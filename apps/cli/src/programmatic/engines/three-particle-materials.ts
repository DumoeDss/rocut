import {
	particleTexturePixel,
	snapshotParticleTexture,
} from "./three-particle-material-textures";
import {
	materialBoolean,
	materialFail as fail,
	materialInteger,
	materialNumber,
	materialRecord,
	materialUnit,
	THREE_PARTICLE_MATERIAL_LIMITS as CAPS,
	type MaterialSnapshot,
	type TextureSnapshot,
	type ThreeParticleMaterialBuffers,
	type ThreeParticleMaterialLimits,
	type ThreeParticleMaterialOptions,
	type ThreeParticleMaterialSample,
	type ThreeParticleMaterialsSnapshot,
} from "./three-particle-material-types";
export { THREE_PARTICLE_MATERIAL_LIMITS } from "./three-particle-material-types";
export type {
	ThreeParticleMaterialBuffers,
	ThreeParticleMaterialLimits,
	ThreeParticleMaterialOptions,
	ThreeParticleMaterialSample,
	ThreeParticleMaterialsSnapshot,
} from "./three-particle-material-types";

const snapshots = new WeakMap<
	ThreeParticleMaterialsSnapshot,
	readonly MaterialSnapshot[]
>();
const TYPES = [
	"MeshBasicMaterial",
	"MeshLambertMaterial",
	"MeshPhongMaterial",
	"MeshStandardMaterial",
	"MeshPhysicalMaterial",
];

function checkMaterial(material: Record<string, unknown>) {
	if (
		material.isMaterial !== true ||
		!TYPES.includes(material.type as string) ||
		material[`is${material.type}`] !== true
	)
		fail(
			"only Basic/Lambert/Phong/Standard/Physical base-color materials are supported",
		);
	for (const name of [
		"wireframe",
		"isShaderMaterial",
		"isRawShaderMaterial",
		"alphaHash",
		"alphaToCoverage",
		"premultipliedAlpha",
	])
		if (material[name]) fail(`${name} is unsupported`);
	if (material.transmission !== undefined && material.transmission !== 0)
		fail("transmission is unsupported");
	if (material.blending !== 1)
		fail("only NormalBlending base-color alpha semantics are supported");
	if (
		material.clippingPlanes != null &&
		(!Array.isArray(material.clippingPlanes) || material.clippingPlanes.length)
	)
		fail("material clipping planes are unsupported");
	for (const key of Object.keys(material))
		if (
			(key.endsWith("Map") || key === "envMap") &&
			key !== "alphaMap" &&
			material[key] != null
		)
			fail(`unsupported material texture ${key}`);
	for (const name of [
		"onBeforeCompile",
		"onBeforeRender",
		"customProgramCacheKey",
	]) {
		let declarations = 0,
			depth = 0;
		for (
			let prototype: object | null = material;
			prototype;
			prototype = Object.getPrototypeOf(prototype)
		) {
			if (++depth > 32) fail("material prototype limit exceeded");
			const hook = Object.getOwnPropertyDescriptor(prototype, name);
			if (
				hook &&
				(prototype === material ||
					++declarations > 1 ||
					typeof hook.value !== "function")
			)
				fail(`custom ${name} hooks are unsupported`);
		}
		if (declarations !== 1) fail(`unsupported material ${name} protocol`);
	}
}

/**
 * Synchronously snapshots static Three rendering state before the async Rust sample
 * request. This is unlit linear base color, not material lighting/shading: normal,
 * roughness, metalness, emissive lighting, tone mapping and blending are not applied.
 * Non-base texture channels and shader hooks fail explicitly. Browser pixels are
 * sRGB RGBA8 unpremultiplied canvas readback, with browser color/alpha precision
 * semantics; only DataTexture pixels retain the input bytes exactly.
 *
 * Allocation is a logical reservation for copied texels, temporary canvas/readback
 * and bounded records. Source resources, caller data and actual JS/GPU heap are
 * excluded. No input material, matrix, image or texture is modified or retained.
 */
export function snapshotThreeParticleMaterials(
	materials: readonly unknown[],
	limits: ThreeParticleMaterialLimits = {},
): ThreeParticleMaterialsSnapshot {
	const supplied = materialRecord(limits);
	const keys = [
		"maxMaterials",
		"maxTextures",
		"maxTextureDimension",
		"maxAllocationBytes",
	] as const;
	for (const key of Object.keys(supplied))
		if (!keys.includes(key as (typeof keys)[number]))
			fail(`unknown snapshot limit ${key}`);
	const budget = Object.fromEntries(
		keys.map((key) => [
			key,
			materialInteger(
				supplied[key] === undefined ? CAPS[key] : supplied[key],
				key,
				CAPS[key],
			),
		]),
	) as Record<(typeof keys)[number], number>;
	if (!Array.isArray(materials) || materials.length > budget.maxMaterials)
		return fail("material count exceeds limit");
	for (let index = 0; index < materials.length; index++)
		if (!Object.hasOwn(materials, index))
			fail("material list must not be sparse");
	let allocatedBytes =
		CAPS.bookkeepingBytes + materials.length * CAPS.materialBytes;
	const reserve = (bytes: number) => {
		allocatedBytes += bytes;
		if (allocatedBytes > budget.maxAllocationBytes)
			fail("snapshot allocation budget exceeded");
	};
	reserve(0);
	const textures = new Map<object, TextureSnapshot>();
	const getTexture = (value: unknown): TextureSnapshot | undefined => {
		if (value == null) return undefined;
		const object = materialRecord(value);
		const found = textures.get(object);
		if (found) return found;
		if (textures.size >= budget.maxTextures)
			fail("texture count exceeds limit");
		reserve(CAPS.textureBytes);
		const snapshot = snapshotParticleTexture(
			object,
			budget.maxTextureDimension,
			reserve,
		);
		textures.set(object, snapshot);
		return snapshot;
	};
	const values = materials.map((source): MaterialSnapshot => {
		const material = materialRecord(source);
		checkMaterial(material);
		const color = materialRecord(material.color);
		const rgb = [color.r, color.g, color.b].map((value) =>
			materialNumber(value, "material color"),
		);
		if (rgb.some((value) => value < 0))
			fail("material color must be nonnegative");
		return {
			color: rgb as [number, number, number],
			opacity: materialUnit(material.opacity, "opacity"),
			vertexColors: materialBoolean(material.vertexColors, "vertexColors"),
			alphaTest: materialUnit(material.alphaTest, "alphaTest"),
			transparent: materialBoolean(material.transparent, "transparent"),
			visible: materialBoolean(material.visible, "visible"),
			map: getTexture(material.map),
			alphaMap: getTexture(material.alphaMap),
		};
	});
	const result: ThreeParticleMaterialsSnapshot = Object.freeze({
		version: 1,
		mode: "base-color",
		sampling: "nearest-base-level",
		output: "linear-base-color",
		browserPixels: "srgb-rgba8-unpremultiplied-readback",
		materialCount: values.length,
		textureCount: textures.size,
		allocatedBytes,
	});
	snapshots.set(result, values);
	return result;
}

function sampleVector(
	value: unknown,
	size: number,
	name: string,
): readonly number[] {
	if (!Array.isArray(value) || value.length !== size)
		return fail(`${name} must have ${size} components`);
	for (let index = 0; index < size; index++) materialNumber(value[index], name);
	return value;
}

/** Evaluates only copied material state, preserving the Rust samples unchanged. */
export function evaluateThreeParticleMaterials(
	samples: readonly ThreeParticleMaterialSample[],
	snapshot: ThreeParticleMaterialsSnapshot,
	options: ThreeParticleMaterialOptions,
): ThreeParticleMaterialBuffers {
	const values = snapshots.get(snapshot);
	if (!values)
		return fail("snapshot was not created by this material evaluator");
	const input = materialRecord(options);
	const maxAllocationBytes = materialInteger(
		input.maxAllocationBytes,
		"maxAllocationBytes",
		CAPS.maxAllocationBytes,
	);
	const underflow = input.underflow;
	if (underflow !== "reject" && underflow !== "allow-zero")
		fail("underflow policy must explicitly be reject or allow-zero");
	if (!Array.isArray(samples) || samples.length > CAPS.maxSamples)
		return fail("sample count exceeds limit");
	const allocatedBytes =
		CAPS.bookkeepingBytes + samples.length * CAPS.bytesPerSample;
	if (allocatedBytes > maxAllocationBytes)
		fail("output allocation budget exceeded");
	const color = new Float32Array(samples.length * 4);
	const visible = new Uint8Array(samples.length);
	let underflowedComponents = 0;
	for (let index = 0; index < samples.length; index++) {
		const sample = materialRecord(samples[index]);
		if (
			!Number.isSafeInteger(sample.materialIndex) ||
			(sample.materialIndex as number) < 0 ||
			(sample.materialIndex as number) >= values.length
		)
			fail(`samples[${index}] requires a valid materialIndex`);
		const material = values[sample.materialIndex as number];
		const rgba = [...material.color, material.opacity];
		if (material.vertexColors && sample.color !== undefined) {
			const vertex = sampleVector(sample.color, 4, "vertex color");
			if (vertex.some((value) => value < 0))
				fail("vertex color must be nonnegative");
			materialUnit(vertex[3], "vertex alpha");
			for (let channel = 0; channel < 4; channel++)
				rgba[channel] *= vertex[channel];
		}
		if (material.map || material.alphaMap) {
			const uv = sampleVector(sample.uv, 2, "UV0") as readonly [number, number];
			if (material.map) {
				const pixel = particleTexturePixel(material.map, uv);
				for (let channel = 0; channel < 4; channel++)
					rgba[channel] *= pixel[channel];
			}
			if (material.alphaMap)
				rgba[3] *= particleTexturePixel(material.alphaMap, uv)[1];
		}
		// Alpha test precedes opaque alpha override in the pinned Three shaders.
		visible[index] = material.visible && rgba[3] >= material.alphaTest ? 1 : 0;
		if (!material.transparent) rgba[3] = 1;
		for (let channel = 0; channel < 4; channel++) {
			const value = rgba[channel],
				rounded = Math.fround(value);
			if (!Number.isFinite(value) || !Number.isFinite(rounded))
				fail("material color overflows Float32");
			if (value !== 0 && rounded === 0) {
				if (underflow === "reject") fail("material color underflows Float32");
				underflowedComponents++;
			}
			color[index * 4 + channel] = rounded;
		}
	}
	return { color, visible, allocatedBytes, underflowedComponents };
}
