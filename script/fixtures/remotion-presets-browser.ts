import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource, ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

async function run() {
  const presets: { id: string; source: ProgrammaticSource; firstFrame: number }[] = await (await fetch("/api/presets")).json();
  const videos = [];
  await initializeGpu();
  try {
    for (const { id, source, firstFrame } of presets) {
      const compositor = new WasmCompositor({ trackGpuResource: ({ handle, label }) => ({
        handle, label, resourceId: `preset:${handle}`, release: () => disposeCompositor(handle),
      }) } as SessionResources);
      try {
        const requested: number[] = [];
        const provider: ProgrammaticFrameProvider = { renderPng: async ({ request, signal }) => {
          const frame = resolveProgrammaticFrame(request as ProgrammaticFrameRequest); if (!frame) throw Error("Missing source frame");
          requested.push(frame.index);
          const response = await fetch(`/api/frames/${id}/${frame.index}.png`, { signal });
          if (!response.ok) throw Error(`Native PNG unavailable ${id}/${frame.index}`);
          return response.blob();
        } };
        const ticks = (value: number) => mediaTime({ ticks: value });
        const tracks: SceneTracks = { main: { id: "main", name: "Main", type: "video", elements: [], hidden: false, muted: false }, audio: [],
          overlay: [{ id: "graphics", name: "Graphics", type: "graphic", hidden: false, elements: [{ type: "graphic", id,
            name: id, definitionId: "programmatic", programmatic: source, startTime: ticks(0), duration: ticks(12000),
            trimStart: ticks(firstFrame * 4000), trimEnd: ticks((source.durationFrames - firstFrame - 3) * 4000), params: {} }] }] };
        const rootNode = buildScene({ tracks, mediaAssets: [], duration: ticks(12000), canvasSize: { width: source.width, height: source.height },
          background: { type: "color", color: "#000000" }, programmaticFrames: provider,
          assetResolver: { resolve: () => { throw Error("Unexpected external asset"); } } as unknown as AssetResolver });
        const bytes = await new SceneExporter({ width: source.width, height: source.height, fps: source.frameRate, compositor,
          videoCache: { getFrameAt: async () => null } as unknown as VideoCache, format: "webm", quality: "very_high",
          shouldIncludeAudio: false }).export({ rootNode, range: { startTime: ticks(0), endTime: ticks(12000), duration: ticks(12000) } });
        if (!bytes) throw Error(`No ${id} export`);
        if (JSON.stringify(requested) !== JSON.stringify([firstFrame, firstFrame + 1, firstFrame + 2])) throw Error(`Wrong source mapping ${id}: ${requested}`);
        videos.push({ id, bytes: [...new Uint8Array(bytes)], requested });
      } finally { compositor.dispose(); }
    }
    return { videos };
  } finally { disposeGpu(); }
}
void run().then(result => Reflect.set(globalThis, "__remotionPresets", result),
  error => Reflect.set(globalThis, "__remotionPresets", { error: String(error?.stack ?? error) }));
