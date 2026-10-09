import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import { Input, BufferSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

export async function runThreeSceneExportProbe(source: ProgrammaticSource) {
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `three:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const params = {
		width: source.width,
		height: source.height,
		fps: source.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
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
						id: "scene",
						name: "Scene",
						type: "graphic",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						startTime: 0,
						duration: 240000,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		],
	} as unknown as SceneTracks;
	const scene = (isPreview: boolean, background = "#204060") =>
		buildScene({
			programmaticFrames: createHttpProgrammaticFrames({ base: "/api" }),
			tracks,
			mediaAssets: [],
			canvasSize: { width: source.width, height: source.height },
			duration: 240000,
			background: { type: "color", color: background },
			assetResolver: {} as AssetResolver,
			isPreview,
		});
	const capture = (canvas: CanvasImageSource) => {
		const context = new OffscreenCanvas(source.width, source.height).getContext(
			"2d",
		)!;
		context.drawImage(canvas, 0, 0);
		return context.getImageData(0, 0, source.width, source.height).data;
	};
	try {
		const renderer = new CanvasRenderer(params),
			preview = await renderer.renderAndCapture({
				node: scene(true),
				time: 0,
				capture,
			}),
			output = await renderer.renderAndCapture({
				node: scene(false),
				time: 0,
				capture,
			});
		if (preview.some((value, i) => value !== output[i]))
			throw Error("Three preview/export graph mismatch");
		const pixel = (rgba: Uint8ClampedArray, x: number, y: number) => [
			...rgba.slice((y * source.width + x) * 4, (y * source.width + x) * 4 + 4),
		];
		const halfAlphaDark = pixel(preview, 220, 76);
		const light = await renderer.renderAndCapture({
			node: scene(false, "#eeeeee"),
			time: 0,
			capture,
		});
		const halfAlphaLight = pixel(light, 220, 76);
		for (const [actual, expected] of [
			[halfAlphaDark, [140, 62, 69, 255]],
			[halfAlphaLight, [243, 149, 140, 255]],
		])
			if (actual.some((value, i) => Math.abs(value - expected[i]) > 3))
				throw Error(
					`Three GPU alpha composition failed: ${JSON.stringify({ actual, expected })}`,
				);
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "high",
		}).export({
			rootNode: scene(false),
			range: {
				startTime: mediaTime({ ticks: 0 }),
				endTime: mediaTime({ ticks: 24000 }),
				duration: mediaTime({ ticks: 24000 }),
			},
		});
		if (!bytes) throw Error("Three export produced no video");
		const input = new Input({
			source: new BufferSource(bytes),
			formats: ALL_FORMATS,
		});
		let frames = 0,
			error = 0,
			decodedMotionMean = 0;
		let firstDecoded: Uint8ClampedArray | undefined;
		try {
			const video = await input.getPrimaryVideoTrack();
			if (!video) throw Error("No encoded Three video track");
			for await (const sample of new CanvasSink(video).canvases()) {
				const decoded = capture(sample.canvas);
				if (frames === 0) {
					firstDecoded = decoded;
					error =
						decoded.reduce(
							(sum, value, i) => sum + Math.abs(value - preview[i]),
							0,
						) / decoded.length;
				} else
					decodedMotionMean =
						decoded.reduce(
							(sum, value, i) => sum + Math.abs(value - firstDecoded![i]),
							0,
						) / decoded.length;
				frames++;
			}
			if (frames !== 6 || error > 8 || decodedMotionMean < 0.1)
				throw Error(
					`Three encoded frames differ: ${JSON.stringify({ frames, error, decodedMotionMean })}`,
				);
		} finally {
			input.dispose();
		}
		let binary = "";
		for (const value of new Uint8Array(bytes))
			binary += String.fromCharCode(value);
		Reflect.set(globalThis, "__threeVideoBase64", btoa(binary));
		console.log(
			"HTML probe: Three scene → Rocut compositor → real WebM encode/decode passed",
		);
		return {
			width: source.width,
			height: source.height,
			fps: 30,
			encodedBytes: bytes.byteLength,
			decodedFrames: frames,
			meanRgbaError: error,
			decodedMotionMean,
			halfAlphaDark,
			halfAlphaLight,
			previewExportEqual: true,
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
