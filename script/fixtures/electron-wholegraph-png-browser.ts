import * as wasm from "opencut-wasm";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { ColorNode } from "../../packages/editor-classic/src/services/renderer/nodes/color-node";
import { ImageNode } from "../../packages/editor-classic/src/services/renderer/nodes/image-node";

/** Test-only selected Electron consumer; no display canvas PNG readback. */
export async function runElectronWholegraph() {
  const report: any = { controls: {}, cleanup: {} };
  const save = async (name: string, bytes: Uint8Array) => {
    const response = await fetch(`/artifact?name=${name}`, { method: "POST", body: bytes });
    if (!response.ok) throw Error("Artifact retention failed");
  };
  let direct: number | undefined, compositor: WasmCompositor | undefined;
  let initialized = false, releases = 0;
  const sources: OffscreenCanvas[] = [];
  try {
    await wasm.initializeGpu(); initialized = true;
    const query = new wasm.WasmRuntimeGraphicsQuery();
    report.backend = query.selectedBackend(); query.free();
    if (report.backend !== "webgl") throw Error("Selected WebGL path required");
    direct = wasm.createCompositor(32, 24);
    for (const [id, color] of [["blue", "#0000ff"], ["red", "#ff0000"]]) {
      const source = new OffscreenCanvas(1, 1), ctx = source.getContext("2d")!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); sources.push(source);
      wasm.uploadTextureForHandle(direct, { id, source, width: 1, height: 1 });
    }
    const layer = (textureId: string, opacity: number, centerX: number, width: number) => ({
      type: "layer", textureId, opacity,
      transform: { centerX, centerY: 12, width, height: 24, rotationDegrees: 0, flipX: false, flipY: false },
      blendMode: "normal", effectPassGroups: [], mask: null,
    });
    const graph = { width: 32, height: 24, clear: { color: [0, 0, 0, 0] }, items: [
      layer("blue", .25, 16, 32),
      { type: "group", items: [layer("red", 1, 24, 16)], effectPassGroups: [], opacity: .5, blendMode: "normal" },
    ] };
    const prepare = async () => {
      const request = wasm.beginRenderFrameForHandle(direct!, graph);
      while (!(await wasm.advanceRenderFrameForHandle(direct!, request, 64))) { /* native bounded advancement */ }
      return request;
    };
    const request = await prepare();
    const output = await wasm.commitRenderFramePngForHandle(direct, request);
    await save("transparent-graph", output.png);
    const cancelled = await prepare();
    const pending = wasm.commitRenderFramePngForHandle(direct, cancelled);
    const rejected = pending.then(() => false, (e: any) => e.name === "AbortError" || e.code === "RENDER_CANCELLED");
    wasm.cancelRenderFrameForHandle(direct, cancelled);
    report.controls.nativeCancelDrained = await rejected;
    const recovered = await prepare();
    await save("recovered-graph", (await wasm.commitRenderFramePngForHandle(direct, recovered)).png);
    wasm.disposeCompositor(direct); direct = undefined;

    const resources: any = {
      trackGpuResource: ({ handle, label }: any) => ({ handle, label, release() { wasm.disposeCompositor(handle); releases++; } }),
    };
    compositor = new WasmCompositor(resources);
    const root = new RootNode({ duration: 120000 });
    root.add(new ColorNode({ color: "rgba(0,0,255,0.25)" }));
    root.add(new ImageNode({
      url: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24"><path fill="red" d="M0 0h16v24H0z"/></svg>'),
      duration: 120000, timeOffset: 0, trimStart: 0, trimEnd: 0, opacity: .5,
      transform: { position: { x: 8, y: 0 }, scaleX: 1, scaleY: 1, rotate: 0 },
    }));
    const renderer = new CanvasRenderer({ width: 32, height: 24, fps: { numerator: 30, denominator: 1 }, compositor, videoCache: {} as any });
    const legacy = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function () { throw Error("Display canvas PNG fallback forbidden"); };
    try {
      const blob = await renderer.renderSnapshotPng({ node: root, time: 0 });
      await save("snapshot", new Uint8Array(await blob.arrayBuffer()));
      report.controls.actualCanvasRendererWholegraph = blob.type === "image/png";
      report.controls.noDisplayCanvasFallback = true;
    } finally { HTMLCanvasElement.prototype.toBlob = legacy; }
    await compositor.close(); compositor = undefined;
    report.controls.handleReleasedOnce = releases === 1;
    renderer.canvas.width = renderer.canvas.height = 0;
    return report;
  } finally {
    if (compositor) await compositor.close();
    if (direct !== undefined) wasm.disposeCompositor(direct);
    for (const source of sources) source.width = source.height = 0;
    if (initialized) { wasm.disposeGpu(); report.cleanup.gpuDisposed = true; }
  }
}
