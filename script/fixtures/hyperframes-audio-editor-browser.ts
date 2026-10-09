import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import type { GraphicElement, SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { ProgrammaticAudioRuntime } from "../../packages/editor-classic/src/media/programmatic-audio-runtime";
import { collectProgrammaticAudio } from "../../packages/editor-classic/src/media/programmatic-audio";
import { createTimelineAudioBuffer } from "../../packages/editor-classic/src/media/audio";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

const ticks = (frames: number) => mediaTime({ ticks: frames * 4800 });
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
async function run() {
	const [loop, video]: ProgrammaticSource[] = await (await fetch("/api/sources")).json();
	const oracle = await Promise.all(["loop", "video"].map(async name => new DataView(await (await fetch(`/api/oracle/${name}`)).arrayBuffer())));
	let requests = 0;
	const http = createHttpProgrammaticFrames({ base: "/api" });
	const provider = { ...http, renderAudio: async (args: Parameters<NonNullable<typeof http.renderAudio>>[0]) => {
		requests++; return http.renderAudio!(args);
	} };
	const runtime = new ProgrammaticAudioRuntime(provider), context = new AudioContext({ sampleRate: 44100 });
	const graphic = (id: string, source: ProgrammaticSource, start: number, duration: number, trim: number): GraphicElement => ({
		type: "graphic", id, name: id, definitionId: "programmatic", programmatic: source,
		startTime: ticks(start), duration: ticks(duration), trimStart: ticks(trim), trimEnd: ticks(source.durationFrames - trim - duration), params: {},
	});
	const loopClip = graphic("loop-clip", loop, 1, 4, 1), videoClip = graphic("video-clip", video, 5, 3, 1);
	const tracks: SceneTracks = { main: { id: "main", name: "Main", type: "video", elements: [], hidden: false, muted: false },
		overlay: [{ id: "graphics", name: "HyperFrames", type: "graphic", hidden: false, elements: [loopClip, videoClip] }], audio: [] };
	const signal = new AbortController().signal;
	await initializeGpu();
	const resources = { trackGpuResource: ({ handle, label }: { handle: number; label: string }) => ({
		handle, label, resourceId: `hf-editor:${handle}`, release: () => disposeCompositor(handle),
	}) } as SessionResources;
	const compositor = new WasmCompositor(resources);
	try {
		const collected = await collectProgrammaticAudio({ tracks, runtime, audioContext: context, signal });
		check(collected.length === 2, "Both native source soundtracks must reach the collector");
		check(collected[0].buffer.length === 10584 && collected[1].buffer.length === 7056, "Native source sample durations changed");
		check(collected[0].startTime === 0.04 && collected[0].trimStart === 0.04 && collected[1].startTime === 0.2, "Placement/trim was discarded");
		check(Math.abs(collected[0].volume - 0.5011872336272722) < 1e-12 && Math.abs(collected[1].volume - 0.251188643150958) < 1e-12,
			"Rust source gain differs from declared -6/-12 dB");
		tracks.overlay[0].hidden = true;
		check((await collectProgrammaticAudio({ tracks, runtime, audioContext: context, signal }))[0].buffer === collected[0].buffer,
			"Visual hidden duplicated or silenced source audio");
		tracks.overlay[0].hidden = false;
		loopClip.programmatic = { ...loop, audio: { version: 1, mode: "native", muted: true } };
		check((await collectProgrammaticAudio({ tracks, runtime, audioContext: context, signal })).length === 1, "Source mute was ignored");
		loopClip.programmatic = loop;
		const ordinary = context.createBuffer(2, 8820, 44100);
		for (let c = 0; c < 2; c++) for (let i = 0; i < ordinary.length; i++)
			ordinary.getChannelData(c)[i] = Math.sin(i * 997 * Math.PI * 2 / 44100) * (c ? 0.015 : 0.03);
		tracks.audio = [{ id: "ordinary", name: "Ordinary audio", type: "audio", muted: false, elements: [{
			type: "audio", sourceType: "library", sourceUrl: "", buffer: ordinary, id: "ordinary-tone", name: "Ordinary",
			startTime: ticks(2), duration: ticks(5), trimStart: ticks(0), trimEnd: ticks(0), params: {},
		}] }];
		const mixed = await createTimelineAudioBuffer({ tracks, mediaAssets: [], duration: ticks(9), audioContext: context,
			resources, programmaticAudio: runtime, signal });
		check(mixed?.length === 15876, "Editor final mix duration differs from nine frames");
		const pcm = new Float32Array(mixed.length * 2);
		let exactWorst = 0, videoError = 0, videoCount = 0;
		for (let i = 0; i < mixed.length; i++) for (let c = 0; c < 2; c++) {
			let expected = 0;
			if (i >= 1764 && i < 8820) expected += oracle[0].getFloat32(((1764 + i % 3528) * 2 + c) * 4, true) * 0.5 * 0.5011872336272722;
			if (i >= 8820 && i < 14112) expected += oracle[1].getFloat32(((i - 7056) * 2 + c) * 4, true) * 0.5 * 0.251188643150958;
			if (i >= 3528 && i < 12348) expected += ordinary.getChannelData(c)[i - 3528];
			const actual = mixed.getChannelData(c)[i]; pcm[i * 2 + c] = actual;
			if (i >= 8820 && i < 14112) { videoError += (actual - expected) ** 2; videoCount++; }
			else exactWorst = Math.max(exactWorst, Math.abs(actual - expected));
		}
		check(exactWorst < 1e-7, `Native loop/placement/trim/gain/ordinary mix mismatch ${exactWorst}`);
		const videoRmsError = Math.sqrt(videoError / videoCount);
		check(videoRmsError < 0.003, `Native video audio differs from source WAV ${videoRmsError}`);
		const partial = await createTimelineAudioBuffer({ tracks, mediaAssets: [], startTime: ticks(3), duration: ticks(4),
			audioContext: context, resources, programmaticAudio: runtime, signal });
		check(partial?.length === 7056, "Partial mix duration changed");
		for (let c = 0; c < 2; c++) for (let i = 0; i < partial.length; i++)
			check(Math.abs(partial.getChannelData(c)[i] - mixed.getChannelData(c)[5292 + i]) < 1e-7,
				`Partial editor mix source clock drift ${JSON.stringify({ channel: c, sample: i, actual: partial.getChannelData(c)[i], expected: mixed.getChannelData(c)[5292 + i] })}`);
		check(requests === 2, "Control changes or partial mix rerendered a cached native soundtrack");
		const rootNode = buildScene({ tracks, mediaAssets: [], duration: ticks(9), canvasSize: { width: 64, height: 64 },
			background: { type: "color", color: "#000000" }, programmaticFrames: provider,
			assetResolver: { resolve: () => { throw Error("Unexpected external asset"); } } as unknown as AssetResolver });
		const bytes = await new SceneExporter({ width: 64, height: 64, fps: { numerator: 25, denominator: 1 }, compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache, format: "webm", quality: "very_high",
			shouldIncludeAudio: true, audioBuffer: mixed }).export({ rootNode,
			range: { startTime: ticks(0), endTime: ticks(9), duration: ticks(9) } });
		check(bytes, "SceneExporter produced no HF editor artifact");
		return { bytes: [...new Uint8Array(bytes)], pcm: [...new Uint8Array(pcm.buffer)], frames: 9,
			exactWorst, videoRmsError, nativeAudioRequests: requests, installedEditorTested: false };
	} finally { await runtime.invalidate(); await context.close(); compositor.dispose(); disposeGpu(); }
}
void run().then(result => Reflect.set(globalThis, "__hyperframesAudioEditorExport", result),
	error => Reflect.set(globalThis, "__hyperframesAudioEditorExport", { error: String(error?.stack ?? error) }));
