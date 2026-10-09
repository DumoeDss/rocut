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
import { check, difference, pixels } from "./mv-afterimage-capture";
import type { AfterimageOracle } from "./mv-afterimage-pixels";

export async function exportAfterimage(
	input: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	oracle: AfterimageOracle,
) {
	const width = 384,
		height = 216,
		ticks = (frame: number) => mediaTime({ ticks: frame * 4000 });
	const source = structuredClone(input);
	Reflect.set(source, "frameRate", { numerator: 30, denominator: 1 });
	Reflect.set(source, "durationFrames", 90);
	Reflect.set(source.recipe!.nodes[0]!.scene, "span", {
		startFrame: 0,
		durationFrames: 90,
	});
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Canvas afterimage used DOM provider");
		},
		loadResource: async ({ resource, signal }) => {
			signal.throwIfAborted();
			const item = resources.find(
				(r) => r.resource.id === Reflect.get(resource as object, "id"),
			);
			check(item, "Missing export resource");
			return new Blob([item.body], { type: item.resource.mimeType });
		},
	};
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
				id: "after",
				name: "Afterimage",
				type: "graphic",
				hidden: false,
				elements: [
					{
						id: "clip",
						name: "Afterimage",
						type: "graphic",
						definitionId: "programmatic",
						params: {},
						programmatic: source,
						startTime: ticks(1),
						duration: ticks(4),
						trimStart: ticks(12),
						trimEnd: ticks(74),
					},
				],
			},
		],
	};
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `afterimage:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	try {
		const scene = (isPreview: boolean) =>
			buildScene({
				tracks,
				mediaAssets: [],
				duration: ticks(6),
				canvasSize: { width, height },
				background: { type: "color", color: "#000000" },
				isPreview,
				assetResolver: {} as AssetResolver,
				programmaticFrames: provider,
			});
		const preview = scene(true),
			output = scene(false);
		const params = {
			width,
			height,
			fps: { numerator: 30, denominator: 1 },
			compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
		};
		const renderer = new CanvasRenderer(params),
			expectations: number[][] = [],
			gpuObservations: unknown[] = [];
		for (let i = 0; i < 6; i++) {
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			ctx.fillStyle = "black";
			ctx.fillRect(0, 0, width, height);
			if (i >= 1 && i < 5) {
				const result = await oracle.render({
					time: 12.25 + (i + 11) / 30,
					shotStart: 12.25,
					duration: 3,
				});
				try {
					ctx.drawImage(result.bitmap, 0, 0, width, height);
				} finally {
					result.bitmap.close();
					result.canvas.width = result.canvas.height = 1;
				}
			}
			expectations.push([...ctx.getImageData(0, 0, width, height).data]);
			canvas.width = canvas.height = 1;
		}
		for (const frame of [4, 1, 3, 0, 5, 2, 1]) {
			const a = await renderer.renderAndCapture({
				node: preview,
				time: ticks(frame),
				capture: (image) => pixels(image, width, height),
			});
			const b = await renderer.renderAndCapture({
				node: output,
				time: ticks(frame),
				capture: (image) => pixels(image, width, height),
			});
			check(difference(a, b).max === 0, "Afterimage preview/export mismatch");
			const error = difference(a, new Uint8ClampedArray(expectations[frame]!));
			check(
				error.mae < 0.3 && error.max <= 5,
				`Afterimage GPU/original mismatch ${frame}: ${JSON.stringify(error)}`,
			);
			gpuObservations.push({ frame, error });
		}
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: { startTime: ticks(0), endTime: ticks(6), duration: ticks(6) },
		});
		check(bytes, "Afterimage export produced no video");
		return {
			bytes: [...new Uint8Array(bytes)],
			expectations,
			gpuObservations,
			checks: [
				"Real buildScene/ProgrammaticNode/resource bridge/GPU preview-export parity and original reference with placement=1, trim=12; six-frame SceneExporter WebM",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
