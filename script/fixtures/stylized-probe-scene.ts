import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import { disposeCompositor } from "opencut-wasm";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";

export const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	width: 128,
	height: 72,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 120,
	seed: 7,
	code: `const c=canvas.getContext('2d');
for(let y=0;y<72;y+=4) for(let x=16;x<128;x+=4){
c.fillStyle='rgba('+x*2+','+y*3+','+((x^y)*2%256)+','+(y<36?0.5:1)+')';c.fillRect(x,y,4,4);}`,
};
export function makeParams() {
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `stylized:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	return {
		width: source.width,
		height: source.height,
		fps: source.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
}
export function scene(
	effects: Effect[],
	options: {
		preview?: boolean;
		trim?: number;
		layer?: string;
		background?: string;
		restored?: boolean;
	} = {},
) {
	const element = {
		id: "pattern",
		name: "Pattern",
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic: source,
		startTime: 12000,
		duration: 240000,
		trimStart: options.trim ?? 40000,
		trimEnd: 0,
		effects,
	};
	const overlay: unknown[] = [
		{
			id: "pattern-track",
			name: "Pattern",
			type: "graphic",
			elements: [element],
		},
	];
	if (options.layer)
		overlay.unshift(
			{
				id: "protected",
				name: "Foreground",
				type: "graphic",
				elements: [
					{
						...element,
						id: "protected-item",
						effects: [],
						programmatic: {
							...source,
							code: "const c=canvas.getContext('2d');c.fillStyle='#00ff00';c.fillRect(0,0,12,12);",
						},
					},
				],
			},
			{
				id: "fx",
				name: "Scene effect",
				type: "effect",
				elements: [
					{
						id: "fx-item",
						type: "effect",
						effectType: options.layer,
						params: { amount: 1 },
						startTime: 12000,
						duration: 240000,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		);
	let tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
		overlay,
	} as unknown as SceneTracks;
	if (options.restored) tracks = JSON.parse(JSON.stringify(tracks));
	return buildScene({
		tracks,
		mediaAssets: [],
		canvasSize: { width: source.width, height: source.height },
		duration: 252000,
		background: { type: "color", color: options.background ?? "#203040" },
		assetResolver: {} as AssetResolver,
		isPreview: options.preview ?? false,
	});
}
export const pixels = (canvas: CanvasImageSource) => {
	const ctx = new OffscreenCanvas(source.width, source.height).getContext(
		"2d",
	)!;
	ctx.drawImage(canvas, 0, 0);
	return ctx.getImageData(0, 0, source.width, source.height).data;
};
export const hash = async (data: Uint8ClampedArray) =>
	[
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer),
		),
	]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
export const effect = (type: string, params = {}): Effect => ({
	id: "filter",
	type,
	enabled: true,
	params,
});
export function assert(value: unknown, message: string): asserts value {
	if (!value) throw Error(message);
}
