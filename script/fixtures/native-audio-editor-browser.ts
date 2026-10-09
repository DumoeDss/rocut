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
import { verifyNativeAudioPreview } from "./native-audio-preview";

const ticks = (value: number) => mediaTime({ ticks: value });
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
async function run() {
  const source: ProgrammaticSource = await (await fetch("/api/editor-source")).json();
  let requests = 0;
  const http = createHttpProgrammaticFrames({ base: "/api" });
  const provider = { ...http, renderAudio: async (args: Parameters<NonNullable<typeof http.renderAudio>>[0]) => {
    requests++; return http.renderAudio!(args);
  } };
  const runtime = new ProgrammaticAudioRuntime(provider), context = new AudioContext({ sampleRate: 44100 });
  const clip: GraphicElement = { type: "graphic", id: "programmatic", name: "Native soundtrack", definitionId: "programmatic",
    programmatic: source, startTime: ticks(4000), duration: ticks(16000), trimStart: ticks(4000), trimEnd: ticks(4000), params: {} };
  const tracks: SceneTracks = { main: { id: "main", name: "Main", type: "video", elements: [], hidden: false, muted: false },
    overlay: [{ id: "graphics", name: "Graphics", type: "graphic", hidden: false, elements: [clip] }], audio: [] };
  const signal = new AbortController().signal;
  await initializeGpu();
  const resources = { trackGpuResource: ({ handle, label }: { handle: number; label: string }) => ({
    handle, label, resourceId: `native-editor:${handle}`, release: () => disposeCompositor(handle),
  }) } as SessionResources;
  const compositor = new WasmCompositor(resources);
  try {
    const first = await collectProgrammaticAudio({ tracks, runtime, audioContext: context, signal });
    check(first.length === 1 && first[0].buffer.length === 8820, "Source duration/sample rate mismatch");
    check(first[0].trimStart === 1 / 30 && first[0].startTime === 1 / 30, "Clip timing was lost");
    check(Math.abs(first[0].volume - 0.5011872336272722) < 1e-12, "Source gain was not applied by Rust");
    clip.hidden = true; tracks.overlay[0].hidden = true;
    const hidden = await collectProgrammaticAudio({ tracks, runtime, audioContext: context, signal });
    check(hidden[0].buffer === first[0].buffer, "Visual hiding silenced or duplicated the audio buffer");
    clip.hidden = false; tracks.overlay[0].hidden = false;
    clip.programmatic = { ...source, audio: { version: 1, mode: "native", muted: true } };
    check((await collectProgrammaticAudio({ tracks, runtime, audioContext: context, signal })).length === 0, "Muted source contributed audio");
    clip.programmatic = source;
    const ordinary = context.createBuffer(2, 8820, 44100);
    for (let c = 0; c < 2; c++) for (let i = 0; i < 8820; i++) ordinary.getChannelData(c)[i] = Math.sin(i * 883 * Math.PI * 2 / 44100) * (c ? 0.02 : 0.03);
    tracks.audio = [{ id: "audio", name: "Ordinary audio", type: "audio", muted: false, elements: [{
      type: "audio", sourceType: "library", sourceUrl: "", buffer: ordinary, id: "ordinary", name: "Ordinary",
      startTime: ticks(0), duration: ticks(24000), trimStart: ticks(0), trimEnd: ticks(0), params: {},
    }] }];
    const mixed = await createTimelineAudioBuffer({ tracks, mediaAssets: [], duration: ticks(24000), audioContext: context,
      resources, programmaticAudio: runtime, signal });
    check(mixed?.length === 8820, "Editor mixer lost duration");
    const pcm = new Float32Array(8820 * 2);
    let worst = 0;
    for (let i = 0; i < 8820; i++) for (let c = 0; c < 2; c++) {
      const authored = i >= 1470 && i < 7350 ? Math.fround(Math.sin(i * 441 * Math.PI * 2 / 44100) * (c ? -0.2 : 0.4)) * 0.5 * 0.5011872336272722 : 0;
      const expected = authored + ordinary.getChannelData(c)[i];
      worst = Math.max(worst, Math.abs(mixed.getChannelData(c)[i] - expected));
      pcm[i * 2 + c] = mixed.getChannelData(c)[i];
    }
    check(worst < 1e-7, `Editor trim/gain/ordinary mix sample mismatch: ${worst}`);
    const partial = await createTimelineAudioBuffer({ tracks, mediaAssets: [], startTime: ticks(8000), duration: ticks(8000),
      audioContext: context, resources, programmaticAudio: runtime, signal });
    check(partial?.length === 2940, "Partial mix duration mismatch");
    for (let c = 0; c < 2; c++) for (let i = 0; i < 2940; i++)
      check(Math.abs(partial.getChannelData(c)[i] - mixed.getChannelData(c)[2940 + i]) < 1e-7, "Partial mix source clock drift");
    check(requests === 1, "Clip controls or partial export rerendered cached source audio");
    const preview = await verifyNativeAudioPreview({ tracks, source, cached: runtime });
    for (const frame of [1, 4]) {
      const image = await createImageBitmap(await provider.renderPng({ request: { source, clipStart: 0, clipDuration: 24000,
        trimStart: 0, timelineTime: frame * 4000 }, signal }));
      try {
        const canvas = new OffscreenCanvas(64, 64), ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
        const rgba = [...ctx.getImageData(32, 32, 1, 1).data];
        check(JSON.stringify(rgba) === JSON.stringify([frame * 40, 255 - frame * 20, 0, 255]), `Native picture frame ${frame}: ${rgba}`);
      } finally { image.close(); }
    }
    const rootNode = buildScene({ tracks, mediaAssets: [], duration: ticks(24000), canvasSize: { width: 64, height: 64 },
      background: { type: "color", color: "#000000" }, programmaticFrames: provider,
      assetResolver: { resolve: () => { throw Error("Unexpected external asset"); } } as unknown as AssetResolver });
    const bytes = await new SceneExporter({ width: 64, height: 64, fps: { numerator: 30, denominator: 1 }, compositor,
      videoCache: { getFrameAt: async () => null } as unknown as VideoCache, format: "webm", quality: "very_high",
      shouldIncludeAudio: true, audioBuffer: mixed }).export({ rootNode,
        range: { startTime: ticks(0), endTime: ticks(24000), duration: ticks(24000) } });
    check(bytes, "No editor export");
    return { bytes: [...new Uint8Array(bytes)], pcm: [...new Uint8Array(pcm.buffer)], frames: 6, worst,
      nativeAudioRequests: requests, preview, editorMixerTested: true, installedEditorTested: false };
  } finally { await runtime.invalidate(); await context.close(); compositor.dispose(); disposeGpu(); }
}
void run().then(result => Reflect.set(globalThis, "__nativeAudioExport", result),
  error => Reflect.set(globalThis, "__nativeAudioExport", { error: String(error?.stack ?? error) }));
