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
import { at, check, digest, pixels } from "./mv-finishing-capture";
import { exportFinishingSource } from "./mv-finishing-source";

export async function exportFinishing() {
	const ticks = (frame: number) => mediaTime({ ticks: frame * 5000 });
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
				id: "finishing",
				name: "Finishing",
				type: "graphic",
				hidden: false,
				elements: [
					{
						id: "finish",
						name: "Finishing",
						type: "graphic",
						definitionId: "programmatic",
						params: {},
						programmatic: exportFinishingSource(),
						startTime: ticks(1),
						duration: ticks(4),
						trimStart: ticks(2),
						trimEnd: ticks(6),
					},
				],
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
			resourceId: `finishing:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const scene = (isPreview: boolean) =>
		buildScene({
			tracks,
			mediaAssets: [],
			duration: ticks(6),
			canvasSize: { width: 100, height: 100 },
			background: { type: "color", color: "#000000" },
			isPreview,
			assetResolver: {} as AssetResolver,
		});
	const params = {
		width: 100,
		height: 100,
		fps: { numerator: 24, denominator: 1 },
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	try {
		const preview = scene(true),
			output = scene(false),
			renderer = new CanvasRenderer(params);
		const expected = [0, 107.1, 130.05, 153, 130.05, 0],
			seen = new Map<number, string>();
		for (const frame of [4, 1, 3, 0, 5, 2, 1]) {
			const a = await renderer.renderAndCapture({
				node: preview,
				time: ticks(frame),
				capture: pixels,
			});
			const b = await renderer.renderAndCapture({
				node: output,
				time: ticks(frame),
				capture: pixels,
			});
			const hash = await digest(a);
			check(
				hash === (await digest(b)),
				`Preview/export pixel mismatch at timeline frame ${frame}`,
			);
			check(
				!seen.has(frame) || seen.get(frame) === hash,
				"GPU reverse seek changed finishing pixels",
			);
			seen.set(frame, hash);
			check(
				at(a)
					.slice(0, 3)
					.every((value) => Math.abs(value - expected[frame]) <= 1),
				`Timeline placement/trim/source curve frame ${frame}: ${at(a)}, expected ${expected[frame]}`,
			);
			check(
				at(a, 50, 4)
					.slice(0, 3)
					.every((value) => value <= 1),
				"GPU letterbox top row is not black",
			);
		}
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: { startTime: ticks(0), endTime: ticks(6), duration: ticks(6) },
		});
		check(bytes, "SceneExporter produced no finishing artifact");
		return {
			bytes: [...new Uint8Array(bytes)],
			checks: [
				"real buildScene/ProgrammaticNode/GPU preview/export parity with placement=1, trim=2, source-time automation",
				"all five finishing effects exported into a six-frame WebM for independent native FFmpeg decoding",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
