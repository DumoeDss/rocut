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
import {
	expectedTimelineSample,
	graphNativeSample,
	ordinarySample,
} from "./hyperframes-graph-editor-oracle.mjs";

const ticks = (frames: number) => mediaTime({ ticks: frames * 4800 });
function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw Error(message);
}
async function run() {
	const source: ProgrammaticSource = await (await fetch("/api/source")).json();
	check(
		source.audio?.profile === "hyperframes-graph-v1",
		"Source lost explicit graph profile",
	);
	const requests = { audio: 0, identity: 0 };
	const http = createHttpProgrammaticFrames({ base: "/api" });
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
		id: "graph",
		name: "HyperFrames graph",
		definitionId: "programmatic",
		programmatic: source,
		startTime: ticks(1),
		duration: ticks(6),
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
	const signal = new AbortController().signal;
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
			resourceId: `hf-graph-editor:${handle}`,
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
			collected.length === 1 && collected[0].buffer.length === 14112,
			"Graph soundtrack sample clock changed",
		);
		check(
			collected[0].startTime === 0.04 &&
				collected[0].trimStart === 0.04 &&
				collected[0].duration === 0.24,
			"Collector lost clip placement/trim/duration",
		);
		check(
			Math.abs(collected[0].volume - 0.5011872336272722) < 1e-12,
			"Source gain is not authoritative -6dB",
		);
		const raw = collected[0].buffer,
			rawPcm = new Float32Array(raw.length * 2);
		let nativeMaxError = 0;
		const wrongOrderMax = {
			"track-gain-first": 0,
			"bus-before-sum": 0,
			"bus-gain-first": 0,
		};
		for (let i = 0; i < raw.length; i++)
			for (let channel = 0; channel < 2; channel++) {
				const expected = graphNativeSample(i, channel),
					actual = raw.getChannelData(channel)[i];
				rawPcm[i * 2 + channel] = actual;
				nativeMaxError = Math.max(nativeMaxError, Math.abs(actual - expected));
				for (const order of Object.keys(wrongOrderMax) as Array<
					keyof typeof wrongOrderMax
				>)
					wrongOrderMax[order] = Math.max(
						wrongOrderMax[order],
						Math.abs(graphNativeSample(i, channel, order) - expected),
					);
			}
		check(
			nativeMaxError < 3e-6,
			`Graph track/FX/bus order differs from scalar oracle: ${nativeMaxError}`,
		);
		check(
			Object.values(wrongOrderMax).every((value) => value > 0.001),
			`Wrong-order controls are not discriminative: ${JSON.stringify(wrongOrderMax)}`,
		);
		tracks.overlay[0].hidden = true;
		check(
			(
				await collectProgrammaticAudio({
					tracks,
					runtime,
					audioContext: context,
					signal,
				})
			)[0].buffer === raw,
			"Hidden graphic lost/circumvented audio cache",
		);
		tracks.overlay[0].hidden = false;
		clip.programmatic = { ...source, audio: { ...source.audio!, muted: true } };
		check(
			(
				await collectProgrammaticAudio({
					tracks,
					runtime,
					audioContext: context,
					signal,
				})
			).length === 0,
			"Graph source mute was ignored",
		);
		clip.programmatic = {
			...source,
			audio: { ...source.audio!, volumeDb: -12 },
		};
		const quieter = await collectProgrammaticAudio({
			tracks,
			runtime,
			audioContext: context,
			signal,
		});
		check(
			quieter[0].buffer === raw &&
				Math.abs(quieter[0].volume - 0.251188643150958) < 1e-12,
			"Source gain was baked into cached PCM",
		);
		clip.programmatic = source;
		const ordinary = context.createBuffer(2, 8820, 44100);
		for (let c = 0; c < 2; c++)
			for (let i = 0; i < ordinary.length; i++)
				ordinary.getChannelData(c)[i] = ordinarySample(i, c);
		tracks.audio = [
			{
				id: "ordinary",
				name: "Ordinary audio",
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
						startTime: ticks(2),
						duration: ticks(5),
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
			duration: ticks(9),
			audioContext: context,
			resources,
			programmaticAudio: runtime,
			signal,
		});
		check(
			mixed?.length === 15876,
			"Editor final graph mix differs from nine frames",
		);
		const pcm = new Float32Array(mixed.length * 2);
		let mixedMaxError = 0;
		for (let i = 0; i < mixed.length; i++)
			for (let c = 0; c < 2; c++) {
				const actual = mixed.getChannelData(c)[i];
				pcm[i * 2 + c] = actual;
				mixedMaxError = Math.max(
					mixedMaxError,
					Math.abs(actual - expectedTimelineSample(i, c)),
				);
			}
		check(
			mixedMaxError < 3e-6,
			`Editor placement/trim/gain/ordinary mix drift: ${mixedMaxError}`,
		);
		const partial = await createTimelineAudioBuffer({
			tracks,
			mediaAssets: [],
			startTime: ticks(3),
			duration: ticks(4),
			audioContext: context,
			resources,
			programmaticAudio: runtime,
			signal,
		});
		check(partial?.length === 7056, "Partial graph mix duration changed");
		let partialMaxError = 0;
		for (let c = 0; c < 2; c++)
			for (let i = 0; i < partial.length; i++)
				partialMaxError = Math.max(
					partialMaxError,
					Math.abs(
						partial.getChannelData(c)[i] - mixed.getChannelData(c)[5292 + i],
					),
				);
		check(
			partialMaxError < 1e-7,
			`Partial graph mix clock drift: ${partialMaxError}`,
		);
		check(
			requests.audio === 1 && requests.identity === 5,
			`Graph cache/identity request counts changed: ${JSON.stringify(requests)}`,
		);
		const rootNode = buildScene({
			tracks,
			mediaAssets: [],
			duration: ticks(9),
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
			range: { startTime: ticks(0), endTime: ticks(9), duration: ticks(9) },
		});
		check(bytes, "SceneExporter produced no graph artifact");
		return {
			bytes: [...new Uint8Array(bytes)],
			pcm: [...new Uint8Array(pcm.buffer)],
			rawPcm: [...new Uint8Array(rawPcm.buffer)],
			nativeMaxError,
			mixedMaxError,
			partialMaxError,
			wrongOrderMax,
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
	(result) => Reflect.set(globalThis, "__hyperframesGraphEditor", result),
	(error) =>
		Reflect.set(globalThis, "__hyperframesGraphEditor", {
			error: String(error?.stack ?? error),
		}),
);
