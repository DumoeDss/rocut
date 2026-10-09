import { ParticleProtocolError } from "./particle-protocol-error";

/** Times use the same 120,000 ticks/second as the Rust mapped source frame. */
export interface ParticleMotion {
	version: 1;
	timeTicks: number;
	scatterStartTicks: number;
	scatterDurationTicks: number;
	holdDurationTicks: number;
	returnDurationTicks: number;
	scatterDistance: number;
	driftAmplitude: number;
	driftFrequency: number;
	size: number;
	sizeVariance: number;
}

/** Current time and the sampling seed are not author options. */
export type ParticleMotionOptions = Omit<ParticleMotion, "timeTicks">;
export type ParticleFrameConstraint = Readonly<{
	seed: number;
	sourceTime: number;
}>;

const ticks = [
	"timeTicks",
	"scatterStartTicks",
	"scatterDurationTicks",
	"holdDurationTicks",
	"returnDurationTicks",
] as const;
const floats = [
	"scatterDistance",
	"driftAmplitude",
	"driftFrequency",
	"size",
	"sizeVariance",
] as const;

/** Wire shape only; motion ranges, curves and randomness are Rust-owned. */
export function validateParticleMotion(
	value: unknown,
): asserts value is ParticleMotion {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ParticleProtocolError("Invalid particle motion object");
	const motion = value as Record<string, unknown>;
	const keys = ["version", ...ticks, ...floats];
	if (
		motion.version !== 1 ||
		keys.some((key) => !Object.hasOwn(motion, key)) ||
		Object.keys(motion).some((key) => !keys.includes(key))
	)
		throw new ParticleProtocolError("Missing or unknown particle motion field");
	for (const key of ticks)
		if (!Number.isSafeInteger(motion[key]) || (motion[key] as number) < 0)
			throw new ParticleProtocolError(
				"Particle motion times must be safe integer ticks",
			);
	for (const key of floats)
		if (typeof motion[key] !== "number" || !Number.isFinite(motion[key]))
			throw new ParticleProtocolError(
				"Particle motion parameters must be finite",
			);
}

export function snapshotParticleFrameConstraint(
	frame: unknown,
): ParticleFrameConstraint {
	const value = frame as Partial<ParticleFrameConstraint> | null;
	if (
		!value ||
		!Number.isSafeInteger(value.seed) ||
		value.seed! < 0 ||
		value.seed! > 0xffff_ffff ||
		!Number.isSafeInteger(value.sourceTime) ||
		value.sourceTime! < 0
	)
		throw new ParticleProtocolError(
			"Particle capture requires Rust mapped seed and sourceTime",
		);
	return Object.freeze({ seed: value.seed!, sourceTime: value.sourceTime! });
}

export function assertParticleFrameConstraint(
	request: { seed: number; motion?: ParticleMotion },
	frame?: ParticleFrameConstraint,
): void {
	if (request.motion && !frame)
		throw new ParticleProtocolError(
			"Particle motion requires a host-owned frame",
		);
	if (
		frame &&
		(request.seed !== frame.seed ||
			(request.motion && request.motion.timeTicks !== frame.sourceTime))
	)
		throw new ParticleProtocolError(
			"Particle request differs from the Rust mapped frame",
		);
}
