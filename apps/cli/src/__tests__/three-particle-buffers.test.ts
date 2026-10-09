import { expect, test } from "bun:test";
import {
	createThreeParticleBuffers,
	THREE_PARTICLE_BUFFER_LIMITS,
	type RustSurfaceSample,
	type ThreeParticleBufferOptions,
} from "../programmatic/engines/three-particle-buffers";

const sample = (
	overrides: Partial<RustSurfaceSample> = {},
): RustSurfaceSample => ({
	position: [0.1, -2, 3],
	normal: [0, 0, 1],
	uv: [0.25, 0.75],
	color: [0.1, 0.2, 0.3, 1],
	barycentric: [0.1, 0.2, 0.7],
	triangleIndex: 3,
	primitiveIndex: 7,
	materialIndex: 11,
	...overrides,
});
const options = (expectedCount = 1): ThreeParticleBufferOptions => ({
	expectedCount,
	maxAllocationBytes: THREE_PARTICLE_BUFFER_LIMITS.maxAllocationBytes,
	underflow: "reject",
});
const payloadKeys = [
	"position",
	"normal",
	"uv",
	"color",
	"barycentric",
	"triangleIndex",
	"primitiveIndex",
	"materialIndex",
	"uvPresent",
	"colorPresent",
	"materialPresent",
] as const;

test("packs the Rust wire layout into independent typed buffers with exact payload accounting", () => {
	const input = sample();
	const result = createThreeParticleBuffers([input], options());
	expect(result.count).toBe(1);
	for (const field of ["position", "normal", "uv", "color"] as const)
		expect(result[field]).toBeInstanceOf(Float32Array);
	expect(result.barycentric).toBeInstanceOf(Float64Array);
	for (const field of [
		"triangleIndex",
		"primitiveIndex",
		"materialIndex",
	] as const)
		expect(result[field]).toBeInstanceOf(Uint32Array);
	for (const field of [
		"uvPresent",
		"colorPresent",
		"materialPresent",
	] as const) {
		expect(result[field]).toBeInstanceOf(Uint8Array);
		expect(Array.from(result[field])).toEqual([1]);
	}
	expect(Array.from(result.position)).toEqual(input.position.map(Math.fround));
	expect(Array.from(result.normal)).toEqual(Array.from(input.normal));
	expect(Array.from(result.uv)).toEqual(Array.from(input.uv!));
	expect(Array.from(result.color)).toEqual(input.color!.map(Math.fround));
	expect(Array.from(result.barycentric)).toEqual(Array.from(input.barycentric));
	expect(Array.from(result.triangleIndex)).toEqual([3]);
	expect(Array.from(result.primitiveIndex)).toEqual([7]);
	expect(Array.from(result.materialIndex)).toEqual([11]);
	expect(result.bufferBytes).toBe(87);
	expect(
		payloadKeys.reduce((bytes, key) => bytes + result[key].byteLength, 0),
	).toBe(result.bufferBytes);
	expect(new Set(payloadKeys.map((key) => result[key].buffer)).size).toBe(11);
	expect(result.estimatedAllocationBytes).toBe(87 + 4096);
	expect(result.underflowedComponents).toBe(0);
});

test("mixed optional presence preserves order and distinguishes absent material from 0 and u32 MAX", () => {
	const missing = sample({ position: [1, 0, 0], triangleIndex: 1 });
	delete missing.uv;
	delete missing.color;
	delete missing.materialIndex;
	const input = [
		missing,
		sample({
			position: [2, 0, 0],
			uv: [0, 0],
			color: [0, 0, 0, 0],
			materialIndex: 0,
			triangleIndex: 2,
		}),
		sample({
			position: [3, 0, 0],
			materialIndex: 0xffff_ffff,
			triangleIndex: 3,
		}),
	];
	const result = createThreeParticleBuffers(input, options(3));
	expect(Array.from(result.position)).toEqual([1, 0, 0, 2, 0, 0, 3, 0, 0]);
	expect(Array.from(result.triangleIndex)).toEqual([1, 2, 3]);
	expect(Array.from(result.materialIndex)).toEqual([0, 0, 0xffff_ffff]);
	expect(Array.from(result.materialPresent)).toEqual([0, 1, 1]);
	expect(Array.from(result.uvPresent)).toEqual([0, 1, 1]);
	expect(Array.from(result.colorPresent)).toEqual([0, 1, 1]);
	expect(Array.from(result.uv.subarray(0, 4))).toEqual([0, 0, 0, 0]);
	expect(Array.from(result.color.subarray(0, 8))).toEqual([
		0, 0, 0, 0, 0, 0, 0, 0,
	]);
});

test("UV and color presence are independent rather than a shared material flag", () => {
	const a = sample();
	delete a.color;
	delete a.materialIndex;
	const b = sample();
	delete b.uv;
	const c = sample();
	delete c.uv;
	delete c.color;
	const result = createThreeParticleBuffers([a, b, c], options(3));
	expect(Array.from(result.uvPresent)).toEqual([1, 0, 0]);
	expect(Array.from(result.colorPresent)).toEqual([0, 1, 0]);
	expect(Array.from(result.materialPresent)).toEqual([0, 1, 1]);
});

test("barycentrics keep f64 precision and large integer associations never pass through Float32", () => {
	const input = sample({
		triangleIndex: 2 ** 24 + 1,
		primitiveIndex: 0xffff_fffe,
		materialIndex: 0xffff_ffff,
		barycentric: [Number.MIN_VALUE, 1 / 3, 2 / 3],
	});
	const result = createThreeParticleBuffers([input], options());
	expect(result.triangleIndex[0]).toBe(2 ** 24 + 1);
	expect(result.primitiveIndex[0]).toBe(0xffff_fffe);
	expect(result.materialIndex[0]).toBe(0xffff_ffff);
	expect(Array.from(result.barycentric)).toEqual(Array.from(input.barycentric));
	expect(result.barycentric[1]).not.toBe(Math.fround(1 / 3));
	expect(result.underflowedComponents).toBe(0);
});

test("explicit underflow policy either rejects or reports signed zero without changing barycentrics", () => {
	const input = sample({
		position: [Number.MIN_VALUE, -Number.MIN_VALUE, -0],
		normal: [1, Number.MIN_VALUE, 0],
		uv: [Number.MIN_VALUE, -0],
		color: [0, 0, Number.MIN_VALUE, 1],
		barycentric: [Number.MIN_VALUE, 0.5, 0.5],
	});
	expect(() => createThreeParticleBuffers([input], options())).toThrow(
		"underflows Float32",
	);
	const result = createThreeParticleBuffers([input], {
		...options(),
		underflow: "allow-zero",
	});
	expect(result.underflowedComponents).toBe(5);
	expect(Object.is(result.position[0], 0)).toBe(true);
	expect(Object.is(result.position[1], -0)).toBe(true);
	expect(Object.is(result.position[2], -0)).toBe(true);
	expect(Object.is(result.uv[1], -0)).toBe(true);
	expect(result.barycentric[0]).toBe(Number.MIN_VALUE);
	expect(result.normal[0]).toBe(1);
});

test("Float32 subnormals are preserved and every Float32 field rejects overflow in either policy", () => {
	const tiny = 2 ** -149;
	const largest = 3.4028234663852886e38;
	const result = createThreeParticleBuffers(
		[sample({ position: [tiny, -tiny, largest] })],
		options(),
	);
	expect(Array.from(result.position)).toEqual([tiny, -tiny, largest]);
	expect(result.underflowedComponents).toBe(0);
	for (const field of ["position", "normal", "uv", "color"] as const) {
		for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
			const input = sample();
			const values = [...input[field]!];
			values[0] = value;
			for (const underflow of ["reject", "allow-zero"] as const)
				expect(() =>
					createThreeParticleBuffers([{ ...input, [field]: values }], {
						...options(),
						underflow,
					}),
				).toThrow("overflows Float32");
		}
	}
});

test("fixed vector shapes and finite entries are required, including optional attributes", () => {
	for (const field of [
		"position",
		"normal",
		"uv",
		"color",
		"barycentric",
	] as const) {
		const length = sample()[field]!.length;
		for (const invalid of [
			null,
			undefined,
			1,
			{},
			new Float32Array(length),
			Array(length),
			Array(length - 1).fill(0),
			Array(length + 1).fill(0),
		])
			expect(() =>
				createThreeParticleBuffers(
					[{ ...sample(), [field]: invalid }],
					options(),
				),
			).toThrow(field);
		for (const invalid of [NaN, Infinity, -Infinity, "0", null, undefined]) {
			const values: unknown[] = Array(length).fill(0);
			values[length - 1] = invalid;
			expect(() =>
				createThreeParticleBuffers(
					[{ ...sample(), [field]: values }],
					options(),
				),
			).toThrow("finite");
		}
	}
});

test("all association fields reject fractional, nonnumeric and out-of-u32 values", () => {
	for (const field of ["triangleIndex", "primitiveIndex", "materialIndex"])
		for (const invalid of [
			-1,
			0.5,
			0x1_0000_0000,
			Number.MAX_SAFE_INTEGER + 1,
			NaN,
			Infinity,
			"1",
			null,
			undefined,
		])
			expect(() =>
				createThreeParticleBuffers(
					[{ ...sample(), [field]: invalid }],
					options(),
				),
			).toThrow("exact u32");
});

test("required fields and dense sample arrays cannot be replaced by partial or inherited records", () => {
	for (const field of [
		"position",
		"normal",
		"barycentric",
		"triangleIndex",
		"primitiveIndex",
	]) {
		const invalid: Record<string, unknown> = { ...sample() };
		delete invalid[field];
		expect(() => createThreeParticleBuffers([invalid], options())).toThrow(
			"required",
		);
	}
	for (const invalid of [
		null,
		undefined,
		[],
		1,
		"sample",
		Object.create(sample()),
	])
		expect(() => createThreeParticleBuffers([invalid], options())).toThrow(
			"Three particle buffers:",
		);
	expect(() => createThreeParticleBuffers(Array(1), options())).toThrow(
		"missing",
	);
});

test("count, explicit policy and allocation caps reject malformed options without inferred defaults", () => {
	for (const expectedCount of [0, -1, 0.5, 65537, NaN, Infinity])
		expect(() =>
			createThreeParticleBuffers([sample()], { ...options(), expectedCount }),
		).toThrow("expectedCount");
	for (const maxAllocationBytes of [0, -1, 0.5, 8388609, NaN, Infinity])
		expect(() =>
			createThreeParticleBuffers([sample()], {
				...options(),
				maxAllocationBytes,
			}),
		).toThrow("maxAllocationBytes");
	for (const invalid of [
		null,
		undefined,
		{},
		{ ...options(), underflow: undefined },
		{ ...options(), underflow: "clamp" },
	])
		expect(() =>
			createThreeParticleBuffers(
				[sample()],
				invalid as ThreeParticleBufferOptions,
			),
		).toThrow("Three particle buffers:");
	for (const invalid of [null, {}, [], [sample(), sample()]])
		expect(() => createThreeParticleBuffers(invalid, options())).toThrow(
			"samples length",
		);
});

test("exact new-allocation budget is admitted and insufficient budget precedes all sample reads", () => {
	const required = 87 + 4096;
	expect(
		createThreeParticleBuffers([sample()], {
			...options(),
			maxAllocationBytes: required,
		}).estimatedAllocationBytes,
	).toBe(required);
	let read = false;
	const input = {
		get position() {
			read = true;
			throw Error("sample read before budget");
		},
	};
	expect(() =>
		createThreeParticleBuffers([input], {
			...options(),
			maxAllocationBytes: required - 1,
		}),
	).toThrow("allocation budget");
	expect(read).toBe(false);
});

test("an invalid final sample is rejected before allocating any output typed array", () => {
	let allocations = 0;
	const globals = globalThis as unknown as Record<string, unknown>;
	const constructors = [
		"Float32Array",
		"Float64Array",
		"Uint32Array",
		"Uint8Array",
	] as const;
	const originals = constructors.map((name) => globals[name]);
	try {
		for (const name of constructors)
			globals[name] = new Proxy(globals[name] as typeof Float32Array, {
				construct() {
					allocations++;
					throw Error("output allocation before validation");
				},
			});
		expect(() =>
			createThreeParticleBuffers(
				[sample(), sample(), { ...sample(), materialIndex: 0x1_0000_0000 }],
				options(3),
			),
		).toThrow("exact u32");
		expect(allocations).toBe(0);
	} finally {
		constructors.forEach((name, index) => {
			globals[name] = originals[index];
		});
	}
});

test("maximum count remains within the adapter cap and every buffer has its exact bounded length", () => {
	const count = THREE_PARTICLE_BUFFER_LIMITS.maxSamples;
	const input = sample();
	const result = createThreeParticleBuffers(
		Array(count).fill(input),
		options(count),
	);
	expect(result.position.length).toBe(count * 3);
	expect(result.normal.length).toBe(count * 3);
	expect(result.uv.length).toBe(count * 2);
	expect(result.color.length).toBe(count * 4);
	expect(result.barycentric.length).toBe(count * 3);
	for (const field of [
		"triangleIndex",
		"primitiveIndex",
		"materialIndex",
		"uvPresent",
		"colorPresent",
		"materialPresent",
	] as const)
		expect(result[field].length).toBe(count);
	expect(result.bufferBytes).toBe(5_701_632);
	expect(result.estimatedAllocationBytes).toBe(5_705_728);
	expect(result.materialIndex[count - 1]).toBe(11);
	expect(result.materialPresent[count - 1]).toBe(1);
});

test("conversion is deterministic and owns its output without modifying Rust JSON samples", () => {
	const input = Object.freeze({
		...sample(),
		position: Object.freeze([0.1, 2, 3] as const),
	});
	const before = JSON.stringify(input);
	const first = createThreeParticleBuffers([input], options());
	const second = createThreeParticleBuffers([input], options());
	for (const key of payloadKeys)
		expect(Array.from(first[key])).toEqual(Array.from(second[key]));
	first.position[0] = 99;
	first.materialPresent[0] = 0;
	first.barycentric[0] = 1;
	expect(JSON.stringify(input)).toBe(before);
	expect(second.position[0]).toBe(Math.fround(0.1));
	expect(second.materialPresent[0]).toBe(1);
	expect(second.barycentric[0]).toBe(0.1);
});
