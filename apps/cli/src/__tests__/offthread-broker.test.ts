import { expect, test } from "bun:test";
import type { FrameBrowserEvent } from "../programmatic/chromium-process";
import { attachOffthreadBroker } from "../programmatic/offthread-broker";
import type { decodeNativeVideoFrame } from "../programmatic/video-decoder";

const src = "data:video/webm;base64,AQID";
const png = Buffer.from([137, 80, 78, 71]);
type Decode = typeof decodeNativeVideoFrame;
const success: Decode = async () => ({ png, index: 0, sourceTime: 0, width: 1, height: 1 });

async function fixture(decodeFrame: Decode = success, maxElements = 8, resourceOnly = false) {
	const listeners = new Set<(event: FrameBrowserEvent) => void>();
	const replies: { contextId: unknown; value: Record<string, unknown> }[] = [];
	const calls: Parameters<Decode>[0][] = [];
	const signal = new AbortController();
	const browser = {
		onEvent(listener: (event: FrameBrowserEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async send(method: string, params: Record<string, unknown> = {}, session?: string) {
			expect(session).toBe("capture-session");
			if (method === "Runtime.evaluate") {
				const expression = String(params.expression);
				replies.push({ contextId: params.contextId, value: JSON.parse(expression.slice(expression.indexOf("(") + 1, -1)) });
			}
			return {};
		},
	};
	const broker = await attachOffthreadBroker({
		browser, session: "capture-session", decoder: { ffmpeg: "host-owned", ffprobe: "host-owned" },
		code: resourceOnly ? "" : `<video src="${src}">`, resources: resourceOnly ? [{
			resource: { id: "clip.webm", kind: "video", mimeType: "video/webm", byteLength: 3, sha256: "verified-upstream", attachmentKey: "verified-upstream" },
			body: new Uint8Array([1, 2, 3]).buffer,
		}] : [], limits: { maxBytes: 1024, maxDimension: 64, maxElements }, signal: signal.signal,
		decodeFrame: async input => { calls.push(input); return decodeFrame(input); },
	});
	const emit = (request: unknown, contextId = 7, sessionId = "capture-session", name = "__rocutNativeFrameRequest") => {
		for (const listener of listeners) listener({ sessionId, method: "Runtime.bindingCalled",
			params: { name, executionContextId: contextId, payload: typeof request === "string" ? request : JSON.stringify(request) } });
	};
	const frame = (id = 1, extra = {}, contextId = 7) => emit({ version: 1, kind: "frame", id, src, seconds: .25, transparent: true, toneMapped: true, ...extra }, contextId);
	return { ...broker, browser, emit, frame, replies, calls, signal, listeners };
}

test("native broker scopes messages and replies, retains native nearest timing, and rejects replay", async () => {
	const f = await fixture();
	try {
		f.emit("invalid", 7, "other-session");
		f.emit("invalid", 7, "capture-session", "other-binding");
		f.frame(1); f.frame(1, { toneMapped: false }, 8);
		await f.check();
		expect(f.calls).toHaveLength(2);
		expect(f.calls[0]).toMatchObject({ seconds: .25, transparent: true, selection: "nearest", toneMapped: true });
		expect(f.calls[1].toneMapped).toBe(false);
		expect([...f.calls[0].body]).toEqual([1, 2, 3]);
		expect(f.replies.map(r => [r.contextId, r.value.id, r.value.png])).toEqual([[7, 1, png.toString("base64")], [8, 1, png.toString("base64")]]);
		f.frame(1);
		await expect(f.check()).rejects.toThrow("Duplicate");
		expect(f.calls).toHaveLength(2);
	} finally { await f.dispose(); }
	expect(f.listeners.size).toBe(0);
});

test("native broker rejects unmanaged sources, malformed/options/oversize requests even if author ignores errors", async () => {
	for (const [payload, expected] of [
		[{ src: "file:///private.mp4" }, "not admitted"],
		[{ src: "https://example.invalid/movie.webm" }, "not admitted"],
		[{ src: "data:video/webm;base64,BAUG" }, "not admitted"],
		[{ seconds: -1 }, "decode options"], [{ transparent: "true" }, "decode options"],
		[{ toneMapped: null }, "decode options"], [{ src: "x".repeat(3000) }, "byte limit"],
		[{ id: 0 }, "Invalid native frame request"],
	] as const) {
		const f = await fixture();
		try { f.frame(1, payload); await expect(f.check()).rejects.toThrow(expected); expect(f.calls).toHaveLength(0); }
		finally { await f.dispose(); }
	}
	const malformed = await fixture();
	try { malformed.emit("{"); await expect(malformed.check()).rejects.toThrow(); expect(malformed.calls).toHaveLength(0); }
	finally { await malformed.dispose(); }
});

test("native broker enforces Rust request counts and retains decoder failures", async () => {
	const f = await fixture(success, 1);
	try {
		f.frame(1); f.frame(2);
		await expect(f.check()).rejects.toThrow("count exceeds"); expect(f.calls).toHaveLength(1);
	} finally { await f.dispose(); }
	const failed = await fixture(async () => { throw Error("decode fixture failed"); });
	try {
		failed.frame(); await expect(failed.check()).rejects.toThrow("decode fixture failed");
		expect(failed.replies[0].value.error).toBe("decode fixture failed");
	} finally { await failed.dispose(); }
});

test("native broker admits declared video attachment bytes and propagates frame-wide abort", async () => {
	const f = await fixture(success, 8, true);
	try { f.frame(); await f.check(); expect(f.calls).toHaveLength(1); expect([...f.calls[0].body]).toEqual([1, 2, 3]); }
	finally { await f.dispose(); }
	const aborted = await fixture();
	try {
		aborted.signal.abort(); aborted.frame(); await aborted.check();
		expect(aborted.calls).toHaveLength(0);
		expect(aborted.replies[0].value.error).toBe("Native video request aborted");
	} finally { await aborted.dispose(); }
});

test("native broker cancels active/queued work, isolates cancel IDs, and drains on dispose", async () => {
	let started!: () => void;
	const ready = new Promise<void>(resolve => { started = resolve; });
	let running = 0, stopped = 0;
	const f = await fixture(async ({ signal }) => {
		running++; started();
		try { await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true })); }
		finally { running--; stopped++; }
		return success({} as Parameters<Decode>[0]);
	});
	f.frame(1); f.frame(2); await ready;
	f.emit({ version: 1, kind: "cancel", id: 1 }, 8);
	expect(f.calls[0].signal.aborted).toBe(false);
	f.emit({ version: 1, kind: "cancel", id: 2 });
	f.emit({ version: 1, kind: "cancel", id: 1 });
	await f.check();
	expect(f.calls).toHaveLength(1); expect(running).toBe(0); expect(stopped).toBe(1);
	expect(f.replies.every(r => r.value.error === "Native video request aborted")).toBe(true);
	await f.dispose(); f.frame(3); expect(f.calls).toHaveLength(1); expect(f.listeners.size).toBe(0);

	const disposed = await fixture(async ({ signal }) => {
		await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true }));
		return success({} as Parameters<Decode>[0]);
	});
	disposed.frame(); await Promise.resolve(); await disposed.dispose();
	expect(disposed.calls[0].signal.aborted).toBe(true); expect(disposed.listeners.size).toBe(0);
});

test("native broker initialization failure and pre-aborted calls leave no subscription", async () => {
	let subscribed = 0;
	const options = { session: "capture", decoder: { ffmpeg: "host", ffprobe: "host" }, code: "", resources: [],
		limits: { maxBytes: 1024, maxDimension: 64, maxElements: 8 }, signal: new AbortController().signal,
		browser: { onEvent() { subscribed++; return () => { subscribed--; }; }, async send() { throw Error("binding failed"); } } };
	await expect(attachOffthreadBroker(options)).rejects.toThrow("binding failed"); expect(subscribed).toBe(0);
	await expect(attachOffthreadBroker({ ...options, signal: AbortSignal.abort() })).rejects.toThrow(); expect(subscribed).toBe(0);
});
