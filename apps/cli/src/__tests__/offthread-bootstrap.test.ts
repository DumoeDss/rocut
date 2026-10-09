import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { OFFTHREAD_BOOTSTRAP } from "../programmatic/offthread-bootstrap";

function fixture(available = true) {
	const requests: Record<string, unknown>[] = [];
	let message!: (event: { source: unknown; data: unknown }) => void;
	const parent = { postMessage(input: { tag: string; payload: string }) { requests.push(JSON.parse(input.payload)); } };
	const window: { rocutOffthread?: { available: boolean; fetch(url: string, options?: { signal: AbortSignal }): Promise<Response> } } = {};
	const originalFetch = () => { throw Error("must not call ambient fetch"); };
	const context = { window, parent, nativeVideoBridge: available, fetch: originalFetch, URL, Response, Uint8Array, atob, DOMException,
		addEventListener(_type: string, callback: typeof message) { message = callback; } };
	runInNewContext(OFFTHREAD_BOOTSTRAP, context);
	const reply = (value: unknown, source: unknown = parent) => message({ source, data: { tag: "rocut-native-frame-reply", reply: value } });
	const url = "http://localhost:0/proxy?src=data%3Avideo%2Fwebm%3Bbase64%2CAQID&time=0.25&transparent=true&toneMapped=true";
	return { bridge: window.rocutOffthread!, requests, reply, url, context, originalFetch };
}

test("native fetch seam retains ambient fetch, validates proxy and returns exact PNG bytes only from parent replies", async () => {
	const f = fixture();
	expect(f.bridge.available).toBe(true); expect(f.context.fetch).toBe(f.originalFetch);
	for (const url of ["https://example.invalid/proxy", "http://localhost:1/proxy", "http://localhost:0/file", "http://user@localhost:0/proxy"]) {
		await expect(f.bridge.fetch(url)).rejects.toThrow("Invalid native");
	}
	expect(f.requests).toHaveLength(0);
	const pending = f.bridge.fetch(f.url);
	expect(f.requests[0]).toEqual({ version: 1, kind: "frame", id: 1, src: "data:video/webm;base64,AQID", seconds: .25, transparent: true, toneMapped: true });
	f.reply({ id: 1, error: "untrusted reply" }, {});
	f.reply({ id: 1, png: "iVBORw==" });
	const response = await pending;
	expect(response.headers.get("content-type")).toBe("image/png");
	expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
	f.reply({ id: 1, error: "late reply ignored" });
});

test("native fetch cancellation removes listeners and does not cancel completed requests", async () => {
	const f = fixture(), controller = new AbortController();
	const rejected = f.bridge.fetch(f.url, { signal: controller.signal });
	void rejected.catch(() => {});
	controller.abort(); await expect(rejected).rejects.toThrow("aborted");
	expect(f.requests.map(r => r.kind)).toEqual(["frame", "cancel"]);
	f.reply({ id: 1, png: "AQID" });
	const completed = new AbortController(), pending = f.bridge.fetch(f.url, { signal: completed.signal });
	f.reply({ id: 2, png: "AQID" }); await pending; completed.abort();
	expect(f.requests.map(r => r.kind)).toEqual(["frame", "cancel", "frame"]);
	await expect(f.bridge.fetch(f.url, { signal: AbortSignal.abort() })).rejects.toThrow();
	expect(f.requests).toHaveLength(3);
	const missing = fixture(false);
	expect(missing.bridge.available).toBe(false);
	await expect(missing.bridge.fetch(f.url)).rejects.toThrow("requires the native frame bridge");
	expect(missing.requests).toHaveLength(0);
});
