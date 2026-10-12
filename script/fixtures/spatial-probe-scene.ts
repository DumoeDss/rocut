import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import { disposeCompositor } from "opencut-wasm";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { ElementAnimations } from "../../packages/editor-classic/src/animation/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
export { assert, hash, effect } from "./stylized-probe-scene";

export const spatialSource: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	width: 640,
	height: 360,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 120,
	seed: 7,
	code: `const c=canvas.getContext('2d');
const g=c.createLinearGradient(0,0,640,360);g.addColorStop(0,'#f5b53c');g.addColorStop(0.5,'#be345c');g.addColorStop(1,'#21bad5');
c.fillStyle=g;c.fillRect(24,24,592,312);
c.fillStyle='#f7ead6';for(let x=40;x<620;x+=32)c.fillRect(x,32,6,296);
c.fillStyle='#132231';for(let y=48;y<330;y+=32)c.fillRect(32,y,576,4);
c.clearRect(280,140,80,80);c.fillStyle='rgba(60,180,250,0.5)';c.fillRect(280,140,40,80);
c.strokeStyle='#f7ead6';c.lineWidth=6;c.beginPath();c.arc(470,180,68,0,Math.PI*2);c.stroke();`,
};
export function spatialParams() {
	return {
		width: 640,
		height: 360,
		fps: spatialSource.frameRate,
		compositor: new WasmCompositor({
			setTimeout: ({ handler, ms }) => {
				const id = globalThis.setTimeout(handler, ms);
				return {
					kind: "timeout",
					resourceId: `spatial:timeout:${id}`,
					cancel: () => globalThis.clearTimeout(id),
				};
			},
			trackGpuResource: ({ handle, label }) => ({
				handle,
				label,
				resourceId: `spatial:${handle}`,
				release: () => disposeCompositor(handle),
			}),
		} as SessionResources),
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
}
export function trajectory(): ElementAnimations {
	return Object.fromEntries(
		Object.entries({ centerX: [0.2, 0.8], centerY: [0.35, 0.65] }).map(
			([key, values]) => [
				`effects.filter.params.${key}`,
				{
					keys: values.map((value, index) => ({
						id: `${key}-${index}`,
						time: mediaTime({ ticks: index * 24000 }),
						value,
						segmentToNext: "linear",
						tangentMode: "auto",
					})),
				},
			],
		),
	);
}
export function spatialScene(
	effects: Effect[],
	options: {
		preview?: boolean;
		trim?: number;
		background?: string;
		animate?: boolean;
		animations?: ElementAnimations;
		restored?: boolean;
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
						name: "Pattern",
						definitionId: "programmatic",
						params: {},
						programmatic: spatialSource,
						startTime: 12000,
						duration: 120000,
						trimStart: options.trim ?? 40000,
						trimEnd: 0,
						effects,
						animations: options.animate
							? { ...trajectory(), ...options.animations }
							: options.animations,
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
export function spatialPixels(canvas: CanvasImageSource) {
	const ctx = new OffscreenCanvas(640, 360).getContext("2d")!;
	ctx.drawImage(canvas, 0, 0);
	return ctx.getImageData(0, 0, 640, 360).data;
}
