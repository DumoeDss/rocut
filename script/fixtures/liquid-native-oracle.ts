import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { liquidPhysics, type LiquidOracleInput } from "./liquid-oracle";

// Emits a frozen fixture for the Rust state-comparison tests, never production state.
const base: LiquidOracleInput = {
	config: {
		columns: 10,
		rows: 8,
		viscosity: 0.001,
		velocityDamping: 0.5,
		dyeDissipation: 0.15,
		pressureIterations: 24,
		diffusionIterations: 6,
		vorticity: 0.5,
	},
	events: [
		{
			atTicks: 0,
			center: [0.3, 0.45],
			radius: 0.38,
			velocity: [1.1, -0.6],
			dye: 0.8,
		},
		{
			atTicks: 1000,
			center: [0.7, 0.6],
			radius: 0.27,
			velocity: [-0.4, 0.9],
			dye: 0.6,
		},
		{
			atTicks: 3000,
			center: [0.4, 0.5],
			radius: 0.42,
			velocity: [0.2, 0.5],
			dye: 0.9,
		},
	],
	elapsedTicks: 12000,
	width: 240,
	height: 120,
};
const inputs: [string, LiquidOracleInput][] = [
	["before-first-step", { ...base, elapsedTicks: 999 }],
	[
		"first-step-no-diffusion",
		{
			...base,
			elapsedTicks: 1000,
			config: { ...base.config, viscosity: 0, vorticity: 0 },
		},
	],
	["half-open-endpoint", { ...base, elapsedTicks: 1999 }],
	["landscape-all-operators", base],
	[
		"portrait-transposed",
		{
			...base,
			width: base.height,
			height: base.width,
			config: {
				...base.config,
				columns: base.config.rows,
				rows: base.config.columns,
			},
			events: base.events.map((event) => ({
				...event,
				center: [event.center[1], event.center[0]],
				velocity: [event.velocity[1], event.velocity[0]],
			})),
		},
	],
	[
		"longer-square",
		{
			...base,
			width: 128,
			height: 128,
			elapsedTicks: 120000,
			config: { ...base.config, columns: 8, rows: 8 },
		},
	],
	[
		"large-coefficients",
		{
			...base,
			elapsedTicks: 16000,
			config: {
				...base.config,
				viscosity: 0.02,
				velocityDamping: 8,
				dyeDissipation: 9,
				pressureIterations: 80,
				diffusionIterations: 24,
				vorticity: 4,
			},
		},
	],
];
const state = (input: LiquidOracleInput) => {
	const result = liquidPhysics(input);
	return {
		u: Array.from(result.state.u),
		v: Array.from(result.state.v),
		pressure: Array.from(result.state.pressure),
		dye: Array.from(result.state.dye),
	};
};
const sources = await Promise.all(
	[
		"liquid-oracle.ts",
		"liquid-oracle-grid.ts",
		"liquid-oracle-operators.ts",
	].map(async (name) => ({
		name,
		sha256: createHash("sha256")
			.update(await readFile(new URL(name, import.meta.url)))
			.digest("hex"),
	})),
);
console.log(
	JSON.stringify({
		version: 1,
		sources,
		absoluteTolerance: 2e-11,
		relativeTolerance: 1e-11,
		cases: inputs.map(([name, input]) => ({
			name,
			input,
			expected: state(input),
			...(name === "landscape-all-operators"
				? {
						negativeControls: ["noProjection", "ignoreEvents", "uvRadius"].map(
							(control) => ({
								name: control,
								state: state({
									...input,
									control: control as LiquidOracleInput["control"],
								}),
							}),
						),
					}
				: {}),
		})),
	}),
);
