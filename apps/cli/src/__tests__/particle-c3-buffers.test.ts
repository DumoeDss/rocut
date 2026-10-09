import { expect, test } from "bun:test";
import {
	createThreeParticleBuffers,
	THREE_PARTICLE_BUFFER_LIMITS as caps,
	type RustSurfaceSample,
	type ThreeParticleBufferOptions,
} from "../programmatic/engines/three-particle-buffers";

// Packing fixtures describe wire data only; no motion calculation is replaced.
const sample = (): RustSurfaceSample => ({
	position: [0.2, 0.3, 0],
	normal: [0, 0, 1],
	barycentric: [1 / 3, 1 / 3, 1 / 3],
	uv: [0.25, 0.75],
	color: [0.5, 0.25, 0.125, 1],
	triangleIndex: 16_777_217,
	primitiveIndex: 0xffff_ffff,
	materialIndex: 0,
});
const animated = (): RustSurfaceSample => ({
	...sample(),
	motionPosition: [1.25, 2.5, -3.75],
	size: 0.5,
});
const pack = (
	values: unknown[],
	options: Partial<ThreeParticleBufferOptions> = {},
) =>
	createThreeParticleBuffers(values, {
		expectedCount: values.length,
		maxAllocationBytes: 8192,
		underflow: "reject",
		...options,
	});

test("legacy buffers keep their exact shape and allocation when motion is absent", () => {
	const value = pack([sample()]);
	expect(Object.hasOwn(value, "motionPosition")).toBe(false);
	expect(Object.hasOwn(value, "size")).toBe(false);
	expect(value.bufferBytes).toBe(87);
	expect(value.estimatedAllocationBytes).toBe(4096 + 87);
	expect(value.underflowedComponents).toBe(0);
});

test("motion buffers are separate Float32 copies and preserve every rest association", () => {
	const input = animated();
	const original = structuredClone(input);
	const value = pack([input]);
	const legacy = pack([sample()]);
	for (const key of [
		"position",
		"normal",
		"barycentric",
		"uv",
		"color",
		"triangleIndex",
		"primitiveIndex",
		"materialIndex",
		"uvPresent",
		"colorPresent",
		"materialPresent",
	] as const)
		expect(value[key]).toEqual(legacy[key]);
	expect(value.motionPosition).toBeInstanceOf(Float32Array);
	expect(value.size).toBeInstanceOf(Float32Array);
	expect(value.motionPosition).toEqual(new Float32Array([1.25, 2.5, -3.75]));
	expect(value.size).toEqual(new Float32Array([0.5]));
	expect(value.barycentric[0]).toBe(1 / 3);
	expect(value.triangleIndex[0]).toBe(16_777_217);
	expect(value.primitiveIndex[0]).toBe(0xffff_ffff);
	expect(input).toEqual(original);
	Reflect.set(input.motionPosition!, "0", 99);
	expect(value.motionPosition?.[0]).toBe(1.25);
	expect(value.position).not.toBe(value.motionPosition);
});

test("motion reserves exactly sixteen additional bytes per sample before allocation", () => {
	const values = [animated(), animated()];
	const exact =
		caps.bookkeepingBytes +
		2 * (caps.bytesPerSample + caps.motionBytesPerSample);
	const value = pack(values, { maxAllocationBytes: exact });
	expect(caps.motionBytesPerSample).toBe(16);
	expect(value.bufferBytes).toBe(206);
	expect(value.estimatedAllocationBytes).toBe(exact);
	expect(() => pack(values, { maxAllocationBytes: exact - 1 })).toThrow(
		"allocation budget",
	);
	const legacyBudget = caps.bookkeepingBytes + 2 * caps.bytesPerSample;
	expect(() =>
		pack([sample(), sample()], { maxAllocationBytes: legacyBudget }),
	).not.toThrow();
	expect(() => pack(values, { maxAllocationBytes: legacyBudget })).toThrow(
		"allocation budget",
	);
});

for (const [name, values] of [
	["motion after legacy", [sample(), animated()]],
	["legacy after motion", [animated(), sample()]],
	["position without size", [{ ...sample(), motionPosition: [0, 0, 0] }]],
	["size without position", [{ ...sample(), size: 1 }]],
	[
		"undefined pair",
		[{ ...sample(), motionPosition: undefined, size: undefined }],
	],
	["null pair", [{ ...sample(), motionPosition: null, size: null }]],
] as const) {
	test(`buffer packing rejects inconsistent motion presence: ${name}`, () => {
		expect(() => pack([...values])).toThrow();
	});
}

for (const [name, changes] of [
	["motion position overflow", { motionPosition: [Number.MAX_VALUE, 0, 0] }],
	["size overflow", { size: Number.MAX_VALUE }],
	["nonfinite motion position", { motionPosition: [Infinity, 0, 0] }],
	["nonfinite size", { size: NaN }],
	["negative size", { size: -1 }],
	["zero size", { size: 0 }],
	["wrong position arity", { motionPosition: [0, 0] }],
	["sparse position", { motionPosition: [, 0, 0] }],
] as const) {
	test(`motion buffer rejects ${name} under either underflow policy`, () => {
		for (const underflow of ["reject", "allow-zero"] as const)
			expect(() =>
				pack([{ ...animated(), ...changes }], { underflow }),
			).toThrow();
	});
}

test("new fields share the explicit underflow policy and count all zeroed components", () => {
	const input = {
		...animated(),
		motionPosition: [Number.MIN_VALUE, -Number.MIN_VALUE, 0],
		size: Number.MIN_VALUE,
	};
	expect(() => pack([input])).toThrow("underflows Float32");
	const value = pack([input], { underflow: "allow-zero" });
	expect(value.underflowedComponents).toBe(3);
	expect(Object.is(value.motionPosition?.[0], 0)).toBe(true);
	expect(Object.is(value.motionPosition?.[1], -0)).toBe(true);
	expect(value.size?.[0]).toBe(0);
	expect(value.position).toEqual(pack([sample()]).position);
	expect(input.size).toBe(Number.MIN_VALUE);
});

test("size-only underflow fails independently of valid motion position", () => {
	expect(() => pack([{ ...animated(), size: Number.MIN_VALUE }])).toThrow(
		"size[0] underflows Float32",
	);
});
