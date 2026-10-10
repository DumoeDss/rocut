import { disposeCompositor } from "opencut-wasm";
import {
	type ResolvedProgrammaticResource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { INK_EXPORT, INK_EXPORT_CLIPS } from "./mv-ink-export-support";
import { loadInkExportResource } from "./mv-ink-export-resource";
export function inkExportScene({
	sources,
	resources,
}: {
	sources: readonly ProgrammaticSource[];
	resources: readonly ResolvedProgrammaticResource[];
}) {
	const { width, height, frames, fps, outputStep, sourceStep } = INK_EXPORT;
	const time = (frame: number) => mediaTime({ ticks: frame * outputStep });
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Ink unexpectedly used an external HTML frame provider");
		},
		loadResource: async ({ resource }) => {
			return loadInkExportResource({ resources, resource });
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
				id: "ink",
				name: "Ink",
				type: "graphic",
				hidden: false,
				elements: INK_EXPORT_CLIPS.map((clip) => ({
					id: clip.id,
					name: clip.id,
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: sources[clip.caseIndex]!,
					startTime: time(clip.start),
					duration: time(clip.duration),
					trimStart: mediaTime({ ticks: clip.trimSourceFrame * sourceStep }),
					trimEnd: mediaTime({
						ticks:
							sources[clip.caseIndex]!.durationFrames * sourceStep -
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
			assetResolver: {
				resolve: () => {
					throw Error("Ink export unexpectedly requested a host asset");
				},
			} satisfies AssetResolver,
			programmaticFrames: provider,
		});
	const resourcesPort: SessionResources = {
		setTimeout: () => {
			throw Error("Unexpected session timer");
		},
		setInterval: () => {
			throw Error("Unexpected session interval");
		},
		requestAnimationFrame: () => {
			throw Error("Unexpected session animation frame");
		},
		createWorker: () => {
			throw Error("Unexpected session Worker");
		},
		createAudioContext: () => {
			throw Error("Unexpected session audio context");
		},
		createObjectUrl: () => {
			throw Error("Unexpected session object URL");
		},
		inspect: () => {
			throw Error("Unexpected session inspection");
		},
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `ink:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	};
	const compositor = new WasmCompositor(resourcesPort);
	const videoCache = new VideoCache();
	return {
		preview: build(true),
		output: build(false),
		compositor,
		videoCache,
		time,
		params: {
			width,
			height,
			fps: { numerator: fps, denominator: 1 },
			compositor,
			videoCache,
		},
	};
}
