import { expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import * as wasm from "opencut-wasm";
import { collectElectronRemotionProducedFrames } from "../programmatic/electron-remotion-produced";
import type { NativeAudioAnalysisConfig } from "../programmatic/remotion-audio-bootstrap";
import type { ElectronProducedCaptureCallback } from "../programmatic/electron-audio-session";

function scan() {
  const archive = (id: string) => ({ id, kind: "source", mimeType: "application/octet-stream", byteLength: 1,
    sha256: "a".repeat(64), attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}` });
  const document = { id: "build.html", kind: "document", mimeType: "text/html", byteLength: 13,
    sha256: "b".repeat(64), attachmentKey: `programmatic-sha256-${"b".repeat(64)}` };
  const source = { version: 1, runtime: "html-document", code: "", documentId: document.id, resources: [document], width: 64, height: 64,
    frameRate: { numerator: 30, denominator: 1 }, durationFrames: 3, seed: 1, build: { version: 1, engine: "remotion",
      engineVersion: "4.0.440", compositionId: "Produced", entryFile: "index.tsx", inputs: [archive("index.tsx")],
      toolchainLock: archive("_rocut/toolchain-lock.json") } };
  const binding = (wasm as unknown as Record<string, (input: string) => string>).resolveRemotionProducedFramesJson;
  if (!binding) throw Error("Produced tests require rebuilt WASM");
  const result = JSON.parse(binding(JSON.stringify({ version: 1, source })));
  if (result.error) throw Error(result.error);
  return result.plan as NonNullable<NativeAudioAnalysisConfig["remotionProduced"]>;
}
const browser = { product: "fixture", revision: "1", jsVersion: "1", protocolVersion: "1" };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]);
function post(callback: ElectronProducedCaptureCallback) {
  return new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(callback.endpoint, { method: "POST", headers: {
      authorization: `Bearer ${callback.token}`, "content-type": "image/png", "content-length": String(png.length),
      "x-rocut-request-id": "1", "x-rocut-frame-index": "1",
    } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.end(png);
  });
}
const options = () => ({ connectionFile: "host-owned", width: 64, height: 64, durationFrames: 3,
  code: "<html></html>", resources: [], sources: [], limits: { maxSeconds: 10, maxAssetsPerFrame: 8,
    maxSourceBytes: 32, maxTotalBytes: 64, maxObservationBytes: 4096 }, scan: scan(), signal: new AbortController().signal,
  normalize(frameIndex: number, assets: unknown) {
    const result = JSON.parse(wasm.resolveRemotionAudioFrameJson(JSON.stringify({ version: 1, frameIndex,
      framesPerSecond: 30, sources: [], assets })));
    if (result.error) throw Error(result.error);
    return result.assets;
  },
});

test("Electron produced collection evaluates one Rust-mapped from-zero canonical scan and captures while paused", async () => {
  const input = options();
  let evaluations = 0, closed = 0, callback: ElectronProducedCaptureCallback | undefined;
  const result = await collectElectronRemotionProducedFrames({ ...input, openSession: async sessionOptions => {
    expect(sessionOptions.profile).toBe("source");
    callback = sessionOptions.producedCapture!;
    return { browser, epoch: "a".repeat(32), async evaluate(expression, evaluationOptions) {
      evaluations++;
      expect(expression).toContain(input.scan.profile);
      expect(expression).toContain("canonicalStartFrame");
      expect(evaluationOptions?.timeoutMs).toBe(54000);
      expect(await post(callback!)).toBe(200);
      return { version: 1, profile: input.scan.profile,
        frames: input.scan.frames.map((_, frameIndex) => ({ frameIndex, assets: [], produced: [] })) };
    }, async close() { closed++; } };
  } });
  expect(evaluations).toBe(1); expect(closed).toBe(1);
  expect(result.frames.map(item => item.frameIndex)).toEqual([0, 1, 2]);
  expect(result.pictures.get(1)).toEqual(png);
  await expect(post(callback!)).rejects.toThrow();
});

test("changed canonical clock and ignored authenticated capture errors fail and close the session", async () => {
  for (const invalidCapture of [false, true]) {
    let closed = 0;
    await expect(collectElectronRemotionProducedFrames({ ...options(), openSession: async input => ({
      browser, epoch: "a".repeat(32), async evaluate() {
        if (invalidCapture) { await post(input.producedCapture!); await post(input.producedCapture!); }
        return { version: 1, profile: options().scan.profile,
          frames: [0, 1, 2].map(frameIndex => ({ frameIndex: invalidCapture ? frameIndex : 2 - frameIndex, assets: [], produced: [] })) };
      }, async close() { closed++; },
    }) })).rejects.toThrow(invalidCapture ? "rejected" : "clock changed");
    expect(closed).toBe(1);
  }
});
