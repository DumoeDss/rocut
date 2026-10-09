import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import type { Effect } from "../../packages/editor-classic/src/effects/types";

export const asciiEffect = (params: Record<string, number> = {}): Effect => ({
	id: "ascii",
	type: "ascii",
	enabled: true,
	params: {
		amount: 1,
		cellSize: 12,
		contrast: 0.9,
		color: 0.4,
		seed: 19,
		...params,
	},
});
export function asciiThreeScene(
	source: ProgrammaticSource,
	effects: Effect[],
	{ preview = false, background = "#102030", trim = 0, apiBase = "/api" } = {},
) {
	const tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
		overlay: [
			{
				id: "three",
				name: "Three",
				type: "graphic",
				elements: [
					{
						id: "model",
						name: "ASCII Object",
						type: "graphic",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						startTime: 12000,
						duration: 120000,
						trimStart: trim,
						trimEnd: 0,
						effects,
					},
				],
			},
		],
	} as unknown as SceneTracks;
	return buildScene({
		tracks,
		mediaAssets: [],
		canvasSize: { width: source.width, height: source.height },
		duration: 132000,
		background: { type: "color", color: background },
		assetResolver: {} as AssetResolver,
		programmaticFrames: createHttpProgrammaticFrames({ base: apiBase }),
		isPreview: preview,
	});
}
