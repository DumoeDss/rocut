import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { particleCaptureExpression } from "../programmatic/particle-page-bootstrap";
import { PARTICLE_BROWSER_RUNTIME_IIFE } from "../programmatic/particle-browser-bundle.generated";
import { identity, policy } from "./particle-protocol-test-support";
import {
	PARTICLE_BINDING_NAME,
	PARTICLE_REPLY_NAME,
} from "../programmatic/particle-protocol";
import {
	PARTICLE_CONFIG_NAME,
	PARTICLE_PAGE_CHECK_NAME,
	PARTICLE_PAGE_CLEANUP_NAME,
	PARTICLE_REQUEST_TAG,
	PARTICLE_REPLY_TAG,
	PARTICLE_CHECK_REQUEST_TAG,
	PARTICLE_CHECK_ACK_TAG,
	PARTICLE_CLEANUP_REQUEST_TAG,
	PARTICLE_CLEANUP_ACK_TAG,
} from "../programmatic/particle-page-contract";

const flush = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function outer(sourceId = identity.sourceId) {
	const sent: any[] = [],
		particleRequests: string[] = [],
		nativeRequests: string[] = [];
	const window: Record<string, any> = {
		[PARTICLE_BINDING_NAME]: (json: string) => particleRequests.push(json),
		__rocutNativeFrameRequest: (json: string) => nativeRequests.push(json),
	};
	const contentWindow = { postMessage: (data: unknown) => sent.push(data) };
	const iframe = { contentWindow, style: {}, srcdoc: "", sandbox: "" };
	let listener!: (event: any) => void;
	const promise = runInNewContext(
		particleCaptureExpression({
			config: {
				version: 1,
				identity: { ...identity, sourceId },
				policy,
				requestTimeoutMs: policy.requestTimeoutMs,
			},
			bootstrap: "const frame={index:12,time:0.48,seed:42};",
			code: "<div>author</div>",
			csp: "default-src 'none'",
		}),
		{
			window,
			document: {
				documentElement: { style: {} },
				body: { style: {}, appendChild() {} },
				createElement: () => iframe,
			},
			addEventListener: (_name: string, handler: typeof listener) => {
				listener = handler;
			},
			requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
			crypto: webcrypto,
			setTimeout,
			clearTimeout,
		},
	) as Promise<unknown>;
	void promise.catch(() => {});
	return {
		window,
		iframe,
		sent,
		particleRequests,
		nativeRequests,
		promise,
		reply(data: unknown, source: object = contentWindow) {
			listener({ source, data });
		},
	};
}

test("outer check/cleanup await matching iframe acknowledgement, not merely postMessage", async () => {
	const page = outer();
	let done = false;
	const cleanup = page.window[PARTICLE_PAGE_CLEANUP_NAME]();
	void cleanup.then(() => {
		done = true;
	});
	expect(page.window[PARTICLE_PAGE_CLEANUP_NAME]()).toBe(cleanup);
	expect(page.sent).toHaveLength(1);
	const request = page.sent[0];
	expect(request.tag).toBe(PARTICLE_CLEANUP_REQUEST_TAG);
	expect(request.id).toMatch(/^[a-f0-9]{32}$/);
	page.reply({ tag: PARTICLE_CLEANUP_ACK_TAG, id: request.id, ok: true }, {});
	page.reply({ tag: PARTICLE_CLEANUP_ACK_TAG, id: "wrong-id", ok: true });
	page.reply({ tag: PARTICLE_CHECK_ACK_TAG, id: request.id, ok: true });
	await flush();
	expect(done).toBe(false);
	page.reply({ tag: PARTICLE_CLEANUP_ACK_TAG, id: request.id, ok: true });
	await cleanup;
	expect(done).toBe(true);
	await expect(page.window[PARTICLE_PAGE_CHECK_NAME]()).rejects.toThrow(
		"closing",
	);
});

test("outer keeps particle/native channels isolated and forwards cleanup errors", async () => {
	const page = outer();
	page.reply({ tag: PARTICLE_REQUEST_TAG, payload: "particle-json" }, {});
	page.reply({ tag: PARTICLE_REQUEST_TAG, payload: "particle-json" });
	page.reply({ tag: "rocut-native-frame-request", payload: "native-json" });
	expect(page.particleRequests).toEqual(["particle-json"]);
	expect(page.nativeRequests).toEqual(["native-json"]);
	page.window[PARTICLE_REPLY_NAME]("particle-reply");
	page.window.__rocutNativeFrameReply("native-reply");
	expect(page.sent).toEqual([
		{ tag: PARTICLE_REPLY_TAG, reply: "particle-reply" },
		{ tag: "rocut-native-frame-reply", reply: "native-reply" },
	]);
	const cleanup = page.window[PARTICLE_PAGE_CLEANUP_NAME]();
	page.reply({
		tag: PARTICLE_CLEANUP_ACK_TAG,
		id: page.sent.at(-1).id,
		error: "author dispose failed",
	});
	await expect(cleanup).rejects.toThrow("author dispose failed");
});

test("generated inner bootstrap installs before authors and cleanup ack follows awaited runtime disposal", async () => {
	const sourceId = "source</script><script>escaped-config</script>";
	const page = outer(sourceId);
	const code = page.iframe.srcdoc.split("<script>")[1].split("</script>")[0];
	expect(code).toContain(PARTICLE_CONFIG_NAME);
	expect(code).toContain(PARTICLE_BROWSER_RUNTIME_IIFE);
	const innerWindow: Record<string, any> = {};
	const replies: any[] = [];
	const parent = { postMessage: (data: unknown) => replies.push(data) };
	let message!: (event: any) => void;
	runInNewContext(code, {
		window: innerWindow,
		parent,
		AbortController,
		Event,
		setTimeout,
		clearTimeout,
		addEventListener: (name: string, callback: typeof message) => {
			if (name === "message") message = callback;
		},
	});
	const runtime = innerWindow.__rocutClaimParticleRuntime();
	expect(innerWindow[PARTICLE_CONFIG_NAME].identity.sourceId).toBe(sourceId);
	await runtime.runPhase(() => {});
	let release!: () => void;
	runtime.registerCleanup(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const control = (source: object, data: unknown) => {
		const event = new Event("message");
		Object.assign(event, { source, data });
		message(event);
	};
	control(
		{},
		{
			tag: PARTICLE_CLEANUP_REQUEST_TAG,
			id: "foreign",
		},
	);
	expect(replies).toHaveLength(0);
	control(parent, { tag: PARTICLE_CHECK_REQUEST_TAG, id: "check" });
	await flush();
	expect(replies[0]).toEqual({
		tag: PARTICLE_CHECK_ACK_TAG,
		id: "check",
		ok: true,
	});
	control(parent, { tag: PARTICLE_CLEANUP_REQUEST_TAG, id: "dispose" });
	await flush();
	expect(replies).toHaveLength(1);
	release();
	await flush();
	expect(replies[1]).toEqual({
		tag: PARTICLE_CLEANUP_ACK_TAG,
		id: "dispose",
		ok: true,
	});
	expect(() => innerWindow.__rocutClaimParticleRuntime()).toThrow(
		"already claimed",
	);
});

test("deterministic browser artifact is current and has no runtime TypeScript import", () => {
	const result = spawnSync(
		process.execPath,
		[resolve("script/build-particle-browser.mjs"), "--check"],
		{ encoding: "utf8", windowsHide: true },
	);
	expect(result.status).toBe(0);
	expect(PARTICLE_BROWSER_RUNTIME_IIFE).not.toMatch(/\bimport\s*(?:\(|["'{*])/);
	expect(PARTICLE_BROWSER_RUNTIME_IIFE).not.toContain("node:");
});
