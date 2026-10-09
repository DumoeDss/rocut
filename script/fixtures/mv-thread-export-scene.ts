import { disposeCompositor } from "opencut-wasm";
import {
	isProgrammaticResource,
	type ResolvedProgrammaticResource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { check } from "./mv-afterimage-capture";
import { THREAD_EXPORT, THREAD_EXPORT_CLIPS } from "./mv-thread-export-support";
export function threadExportScene(
	sources: readonly ProgrammaticSource[],
	resources: readonly ResolvedProgrammaticResource[],
) {
	const { width, height, frames, fps, outputStep, sourceStep } = THREAD_EXPORT;
	const time = (frame: number) => mediaTime({ ticks: frame * outputStep });
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Thread unexpectedly used an external HTML frame provider");
		},
		loadResource: async ({ resource }) => {
			check(
				isProgrammaticResource(resource),
				"Invalid Thread attachment identity",
			);
			const found = resources.find(
				(r) => JSON.stringify(r.resource) === JSON.stringify(resource),
			);
			check(found, "Unknown Thread export attachment");
			return new Blob([found.body], { type: resource.mimeType });
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
				id: "thread",
				name: "Thread",
				type: "graphic",
				hidden: false,
				elements: THREAD_EXPORT_CLIPS.map((clip, index) => ({
					id: clip.id,
					name: clip.id,
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: sources[index]!,
					startTime: time(clip.start),
					duration: time(clip.duration),
					trimStart: mediaTime({ ticks: clip.trimSourceFrame * sourceStep }),
					trimEnd: mediaTime({
						ticks:
							sources[index]!.durationFrames * sourceStep -
							clip.trimSourceFrame * sourceStep -
							clip.duration * outputStep,
					}),
				})),
			},
		],
	};
	const build = (isPreview: boolean) =>
		buildScene({
			tracks,
			mediaAssets: [],
			duration: time(frames),
			canvasSize: { width, height },
			background: { type: "color", color: "#000000" },
			isPreview,
			assetResolver: {} as AssetResolver,
			programmaticFrames: provider,
		});
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `thread:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	return {
		preview: build(true),
		output: build(false),
		compositor,
		time,
		params: {
			width,
			height,
			fps: { numerator: fps, denominator: 1 },
			compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
		},
	};
}
