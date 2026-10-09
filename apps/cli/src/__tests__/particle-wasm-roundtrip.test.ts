import { expect } from "bun:test";
import { extractThreeSurface } from "../programmatic/engines/three-surface-extract";
import {
	check,
	mesh,
	requestData,
	roundTrip,
	rustSample,
	success,
	THREE,
	threeVersion,
} from "./particle-wasm-roundtrip-support";

function close(
	actual: ArrayLike<number>,
	expected: readonly number[],
	digits = 12,
) {
	expect(actual.length).toBe(expected.length);
	for (let i = 0; i < expected.length; i++)
		expect(actual[i]).toBeCloseTo(expected[i], digits);
}

check("loads the explicit real Three 0.185.1 and new Rust WASM export", () => {
	expect(threeVersion).toBe("0.185.1");
	expect(THREE.REVISION).toBe("185");
	const raw = rustSample(JSON.stringify(requestData(mesh(), 1)));
	expect(JSON.parse(raw)).toMatchObject({ version: 1, ok: true });
});

check(
	"seed replay is byte-identical; changed seeds keep independent triangle geometry",
	() => {
		const object = mesh(undefined, true);
		const data = requestData(object);
		const first = success(data),
			repeat = success(data);
		const changed = success({ ...data, seed: data.seed + 1 });
		expect(repeat.raw).toBe(first.raw);
		expect(repeat.buffers.position).toEqual(first.buffers.position);
		expect(changed.raw).not.toBe(first.raw);
		expect(changed.buffers.position).not.toEqual(first.buffers.position);
		expect(first.buffers.count).toBe(32);
		expect(first.buffers.underflowedComponents).toBe(0);
		for (const [index, sample] of first.samples.entries()) {
			const [a, b, c] = sample.barycentric;
			expect(a + b + c).toBeCloseTo(1, 14);
			expect([a, b, c].every((n) => n >= 0 && n <= 1)).toBe(true);
			close(sample.position, [b, c, 0]);
			close(sample.normal, [0, 0, 1]);
			close(
				first.buffers.position.subarray(index * 3, index * 3 + 3),
				sample.position.map(Math.fround),
				14,
			);
			close(
				first.buffers.barycentric.subarray(index * 3, index * 3 + 3),
				sample.barycentric,
				14,
			);
			expect(first.buffers.triangleIndex[index]).toBe(0);
			expect(first.buffers.materialPresent[index]).toBe(1);
		}
	},
);

check(
	"world area 8:1 controls sampling even when the larger surface faces sideways",
	() => {
		const root = new THREE.Group(),
			small = mesh(),
			large = mesh();
		large.scale.set(4, 2, 1);
		large.rotation.y = Math.PI / 2;
		large.position.set(10, 0, 0);
		root.add(small, large);
		const output = success(requestData(root, 4096, 17));
		const smallCount = output.samples.filter(
			(sample) => sample.triangleIndex === 0,
		).length;
		// Both local areas are 1/2; scaling the two tangent axes by 4 and 2
		// gives the side-facing triangle world area 4, independently of screen area.
		expect(Math.abs(smallCount / 4096 - 1 / 9)).toBeLessThan(0.02);
		expect(
			output.samples.every((sample) => {
				const [x, y, z] = sample.position;
				return sample.triangleIndex === 0
					? x >= 0 && y >= 0 && x + y <= 1 + 1e-12 && z === 0
					: Math.abs(x - 10) < 1e-12 &&
							y >= 0 &&
							z <= 0 &&
							y / 2 - z / 4 <= 1 + 1e-12;
			}),
		).toBe(true);
		expect(new Set(output.buffers.primitiveIndex)).toEqual(new Set([0, 1]));
		expect(new Set(output.buffers.materialIndex)).toEqual(new Set([0, 1]));
	},
);

check(
	"mirrored winding agrees with inverse-transpose and generated normals, retaining UV",
	() => {
		for (const withNormals of [false, true]) {
			const object = mesh([0, 0, 0, 0, 1, 0, 0, 0, 1]);
			object.scale.set(-2, 3, 4);
			object.geometry.setAttribute(
				"uv",
				new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2),
			);
			if (withNormals)
				object.geometry.setAttribute(
					"normal",
					new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3),
				);
			const output = success(requestData(object, 12));
			for (const [index, sample] of output.samples.entries()) {
				const [x, y, z] = sample.position;
				expect(x).toBe(0);
				expect(y / 3 + z / 4).toBeLessThanOrEqual(1 + 1e-12);
				close(sample.normal, [-1, 0, 0]);
				close(sample.uv!, [y / 3, z / 4]);
				close(
					output.buffers.normal.subarray(index * 3, index * 3 + 3),
					[-1, 0, 0],
				);
			}
		}
	},
);

check(
	"mixed UV/color presence and materials remain associated through real Rust and buffers",
	() => {
		const root = new THREE.Group(),
			rich = mesh(undefined, true),
			bare = mesh();
		rich.geometry.setAttribute(
			"uv",
			new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2),
		);
		rich.geometry.setAttribute(
			"color",
			new THREE.Float32BufferAttribute(
				[1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0.25],
				4,
			),
		);
		rich.material.color.setRGB(0.1, 0.2, 0.3);
		rich.material.opacity = 0.125;
		bare.position.x = 10;
		root.add(rich, bare);
		const extracted = extractThreeSurface(root);
		expect(extracted.materials[0]).toBe(rich.material);
		expect(extracted.materials[1]).toBe(bare.material);
		const output = success({
			triangles: extracted.triangles,
			count: 64,
			seed: 5,
		});
		expect(new Set(output.buffers.uvPresent)).toEqual(new Set([0, 1]));
		for (const [index, sample] of output.samples.entries()) {
			const isRich = sample.triangleIndex === 0;
			expect(output.buffers.primitiveIndex[index]).toBe(sample.triangleIndex);
			expect(output.buffers.materialIndex[index]).toBe(isRich ? 0 : 1);
			expect(output.buffers.materialPresent[index]).toBe(1);
			expect(output.buffers.uvPresent[index]).toBe(isRich ? 1 : 0);
			expect(output.buffers.colorPresent[index]).toBe(isRich ? 1 : 0);
			if (isRich) {
				const [x, y] = sample.position;
				close(sample.uv!, [x, y]);
				close(sample.color!, [1 - x - y, x, y, 1 - 0.5 * x - 0.75 * y]);
				close(
					output.buffers.color.subarray(index * 4, index * 4 + 4),
					sample.color!.map(Math.fround),
					14,
				);
			} else {
				expect(sample.position[0]).toBeGreaterThanOrEqual(10);
				expect(sample.uv).toBeUndefined();
				expect(sample.color).toBeUndefined();
				close(output.buffers.uv.subarray(index * 2, index * 2 + 2), [0, 0]);
				close(
					output.buffers.color.subarray(index * 4, index * 4 + 4),
					[0, 0, 0, 0],
				);
			}
		}
	},
);

check(
	"optional material wire variant distinguishes missing from real material zero",
	() => {
		const root = new THREE.Group();
		root.add(mesh(), mesh());
		const data = requestData(root, 64);
		// Real Three always supplies a material binding. This explicit wire-only
		// variant additionally exercises Rust's optional material field and mask.
		delete data.triangles[1].materialIndex;
		const output = success(data);
		expect(new Set(output.buffers.materialPresent)).toEqual(new Set([0, 1]));
		for (const [index, sample] of output.samples.entries()) {
			expect(output.buffers.materialIndex[index]).toBe(0);
			expect(output.buffers.materialPresent[index]).toBe(
				sample.triangleIndex === 0 ? 1 : 0,
			);
		}
	},
);

check(
	"Rust sample cap, all-degenerate and numeric-range errors survive both envelopes unchanged",
	() => {
		const extreme = mesh([
			-Number.MAX_VALUE,
			0,
			0,
			Number.MAX_VALUE,
			Number.MIN_VALUE,
			0,
			-Number.MAX_VALUE,
			1,
			0,
		]);
		// Finite input with overflowing x edge and minimum-subnormal y edge:
		// Rust must report unrepresentable dynamic range, not emit partial samples.
		const cases = [
			{ data: requestData(mesh(), 65_537), code: "sampleCount" },
			{ data: requestData(mesh(Array(9).fill(0))), code: "allDegenerate" },
			{ data: requestData(extreme), code: "numericRange" },
		];
		for (const { data, code } of cases) {
			const output = roundTrip(data);
			expect(output.result.ok).toBe(false);
			if (output.result.ok) throw new Error("Expected real Rust failure");
			expect(output.result.error.code).toBe(code);
			expect(output.result.error.path.length).toBeGreaterThan(0);
			expect(output.result.error.message.length).toBeGreaterThan(0);
			expect(output.result).toEqual(JSON.parse(output.raw));
			expect(Object.hasOwn(output.result, "samples")).toBe(false);
			expect(output.buffers).toBeNull();
			expect(output.wire.ok).toBe(true);
			if (!output.wire.ok)
				throw new Error("Rust errors must preserve raw responseJson");
			expect(output.wire.responseJson).toBe(output.raw);
		}
	},
);
