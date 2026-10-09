import { Input, BufferSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

export async function runMvExportProbe(
	source: ProgrammaticSource,
	resources: ResolvedProgrammaticResource[],
) {
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `mv:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Recipe must not use HTML backend");
		},
		loadResource: async ({ resource, signal }) => {
			signal.throwIfAborted();
			const id = Reflect.get(resource as object, "id");
			const item = resources.find((r) => r.resource.id === id);
			if (!item) throw Error("Missing fixture attachment");
			return new Blob([item.body], { type: item.resource.mimeType });
		},
	};
	const tracks = {
		overlay: [
			{
				id: "recipe-track",
				name: "MV recipe",
				type: "graphic",
				hidden: false,
				elements: [
					{
						id: "recipe-clip",
						name: "MV recipe",
						type: "graphic",
						definitionId: "programmatic",
						programmatic: source,
						params: {},
						startTime: 0,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		],
		main: {
			id: "main",
			name: "Main",
			type: "video",
			hidden: false,
			muted: false,
			elements: [],
		},
		audio: [],
	} as unknown as SceneTracks;
	const scene = (isPreview: boolean) =>
		buildScene({
			canvasSize: { width: 64, height: 64 },
			tracks,
			mediaAssets: [],
			duration: 120000,
			background: { type: "color", color: "#ffffff" },
			isPreview,
			assetResolver: {} as AssetResolver,
			programmaticFrames: provider,
		});
	const params = {
		width: 64,
		height: 64,
		fps: source.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	const pixels = (image: CanvasImageSource) => {
		const c = new OffscreenCanvas(64, 64),
			ctx = c.getContext("2d")!;
		ctx.drawImage(image, 0, 0);
		return ctx.getImageData(0, 0, 64, 64).data;
	};
	const hash = async (image: CanvasImageSource) =>
		[
			...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels(image))),
		].join(",");
	try {
		const renderer = new CanvasRenderer(params),
			preview = scene(true),
			output = scene(false),
			hashes: string[] = [];
		for (const time of [20000, 80000, 20000]) {
			const a = await renderer.renderAndCapture({
				node: preview,
				time,
				capture: hash,
			});
			const b = await renderer.renderAndCapture({
				node: output,
				time,
				capture: hash,
			});
			if (a !== b) throw Error("MV recipe preview/export GPU mismatch");
			hashes.push(a);
		}
		if (hashes[0] !== hashes[2] || hashes[0] === hashes[1])
			throw Error("MV recipe GPU seek is stale");
		const exporter = new SceneExporter({
			...params,
			format: "webm",
			quality: "high",
		});
		const start = 20000,
			end = 30000;
		const bytes = await exporter.export({
			rootNode: output,
			range: {
				startTime: mediaTime({ ticks: start }),
				endTime: mediaTime({ ticks: end }),
				duration: mediaTime({ ticks: end - start }),
			},
		});
		if (!bytes) throw Error("No MV recipe export");
		const input = new Input({
			source: new BufferSource(bytes),
			formats: ALL_FORMATS,
		});
		try {
			const video = await input.getPrimaryVideoTrack();
			if (!video) throw Error("Missing MV video track");
			const sink = new CanvasSink(video);
			let frames = 0;
			for await (const decoded of sink.canvases()) {
				const expected = await renderer.renderAndCapture({
					node: output,
					time: start + frames * 5000,
					capture: pixels,
				});
				const actual = pixels(decoded.canvas);
				let error = 0;
				for (let i = 0; i < actual.length; i += 4)
					for (let k = 0; k < 3; k++)
						error += Math.abs(actual[i + k] - expected[i + k]);
				if (error / (64 * 64 * 3) > 12)
					throw Error("Decoded recipe export differs from frame composition");
				frames++;
			}
			if (frames !== 2)
				throw Error(`Expected exactly two recipe frames, got ${frames}`);
		} finally {
			input.dispose();
		}
		return {
			encodedBytes: bytes.byteLength,
			checks: [
				"real recipe resources through production loader and Rocut GPU preview/export parity",
				"actual two-frame WebM encode/decode matches composed recipe frames",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
