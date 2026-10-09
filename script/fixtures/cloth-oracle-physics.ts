import type { MvCloth } from "../../packages/editor-contracts/src/mv-cloth";

export type ClothVector = [number, number, number];
export type ClothPoint = [number, number];
export type ClothControl = "noConstraints" | "ignoreEvents" | "uvRadius";
export interface ClothOracleInput {
	settings: MvCloth;
	/** Caller maps source time and clamps it to the authored span first. */
	elapsedTicks: number;
	width: number;
	height: number;
	seed?: number;
	control?: ClothControl;
}
export interface ClothOracleParticle {
	index: number;
	uv: ClothPoint;
	/** Rest, position and velocity use authored-rect short-side units. */
	rest: ClothVector;
	position: ClothVector;
	velocity: ClothVector;
	pinned: boolean;
}
export interface ClothOracleConstraint {
	a: number;
	b: number;
	restLength: number;
	kind: "structural" | "shear" | "bend";
}
export interface ClothOracleState {
	rect: [number, number, number, number];
	shortSide: number;
	normalizedSize: ClothPoint;
	elapsedTicks: number;
	steps: number;
	fullImage: boolean;
	particles: ClothOracleParticle[];
	constraints: ClothOracleConstraint[];
	eventCount: number;
}

const stepTicks = 1000;
const secondsPerStep = 1 / 120;
const normalMinimum = 2 ** -1022;
type Field = [Float64Array, Float64Array, Float64Array];
const field = (count: number): Field => [
	new Float64Array(count),
	new Float64Array(count),
	new Float64Array(count),
];
const squaredLength = (v: readonly number[]) =>
	v.reduce((sum, x) => sum + x * x, 0);

function admit({
	settings: s,
	elapsedTicks,
	width,
	height,
	seed = 19,
	control,
}: ClothOracleInput): void {
	if (
		![s.columns, s.rows].every(
			(value) => Number.isInteger(value) && value >= 2 && value <= 12,
		)
	)
		throw Error("Cloth CPU oracle supports only 2..12 cells per axis");
	if (
		!Number.isSafeInteger(elapsedTicks) ||
		elapsedTicks < 0 ||
		elapsedTicks > 240000
	)
		throw Error(
			"Cloth CPU oracle supports only 0..240000 elapsed ticks; caller must clamp the span",
		);
	if (
		![width, height].every(
			(value) => Number.isInteger(value) && value > 0 && value <= 4096,
		) ||
		!Number.isInteger(seed) ||
		seed < 0 ||
		seed > 0xffffffff
	)
		throw Error(
			"Cloth CPU oracle needs bounded integer dimensions and a uint32 seed",
		);
	if (
		control !== undefined &&
		!["noConstraints", "ignoreEvents", "uvRadius"].includes(control)
	)
		throw Error("Unknown Cloth CPU oracle counterexample");
	if (
		!Number.isInteger(s.solverIterations) ||
		s.solverIterations < 2 ||
		s.solverIterations > 12 ||
		!["topEdge", "topCorners", "leftEdge"].includes(s.pins) ||
		s.rect.length !== 4 ||
		s.rect[2] <= 0 ||
		s.rect[3] <= 0 ||
		s.wind.length !== 3 ||
		s.stretchCompliance < 0 ||
		s.bendCompliance < 0 ||
		![
			...s.rect,
			...s.wind,
			s.gravity,
			s.gust,
			s.gustFrequency,
			s.damping,
			s.stretchCompliance,
			s.bendCompliance,
			s.perspective,
			s.shading,
			s.opacity,
		].every(Number.isFinite)
	)
		throw Error(
			"Cloth CPU oracle requires finite authored physical parameters",
		);
	if (
		s.events.length > 16 ||
		s.events.some(
			(event, index) =>
				!Number.isSafeInteger(event.atTicks) ||
				event.atTicks < 0 ||
				event.atTicks > 3600000 ||
				(index > 0 && s.events[index - 1].atTicks > event.atTicks) ||
				event.center.length !== 2 ||
				event.velocity.length !== 3 ||
				event.radius <= 0 ||
				![...event.center, ...event.velocity, event.radius].every(
					Number.isFinite,
				),
		)
	)
		throw Error("Cloth CPU oracle requires at most 16 ordered, finite events");
}

// BigInt expresses the specified uint32 phase hash without sharing an RNG implementation.
function gustPhase(seed: number): number {
	const mask = 0xffffffffn;
	let bits = BigInt(seed) ^ ((0xc107n * 374761393n) & mask);
	bits = ((bits ^ (bits >> 13n)) * 1274126177n) & mask;
	return (Number((bits ^ (bits >> 16n)) & mask) / 4294967296) * (2 * Math.PI);
}

function lattice(s: MvCloth, size: ClothPoint): ClothOracleParticle[] {
	return Array.from({ length: (s.columns + 1) * (s.rows + 1) }, (_, index) => {
		const uv: ClothPoint = [
			(index % (s.columns + 1)) / s.columns,
			Math.floor(index / (s.columns + 1)) / s.rows,
		];
		const rest: ClothVector = [
			(uv[0] - 0.5) * size[0],
			(uv[1] - 0.5) * size[1],
			0,
		];
		const pinned =
			s.pins === "leftEdge"
				? uv[0] === 0
				: uv[1] === 0 && (s.pins === "topEdge" || uv[0] === 0 || uv[0] === 1);
		return {
			index,
			uv,
			rest,
			position: [...rest],
			velocity: [0, 0, 0],
			pinned,
		};
	});
}

function links(s: MvCloth, size: ClothPoint): ClothOracleConstraint[] {
	// Per-anchor stencil order is part of cloth-xpbd v1's Gauss-Seidel semantics.
	const stencils: readonly [
		ClothPoint,
		ClothPoint,
		ClothOracleConstraint["kind"],
	][] = [
		[[0, 0], [1, 0], "structural"],
		[[0, 0], [0, 1], "structural"],
		[[0, 0], [1, 1], "shear"],
		[[1, 0], [0, 1], "shear"],
		[[0, 0], [2, 0], "bend"],
		[[0, 0], [0, 2], "bend"],
	];
	return Array.from({ length: (s.columns + 1) * (s.rows + 1) }, (_, anchor) => {
		const x = anchor % (s.columns + 1),
			y = Math.floor(anchor / (s.columns + 1));
		return stencils.flatMap(([from, to, kind]) => {
			const a: ClothPoint = [x + from[0], y + from[1]],
				b: ClothPoint = [x + to[0], y + to[1]];
			if ([a, b].some(([u, v]) => u > s.columns || v > s.rows)) return [];
			return [
				{
					a: a[1] * (s.columns + 1) + a[0],
					b: b[1] * (s.columns + 1) + b[0],
					kind,
					restLength: Math.sqrt(
						(((to[0] - from[0]) * size[0]) / s.columns) ** 2 +
							(((to[1] - from[1]) * size[1]) / s.rows) ** 2,
					),
				},
			];
		});
	}).flat();
}

function projectDistances(
	coordinates: Field,
	constraints: ClothOracleConstraint[],
	masses: Float64Array,
	compliance: Float64Array,
	iterations: number,
): void {
	const multiplier = new Float64Array(constraints.length);
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		constraints.forEach(({ a, b, restLength }, index) => {
			const movable = masses[a] + masses[b];
			if (movable === 0) return;
			const direction = coordinates.map((axis) => axis[b] - axis[a]);
			const distance = Math.sqrt(squaredLength(direction));
			if (distance <= normalMinimum) return;
			const elastic = compliance[index] / secondsPerStep ** 2;
			const tension =
				(distance - restLength + elastic * multiplier[index]) /
				(movable + elastic);
			multiplier[index] -= tension;
			coordinates.forEach((axis, dimension) => {
				const displacement = (direction[dimension] / distance) * tension;
				if (masses[a] !== 0) axis[a] += displacement;
				if (masses[b] !== 0) axis[b] -= displacement;
			});
		});
	}
}

/** Independent short-run reference; it neither consumes plans nor retains replay checkpoints. */
export function clothPhysics(input: ClothOracleInput): ClothOracleState {
	admit(input);
	const {
		settings: s,
		width,
		height,
		elapsedTicks,
		seed = 19,
		control,
	} = input;
	const rect: ClothOracleState["rect"] = [
		s.rect[0] * width,
		s.rect[1] * height,
		s.rect[2] * width,
		s.rect[3] * height,
	];
	const shortSide = Math.min(rect[2], rect[3]);
	const normalizedSize: ClothPoint = [rect[2] / shortSide, rect[3] / shortSide];
	const particles = lattice(s, normalizedSize),
		constraints = links(s, normalizedSize);
	const positions = field(particles.length),
		velocities = field(particles.length);
	const masses = Float64Array.from(particles, (point) =>
		point.pinned ? 0 : 1,
	);
	particles.forEach((point) =>
		positions.forEach((axis, dimension) => {
			axis[point.index] = point.rest[dimension];
		}),
	);
	const compliance = Float64Array.from(constraints, (edge) =>
		edge.kind === "bend" ? s.bendCompliance : s.stretchCompliance,
	);
	const phase = gustPhase(seed),
		attenuation = Math.exp(-s.damping * secondsPerStep);
	const steps = Math.floor(elapsedTicks / stepTicks);
	let eventCount = 0;
	for (let step = 0; step < steps; step += 1) {
		const events =
			control === "ignoreEvents"
				? []
				: s.events.filter(
						(event) =>
							event.atTicks >= step * stepTicks &&
							event.atTicks < (step + 1) * stepTicks,
					);
		eventCount += events.length;
		const angle =
			phase + (2 * Math.PI * s.gustFrequency * (step * stepTicks)) / 120000;
		const acceleration = [
			s.wind[0] + s.gust * Math.sin(angle),
			s.gravity + s.wind[1] + s.gust * 0.25 * Math.sin(angle + 1.7),
			s.wind[2] + s.gust * Math.cos(angle + 0.8),
		];
		const before = positions.map((axis) => axis.slice());
		const weights = particles.map(({ uv }) =>
			events.map((event) => {
				const scale = control === "uvRadius" ? [1, 1] : normalizedSize;
				const radius = Math.sqrt(
					squaredLength(
						uv.map((value, axis) => (value - event.center[axis]) * scale[axis]),
					),
				);
				const ramp = Math.max(0, 1 - radius / event.radius);
				return ramp * ramp * (3 - 2 * ramp);
			}),
		);
		positions.forEach((axis, dimension) => {
			particles.forEach(({ index, pinned }) => {
				if (pinned) return;
				const kicked = events.reduce(
					(velocity, event, eventIndex) =>
						velocity + event.velocity[dimension] * weights[index][eventIndex],
					velocities[dimension][index],
				);
				axis[index] +=
					(kicked + acceleration[dimension] * secondsPerStep) *
					attenuation *
					secondsPerStep;
			});
		});
		if (control !== "noConstraints")
			projectDistances(
				positions,
				constraints,
				masses,
				compliance,
				s.solverIterations,
			);
		positions.forEach((axis, dimension) =>
			particles.forEach(({ index, pinned, rest }) => {
				if (pinned) axis[index] = rest[dimension];
				velocities[dimension][index] = pinned
					? 0
					: (axis[index] - before[dimension][index]) / secondsPerStep;
			}),
		);
	}
	for (const point of particles) {
		point.position = positions.map((axis) => axis[point.index]) as ClothVector;
		point.velocity = velocities.map((axis) => axis[point.index]) as ClothVector;
		if (![...point.position, ...point.velocity].every(Number.isFinite))
			throw Error("Nonfinite Cloth CPU oracle state");
	}
	return {
		rect,
		shortSide,
		normalizedSize,
		elapsedTicks,
		steps,
		fullImage: elapsedTicks === 0,
		particles,
		constraints,
		eventCount,
	};
}
