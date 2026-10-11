import { ParticleProtocolError } from "./particle-protocol-error";

export interface ParticleMotionControl {
	mode: "spring" | "vortex";
	startTicks: number;
	durationTicks: number;
	knots: { timeTicks: number; position: [number, number, number] }[];
	restoringForce: number;
	damping: number;
	radius: number;
	strength: number;
	axis?: [number, number, number];
}

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
	control?: ParticleMotionControl;
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

/** Bounded wire shape only; schedule admission and dynamics remain Rust-owned. */
export function validateParticleMotionControl(
	value: unknown,
): asserts value is ParticleMotionControl {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ParticleProtocolError("Invalid particle control object");
	const control = value as Record<string, unknown>;
	const keys = [
		"mode",
		"startTicks",
		"durationTicks",
		"knots",
		"restoringForce",
		"damping",
		"radius",
		"strength",
	];
	const allowed = control.mode === "vortex" ? [...keys, "axis"] : keys;
	if (
		!["spring", "vortex"].includes(control.mode as string) ||
		keys.some((key) => !Object.hasOwn(control, key)) ||
		Reflect.ownKeys(control).some(
			(key) => typeof key !== "string" || !allowed.includes(key),
		)
	)
		throw new ParticleProtocolError(
			"Missing or unknown particle control field",
		);
	const tick = (entry: unknown) =>
		Number.isSafeInteger(entry) && (entry as number) >= 0;
	const vector = (entry: unknown) =>
		Array.isArray(entry) &&
		entry.length === 3 &&
		[0, 1, 2].every(
			(index) =>
				typeof entry[index] === "number" && Number.isFinite(entry[index]),
		);
	if (!tick(control.startTicks) || !tick(control.durationTicks))
		throw new ParticleProtocolError(
			"Particle control times must be safe integer ticks",
		);
	for (const key of ["restoringForce", "damping", "radius", "strength"])
		if (typeof control[key] !== "number" || !Number.isFinite(control[key]))
			throw new ParticleProtocolError(
				"Particle control parameters must be finite",
			);
	if (control.mode === "vortex" && !vector(control.axis))
		throw new ParticleProtocolError(
			"Particle vortex axis requires a finite vector",
		);
	if (
		!Array.isArray(control.knots) ||
		control.knots.length < 2 ||
		control.knots.length > 128
	)
		throw new ParticleProtocolError(
			"Particle control requires 2..128 bounded knots",
		);
	for (const knot of control.knots) {
		if (
			!knot ||
			typeof knot !== "object" ||
			Array.isArray(knot) ||
			Reflect.ownKeys(knot).length !== 2 ||
			!Object.hasOwn(knot, "timeTicks") ||
			!Object.hasOwn(knot, "position") ||
			!tick(knot.timeTicks) ||
			!vector(knot.position)
		)
			throw new ParticleProtocolError(
				"Particle control knot requires ticks and a finite position vector",
			);
	}
}

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
		Object.keys(motion).some((key) => !keys.includes(key) && key !== "control")
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
	if (Object.hasOwn(motion, "control"))
		validateParticleMotionControl(motion.control);
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
