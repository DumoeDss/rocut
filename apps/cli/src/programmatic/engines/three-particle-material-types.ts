import type { RustSurfaceSample } from "./three-particle-buffers";

export interface ThreeParticleMaterialLimits {
	maxMaterials?: number;
	maxTextures?: number;
	maxTextureDimension?: number;
	maxAllocationBytes?: number;
}

export interface ThreeParticleMaterialsSnapshot {
	readonly version: 1;
	readonly mode: "base-color";
	readonly sampling: "nearest-base-level";
	readonly output: "linear-base-color";
	readonly browserPixels: "srgb-rgba8-unpremultiplied-readback";
	readonly materialCount: number;
	readonly textureCount: number;
	/** Logical reservation including readback scratch; not a process-heap ceiling. */
	readonly allocatedBytes: number;
}

export interface ThreeParticleMaterialOptions {
	maxAllocationBytes: number;
	underflow: "reject" | "allow-zero";
}

export interface ThreeParticleMaterialBuffers {
	color: Float32Array;
	/** Material visibility and alpha-test acceptance, not camera/depth occlusion. */
	visible: Uint8Array;
	allocatedBytes: number;
	underflowedComponents: number;
}

export type ThreeParticleMaterialSample = Pick<
	RustSurfaceSample,
	"uv" | "color" | "materialIndex"
>;

export interface TextureSnapshot {
	width: number;
	height: number;
	pixels: Uint8Array | Uint8ClampedArray;
	matrix: readonly number[];
	wrapS: number;
	wrapT: number;
	flipY: boolean;
	srgb: boolean;
}

export interface MaterialSnapshot {
	color: readonly [number, number, number];
	opacity: number;
	vertexColors: boolean;
	alphaTest: number;
	transparent: boolean;
	visible: boolean;
	map?: TextureSnapshot;
	alphaMap?: TextureSnapshot;
}

export const THREE_PARTICLE_MATERIAL_LIMITS = Object.freeze({
	maxMaterials: 4096,
	maxTextures: 8192,
	maxTextureDimension: 4096,
	maxAllocationBytes: 64 * 1024 * 1024,
	maxSamples: 65_536,
	bookkeepingBytes: 4096,
	materialBytes: 256,
	textureBytes: 512,
	bytesPerSample: 17,
});

export const materialFail = (reason: string): never => {
	throw Error(`Three particle materials: ${reason}`);
};

export function materialRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return materialFail("expected an object");
	return value as Record<string, unknown>;
}

export function materialNumber(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		return materialFail(`${name} must be finite`);
	return value;
}

export function materialBoolean(value: unknown, name: string): boolean {
	if (typeof value !== "boolean")
		return materialFail(`${name} must be boolean`);
	return value;
}

export function materialUnit(value: unknown, name: string): number {
	const number = materialNumber(value, name);
	if (number < 0 || number > 1) materialFail(`${name} must be within 0..1`);
	return number;
}

export function materialInteger(
	value: unknown,
	name: string,
	max: number,
): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 1 ||
		(value as number) > max
	)
		return materialFail(`${name} must be an integer in 1..${max}`);
	return value as number;
}
