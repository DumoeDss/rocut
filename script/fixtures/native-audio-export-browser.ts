import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { ColorNode } from "../../packages/editor-classic/src/services/renderer/nodes/color-node";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

async function run() {
  const response = await fetch("/api/pcm");
  if (!response.ok) throw Error(await response.text());
  const pcm = new DataView(await response.arrayBuffer());
  if (pcm.byteLength !== 8000 * 8) throw Error("Wrong native source soundtrack length");
  const audio = new AudioBuffer({ numberOfChannels: 2, sampleRate: 48000, length: 8000 });
  for (let channel = 0; channel < 2; channel++) {
    const output = audio.getChannelData(channel);
    for (let i = 0; i < output.length; i++) output[i] = pcm.getFloat32(i * 8 + channel * 4, true);
  }
  await initializeGpu();
  const compositor = new WasmCompositor({ trackGpuResource: ({ handle, label }) => ({
    handle, label, resourceId: `native-audio:${handle}`, release: () => disposeCompositor(handle),
  }) } as SessionResources);
  try {
    const rootNode = new RootNode({ duration: 240000 });
    rootNode.add(new ColorNode({ color: "#00ff00" }));
    const bytes = await new SceneExporter({ width: 64, height: 64, fps: { numerator: 30, denominator: 1 },
      compositor, videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
      format: "webm", quality: "high", shouldIncludeAudio: true, audioBuffer: audio,
    }).export({ rootNode, range: { startTime: mediaTime({ ticks: 4000 }), endTime: mediaTime({ ticks: 24000 }), duration: mediaTime({ ticks: 20000 }) } });
    if (!bytes) throw Error("Rocut returned no video");
    return { bytes: [...new Uint8Array(bytes)], frames: 5, sourceFirstFrame: 1, installedEditorTested: false };
  } finally { compositor.dispose(); disposeGpu(); }
}
void run().then(result => Reflect.set(globalThis, "__nativeAudioExport", result),
  error => Reflect.set(globalThis, "__nativeAudioExport", { error: String(error?.stack ?? error) }));
