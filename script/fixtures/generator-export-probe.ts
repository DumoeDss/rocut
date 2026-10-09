import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	assertGenerator as assert,
	generatorHash,
	generatorPixels,
	generatorDetail,
} from "./generator-browser-assets";

export async function exportGenerators(
	sources: ProgrammaticSource[],
	resources: ResolvedProgrammaticResource[],
	{ startTime = 36000, requireAlpha = true } = {},
) {
	// Raster checks separately stress 192x108; encode at 384x216 so 4:2:0 chroma
	// subsampling does not turn one-pixel colored cells into a codec stress test.
	const width = 384,
		height = 216;
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `generators:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Canvas generators must not use HTML/Host capture");
		},
		loadResource: async ({ resource, signal }) => {
			signal.throwIfAborted();
			const item = resources.find(
				(r) => r.resource.id === Reflect.get(resource as object, "id"),
			);
			assert(item, "Missing generator attachment");
			return new Blob([item.body], { type: item.resource.mimeType });
		},
	};
	const tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
		overlay: sources.map((source, index) => ({
			id: `t${index}`,
			name: "Generator",
			type: "graphic",
			elements: [
				{
					id: `c${index}`,
					name: "Generator",
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: { ...source, width, height },
					startTime: 12000,
					duration: 120000,
					trimStart: 0,
					trimEnd: 0,
				},
			],
		})),
	} as unknown as SceneTracks;
	const scene = (isPreview: boolean, background = "#102030") =>
		buildScene({
			tracks,
			mediaAssets: [],
			canvasSize: { width, height },
			duration: 132000,
			background: { type: "color", color: background },
			assetResolver: {} as AssetResolver,
			programmaticFrames: provider,
			isPreview,
		});
	const params = {
		width,
		height,
		fps: sources[0].frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	const pixels = (canvas: CanvasImageSource) =>
		generatorPixels(canvas, width, height);
	const hash = (d: Uint8ClampedArray) =>
		generatorHash(new Uint8Array(d).buffer);
	try {
		const renderer = new CanvasRenderer(params),
			preview = scene(true),
			output = scene(false);
		const capture = (node: ReturnType<typeof scene>, time: number) =>
			renderer.renderAndCapture({ node, time, capture: pixels });
		const seen: string[] = [];
		for (const time of [36000, 84000, 36000]) {
			const a = await capture(preview, time),
				b = await capture(output, time);
			seen.push(await hash(a));
			assert(
				seen.at(-1) === (await hash(b)),
				"Generator preview/export differ",
			);
		}
		assert(
			seen[0] === seen[2] && seen[0] !== seen[1],
			"Generator composition seek leaked state",
		);
		const light = await capture(scene(false, "#eeeeee"), 84000);
		assert(
			!requireAlpha || (await hash(light)) !== seen[1],
			"Transparent generators obscured both backdrops",
		);
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: {
				startTime: mediaTime({ ticks: startTime }),
				endTime: mediaTime({ ticks: startTime + 24000 }),
				duration: mediaTime({ ticks: 24000 }),
			},
		});
		assert(bytes, "No generator video");
		const input = new Input({
			source: new BufferSource(bytes),
			formats: ALL_FORMATS,
		});
		const errors: number[] = [],
			expectedFrames: Uint8ClampedArray[] = [];
		const detail: ReturnType<typeof generatorDetail>[] = [];
		let motion = 0,
			first: Uint8ClampedArray | undefined;
		try {
			const video = await input.getPrimaryVideoTrack();
			assert(video, "No video track");
			for await (const sample of new CanvasSink(video).canvases()) {
				const expected = await capture(
						output,
						startTime + errors.length * 4000,
					),
					actual = pixels(sample.canvas);
				errors.push(
					actual.reduce((sum, v, i) => sum + Math.abs(v - expected[i]), 0) /
						actual.length,
				);
				expectedFrames.push(expected);
				detail.push(generatorDetail(actual, expected));
				if (first)
					motion =
						actual.reduce((sum, v, i) => sum + Math.abs(v - first![i]), 0) /
						actual.length;
				else first = actual;
			}
		} finally {
			input.dispose();
		}
		assert(
			errors.length === 6 && Math.max(...errors) < 10 && motion > 0.1,
			`Generator decode ${JSON.stringify({ errors, motion })}`,
		);
		assert(
			detail.every(
				(d) =>
					d.pixels > 500 &&
					d.error < 25 &&
					d.contrastRatio > 0.7 &&
					d.contrastRatio < 1.3,
			),
			`Generator foreground decode ${JSON.stringify(detail)}`,
		);
		let binary = "";
		for (const byte of new Uint8Array(bytes))
			binary += String.fromCharCode(byte);
		Reflect.set(globalThis, "__stylizedVideoBase64", btoa(binary));
		let expectedBinary = "";
		for (const frame of expectedFrames)
			for (const byte of frame) expectedBinary += String.fromCharCode(byte);
		Reflect.set(globalThis, "__stylizedExpectedBase64", btoa(expectedBinary));
		return {
			width,
			height,
			fps: sources[0].frameRate,
			frames: errors.length,
			quality: "very_high",
			detail,
			errors,
			errorLimit: 10,
			motion,
			bytes: bytes.byteLength,
			previewExportEqual: true,
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
