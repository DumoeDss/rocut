import { expect, test } from "bun:test";
import { createServer, request as httpRequest } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { createHttpProgrammaticFrames } from "../../../vite-example/src/host/http-programmatic-frames";
import { createProgrammaticAudioService } from "../programmatic/audio-service";
import type { ProgrammaticResourceStore } from "../programmatic/resources";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test server address");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
const headers = { "content-type": "application/vnd.rocut.audio-pcm", "content-length": "16", "x-rocut-audio-version": "1",
  "x-rocut-sample-rate": "44100", "x-rocut-channels": "2", "x-rocut-frames": "2", "x-rocut-sample-origin": "0", "x-rocut-has-audio": "1" };

test("audio HTTP transport preserves PCM bytes and rejects malformed or truncated responses", async () => {
  let reply = (response: ServerResponse) => { response.writeHead(200, headers).end(Buffer.alloc(16, 7)); };
  const server = createServer((_request, response) => reply(response));
  const base = await listen(server), provider = createHttpProgrammaticFrames({ base });
  const call = () => provider.renderAudio!({ request: {}, signal: AbortSignal.timeout(2000) });
  try {
    const data = await call();
    expect(data).toMatchObject({ sampleRate: 44100, channels: 2, frames: 2, sampleOrigin: 0, hasAudio: true });
    expect([...new Uint8Array(data.pcm)]).toEqual(Array(16).fill(7));
    for (const change of [ { "content-type": "text/plain" }, { "x-rocut-audio-version": "2" },
      { "x-rocut-channels": "1" }, { "x-rocut-sample-rate": "22050" }, { "x-rocut-frames": "-1" },
      { "x-rocut-has-audio": "true" }, { "x-rocut-sample-origin": "NaN" }, { "content-length": "0" },
      { "content-length": "134217736", "x-rocut-frames": "16777217" } ]) {
      reply = response => { response.writeHead(200, { ...headers, ...change }).end(Buffer.alloc(16)); };
      await expect(call()).rejects.toThrow("Invalid native audio");
    }
    reply = response => { response.writeHead(200, headers); response.write(Buffer.alloc(8)); response.end(); };
    await expect(call()).rejects.toThrow();
    reply = response => { response.writeHead(503, { "content-type": "application/json" }).end('{"error":"not configured"}'); };
    await expect(call()).rejects.toThrow("not configured");
  } finally { await close(server); }
});

test("client cancellation closes a stalled PCM body", async () => {
  let seen!: () => void, closed!: () => void;
  const received = new Promise<void>(resolve => { seen = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.once("close", closed); response.writeHead(200, headers); response.write(Buffer.alloc(8)); seen();
  });
  const base = await listen(server), controller = new AbortController();
  try {
    const result = createHttpProgrammaticFrames({ base }).renderAudio!({ request: {}, signal: controller.signal }).catch(error => error);
    await received; controller.abort(); expect(await result).toBeInstanceOf(Error);
    await disconnected;
  } finally { await close(server); }
});

test("native service never falls back from Electron and disposing a partial request drains", async () => {
  // No store access or executable launch is allowed in these admission/lifecycle cases.
  const resourceStore = { projectId: "unused", store: new Proxy({}, { get() { throw Error("Unexpected store access"); } }) } as ProgrammaticResourceStore;
  const configuration = { resourceStore, executable: process.execPath, decoder: { ffmpeg: process.execPath, ffprobe: process.execPath } };
  const electron = createProgrammaticAudioService({ ...configuration, connectionFile: "electron-owner.json" });
  expect(electron.capability.configured).toBe(false); await electron.dispose();
  const service = createProgrammaticAudioService({ ...configuration, connectionFile: "" });
  expect(service.capability.availability).toBe("configured-not-health-probed");
  let active = 0, started!: () => void;
  started = () => {};
  const server = createServer(async (request, response) => {
    active++; started(); try { await service.handle(request, response); } finally { active--; }
  });
  const base = await listen(server);
  try {
    for (const body of ["null", "{", "{}", '{"unknown":1}', '{"source":{"audio":null},"sampleRate":44100}']) {
      const response = await fetch(base, { method: "POST", body }); expect(response.status).toBe(422); await response.arrayBuffer();
    }
    const request = httpRequest(base, { method: "POST", headers: { "content-length": "1000" } });
    const disconnected = new Promise<void>(resolve => { request.once("error", () => resolve()); request.once("close", resolve); });
    request.flushHeaders(); request.write("{");
    // Wait for THIS partial upload, not an earlier validation request.
    await new Promise<void>(resolve => { started = resolve; });
    expect(active).toBe(1); await service.dispose(); await disconnected; expect(active).toBe(0);
    const after = await fetch(base, { method: "POST", body: "{}" }); expect(after.status).toBe(503);
  } finally { await service.dispose(); await close(server); }
});
