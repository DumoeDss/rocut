import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	evaluateThreeParticleMaterials as evaluate,
	snapshotThreeParticleMaterials as snapshot,
	THREE_PARTICLE_MATERIAL_LIMITS as CAPS,
	type ThreeParticleMaterialSample,
	type ThreeParticleMaterialsSnapshot,
} from "../programmatic/engines/three-particle-materials";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
const THREE = toolchain
	? await import(
			pathToFileURL(join(toolchain, "node_modules/three/build/three.module.js"))
				.href
		)
	: undefined;
const check = test.skipIf(!THREE);
const options = { maxAllocationBytes: 65536, underflow: "reject" as const };
const sample = (
	patch: ThreeParticleMaterialSample = {},
): ThreeParticleMaterialSample => ({ materialIndex: 0, ...patch });
const basic = () => new THREE.MeshBasicMaterial();
function texture(
	pixels = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 255, 255, 255, 0],
) {
	return new THREE.DataTexture(new Uint8Array(pixels), 2, 2);
}
function approx(actual: ArrayLike<number>, expected: readonly number[]) {
	expect(actual.length).toBe(expected.length);
	expected.forEach((value, index) =>
		expect(actual[index]).toBeCloseTo(value, 6),
	);
}

check("five pinned material types yield unlit linear base color", () => {
	expect(THREE.REVISION).toBe("185");
	for (const kind of [
		"MeshBasicMaterial",
		"MeshLambertMaterial",
		"MeshPhongMaterial",
		"MeshStandardMaterial",
		"MeshPhysicalMaterial",
	]) {
		const material = new THREE[kind]();
		material.color.setRGB(0.25, 0.5, 2);
		material.opacity = 0.2;
		material.transparent = true;
		const state = snapshot([material]);
		expect(state.mode).toBe("base-color");
		expect(state.sampling).toBe("nearest-base-level");
		expect(state.output).toBe("linear-base-color");
		approx(evaluate([sample()], state, options).color, [0.25, 0.5, 2, 0.2]);
	}
});

check(
	"material binding and vertex RGBA multiplication preserve samples",
	() => {
		const first = basic(),
			second = basic();
		first.color.setRGB(0.5, 1, 0.25);
		first.vertexColors = true;
		first.transparent = true;
		first.opacity = 0.5;
		second.color.setRGB(1, 0.25, 0.5);
		const samples = [
			sample({ color: [0.5, 0.25, 2, 0.5] }),
			sample({ materialIndex: 1, color: [0, 0, 0, 0] }),
		];
		const before = JSON.stringify(samples);
		const result = evaluate(samples, snapshot([first, second]), options);
		approx(result.color, [0.25, 0.25, 0.5, 0.25, 1, 0.25, 0.5, 1]);
		expect([...result.visible]).toEqual([1, 1]);
		expect(JSON.stringify(samples)).toBe(before);
		approx(
			evaluate([sample()], snapshot([first]), options).color,
			[0.5, 1, 0.25, 0.5],
		);
	},
);

check(
	"snapshot copies texture bytes and material state without input mutation",
	async () => {
		const material = basic(),
			map = texture();
		material.map = map;
		material.transparent = true;
		map.offset.set(0.1, 0.1);
		const before = JSON.stringify({
			matrix: map.matrix.elements,
			version: map.version,
			color: material.color,
			pixels: [...map.image.data],
		});
		const state = snapshot([material]);
		expect(
			JSON.stringify({
				matrix: map.matrix.elements,
				version: map.version,
				color: material.color,
				pixels: [...map.image.data],
			}),
		).toBe(before);
		await Promise.resolve();
		map.image.data.fill(0);
		map.offset.set(0.75, 0.75);
		material.color.setRGB(0, 0, 0);
		material.opacity = 0;
		approx(
			evaluate([sample({ uv: [0.1, 0.1] })], state, options).color,
			[1, 0, 0, 1],
		);
		expect(Object.isFrozen(state)).toBe(true);
		expect(state.textureCount).toBe(1);
	},
);

check(
	"nearest texel has declared repeat, mirrored-repeat, clamp and flipY boundaries",
	() => {
		const material = basic(),
			map = texture();
		material.map = map;
		const output = (uv: readonly [number, number]) =>
			Array.from(
				evaluate([sample({ uv })], snapshot([material]), options).color,
			).slice(0, 3);
		map.wrapS = THREE.RepeatWrapping;
		expect(output([1, 0])).toEqual([1, 0, 0]);
		expect(output([-0.1, 0])).toEqual([0, 1, 0]);
		map.wrapS = THREE.MirroredRepeatWrapping;
		expect(output([1, 0])).toEqual([0, 1, 0]);
		expect(output([-0.1, 0])).toEqual([1, 0, 0]);
		expect(output([2, 0])).toEqual([1, 0, 0]);
		map.wrapS = THREE.ClampToEdgeWrapping;
		expect(output([2, 0])).toEqual([0, 1, 0]);
		expect(output([-2, 0])).toEqual([1, 0, 0]);
		map.flipY = true;
		expect(output([0, 0])).toEqual([0, 0, 1]);
		expect(output([0, 1])).toEqual([1, 0, 0]);
	},
);

check(
	"automatic UV matrix matches pinned Three transform and does not update input",
	() => {
		const material = basic(),
			map = texture();
		material.map = map;
		map.offset.set(0.17, -0.23);
		map.repeat.set(1.7, 0.8);
		map.center.set(0.31, 0.64);
		map.rotation = 0.73;
		map.wrapS = THREE.MirroredRepeatWrapping;
		map.wrapT = THREE.RepeatWrapping;
		map.flipY = true;
		const matrixBefore = map.matrix.elements.slice();
		const state = snapshot([material]);
		expect(map.matrix.elements).toEqual(matrixBefore);
		const reference = map.clone();
		reference.updateMatrix();
		for (const uv of [
			[-0.2, 0.3],
			[0.25, 0.75],
			[1.3, -1.2],
			[0.51, 0.22],
		]) {
			const expectedUv = reference.transformUv(new THREE.Vector2(...uv));
			const offset =
				(Math.min(1, Math.floor(expectedUv.y * 2)) * 2 +
					Math.min(1, Math.floor(expectedUv.x * 2))) *
				4;
			const expected = [...map.image.data.slice(offset, offset + 3)].map(
				(n) => n / 255,
			);
			approx(
				evaluate(
					[sample({ uv: uv as [number, number] })],
					state,
					options,
				).color.slice(0, 3),
				expected,
			);
		}
	},
);

check("manual map and alphaMap matrices remain independent", () => {
	const material = basic(),
		map = texture(),
		alpha = texture([
			0, 64, 0, 255, 0, 128, 0, 255, 0, 192, 0, 255, 0, 255, 0, 255,
		]);
	material.map = map;
	material.alphaMap = alpha;
	material.transparent = true;
	map.matrixAutoUpdate = false;
	map.matrix.set(1, 0, 0.6, 0, 1, 0, 0, 0, 1);
	alpha.matrixAutoUpdate = false;
	alpha.matrix.set(1, 0, 0, 0, 1, 0.6, 0, 0, 1);
	approx(
		evaluate([sample({ uv: [0, 0] })], snapshot([material]), options).color,
		[0, 1, 0, (128 / 255) * (192 / 255)],
	);
});

check("sRGB RGB decodes while alpha stays linear, alphaMap uses green", () => {
	const material = basic(),
		map = texture([128, 64, 255, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	map.colorSpace = THREE.SRGBColorSpace;
	material.map = map;
	material.transparent = true;
	const expected = new THREE.Color().setRGB(
		128 / 255,
		64 / 255,
		1,
		THREE.SRGBColorSpace,
	);
	approx(
		evaluate([sample({ uv: [0, 0] })], snapshot([material]), options).color,
		[expected.r, expected.g, expected.b, 128 / 255],
	);
	material.alphaMap = map;
	approx(
		evaluate([sample({ uv: [0, 0] })], snapshot([material]), options).color,
		[expected.r, expected.g, expected.b, (128 / 255) * expected.g],
	);
});

check(
	"alphaTest uses strict less-than before opaque override and visibility",
	() => {
		const material = basic();
		material.opacity = 0.25;
		material.alphaTest = 0.25;
		let result = evaluate([sample()], snapshot([material]), options);
		expect([...result.visible]).toEqual([1]);
		expect(result.color[3]).toBe(1);
		material.alphaTest = 0.3;
		result = evaluate([sample()], snapshot([material]), options);
		expect([...result.visible]).toEqual([0]);
		expect(result.color[3]).toBe(1);
		material.alphaTest = 0;
		material.visible = false;
		expect([
			...evaluate([sample()], snapshot([material]), options).visible,
		]).toEqual([0]);
	},
);

check(
	"shared texture has one snapshot and tight pre-allocation budgets",
	() => {
		const material = basic(),
			map = texture();
		material.map = map;
		material.alphaMap = map;
		const expected =
			CAPS.bookkeepingBytes + CAPS.materialBytes + CAPS.textureBytes + 16;
		const state = snapshot([material], { maxAllocationBytes: expected });
		expect(state.allocatedBytes).toBe(expected);
		expect(state.textureCount).toBe(1);
		expect(() =>
			snapshot([material], { maxAllocationBytes: expected - 1 }),
		).toThrow("budget");
		const outputBytes = CAPS.bookkeepingBytes + CAPS.bytesPerSample;
		expect(
			evaluate([sample({ uv: [0, 0] })], state, {
				...options,
				maxAllocationBytes: outputBytes,
			}).allocatedBytes,
		).toBe(outputBytes);
		expect(() =>
			evaluate([sample({ uv: [0, 0] })], state, {
				...options,
				maxAllocationBytes: outputBytes - 1,
			}),
		).toThrow("budget");
		expect(() => snapshot([material, material], { maxMaterials: 1 })).toThrow(
			"count",
		);
		expect(() => snapshot([material], { maxTextureDimension: 1 })).toThrow(
			"width",
		);
		const other = basic();
		other.map = texture();
		expect(() => snapshot([material, other], { maxTextures: 1 })).toThrow(
			"texture count",
		);
	},
);

check("Float32 overflow and explicit underflow policies are enforced", () => {
	const material = basic();
	material.color.setRGB(1e-50, 1, 1);
	const state = snapshot([material]);
	expect(() => evaluate([sample()], state, options)).toThrow("underflows");
	const result = evaluate([sample()], state, {
		...options,
		underflow: "allow-zero",
	});
	expect(result.color[0]).toBe(0);
	expect(result.underflowedComponents).toBe(1);
	material.color.setRGB(1e50, 1, 1);
	expect(() => evaluate([sample()], snapshot([material]), options)).toThrow(
		"overflows",
	);
});

check(
	"rejects invalid bindings, UVs, forged snapshots and sparse materials",
	() => {
		const material = basic(),
			state = snapshot([material]);
		for (const id of [undefined, -1, 1, 0.5, Number.NaN])
			expect(() =>
				evaluate([sample({ materialIndex: id })], state, options),
			).toThrow("materialIndex");
		expect(() =>
			evaluate(
				[sample()],
				{ ...state } as ThreeParticleMaterialsSnapshot,
				options,
			),
		).toThrow("snapshot");
		expect(() => snapshot(new Array(1))).toThrow("sparse");
		material.map = texture();
		for (const uv of [undefined, [0, Number.NaN], [0]])
			expect(() =>
				evaluate(
					[sample({ uv: uv as [number, number] })],
					snapshot([material]),
					options,
				),
			).toThrow();
	},
);

check(
	"rejects shader hooks and active non-base rendering features explicitly",
	() => {
		for (const mutate of [
			(m: ReturnType<typeof basic>) => {
				m.onBeforeCompile = () => {};
			},
			(m: ReturnType<typeof basic>) => {
				m.alphaHash = true;
			},
			(m: ReturnType<typeof basic>) => {
				m.alphaToCoverage = true;
			},
			(m: ReturnType<typeof basic>) => {
				m.premultipliedAlpha = true;
			},
			(m: ReturnType<typeof basic>) => {
				m.displacementMap = texture();
			},
			(m: ReturnType<typeof basic>) => {
				m.normalMap = texture();
			},
			(m: ReturnType<typeof basic>) => {
				m.transmission = 0.1;
			},
		]) {
			const material = basic();
			mutate(material);
			expect(() => snapshot([material])).toThrow("unsupported");
		}
		const additive = basic();
		additive.blending = THREE.AdditiveBlending;
		expect(() => snapshot([additive])).toThrow("NormalBlending");
		expect(() => snapshot([new THREE.ShaderMaterial()])).toThrow("base-color");
	},
);

check(
	"rejects dynamic and unsupported texture forms and malformed storage",
	() => {
		for (const mutate of [
			(t: ReturnType<typeof texture>) => {
				t.isVideoTexture = true;
			},
			(t: ReturnType<typeof texture>) => {
				t.isRenderTargetTexture = true;
			},
			(t: ReturnType<typeof texture>) => {
				t.isCompressedTexture = true;
			},
			(t: ReturnType<typeof texture>) => {
				t.channel = 1;
			},
			(t: ReturnType<typeof texture>) => {
				t.mapping = THREE.CubeReflectionMapping;
			},
			(t: ReturnType<typeof texture>) => {
				t.colorSpace = "display-p3";
			},
			(t: ReturnType<typeof texture>) => {
				t.type = THREE.FloatType;
			},
			(t: ReturnType<typeof texture>) => {
				t.internalFormat = "SRGB8_ALPHA8";
			},
			(t: ReturnType<typeof texture>) => {
				t.premultiplyAlpha = true;
			},
			(t: ReturnType<typeof texture>) => {
				t.image.data = new Uint8Array(3);
			},
			(t: ReturnType<typeof texture>) => {
				t.image.data = new Uint8Array(new SharedArrayBuffer(16));
			},
			(t: ReturnType<typeof texture>) => {
				t.mipmaps = [{}];
			},
		]) {
			const material = basic();
			material.map = texture();
			mutate(material.map);
			expect(() => snapshot([material])).toThrow();
		}
	},
);

check("empty material and sample snapshots stay explicitly budgeted", () => {
	const state = snapshot([]);
	const result = evaluate([], state, options);
	expect(state.materialCount).toBe(0);
	expect(result.color.length).toBe(0);
	expect(result.visible.length).toBe(0);
	expect(result.allocatedBytes).toBe(CAPS.bookkeepingBytes);
});
