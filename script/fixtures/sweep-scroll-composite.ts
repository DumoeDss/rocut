import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import {
	generatorPixels,
	assertGenerator as assert,
} from "./generator-browser-assets";
import {
	compareSweepScroll,
	scrollOracle,
	sweepOracle,
} from "./sweep-scroll-oracles";

export async function checkSweepScrollComposite(
	sources: ProgrammaticSource[],
	resources: ResolvedProgrammaticResource[],
	image: OffscreenCanvas,
) {
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `sweep-scroll:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Canvas generator used Host capture");
		},
		loadResource: async ({ resource, signal }) => {
			signal.throwIfAborted();
			const item = resources.find(
				(r) => r.resource.id === Reflect.get(resource as object, "id"),
			);
			assert(item, "Composite resource missing");
			return new Blob([item.body], { type: item.resource.mimeType });
		},
	};
	try {
		const tracks = {
			main: { id: "main", name: "Main", type: "video", elements: [] },
			audio: [],
			overlay: sources.map((source, i) => ({
				id: `track-${i}`,
				name: "Generator",
				type: "graphic",
				elements: [
					{
						id: `clip-${i}`,
						name: "Generator",
						type: "graphic",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						startTime: 12000,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			})),
		} as unknown as SceneTracks;
		const node = buildScene({
			tracks,
			mediaAssets: [],
			canvasSize: { width: 192, height: 108 },
			duration: 132000,
			background: { type: "color", color: "#102030" },
			assetResolver: {} as AssetResolver,
			programmaticFrames: provider,
			isPreview: false,
		});
		const renderer = new CanvasRenderer({
			width: 192,
			height: 108,
			fps: sources[0].frameRate,
			compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
		});
		const actual = await renderer.renderAndCapture({
			node,
			time: 60000,
			capture: (canvas) => generatorPixels(canvas, 192, 108),
		});
		const expected = new OffscreenCanvas(192, 108),
			ctx = expected.getContext("2d")!;
		ctx.fillStyle = "#102030";
		ctx.fillRect(0, 0, 192, 108);
		for (const pixels of [scrollOracle(image, 12), sweepOracle(12)]) {
			const layer = new OffscreenCanvas(192, 108);
			layer
				.getContext("2d")!
				.putImageData(
					new ImageData(new Uint8ClampedArray(pixels), 192, 108),
					0,
					0,
				);
			ctx.drawImage(layer, 0, 0);
		}
		return compareSweepScroll(
			actual,
			ctx.getImageData(0, 0, 192, 108).data,
			"Timeline top-to-bottom overlay",
		);
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
