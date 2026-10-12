import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
if (process.env.BLAZE_PNG_CONSUMER_ISOLATED !== "1") {
    test("production effect PNG consumer runs isolated", () => { const run = Bun.spawnSync({ cmd: [process.execPath, "test", fileURLToPath(import.meta.url)], env: { ...process.env, BLAZE_PNG_CONSUMER_ISOLATED: "1" }, stdout: "pipe", stderr: "pipe" }); if (run.exitCode !== 0) throw Error(run.stderr.toString()); });
} else {
    const calls: string[] = [];
    const encoded = { png: new Uint8Array([137,80,78,71,13,10,26,10]), width: 2, height: 1, requestId: 1, generation: 1, peakBytes: 2048, format: "rgba8unorm", alphaMode: "straight", colorSpace: "srgb", mimeType: "image/png", backend: "webgl" };
    mock.module("../../../effects", () => ({ effectsRegistry: { get: () => ({ id: "blaze" }) }, buildDefaultEffectInstance: () => ({ params: { amount: 1 } }), resolveEffectPasses: () => [{ shader: "blaze", uniforms: { amount: 1 } }] }));
    mock.module("../gpu-renderer", () => ({ gpuRenderer: { createBlazeOutputOwner: () => ({ exportPng: async (options: unknown) => { calls.push("native-export"); return encoded; }, drain: async () => { calls.push("drain"); }, cancel: () => { calls.push("cancel"); }, dispose: async () => { calls.push("dispose-native"); } }) } }));
    const { EffectPreviewService } = await import("../effect-preview");
    test("existing service exports native PNG directly without preview/source canvas inversion", async () => {
        const source = { dispose: () => { calls.push("dispose-source"); }, reset: () => {}, getTestSource: () => { throw Error("must use actual supplied source"); } };
        const service = new EffectPreviewService(source as never);
        const canvas = { getContext: () => { throw Error("Canvas inverse readback forbidden"); } } as unknown as OffscreenCanvas;
        expect(await service.exportEffectPng({ effectType: "blaze", params: { amount: 1 }, source: canvas, width: 2, height: 1 })).toBe(encoded);
        await service.drainEffectOutput(); service.dispose(); await Promise.resolve(); await Promise.resolve();
        expect(calls).toEqual(["native-export", "drain", "dispose-native", "dispose-source"]);
        await expect(service.exportEffectPng({ effectType: "blaze", params: {}, source: canvas, width: 2, height: 1 })).rejects.toThrow("disposed");
    });
}
