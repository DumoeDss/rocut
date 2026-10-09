import {
	advectLiquid,
	fixedFace,
	liquidDivergence,
	liquidDt,
	LiquidField,
	liquidPosition,
	type LiquidLocation,
	type LiquidVelocity,
} from "./liquid-oracle-grid";
import { confineLiquid, liquidOperators } from "./liquid-oracle-operators";

export interface LiquidOracleConfig {
	columns: number;
	rows: number;
	viscosity: number;
	velocityDamping: number;
	dyeDissipation: number;
	pressureIterations: number;
	diffusionIterations: number;
	vorticity: number;
}
export interface LiquidOracleEvent {
	atTicks: number;
	center: readonly [number, number];
	radius: number;
	velocity: readonly [number, number];
	dye: number;
}
export type LiquidOracleControl = "noProjection" | "ignoreEvents" | "uvRadius";
export interface LiquidOracleInput {
	config: LiquidOracleConfig;
	events: readonly LiquidOracleEvent[];
	/** Elapsed source ticks after the caller's span mapping and clamp. */
	elapsedTicks: number;
	width: number;
	height: number;
	control?: LiquidOracleControl;
}
export interface LiquidOracleGrid {
	columns: number;
	rows: number;
	Lx: number;
	Ly: number;
	dx: number;
	dy: number;
}
export interface LiquidOracleResult {
	/** All arrays use row-major order; u/v have their full staggered face dimensions. */
	state: {
		u: Float64Array;
		v: Float64Array;
		pressure: Float64Array;
		dye: Float64Array;
		divergence: Float64Array;
	};
	grid: LiquidOracleGrid;
	elapsedTicks: number;
	steps: number;
	completedTicks: number;
	eventsApplied: number;
	diagnostics: {
		maxAbsDivergence: number;
		rmsDivergence: number;
		dyeMass: number;
		dyeMin: number;
		dyeMax: number;
		kineticEnergy: number;
	};
}

function range(
	value: number,
	min: number,
	max: number,
	integer = false,
): boolean {
	return (
		Number.isFinite(value) &&
		value >= min &&
		value <= max &&
		(!integer || Number.isSafeInteger(value))
	);
}
function admit(input: LiquidOracleInput): LiquidOracleGrid {
	const { config: c, width, height, elapsedTicks, events, control } = input;
	if (![c.columns, c.rows].every((value) => range(value, 8, 24, true)))
		throw Error("Liquid CPU oracle supports only 8..24 cells per axis");
	if (!range(elapsedTicks, 0, 240000, true))
		throw Error(
			"Liquid CPU oracle supports only 0..240000 elapsed ticks; caller must clamp the span",
		);
	if (![width, height].every((value) => range(value, 1, 4096, true)))
		throw Error("Liquid CPU oracle needs integer output dimensions in 1..4096");
	if (
		!range(c.viscosity, 0, 0.02) ||
		!range(c.velocityDamping, 0, 10) ||
		!range(c.dyeDissipation, 0, 10) ||
		!range(c.pressureIterations, 4, 80, true) ||
		!range(c.diffusionIterations, 2, 24, true) ||
		!range(c.vorticity, 0, 4)
	)
		throw Error("Liquid CPU oracle received unsupported physical parameters");
	if (
		control !== undefined &&
		!["noProjection", "ignoreEvents", "uvRadius"].includes(control)
	)
		throw Error("Unknown Liquid CPU oracle counterexample");
	if (
		events.length > 16 ||
		events.some(
			(event, index) =>
				!range(event.atTicks, 0, 3600000, true) ||
				!range(event.radius, 0.01, 2) ||
				event.center.length !== 2 ||
				!event.center.every((value) => range(value, 0, 1)) ||
				event.velocity.length !== 2 ||
				!event.velocity.every((value) => range(value, -3, 3)) ||
				!range(event.dye, 0, 1) ||
				(index > 0 && events[index - 1].atTicks > event.atTicks),
		)
	)
		throw Error(
			"Liquid CPU oracle requires at most 16 ordered, bounded events",
		);
	const short = Math.min(width, height),
		Lx = width / short,
		Ly = height / short;
	return {
		columns: c.columns,
		rows: c.rows,
		Lx,
		Ly,
		dx: Lx / c.columns,
		dy: Ly / c.rows,
	};
}

function inject(
	flow: LiquidVelocity,
	dye: LiquidField,
	events: readonly LiquidOracleEvent[],
	grid: LiquidOracleGrid,
	control: LiquidOracleControl | undefined,
): void {
	const targets: readonly [LiquidField, LiquidLocation, number][] = [
		[flow.u, "u", 0],
		[flow.v, "v", 1],
		[dye, "cell", 2],
	];
	for (const event of events) {
		for (const [field, location, component] of targets) {
			const amplitude = component === 2 ? event.dye : event.velocity[component];
			field.visit((value, x, y) => {
				if (fixedFace(location, x, y, grid)) return;
				const point = liquidPosition(location, x, y, grid);
				const distance =
					control === "uvRadius"
						? Math.hypot(
								point[0] / grid.Lx - event.center[0],
								point[1] / grid.Ly - event.center[1],
							)
						: Math.hypot(
								point[0] - event.center[0] * grid.Lx,
								point[1] - event.center[1] * grid.Ly,
							);
				const ramp = Math.max(0, 1 - distance / event.radius);
				field.set(x, y, value + amplitude * ramp * ramp * (3 - 2 * ramp));
			});
		}
	}
}

/** Fresh fixed-step MAC integration from the declared zero initial state. */
export function liquidPhysics(input: LiquidOracleInput): LiquidOracleResult {
	const grid = admit(input),
		c = input.config;
	let flow: LiquidVelocity = {
		u: new LiquidField(c.columns + 1, c.rows),
		v: new LiquidField(c.columns, c.rows + 1),
	};
	let dye = new LiquidField(c.columns, c.rows),
		pressure = new LiquidField(c.columns, c.rows);
	const operators = liquidOperators(grid),
		steps = Math.floor(input.elapsedTicks / 1000);
	const velocityDecay = Math.exp(-c.velocityDamping * liquidDt),
		dyeDecay = Math.exp(-c.dyeDissipation * liquidDt);
	let eventsApplied = 0;
	for (let step = 0; step < steps; step += 1) {
		const events =
			input.control === "ignoreEvents"
				? []
				: input.events.filter(
						(event) =>
							event.atTicks >= step * 1000 && event.atTicks < (step + 1) * 1000,
					);
		inject(flow, dye, events, grid, input.control);
		eventsApplied += events.length;
		const transported: LiquidVelocity = {
			u: advectLiquid(flow.u, "u", flow, grid),
			v: advectLiquid(flow.v, "v", flow, grid),
		};
		const smoothed: LiquidVelocity = {
			u: operators.diffuse(
				transported.u,
				"u",
				c.viscosity,
				c.diffusionIterations,
			),
			v: operators.diffuse(
				transported.v,
				"v",
				c.viscosity,
				c.diffusionIterations,
			),
		};
		const rotating = confineLiquid(smoothed, grid, c.vorticity);
		const projected =
			input.control === "noProjection"
				? { ...rotating, pressure: new LiquidField(c.columns, c.rows) }
				: operators.project(rotating, c.pressureIterations);
		flow = {
			u: projected.u.map((value) => value * velocityDecay),
			v: projected.v.map((value) => value * velocityDecay),
		};
		pressure = projected.pressure;
		dye = advectLiquid(dye, "cell", flow, grid).map(
			(value) => value * dyeDecay,
		);
	}
	const divergence = liquidDivergence(flow, grid),
		state = {
			u: flow.u.rowMajor(),
			v: flow.v.rowMajor(),
			pressure: pressure.rowMajor(),
			dye: dye.rowMajor(),
			divergence: divergence.rowMajor(),
		};
	if (
		Object.values(state).some((values) =>
			values.some((value) => !Number.isFinite(value)),
		)
	)
		throw Error("Nonfinite Liquid CPU oracle state");
	let energy = 0;
	dye.visit((_, x, y) => {
		const u = (flow.u.get(x, y) + flow.u.get(x + 1, y)) / 2;
		const v = (flow.v.get(x, y) + flow.v.get(x, y + 1)) / 2;
		energy += ((u * u + v * v) * grid.dx * grid.dy) / 2;
	});
	return {
		state,
		grid,
		elapsedTicks: input.elapsedTicks,
		steps,
		completedTicks: steps * 1000,
		eventsApplied,
		diagnostics: {
			maxAbsDivergence: Math.max(...state.divergence.map(Math.abs)),
			rmsDivergence: Math.sqrt(
				state.divergence.reduce((sum, value) => sum + value * value, 0) /
					state.divergence.length,
			),
			dyeMass:
				state.dye.reduce((sum, value) => sum + value, 0) * grid.dx * grid.dy,
			dyeMin: Math.min(...state.dye),
			dyeMax: Math.max(...state.dye),
			kineticEnergy: energy,
		},
	};
}
