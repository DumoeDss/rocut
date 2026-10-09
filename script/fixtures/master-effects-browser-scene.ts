import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	WIDTH,
	HEIGHT,
	FPS,
	NOISE,
	SEED,
} from "./master-effects-browser-oracle";

export const ticks = (frame: number) => mediaTime({ ticks: frame * 4000 });
const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	width: WIDTH,
	height: HEIGHT,
	frameRate: { numerator: FPS, denominator: 1 },
	durationFrames: 60,
	seed: SEED,
	code: "",
	recipe: {
		version: 1,
		root: "red",
		songStartSeconds: 0,
		outputRoles: ["foreground"],
		nodes: [
			{
				id: "red",
				scene: { kind: "solid", role: "foreground", color: [1, 0, 0, 0.5] },
			},
		],
	},
};
const canvas: ProgrammaticSource = {
	...source,
	recipe: undefined,
	code: "const c=canvas.getContext('2d');c.fillStyle='rgba(0,0,255,0.5)';c.fillRect(32,16,32,32);",
};
const graphic = (id: string, programmatic: ProgrammaticSource) => ({
	id,
	name: id,
	type: "graphic" as const,
	definitionId: "programmatic",
	params: {},
	programmatic,
	startTime: ticks(5),
	duration: ticks(30),
	trimStart: ticks(7),
	trimEnd: ticks(23),
});
const tracks: SceneTracks = {
	main: {
		id: "main",
		name: "Main",
		type: "video",
		elements: [],
		hidden: false,
		muted: false,
	},
	audio: [],
	overlay: [
		{
			id: "canvas",
			name: "Canvas",
			type: "graphic",
			hidden: false,
			elements: [graphic("canvas", canvas)],
		},
		{
			id: "native",
			name: "Native recipe",
			type: "graphic",
			hidden: false,
			elements: [graphic("native", source)],
		},
	],
};
export const adjustment = (
	id: string,
	exposure: number,
	contrast: number,
	enabled = true,
): Effect => ({
	id,
	type: "color-adjustment",
	enabled,
	params: { exposure, contrast, saturation: 0, temperature: 0, tint: 0 },
});
export const ordered = (): Effect[] => [
	adjustment("exposure", 1, 0),
	adjustment("contrast", 0, 50),
];
export const temporal = (): Effect[] => [
	...ordered(),
	{
		id: "clock",
		type: "vhs",
		enabled: true,
		params: { amount: 1, noise: NOISE, scanlines: 0, bleed: 0, seed: SEED },
	},
];
export function scene(masterEffects?: readonly Effect[], isPreview = false) {
	return buildScene({
		tracks,
		mediaAssets: [],
		duration: ticks(40),
		canvasSize: { width: WIDTH, height: HEIGHT },
		background: { type: "color", color: "#004000" },
		isPreview,
		assetResolver: {} as AssetResolver,
		...(masterEffects === undefined ? {} : { masterEffects }),
	});
}
