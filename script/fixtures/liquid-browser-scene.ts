import type { AssetResolver } from "@opencut/editor-ports";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import type { ElementAnimations } from "../../packages/editor-classic/src/animation/types";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import {
	spatialSource,
	spatialParams,
	effect,
	assert,
	hash,
	spatialPixels,
} from "./spatial-probe-scene";
import { liquidSource } from "./liquid-browser-cases";
export { spatialParams, effect, assert, hash, spatialPixels };

export function liquidScene(
	effects: Effect[],
	options: {
		preview?: boolean;
		trim?: number;
		restored?: boolean;
		background?: string;
		animations?: ElementAnimations;
	} = {},
) {
	let tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
		overlay: [
			{
				id: "visual",
				name: "Visual",
				type: "graphic",
				elements: [
					{
						id: "pattern",
						type: "graphic",
						name: "Liquid source",
						definitionId: "programmatic",
						params: {},
						programmatic: {
							...spatialSource,
							code: `const pixels=(${liquidSource.toString()})(640,360,true);canvas.getContext('2d').putImageData(new ImageData(pixels,640,360),0,0);`,
						},
						startTime: 12000,
						duration: 120000,
						trimStart: options.trim ?? 40000,
						trimEnd: 0,
						effects,
						animations: options.animations,
					},
				],
			},
		],
	} as unknown as SceneTracks;
	if (options.restored) tracks = JSON.parse(JSON.stringify(tracks));
	return buildScene({
		tracks,
		mediaAssets: [],
		canvasSize: { width: 640, height: 360 },
		duration: 132000,
		background: { type: "color", color: options.background ?? "#203040" },
		assetResolver: {} as AssetResolver,
		isPreview: options.preview ?? false,
	});
}
export function liquidSceneSource() {
	const ctx = new OffscreenCanvas(640, 360).getContext("2d")!;
	ctx.putImageData(new ImageData(liquidSource(640, 360, true), 640, 360), 0, 0);
	return ctx.getImageData(0, 0, 640, 360).data;
}
export type LiquidCapture = (
	node: ReturnType<typeof liquidScene>,
	local: number,
) => Promise<Uint8ClampedArray>;
