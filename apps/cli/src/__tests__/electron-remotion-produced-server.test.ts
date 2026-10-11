import { expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import { createElectronRemotionProducedServer } from "../programmatic/electron-remotion-produced-server";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
async function fixture(maxSourceBytes = 32, maxTotalBytes = 64) {
  const controller = new AbortController();
  const server = await createElectronRemotionProducedServer({ durationFrames: 3,
    limits: { maxSourceBytes, maxTotalBytes }, signal: controller.signal });
  const post = (requestId = "1", frameIndex = "0", body = png, extra: Record<string, string> = {}) =>
    new Promise<Response>((resolve, reject) => {
      const request = httpRequest(server.callback.endpoint, { method: "POST", headers: {
        authorization: `Bearer ${server.callback.token}`, "content-type": "image/png",
        "x-rocut-request-id": requestId, "x-rocut-frame-index": frameIndex, "content-length": String(body.length), ...extra,
      } }, response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
        response.on("error", reject);
      });
      request.on("error", reject); request.end(body);
    });
  return { ...server, controller, post };
}

test("paused-produced callback records exact frame zero bytes and acknowledges only admitted binary PNG", async () => {
  const f = await fixture();
  try {
    expect(await (await f.post()).json()).toEqual({ version: 1, ok: true });
    expect(await (await f.post("2", "2", Buffer.concat([png, Buffer.from([2])]))).json()).toEqual({ version: 1, ok: true });
    await f.check();
    expect(f.take().get(0)).toEqual(png);
    expect([...f.take().keys()]).toEqual([0, 2]);
    expect(f.callback).toMatchObject({ durationFrames: 3, maxSourceBytes: 32, maxTotalBytes: 64 });
  } finally { await f.dispose(); }
});

test("unrelated token cannot publish pictures or poison a legitimate scan", async () => {
  const f = await fixture();
  try {
    expect((await f.post("1", "0", png, { authorization: "Bearer wrong" })).status).toBe(403);
    expect((await f.post()).status).toBe(200);
    await f.check(); expect(f.take().size).toBe(1);
  } finally { await f.dispose(); }
});

test("authenticated duplicate, clock, browser-header, PNG and byte-budget violations cannot be ignored", async () => {
  for (const invalid of [
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("1", "0"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("2", "3"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("02", "1"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("2", "1", png, { origin: "http://127.0.0.1" }),
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("2", "1", png, { host: "localhost" }),
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("2", "1", Buffer.alloc(8)),
    (f: Awaited<ReturnType<typeof fixture>>) => f.post("2", "1", Buffer.concat([png, Buffer.alloc(40)])),
  ]) {
    const f = await fixture();
    try {
      expect((await f.post()).status).toBe(200);
      expect((await invalid(f)).ok).toBe(false);
      await expect(f.check()).rejects.toThrow("rejected");
      expect(() => f.take()).toThrow();
    } finally { await f.dispose(); }
  }
  const f = await fixture(32, png.length);
  try {
    expect((await f.post()).status).toBe(200);
    expect((await f.post("2", "1")).status).toBe(422);
    await expect(f.check()).rejects.toThrow("rejected");
  } finally { await f.dispose(); }
});

test("streamed over-budget payload and abort drain callback lifetime", async () => {
  const f = await fixture(8);
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(f.callback.endpoint, { method: "POST", headers: {
        authorization: `Bearer ${f.callback.token}`, "content-type": "image/png",
        "x-rocut-request-id": "1", "x-rocut-frame-index": "0",
      } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.write(png.subarray(0, 8)); request.end(png.subarray(8));
    });
    expect(status).toBe(422);
    await expect(f.check()).rejects.toThrow("rejected");
    f.controller.abort(); await f.dispose(); await f.dispose();
    await expect(f.post()).rejects.toThrow();
  } finally { await f.dispose(); }
});
