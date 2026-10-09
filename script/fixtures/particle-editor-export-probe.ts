import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import {
	mediaTime,
	resolveMediaTimeRange,
} from "../../packages/editor-classic/src/wasm/media-time";
import { admitFinalUiProject } from "./particle-editor-export-admission";

export const editorExportProgress = { phase: "admission" };

export async function exportFinalUiProject(input: unknown, baseUrl: string) {
	const { project, scene, clip } = admitFinalUiProject(input);
	const api = new URL(baseUrl);
	if (
		api.protocol !== "http:" ||
		!["127.0.0.1", "localhost", "[::1]"].includes(api.hostname) ||
		api.username ||
		api.password ||
		api.search ||
		api.hash
	)
		throw Error("Credential-free explicit loopback API required");
	const assetResolver: AssetResolver = {
		resolve() {
			throw Error("Unexpected external asset in archived particle project");
		},
	};
	let gpu = false,
		compositor: WasmCompositor | undefined;
	let node: ReturnType<typeof buildScene> | undefined;
	let result:
		| {
				video: Uint8Array;
				mimeType: string;
				frameCount: number;
				width: number;
				height: number;
				frameRate: { numerator: number; denominator: number };
				range: { startTime: number; endTime: number; duration: number };
				savedClip: unknown;
		  }
		| undefined;
	const failures: unknown[] = [];
	try {
		editorExportProgress.phase = "gpu-initialize";
		await initializeGpu();
		gpu = true;
		compositor = new WasmCompositor({
			trackGpuResource: ({ handle, label }) => {
				let released = false;
				return {
					handle,
					label,
					resourceId: `ui-project-export:${handle}`,
					release() {
						if (!released) {
							disposeCompositor(handle);
							released = true;
						}
					},
				};
			},
		} as SessionResources);
		node = buildScene({
			programmaticFrames: createHttpProgrammaticFrames({
				base: api.href.replace(/\/$/, ""),
			}),
			tracks: scene.tracks,
			mediaAssets: [],
			canvasSize: project.settings.canvasSize,
			duration: project.metadata.duration,
			background: project.settings.background,
			assetResolver,
			isPreview: false,
		});
		const range = resolveMediaTimeRange({
			range: {
				startTime: mediaTime({ ticks: 0 }),
				endTime: project.metadata.duration,
			},
			timelineDuration: project.metadata.duration,
		});
		if (
			range.duration !== 484000 ||
			range.startTime !== 0 ||
			range.endTime !== 484000
		)
			throw Error("Full saved timeline range changed");
		editorExportProgress.phase = "scene-exporter-121-frames";
		const encoded = await new SceneExporter({
			width: project.settings.canvasSize.width,
			height: project.settings.canvasSize.height,
			fps: project.settings.fps,
			compositor,
			videoCache: {
				getFrameAt: async () => {
					throw Error("Unexpected video-cache access");
				},
			} as unknown as VideoCache,
			format: "webm",
			quality: "very_high",
			shouldIncludeAudio: false,
		}).export({ rootNode: node, range });
		if (
			!encoded ||
			!encoded.byteLength ||
			encoded.byteLength > 128 * 1024 * 1024
		)
			throw Error("Empty or oversized full-duration output");
		result = {
			video: new Uint8Array(encoded),
			mimeType: "video/webm",
			frameCount: 121,
			width: 1920,
			height: 1080,
			frameRate: project.settings.fps,
			range,
			savedClip: clip,
		};
		editorExportProgress.phase = "encoded-awaiting-independent-decode";
	} catch (error) {
		failures.push(error);
	}
	try {
		if (node) cancelPendingRenderFrames(node);
	} catch (error) {
		failures.push(error);
	}
	try {
		compositor?.dispose();
	} catch (error) {
		failures.push(error);
	}
	try {
		if (gpu) disposeGpu();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length)
		throw new AggregateError(
			failures,
			"Final UI project export or cleanup failed",
			{ cause: failures[0] },
		);
	return result!;
}
