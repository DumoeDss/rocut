import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { MvColor } from "../../packages/editor-contracts/src/mv-recipe";
import type { MvConverge } from "../../packages/editor-contracts/src/mv-converge";

export const CONVERGE_START = 12.25;
export const CONVERGE_DURATION = 4;
export const CONVERGE_WHITE_AT = 15.75;
/** Explicit authored events; no audio extraction or invented BPM extrapolation in the fixture. */
export const CONVERGE_BEATS = [
	11.75, 12.2, 12.75, 13.3, 13.85, 14.4, 14.95, 15.5, 16.05, 16.6, 17.15,
] as const;
const rgba = (r: number, g: number, b: number, a = 1): MvColor => [
	r / 255,
	g / 255,
	b / 255,
	a,
];

/** Explicit author palette. No timing/geometry/randomness formula is duplicated here. */
export function convergeSettings(): MvConverge {
	return {
		seed: 7,
		whiteAtTicks: Math.round(CONVERGE_WHITE_AT * 120000),
		beats: {
			kind: "manual",
			songTicks: CONVERGE_BEATS.map((beat) => Math.round(beat * 120000)),
		},
		grain: 0.07,
		palette: {
			background: [rgba(6, 3, 10), rgba(18, 10, 27), rgba(8, 4, 12)],
			shadow: rgba(58, 23, 69),
			dusk: rgba(122, 35, 80),
			verm: rgba(200, 55, 58),
			sunset: rgba(240, 102, 58),
			glow: rgba(255, 165, 82),
			hi: rgba(255, 227, 176),
			core: rgba(255, 246, 230),
			shard: {
				body: rgba(42, 24, 56),
				rim: rgba(127, 180, 208),
				edge: rgba(207, 230, 240),
			},
			firefly: {
				body: rgba(200, 240, 96),
				core: rgba(242, 255, 200),
				edge: rgba(155, 216, 106),
			},
			white: rgba(255, 248, 238),
		},
	};
}

export function convergeSource(
	settings: MvConverge = convergeSettings(),
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames: 240,
		seed: 0,
		recipe: {
			version: 1,
			root: "converge",
			songStartSeconds: CONVERGE_START,
			outputRoles: ["graphics"],
			post: [],
			nodes: [
				{
					id: "converge",
					scene: {
						kind: "converge",
						role: "graphics",
						span: { startFrame: 0, durationFrames: 240 },
						settings,
					},
				},
			],
		},
	};
}
