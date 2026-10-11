import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticResourceStore } from "../programmatic/resources";
import { renderRemotionAudioRange } from "../programmatic/remotion-audio-render";
import { ELECTRON_NATIVE_AUDIO_PROTOCOL } from "../programmatic/electron-audio-transport";
import { ELECTRON_AUDIO_SESSION_PROTOCOL } from "../programmatic/electron-audio-session";

test("Electron canonical produced scan retains pre-crop thumbnail artifacts and exact PCM origin through actual Rust", async () => {
  const parent = "C:/tmps", root = await mkdtemp(join(parent, "rocut-electron-produced-range-"));
  const code = Buffer.from("<html></html>"), hash = createHash("sha256").update(code).digest("hex");
  const archive = (id: string) => ({ id, kind: "source", mimeType: "application/octet-stream", byteLength: 1,
    sha256: "a".repeat(64), attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}` });
  const document = { id: "build.html", kind: "document", mimeType: "text/html", byteLength: code.length,
    sha256: hash, attachmentKey: `programmatic-sha256-${hash}` };
  const source = { version: 1, runtime: "html-document", code: "", documentId: document.id, resources: [document],
    width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 3, seed: 1,
    build: { version: 1, engine: "remotion", engineVersion: "4.0.440", compositionId: "Produced", entryFile: "index.tsx",
      inputs: [archive("index.tsx")], toolchainLock: archive("_rocut/toolchain-lock.json") } } as ProgrammaticSource;
  let loads = 0, evaluations = 0, closes = 0, callbackEndpoint = "";
  const resourceStore = { projectId: "fixture", store: { async loadAttachment() {
    loads++; return { body: Uint8Array.from(code).buffer, metadata: { kind: "programmatic-resource", version: 1,
      sha256: hash, byteLength: code.length, mimeType: "text/html" } };
  } } } as unknown as ProgrammaticResourceStore;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 8]);
  let capture: { endpoint: string; token: string };
  const host = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      let result: object;
      if (request.url === "/v1/audio-sessions/open") {
        expect(input.profile).toBe("source"); capture = input.producedCapture; callbackEndpoint = capture.endpoint;
        result = { version: 1, sessionId: "a".repeat(32), epoch: "b".repeat(32),
          browser: { product: "fixture", revision: "1", jsVersion: "1", protocolVersion: "1" } };
      } else if (request.url?.endsWith("/evaluate")) {
        evaluations++;
        expect(input.expression).toContain("canonicalStartFrame");
        await new Promise<void>((resolveCapture, reject) => {
          const post = httpRequest(capture.endpoint, { method: "POST", headers: {
            authorization: `Bearer ${capture.token}`, "content-type": "image/png", "content-length": String(png.length),
            "x-rocut-request-id": "1", "x-rocut-frame-index": "0",
          } }, receipt => {
            expect(receipt.statusCode).toBe(200); receipt.resume(); receipt.on("end", resolveCapture);
          }); post.on("error", reject); post.end(png);
        });
        result = { version: 1, value: { version: 1, profile: "remotion-4.0.440-native-produced-frames-v1",
          frames: [0, 1, 2].map(frameIndex => ({ frameIndex, assets: [], produced: frameIndex === 0 ? [{
            type: "artifact", id: "thumbnail", filename: "sidecars/initial.png", frame: 0,
            contentType: "thumbnail", downloadBehavior: null,
          }] : [] })) } };
      } else if (request.url?.endsWith("/close")) { closes++; result = { version: 1, closed: true }; }
      else throw Error("Unexpected basic frame request");
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    })().catch(() => response.writeHead(500).end());
  });
  try {
    await new Promise<void>(resolveListen => host.listen(0, "127.0.0.1", resolveListen));
    const address = host.address() as { port: number }, connectionFile = join(root, "connection.json");
    const descriptor = { version: 1, backend: "elftia-electron", token: "c".repeat(64),
      endpoint: `http://127.0.0.1:${address.port}/v1/frame`, capabilities: {
        nativeAudioAnalysis: { version: 1, protocol: ELECTRON_NATIVE_AUDIO_PROTOCOL },
      } };
    await writeFile(connectionFile, JSON.stringify(descriptor), "utf8");
    const options = { source, firstFrame: 2, frameCount: 1, sampleRate: 48000 as const, connectionFile, resourceStore,
      decoder: { ffmpeg: "must-not-run", ffprobe: "must-not-run" }, signal: new AbortController().signal, produced: true };
    await expect(renderRemotionAudioRange(options)).rejects.toThrow("session grant");
    expect(loads).toBe(0); expect(evaluations).toBe(0);
    await writeFile(connectionFile, JSON.stringify({ ...descriptor, capabilities: { ...descriptor.capabilities,
      nativeAudioSession: { version: 1, protocol: ELECTRON_AUDIO_SESSION_PROTOCOL } } }), "utf8");
    const result = await renderRemotionAudioRange(options);
    expect(evaluations).toBe(1); expect(closes).toBe(1);
    expect(result.firstFrame).toBe(2); expect(result.sampleOrigin).toBe(3200); expect(result.frames).toBe(1600);
    expect(result.hasAudio).toBe(false); expect(result.pcm.every(byte => byte === 0)).toBe(true);
    expect(result.artifacts).toHaveLength(1); expect(result.artifacts[0].body).toEqual(png);
    expect(result.artifacts[0].collectionFrame).toBe(0);
    await expect(new Promise((resolveRequest, reject) => {
      httpRequest(callbackEndpoint, response => { response.resume(); resolveRequest(response.statusCode); }).on("error", reject).end();
    })).rejects.toThrow();
  } finally {
    await new Promise<void>(resolveClose => host.close(() => resolveClose()));
    host.closeAllConnections();
    if (dirname(resolve(root)) !== resolve(parent)) throw Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
