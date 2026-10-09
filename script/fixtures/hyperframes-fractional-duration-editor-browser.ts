import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import type {
	GraphicElement,
	SceneTracks,
} from "../../packages/editor-classic/src/timeline/types";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { ProgrammaticAudioRuntime } from "../../packages/editor-classic/src/media/programmatic-audio-runtime";
import { collectProgrammaticAudio } from "../../packages/editor-classic/src/media/programmatic-audio";
import { createTimelineAudioBuffer } from "../../packages/editor-classic/src/media/audio";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { durationEditorOrdinarySample } from "./hyperframes-fractional-duration-editor-spec.mjs";
import {
	check,
	compare,
} from "./hyperframes-fractional-duration-editor-browser-metrics";

const ticks = (frames: number) => mediaTime({ ticks: frames * 4800 });
async function run() {
	const source: ProgrammaticSource = await (await fetch("/api/source")).json();
	check(
		source.audio?.profile === "hyperframes-graph-v1",
		"Explicit graph profile lost",
	);
	const [expectedSource, wrongSource, expectedTimeline] = await Promise.all(
		["source", "rounded", "timeline"].map(
			async (name) =>
				new DataView(await (await fetch(`/api/oracle/${name}`)).arrayBuffer()),
		),
	);
	const http = createHttpProgrammaticFrames({ base: "/api" }),
		requests = { audio: 0, identity: 0 };
	const provider = {
		...http,
		getAudioIdentity: async (
			args: Parameters<NonNullable<typeof http.getAudioIdentity>>[0],
		) => {
			requests.identity++;
			return http.getAudioIdentity!(args);
		},
		renderAudio: async (
			args: Parameters<NonNullable<typeof http.renderAudio>>[0],
		) => {
			requests.audio++;
			return http.renderAudio!(args);
		},
	};
	const runtime = new ProgrammaticAudioRuntime(provider),
		context = new AudioContext({ sampleRate: 44100 });
	const clip: GraphicElement = {
		type: "graphic",
		id: "fractional-duration",
		name: "Fractional duration",
		definitionId: "programmatic",
		programmatic: source,
		startTime: ticks(2),
		duration: ticks(16),
		trimStart: ticks(1),
		trimEnd: ticks(1),
		params: {},
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
		overlay: [
			{
				id: "graphics",
				name: "HyperFrames",
				type: "graphic",
				hidden: false,
				elements: [clip],
			},
		],
		audio: [],
	};
	const signal = AbortSignal.timeout(180000);
	await initializeGpu();
	const resources = {
		trackGpuResource: ({
			handle,
			label,
		}: {
			handle: number;
			label: string;
		}) => ({
			handle,
			label,
			resourceId: `hf-duration-editor:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources;
	const compositor = new WasmCompositor(resources);
	try {
		const collected = await collectProgrammaticAudio({
			tracks,
			runtime,
			audioContext: context,
			signal,
		});
		check(
			collected.length === 1 && collected[0].buffer.length === 31752,
			"Graph canonical duration changed",
		);
		check(
			collected[0].startTime === 0.08 &&
				collected[0].trimStart === 0.04 &&
				collected[0].duration === 0.64,
			"Editor placement/trim changed",
		);
		check(
			Math.abs(collected[0].volume - 10 ** (-6 / 20)) < 1e-12,
			"Source gain changed",
		);
		const raw = collected[0].buffer,
			native = compare(raw, expectedSource),
			wrong = compare(raw, wrongSource);
		check(
			native.maximum < 3e-6,
			`Real author/Host graph differs from independent native oracle: ${native.maximum}`,
		);
		check(
			wrong.maximum > 0.001,
			`Duration-rounding negative is not discriminative: ${wrong.maximum}`,
		);
		check(
			(
				await collectProgrammaticAudio({
					tracks,
					runtime,
					audioContext: context,
					signal,
				})
			)[0].buffer === raw,
			"Stable identity did not reuse cached PCM",
		);
		const ordinary = context.createBuffer(2, 22932, 44100);
		for (let c = 0; c < 2; c++)
			for (let i = 0; i < ordinary.length; i++)
				ordinary.getChannelData(c)[i] = durationEditorOrdinarySample(i, c);
		tracks.audio = [
			{
				id: "ordinary",
				name: "Ordinary",
				type: "audio",
				muted: false,
				elements: [
					{
						type: "audio",
						sourceType: "library",
						sourceUrl: "",
						buffer: ordinary,
						id: "ordinary-tone",
						name: "Ordinary",
						startTime: ticks(4),
						duration: ticks(13),
						trimStart: ticks(0),
						trimEnd: ticks(0),
						params: {},
					},
				],
			},
		];
		const mixed = await createTimelineAudioBuffer({
			tracks,
			mediaAssets: [],
			duration: ticks(21),
			audioContext: context,
			resources,
			programmaticAudio: runtime,
			signal,
		});
		check(
			mixed?.length === 37044,
			"Editor output duration differs from 21 frames",
		);
		const full = compare(mixed, expectedTimeline);
		check(
			full.maximum < 3e-6,
			`Editor gain/placement/trim/mix mismatch: ${full.maximum}`,
		);
		const partial = await createTimelineAudioBuffer({
			tracks,
			mediaAssets: [],
			startTime: ticks(7),
			duration: ticks(7),
			audioContext: context,
			resources,
			programmaticAudio: runtime,
			signal,
		});
		check(partial?.length === 12348, "Partial mix duration changed");
		const crop = compare(
			partial,
			new DataView(expectedTimeline.buffer, 12348 * 8, 12348 * 8),
		);
		check(
			crop.maximum < 3e-6,
			`Partial mix differs from independent canonical crop: ${crop.maximum}`,
		);
		let repeatCropMaximum = 0;
		for (let c = 0; c < 2; c++)
			for (let i = 0; i < partial.length; i++)
				repeatCropMaximum = Math.max(
					repeatCropMaximum,
					Math.abs(
						partial.getChannelData(c)[i] - mixed.getChannelData(c)[12348 + i],
					),
				);
		check(
			repeatCropMaximum < 1e-7,
			"Partial timeline render changed source phase",
		);
		check(
			requests.audio === 1 && requests.identity === 4,
			`Cache request counts changed: ${JSON.stringify(requests)}`,
		);
		const rootNode = buildScene({
			tracks,
			mediaAssets: [],
			duration: ticks(21),
			canvasSize: { width: 64, height: 64 },
			background: { type: "color", color: "#000000" },
			programmaticFrames: provider,
			assetResolver: {
				resolve: () => {
					throw Error("Unexpected external asset");
				},
			} as unknown as AssetResolver,
		});
		const bytes = await new SceneExporter({
			width: 64,
			height: 64,
			fps: { numerator: 25, denominator: 1 },
			compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
			format: "webm",
			quality: "very_high",
			shouldIncludeAudio: true,
			audioBuffer: mixed,
		}).export({
			rootNode,
			range: { startTime: ticks(0), endTime: ticks(21), duration: ticks(21) },
		});
		check(bytes, "SceneExporter produced no encoded artifact");
		return {
			bytes: [...new Uint8Array(bytes)],
			pcm: [...new Uint8Array(full.pcm.buffer)],
			rawPcm: [...new Uint8Array(native.pcm.buffer)],
			partialPcm: [...new Uint8Array(crop.pcm.buffer)],
			nativeMaximum: native.maximum,
			nativeRms: native.rms,
			mixedMaximum: full.maximum,
			mixedRms: full.rms,
			cropMaximum: crop.maximum,
			repeatCropMaximum,
			incorrectRoundedMaximum: wrong.maximum,
			requests,
			installedEditorTested: false,
		};
	} finally {
		await runtime.invalidate();
		await context.close();
		compositor.dispose();
		disposeGpu();
	}
}
void run().then(
	(result) =>
		Reflect.set(globalThis, "__hyperframesFractionalDurationEditor", result),
	(error) =>
		Reflect.set(globalThis, "__hyperframesFractionalDurationEditor", {
			error: String(error?.stack ?? error),
		}),
);
