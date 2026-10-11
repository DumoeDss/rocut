import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { openElectronAudioSession, pinElectronAudioSessionConnection, ELECTRON_AUDIO_SESSION_PROTOCOL } from "../programmatic/electron-audio-session";
import { ELECTRON_NATIVE_AUDIO_PROTOCOL } from "../programmatic/electron-audio-transport";
import { ELECTRON_NATIVE_VIDEO_PROTOCOL } from "../programmatic/electron-native-video-server";

const browser = { product: "fixture", revision: "1", jsVersion: "1", protocolVersion: "1" };
const id = "a".repeat(64);
async function fixture() {
  const parent = "C:/tmps", directory = await mkdtemp(join(parent, "rocut-audio-session-test-"));
  const connectionFile = join(directory, "connection.json"), token = "b".repeat(64);
  const controller = new AbortController();
  const state = {
    opened: { version: 1, sessionId: id, epoch: "c".repeat(32), browser } as Record<string, unknown>,
    closed: { version: 1, closed: true } as Record<string, unknown>,
    closeIds: [] as string[], requests: [] as string[],
    evaluate: async (_input: Record<string, unknown>, _request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: 1, value: "result" }));
    },
  };
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      state.requests.push(request.url!);
      if (request.url === "/v1/audio-sessions/open") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state.opened));
      } else if (request.url?.endsWith("/close")) {
        state.closeIds.push(request.url.split("/")[3]);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state.closed));
      } else if (request.url?.endsWith("/evaluate")) await state.evaluate(input, request, response);
      else response.writeHead(404).end();
    })().catch(() => { if (!response.destroyed) response.writeHead(500).end(); });
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/frame`;
  const capabilities = { nativeAudioAnalysis: { version: 1, protocol: ELECTRON_NATIVE_AUDIO_PROTOCOL },
    nativeAudioSession: { version: 1, protocol: ELECTRON_AUDIO_SESSION_PROTOCOL } };
  const descriptor = { version: 1, backend: "elftia-electron", endpoint, token, capabilities };
  await writeFile(connectionFile, JSON.stringify(descriptor), "utf8");
  return { state, controller, connectionFile, descriptor,
    open: (profile: "source" | "dsp" = "source") => openElectronAudioSession({ connectionFile, profile,
      width: 64, height: 64, signal: controller.signal }),
    async dispose() {
      controller.abort();
      const closed = new Promise<void>(resolveClose => server.close(() => resolveClose()));
      server.closeAllConnections(); await closed;
      if (dirname(resolve(directory)) !== resolve(parent)) throw Error("Unsafe session fixture cleanup");
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("persistent audio grant requires independent basic and session grants; video is additional", async () => {
  const f = await fixture();
  try {
    expect(pinElectronAudioSessionConnection(f.connectionFile).endpoint).toContain("/v1/audio-sessions");
    expect(() => pinElectronAudioSessionConnection(f.connectionFile, true)).toThrow("grant");
    for (const capabilities of [{ nativeAudioAnalysis: f.descriptor.capabilities.nativeAudioAnalysis },
      { nativeAudioSession: f.descriptor.capabilities.nativeAudioSession }, {}]) {
      await writeFile(f.connectionFile, JSON.stringify({ ...f.descriptor, capabilities }), "utf8");
      expect(() => pinElectronAudioSessionConnection(f.connectionFile)).toThrow("grant");
    }
    await writeFile(f.connectionFile, JSON.stringify({ ...f.descriptor, capabilities: { ...f.descriptor.capabilities,
      nativeVideoCapture: { version: 1, protocol: ELECTRON_NATIVE_VIDEO_PROTOCOL } } }), "utf8");
    expect(pinElectronAudioSessionConnection(f.connectionFile, true).endpoint).toContain("audio-sessions");
    expect(f.state.requests).toEqual([]);
  } finally { await f.dispose(); }
});

test("source sessions admit observations over 2 MiB while DSP overflow closes and poisons its session", async () => {
  const f = await fixture();
  try {
    const value = "x".repeat(2 * 1024 * 1024 + 32);
    f.state.evaluate = async (_input, _request, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: 1, value }));
    };
    const source = await f.open(); expect((await source.evaluate("facts()")).length).toBe(value.length); await source.close();
    const dsp = await f.open("dsp"); await expect(dsp.evaluate("facts()")).rejects.toThrow("limit");
    expect(f.state.closeIds).toEqual([id, id]);
    await expect(dsp.evaluate("again()")).rejects.toThrow("closed");
  } finally { await f.dispose(); }
});

test("busy evaluations serialize without closing the active job; malformed observations poison it", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolveWait => { release = resolveWait; });
  const started = new Promise<void>(resolveStarted => { entered = resolveStarted; });
  try {
    f.state.evaluate = async (_input, _request, response) => {
      entered(); await waiting;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: 1, value: 42 }));
    };
    const session = await f.open(), active = session.evaluate("first()");
    await started; await expect(session.evaluate("overlap()")).rejects.toThrow("busy");
    expect(f.state.closeIds).toEqual([]); release(); expect(await active).toBe(42);
    f.state.evaluate = async (_input, _request, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end('{"version":1}');
    };
    await expect(session.evaluate("invalid()")).rejects.toThrow("envelope");
    expect(f.state.closeIds).toEqual([id]); await expect(session.evaluate("again()")).rejects.toThrow("closed");
  } finally { release(); await f.dispose(); }
});

test("caller cancellation closes through an independent cleanup lifetime", async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>(resolveStarted => { entered = resolveStarted; });
  try {
    f.state.evaluate = async () => { entered(); };
    const session = await f.open();
    const active = session.evaluate("pending()");
    const outcome = active.then(value => ({ value }), error => ({ error }));
    await started; f.controller.abort();
    expect(await outcome).toMatchObject({ error: expect.any(Error) }); await session.close();
    expect(f.state.closeIds).toEqual([id]);
  } finally { await f.dispose(); }
});

test("invalid epoch/browser after a safe ID gets best-effort cleanup; only exact 32/64 lowercase hex IDs are routable", async () => {
  const f = await fixture();
  try {
    const original = { ...f.state.opened };
    for (const change of [{ epoch: "invalid" }, { browser: { ...browser, product: "" } }]) {
      f.state.opened = { ...original, ...change };
      await expect(f.open()).rejects.toThrow("Invalid Electron");
    }
    expect(f.state.closeIds).toEqual([id, id]);
    f.state.closed = { version: 1, closed: false };
    f.state.opened = { ...original, epoch: "invalid" };
    await expect(f.open()).rejects.toThrow("identity"); // Cleanup failure preserves the open validation error.
    expect(f.state.closeIds).toHaveLength(3);
    for (const invalidId of ["a".repeat(33), "a".repeat(63), "A".repeat(64), "../unsafe"]) {
      f.state.opened = { ...original, sessionId: invalidId };
      await expect(f.open()).rejects.toThrow("identity");
    }
    expect(f.state.closeIds).toHaveLength(3);
    f.state.opened = { ...original, sessionId: "a".repeat(32) }; f.state.closed = { version: 1, closed: true };
    await (await f.open()).close(); expect(f.state.closeIds.at(-1)).toBe("a".repeat(32));
  } finally { await f.dispose(); }
});

test("close requires the exact Host closed receipt and is idempotent even on failure", async () => {
  const f = await fixture();
  try {
    for (const receipt of [{ version: 1, ok: true }, { version: 1, closed: false }, { version: 1, closed: true, extra: 1 }]) {
      f.state.closed = receipt;
      const session = await f.open();
      await expect(session.close()).rejects.toThrow("close receipt");
      await expect(session.close()).rejects.toThrow("close receipt");
      await expect(session.evaluate("again()")).rejects.toThrow("closed");
    }
    expect(f.state.closeIds).toHaveLength(3);
    f.state.closed = { version: 1, closed: true };
    const session = await f.open(); await session.close(); await session.close();
    expect(f.state.closeIds).toHaveLength(4);
  } finally { await f.dispose(); }
});
