import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { lightLeakSource } from "./mv-light-leak-source";
import {
	check,
	difference,
	originalPixels,
	pixels,
} from "./mv-light-leak-pixels";

export async function exportLightLeak() {
	const ticks = (frame: number) => mediaTime({ ticks: frame * 4004 });
	const source = structuredClone(lightLeakSource()) as any;
	source.recipe.nodes[0].scene.color[3] = 1;
	source.recipe.post[0].effects[0].speed = 8;
	source.recipe.post[0].automation = [
		{
			effect: 0,
			keyframes: [
				{ frame: 2, value: 0.15, easing: "linear" },
				{ frame: 5, value: 0.85, easing: "linear" },
			],
		},
	];
	const external = {
		...source,
		recipe: undefined,
		code: "const c=canvas.getContext('2d');c.fillStyle='lime';c.fillRect(0,0,16,16);",
	};
	const clip = (
		id: string,
		programmatic: typeof source,
		start: number,
		duration: number,
		trim: number,
	) => ({
		id,
		name: id,
		type: "graphic" as const,
		definitionId: "programmatic",
		params: {},
		programmatic,
		startTime: ticks(start),
		duration: ticks(duration),
		trimStart: ticks(trim),
		trimEnd: ticks(300 - trim - duration),
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
				id: "external",
				name: "External timeline marker",
				type: "graphic",
				hidden: false,
				elements: [clip("external", external, 0, 6, 0)],
			},
			{
				id: "leak",
				name: "Recipe-local light leak",
				type: "graphic",
				hidden: false,
				elements: [clip("leak", source, 1, 4, 2)],
			},
		],
	};
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({
			handle,
			label,
		}: {
			handle: number;
			label: string;
		}) => ({
			handle,
			label,
			resourceId: `light-leak:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const scene = (isPreview: boolean) =>
		buildScene({
			tracks,
			mediaAssets: [],
			duration: ticks(6),
			canvasSize: { width: 160, height: 96 },
			background: { type: "color", color: "#000000" },
			isPreview,
			assetResolver: {} as AssetResolver,
		});
	const params = {
		width: 160,
		height: 96,
		fps: { numerator: 30000, denominator: 1001 },
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	try {
		const preview = scene(true),
			output = scene(false),
			renderer = new CanvasRenderer(params),
			expectations: number[][] = [],
			observations: unknown[] = [];
		for (let frame = 0; frame < 6; frame++) {
			const canvas = new OffscreenCanvas(160, 96),
				ctx = canvas.getContext("2d")!;
			ctx.fillStyle = "black";
			ctx.fillRect(0, 0, 160, 96);
			if (frame >= 1 && frame < 5) {
				const index = frame + 1,
					amount = 0.15 + ((index - 2) * (0.85 - 0.15)) / 3;
				ctx.putImageData(
					new ImageData(
						originalPixels(source, index, { amount, speed: 8, opaque: true }),
						160,
						96,
					),
					0,
					0,
				);
			}
			ctx.fillStyle = "lime";
			ctx.fillRect(0, 0, 16, 16);
			expectations.push([...ctx.getImageData(0, 0, 160, 96).data]);
		}
		for (const frame of [4, 1, 3, 0, 5, 2, 1]) {
			const a = await renderer.renderAndCapture({
				node: preview,
				time: ticks(frame),
				capture: (image) => pixels(image),
			});
			const b = await renderer.renderAndCapture({
				node: output,
				time: ticks(frame),
				capture: (image) => pixels(image),
			});
			check(
				difference(a, b).max === 0,
				"Preview/export light-leak pixels differ",
			);
			const error = difference(a, new Uint8ClampedArray(expectations[frame]!));
			check(
				error.max <= 2,
				`GPU differs from independent reference at frame ${frame}: ${JSON.stringify(error)}`,
			);
			const at = (8 * 160 + 8) * 4;
			check(
				a[at] === 0 && a[at + 1] === 255 && a[at + 2] === 0,
				"Recipe post contaminated external timeline marker",
			);
			observations.push({ frame, error });
		}
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: { startTime: ticks(0), endTime: ticks(6), duration: ticks(6) },
		});
		check(bytes, "SceneExporter produced no light-leak artifact");
		return {
			bytes: [...new Uint8Array(bytes!)],
			expectations,
			observations,
			checks: [
				"real buildScene/ProgrammaticNode/GPU preview/export against original reference; placement=1 trim=2; 30000/1001 fps",
				"external timeline marker unaffected by recipe composite post; six-frame WebM for independent FFmpeg decode",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
