/** JSON data emitted by the Rust SurfaceSample serializer. */
export interface RustSurfaceSample {
	position: readonly [number, number, number];
	motionPosition?: readonly [number, number, number];
	size?: number;
	normal: readonly [number, number, number];
	uv?: readonly [number, number];
	color?: readonly [number, number, number, number];
	barycentric: readonly [number, number, number];
	triangleIndex: number;
	primitiveIndex: number;
	materialIndex?: number;
}

export interface ThreeParticleBufferOptions {
	expectedCount: number;
	/** Logical reservation for new output buffers and fixed bookkeeping only. */
	maxAllocationBytes: number;
	/** Explicit caller policy for a nonzero f64 becoming signed Float32 zero. */
	underflow: "reject" | "allow-zero";
}

export interface ThreeParticleBuffers {
	count: number;
	position: Float32Array;
	/** Separate from rest position so UV/barycentric associations remain intact. */
	motionPosition?: Float32Array;
	size?: Float32Array;
	normal: Float32Array;
	uv: Float32Array;
	color: Float32Array;
	barycentric: Float64Array;
	triangleIndex: Uint32Array;
	primitiveIndex: Uint32Array;
	materialIndex: Uint32Array;
	uvPresent: Uint8Array;
	colorPresent: Uint8Array;
	materialPresent: Uint8Array;
	bufferBytes: number;
	estimatedAllocationBytes: number;
	underflowedComponents: number;
}

// Local transport caps, not published Rust policy or a bound on V8's actual heap.
export const THREE_PARTICLE_BUFFER_LIMITS = Object.freeze({
	maxSamples: 65_536,
	maxAllocationBytes: 8 * 1024 * 1024,
	bytesPerSample: 87,
	motionBytesPerSample: 16,
	bookkeepingBytes: 4096,
});

const fail = (reason: string): never => {
	throw new Error(`Three particle buffers: ${reason}`);
};
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string): boolean => Object.hasOwn(value, key);
const requiredVectors = ["position", "normal", "barycentric"] as const;
const requiredIndices = ["triangleIndex", "primitiveIndex"] as const;

function u32(value: unknown, sample: number, field: string): void {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > 0xffff_ffff
	)
		fail(`samples[${sample}].${field} must be an exact u32 index`);
}

function vector(
	value: unknown,
	length: number,
	float32: boolean,
	underflow: ThreeParticleBufferOptions["underflow"],
	sample: number,
	field: string,
): number {
	if (!Array.isArray(value) || value.length !== length)
		return fail(
			`samples[${sample}].${field} must contain exactly ${length} numbers`,
		);
	let underflowed = 0;
	for (let component = 0; component < length; component++) {
		const number: unknown = value[component];
		if (
			!own(value, String(component)) ||
			typeof number !== "number" ||
			!Number.isFinite(number)
		)
			fail(`samples[${sample}].${field}[${component}] must be finite`);
		if (!float32) continue;
		const rounded = Math.fround(number as number);
		if (!Number.isFinite(rounded))
			fail(`samples[${sample}].${field}[${component}] overflows Float32`);
		if (number !== 0 && rounded === 0) {
			if (underflow === "reject")
				fail(`samples[${sample}].${field}[${component}] underflows Float32`);
			underflowed++;
		}
	}
	return underflowed;
}

function validateSample(
	value: unknown,
	index: number,
	policy: ThreeParticleBufferOptions["underflow"],
	motion: boolean,
): number {
	if (!record(value)) return fail(`samples[${index}] must be a JSON object`);
	let underflowed = 0;
	if (own(value, "motionPosition") !== motion || own(value, "size") !== motion)
		fail(`samples[${index}] has inconsistent motion fields`);
	if (motion) {
		underflowed += vector(
			value.motionPosition,
			3,
			true,
			policy,
			index,
			"motionPosition",
		);
		underflowed += vector([value.size], 1, true, policy, index, "size");
		if ((value.size as number) <= 0)
			fail(`samples[${index}].size must be positive`);
	}
	for (const field of requiredVectors) {
		if (!own(value, field)) fail(`samples[${index}].${field} is required`);
		underflowed += vector(
			value[field],
			3,
			field !== "barycentric",
			policy,
			index,
			field,
		);
	}
	if (own(value, "uv"))
		underflowed += vector(value.uv, 2, true, policy, index, "uv");
	if (own(value, "color"))
		underflowed += vector(value.color, 4, true, policy, index, "color");
	for (const field of requiredIndices) {
		if (!own(value, field)) fail(`samples[${index}].${field} is required`);
		u32(value[field], index, field);
	}
	if (own(value, "materialIndex"))
		u32(value.materialIndex, index, "materialIndex");
	return underflowed;
}

/**
 * Packs bounded, already-parsed Rust JSON samples; does not sample, normalize,
 * animate, evaluate materials or revalidate geometric invariants. Input must be
 * ordinary JSON data, not live accessors/proxies or shared mutable objects.
 *
 * All samples are checked before allocating any output buffer. Logical admission
 * is (87 + optional motion 16) * count bytes + 4 KiB; input JSON, existing JS sample
 * objects, bridge/CDP copies, V8 allocator/GC overhead and later GPU copies are
 * excluded. This is not a strict process-heap ceiling.
 *
 * Position/normal/UV/RGBA use IEEE Float32 rounding. Barycentrics retain f64 as
 * CPU-side association data; do not bind that Float64 array as a GPU attribute.
 * Optional fields may vary per sample. Zero-filled missing slots are invalid
 * unless their presence mask is 1; material 0 and u32::MAX remain real IDs.
 * Keep index arrays integer when binding to GPU; converting them to Float32 can
 * lose IDs above 2^24. The caller chooses geometry attribute names/item sizes.
 */
export function createThreeParticleBuffers(
	samples: unknown,
	options: ThreeParticleBufferOptions,
): ThreeParticleBuffers {
	if (!record(options)) return fail("options must be an object");
	const { expectedCount, maxAllocationBytes, underflow } = options;
	const caps = THREE_PARTICLE_BUFFER_LIMITS;
	if (
		!Number.isSafeInteger(expectedCount) ||
		expectedCount < 1 ||
		expectedCount > caps.maxSamples
	)
		fail("expectedCount must be an integer in 1..65536");
	if (
		!Number.isSafeInteger(maxAllocationBytes) ||
		maxAllocationBytes < 1 ||
		maxAllocationBytes > caps.maxAllocationBytes
	)
		fail("maxAllocationBytes must be an integer in 1..8388608");
	if (underflow !== "reject" && underflow !== "allow-zero")
		fail("underflow policy must explicitly be reject or allow-zero");
	if (!Array.isArray(samples) || samples.length !== expectedCount)
		return fail("samples length must equal expectedCount");
	const motion = record(samples[0]) && own(samples[0], "motionPosition");
	const bufferBytes =
		expectedCount *
		(caps.bytesPerSample + (motion ? caps.motionBytesPerSample : 0));
	const estimatedAllocationBytes = bufferBytes + caps.bookkeepingBytes;
	if (estimatedAllocationBytes > maxAllocationBytes)
		fail("output allocation budget exceeded");
	let underflowedComponents = 0;
	for (let index = 0; index < expectedCount; index++) {
		if (!own(samples, String(index))) fail(`samples[${index}] is missing`);
		underflowedComponents += validateSample(
			samples[index],
			index,
			underflow,
			motion,
		);
	}
	const source = samples as readonly RustSurfaceSample[];
	const result: ThreeParticleBuffers = {
		count: expectedCount,
		position: new Float32Array(expectedCount * 3),
		...(motion
			? {
					motionPosition: new Float32Array(expectedCount * 3),
					size: new Float32Array(expectedCount),
				}
			: {}),
		normal: new Float32Array(expectedCount * 3),
		uv: new Float32Array(expectedCount * 2),
		color: new Float32Array(expectedCount * 4),
		barycentric: new Float64Array(expectedCount * 3),
		triangleIndex: new Uint32Array(expectedCount),
		primitiveIndex: new Uint32Array(expectedCount),
		materialIndex: new Uint32Array(expectedCount),
		uvPresent: new Uint8Array(expectedCount),
		colorPresent: new Uint8Array(expectedCount),
		materialPresent: new Uint8Array(expectedCount),
		bufferBytes,
		estimatedAllocationBytes,
		underflowedComponents,
	};
	for (let index = 0; index < expectedCount; index++) {
		const sample = source[index];
		result.position.set(sample.position, index * 3);
		if (motion) {
			result.motionPosition!.set(sample.motionPosition!, index * 3);
			result.size![index] = sample.size!;
		}
		result.normal.set(sample.normal, index * 3);
		result.barycentric.set(sample.barycentric, index * 3);
		result.triangleIndex[index] = sample.triangleIndex;
		result.primitiveIndex[index] = sample.primitiveIndex;
		if (own(sample, "uv")) {
			result.uv.set(sample.uv!, index * 2);
			result.uvPresent[index] = 1;
		}
		if (own(sample, "color")) {
			result.color.set(sample.color!, index * 4);
			result.colorPresent[index] = 1;
		}
		if (own(sample, "materialIndex")) {
			result.materialIndex[index] = sample.materialIndex!;
			result.materialPresent[index] = 1;
		}
	}
	return result;
}
