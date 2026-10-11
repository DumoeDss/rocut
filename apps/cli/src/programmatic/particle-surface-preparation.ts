import {
	extractThreeSurface,
	type ThreeSurfaceObject,
} from "./engines/three-surface-extract";
import {
	createThreeParticleBuffers,
	THREE_PARTICLE_BUFFER_LIMITS,
	type RustSurfaceSample,
	type ThreeParticleBufferOptions,
} from "./engines/three-particle-buffers";
import {
	snapshotThreeParticleMaterials,
	evaluateThreeParticleMaterials,
} from "./engines/three-particle-materials";
import {
	snapshotParticleFrameConstraint,
	validateParticleMotion,
	validateParticleMotionControl,
	type ParticleMotionOptions,
} from "./particle-motion-contract";
import type { ParticlePolicy } from "./particle-policy-types";

export interface ParticleSurfaceOptions {
	count: number;
	underflow: ThreeParticleBufferOptions["underflow"];
	/** Combined reservation for output buffers and copied material pixels. */
	maxAllocationBytes?: number;
	motion?: ParticleMotionOptions;
	material?: { mode: "base-color"; sampling: "nearest-base-level" };
}

/** Snapshot author data before the worker await; never reread mutable options. */
export function prepareParticleSurface(
	root: ThreeSurfaceObject,
	input: ParticleSurfaceOptions,
	frame: Readonly<Record<string, unknown>>,
	policy: ParticlePolicy,
) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Invalid particle options");
	if (
		Object.keys(input).some(
			(key) =>
				![
					"count",
					"underflow",
					"maxAllocationBytes",
					"motion",
					"material",
				].includes(key),
		)
	)
		throw Error("Invalid particle count or explicit underflow policy");
	if (input.motion && Object.hasOwn(input.motion, "timeTicks"))
		throw Error("Particle motion time belongs to the Rust mapped frame");
	if (input.motion && Object.hasOwn(input.motion, "control"))
		validateParticleMotionControl(input.motion.control);
	if (
		Object.hasOwn(input, "maxAllocationBytes") &&
		(!Number.isSafeInteger(input.maxAllocationBytes) ||
			input.maxAllocationBytes! < 1)
	)
		throw Error("Particle output allocation cap may only be tightened");
	const options = JSON.parse(JSON.stringify(input)) as ParticleSurfaceOptions;
	if (
		Object.keys(options).some(
			(key) =>
				![
					"count",
					"underflow",
					"maxAllocationBytes",
					"motion",
					"material",
				].includes(key),
		) ||
		!Number.isSafeInteger(options.count) ||
		options.count < 1 ||
		options.count > policy.maxSamples ||
		(options.underflow !== "reject" && options.underflow !== "allow-zero")
	)
		throw Error("Invalid particle count or explicit underflow policy");
	const { count, underflow } = options;
	const caps = THREE_PARTICLE_BUFFER_LIMITS;
	const allocationCap = Math.min(
		policy.maxFrameRetainedPayloadBytes,
		caps.maxAllocationBytes,
	);
	const maxAllocationBytes = options.maxAllocationBytes ?? allocationCap;
	if (
		!Number.isSafeInteger(maxAllocationBytes) ||
		maxAllocationBytes < 1 ||
		maxAllocationBytes > allocationCap
	)
		throw Error("Particle output allocation cap may only be tightened");
	let motion;
	if (Object.hasOwn(options, "motion")) {
		if (
			!options.motion ||
			typeof options.motion !== "object" ||
			Array.isArray(options.motion) ||
			Object.hasOwn(options.motion, "timeTicks")
		)
			throw Error("Particle motion time belongs to the Rust mapped frame");
		const constraint = snapshotParticleFrameConstraint(frame);
		motion = { ...options.motion, timeTicks: constraint.sourceTime };
		validateParticleMotion(motion);
	}
	if (
		Object.hasOwn(options, "material") &&
		(!options.material ||
			typeof options.material !== "object" ||
			Object.keys(options.material).length !== 2 ||
			options.material.mode !== "base-color" ||
			options.material.sampling !== "nearest-base-level")
	)
		throw Error(
			"Particle material requires explicit base-color nearest-base-level sampling",
		);
	const baseBytes =
		caps.bookkeepingBytes +
		count * (caps.bytesPerSample + (motion ? caps.motionBytesPerSample : 0));
	if (baseBytes > maxAllocationBytes)
		throw Error("Particle output allocation budget exceeded");
	const extracted = extractThreeSurface(root, {
		maxTriangles: policy.maxTriangles,
		maxWorkingBytes: Math.min(
			32 * 1024 * 1024,
			policy.maxFrameRetainedPayloadBytes,
		),
	});
	const materialSnapshot = options.material
		? snapshotThreeParticleMaterials(extracted.materials, {
				maxAllocationBytes: maxAllocationBytes - baseBytes,
			})
		: undefined;
	const requestJson = JSON.stringify({
		triangles: extracted.triangles,
		count,
		seed: frame.seed,
		...(motion ? { motion } : {}),
	});
	return {
		requestJson,
		finish(response: string) {
			// The client checks the complete response against this exact request.
			const { samples } = JSON.parse(response) as {
				samples: RustSurfaceSample[];
			};
			const buffers = createThreeParticleBuffers(samples, {
				expectedCount: count,
				maxAllocationBytes,
				underflow,
			});
			const materialBuffers = materialSnapshot
				? evaluateThreeParticleMaterials(samples, materialSnapshot, {
						maxAllocationBytes:
							maxAllocationBytes -
							buffers.estimatedAllocationBytes -
							materialSnapshot.allocatedBytes,
						underflow,
					})
				: undefined;
			return {
				buffers,
				primitives: extracted.primitives,
				materials: extracted.materials,
				...(materialBuffers ? { materialBuffers } : {}),
				estimatedAllocationBytes:
					buffers.estimatedAllocationBytes +
					(materialSnapshot?.allocatedBytes ?? 0) +
					(materialBuffers?.allocatedBytes ?? 0),
			};
		},
	};
}
