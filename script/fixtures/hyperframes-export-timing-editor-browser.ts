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
import {
	exportTimingEditorSpec as spec,
	type ExportTimingEditorCase,
} from "./hyperframes-export-timing-editor-spec.mjs";

const ticks = (frames: number) => mediaTime({ ticks: frames * 4800 });
/** FFmpeg sample-delay negative controls may contain one additional tail frame. */
function comparePlacementNegative(buffer: AudioBuffer, expected: DataView) {
	check(expected.byteLength % 8 === 0, "Negative PCM stereo geometry changed");
	const expectedFrames = expected.byteLength / 8;
	let maximum = 0;
	for (let i = 0; i < Math.max(buffer.length, expectedFrames); i++)
		for (let c = 0; c < 2; c++) {
			const actual = i < buffer.length ? buffer.getChannelData(c)[i] : 0;
			const negative =
				i < expectedFrames ? expected.getFloat32(i * 8 + c * 4, true) : 0;
			maximum = Math.max(maximum, Math.abs(actual - negative));
		}
	return { maximum, actualFrames: buffer.length, expectedFrames };
}
async function run() {
	const source: ProgrammaticSource = await (await fetch("/api/source")).json();
	const test: ExportTimingEditorCase = await (await fetch("/api/case")).json();
	check(source.audio?.profile === "hyperframes-graph-v1", "Graph profile lost");
	check(
		source.audio?.timing === test.timing,
		"Explicit timing declaration lost",
	);
	const [expectedSource, wrongSource, untrimmedSource, expectedTimeline] =
		await Promise.all(
			["source", "placement", "untrimmed", "timeline"].map(
				async (name) =>
					new DataView(
						await (await fetch(`/api/oracle/${name}`)).arrayBuffer(),
					),
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
		context = new AudioContext({ sampleRate: spec.sampleRate });
	const clip: GraphicElement = {
		type: "graphic",
		id: "export-timing",
		name: test.id,
		definitionId: "programmatic",
		programmatic: source,
		startTime: ticks(spec.clipStartFrame),
		duration: ticks(spec.clipDurationFrames),
		trimStart: ticks(spec.clipTrimFrame),
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
			resourceId: `hf-export-timing-editor:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources;
	const compositor = new WasmCompositor(resources);
	try {
		const input = { tracks, runtime, audioContext: context, signal };
		const collected = await collectProgrammaticAudio(input);
		check(
			collected.length === 1 && collected[0].buffer.length === 47628,
			"Canonical source length changed",
		);
		check(
			collected[0].startTime === 0.08 &&
				collected[0].trimStart === 0.04 &&
				collected[0].duration === 1,
			"Clip geometry changed",
		);
		check(
			Math.abs(collected[0].volume - 10 ** (-6 / 20)) < 1e-12,
			"Source gain changed",
		);
		const raw = collected[0].buffer,
			native = compare(raw, expectedSource);
		const wrong = comparePlacementNegative(raw, wrongSource),
			untrimmed = compare(raw, untrimmedSource);
		check(
			native.maximum < 3e-6,
			`Host graph vs independent oracle: ${native.maximum}`,
		);
		check(
			wrong.maximum > 0.001,
			`Placement negative is not discriminative: ${wrong.maximum}`,
		);
		if (test.timing)
			check(
				untrimmed.maximum > 1e-5,
				`Final trim negative is not discriminative: ${untrimmed.maximum}`,
			);
		check(
			(await collectProgrammaticAudio(input))[0].buffer === raw,
			"Stable source did not reuse cached PCM",
		);
		const ordinary = context.createBuffer(2, 22932, spec.sampleRate);
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
		const mixing = {
			tracks,
			mediaAssets: [],
			audioContext: context,
			resources,
			programmaticAudio: runtime,
			signal,
		};
		const mixed = await createTimelineAudioBuffer({
			...mixing,
			duration: ticks(spec.exportFrames),
		});
		check(mixed?.length === 52920, "Timeline length changed");
		const full = compare(mixed, expectedTimeline);
		check(
			full.maximum < 3e-6,
			`Editor gain/placement/trim/mix mismatch: ${full.maximum}`,
		);
		const partial = await createTimelineAudioBuffer({
			...mixing,
			startTime: ticks(spec.cropStartFrame),
			duration: ticks(spec.cropFrames),
		});
		check(partial?.length === 8820, "Terminal crop length changed");
		const crop = compare(
			partial,
			new DataView(expectedTimeline.buffer, 38808 * 8, 8820 * 8),
		);
		check(crop.maximum < 3e-6, `Terminal crop mismatch: ${crop.maximum}`);
		let repeatCropMaximum = 0;
		for (let c = 0; c < 2; c++)
			for (let i = 0; i < partial.length; i++)
				repeatCropMaximum = Math.max(
					repeatCropMaximum,
					Math.abs(
						partial.getChannelData(c)[i] - mixed.getChannelData(c)[38808 + i],
					),
				);
		check(
			repeatCropMaximum < 1e-7,
			"Crop changed source phase or terminal boundary",
		);
		check(
			requests.audio === 1 && requests.identity === 4,
			`Cache counts changed: ${JSON.stringify(requests)}`,
		);
		let bytes: ArrayBuffer | null = null;
		if (test.encode) {
			const rootNode = buildScene({
				tracks,
				mediaAssets: [],
				duration: ticks(spec.exportFrames),
				canvasSize: { width: 64, height: 64 },
				background: { type: "color", color: "#000000" },
				programmaticFrames: provider,
				assetResolver: {
					resolve: () => {
						throw Error("Unexpected external asset");
					},
				} as unknown as AssetResolver,
			});
			bytes = await new SceneExporter({
				width: 64,
				height: 64,
				fps: { numerator: spec.fps, denominator: 1 },
				compositor,
				videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
				format: "webm",
				quality: "very_high",
				shouldIncludeAudio: true,
				audioBuffer: mixed,
			}).export({
				rootNode,
				range: {
					startTime: ticks(0),
					endTime: ticks(spec.exportFrames),
					duration: ticks(spec.exportFrames),
				},
			});
			check(bytes, "SceneExporter produced no artifact");
		}
		return {
			test,
			bytes: bytes ? [...new Uint8Array(bytes)] : [],
			pcm: [...new Uint8Array(full.pcm.buffer)],
			rawPcm: [...new Uint8Array(native.pcm.buffer)],
			partialPcm: [...new Uint8Array(crop.pcm.buffer)],
			nativeMaximum: native.maximum,
			nativeRms: native.rms,
			mixedMaximum: full.maximum,
			mixedRms: full.rms,
			cropMaximum: crop.maximum,
			repeatCropMaximum,
			incorrectPlacementMaximum: wrong.maximum,
			incorrectPlacementActualFrames: wrong.actualFrames,
			incorrectPlacementExpectedFrames: wrong.expectedFrames,
			incorrectPlacementFrameDifference:
				wrong.expectedFrames - wrong.actualFrames,
			incorrectUntrimmedMaximum: untrimmed.maximum,
			terminalTrimNegativeChecked: !!test.timing,
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
		Reflect.set(globalThis, "__hyperframesExportTimingEditor", result),
	(error) =>
		Reflect.set(globalThis, "__hyperframesExportTimingEditor", {
			error: String(error?.stack ?? error),
		}),
);
