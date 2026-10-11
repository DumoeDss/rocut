import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

export interface ElectronRemotionProducedCallback {
  version: 1;
  endpoint: string;
  token: string;
  maxSourceBytes: number;
  maxTotalBytes: number;
  durationFrames: number;
}

/** Receives only Host-captured PNGs from the paused canonical source session. */
export async function createElectronRemotionProducedServer({ durationFrames, limits, signal }: {
  durationFrames: number;
  limits: { maxSourceBytes: number; maxTotalBytes: number };
  signal: AbortSignal;
}) {
  signal.throwIfAborted();
  for (const value of [durationFrames, limits.maxSourceBytes]) {
    if (!Number.isSafeInteger(value) || value < 1) throw Error("Invalid produced capture limits");
  }
  if (!Number.isSafeInteger(limits.maxTotalBytes) || limits.maxTotalBytes < 0) throw Error("Invalid produced capture limits");
  const token = randomBytes(32).toString("hex");
  const pictures = new Map<number, Buffer>();
  const requests = new Set<number>();
  const jobs = new Set<Promise<void>>();
  let authority = "", total = 0, busy = false, disposed = false, failure: Error | undefined;
  const server = createServer((request, response) => {
    const job = (async () => {
      const json = (status: number, value: object) => {
        if (!response.destroyed) response.writeHead(status, {
          "content-type": "application/json", "cache-control": "no-store",
        }).end(JSON.stringify(value));
      };
      let admitted = false;
      try {
        signal.throwIfAborted();
        const headers = request.headers;
        const counts = new Map<string, number>();
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          const name = request.rawHeaders[index]!.toLowerCase();
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        if (disposed || request.method !== "POST" || request.url !== "/v1/native-produced/frame"
          || request.socket.remoteAddress !== "127.0.0.1" || headers.host !== authority
          || headers.authorization !== `Bearer ${token}`
          || Object.keys(headers).some(name => ["origin", "referer", "cookie"].includes(name) || name.startsWith("sec-fetch-"))
          || ["host", "authorization", "content-type", "content-length", "x-rocut-request-id", "x-rocut-frame-index"]
            .some(name => (counts.get(name) ?? 0) > 1)) {
          if (headers.authorization === `Bearer ${token}`) failure ??= Error("Native produced callback rejected");
          request.resume(); json(403, { error: "Native produced callback unavailable" }); return;
        }
        const integer = (value: string | string[] | undefined, minimum: number) => {
          if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error();
          const number = Number(value);
          if (!Number.isSafeInteger(number) || number < minimum) throw Error();
          return number;
        };
        const requestId = integer(headers["x-rocut-request-id"], 1);
        const frameIndex = integer(headers["x-rocut-frame-index"], 0);
        if (headers["content-type"] !== "image/png" || frameIndex >= durationFrames
          || requests.has(requestId) || pictures.has(frameIndex) || busy) throw Error();
        if (headers["content-length"] !== undefined) {
          const length = integer(headers["content-length"], 8);
          if (length > limits.maxSourceBytes || total + length > limits.maxTotalBytes) throw Error();
        }
        busy = true; admitted = true; requests.add(requestId);
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          signal.throwIfAborted();
          size += chunk.length;
          if (disposed || size > limits.maxSourceBytes || total + size > limits.maxTotalBytes) throw Error();
          chunks.push(Buffer.from(chunk));
        }
        signal.throwIfAborted();
        const body = Buffer.concat(chunks);
        if (disposed || body.length < 8 || !body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error();
        pictures.set(frameIndex, body); total += body.length;
        json(200, { version: 1, ok: true });
      } catch {
        // Authenticated malformed calls poison this job; unrelated callers get
        // no receipts or payload detail and cannot alter the session's result.
        if (request.headers.authorization === `Bearer ${token}`) failure ??= Error("Native produced callback rejected");
        request.resume(); json(422, { error: "Native produced callback rejected" });
      } finally { if (admitted) busy = false; }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.maxConnections = 4;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    disposed = true;
    closing = (async () => {
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await Promise.allSettled(jobs);
      await closed;
      pictures.clear(); requests.clear();
    })();
    return closing;
  };
  const abort = () => { void close(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
    });
    signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Native produced callback bind failed");
    authority = `127.0.0.1:${address.port}`;
    return {
      callback: { version: 1 as const, endpoint: `http://${authority}/v1/native-produced/frame`, token,
        maxSourceBytes: limits.maxSourceBytes, maxTotalBytes: limits.maxTotalBytes, durationFrames },
      async check() { await Promise.all(jobs); signal.throwIfAborted(); if (failure) throw failure; },
      take() {
        signal.throwIfAborted();
        if (disposed || failure || jobs.size || busy) throw Error("Native produced captures are unavailable or unsettled");
        return new Map(pictures);
      },
      async dispose() { signal.removeEventListener("abort", abort); await close(); },
    };
  } catch (error) { signal.removeEventListener("abort", abort); await close(); throw error; }
}
