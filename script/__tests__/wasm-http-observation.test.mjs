import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { observeProbeWasmHttp } from "../fixtures/wasm-http-observation.mjs";

const bytes = Buffer.from([0, 97, 115, 109]);
const expected = {
	url: "http://127.0.0.1:12345/exact.wasm",
	byteLength: bytes.length,
	sha256: createHash("sha256").update(bytes).digest("hex"),
};
async function fixture(
	body = async () => ({ body: bytes.toString("base64"), base64Encoded: true }),
) {
	const session = new EventEmitter(),
		calls = [];
	session.send = async (method, params) => {
		calls.push({ method, params });
		if (method === "Network.enable") return {};
		assert.equal(
			method,
			"Network.getResponseBody",
			"No URL refetch/fallback is allowed",
		);
		return body(params);
	};
	const observed = await observeProbeWasmHttp(session, expected);
	return {
		session,
		calls,
		observed,
		response(id = "original-request", overrides = {}) {
			session.emit("Network.responseReceived", {
				requestId: id,
				response: { url: expected.url, status: 200, ...overrides },
			});
		},
		finish(id = "original-request") {
			session.emit("Network.loadingFinished", { requestId: id });
		},
	};
}
test("exact original request ID is read once only after loadingFinished, with bounded Network buffers", async () => {
	const f = await fixture();
	f.response();
	assert.equal(f.calls.length, 1);
	f.finish();
	f.finish();
	const result = await f.observed.drain();
	assert.equal(result.ok, true);
	assert.deepEqual(f.calls, [
		{
			method: "Network.enable",
			params: {
				maxTotalBufferSize: 15 * 1024 * 1024,
				maxResourceBufferSize: 15 * 1024 * 1024,
			},
		},
		{
			method: "Network.getResponseBody",
			params: { requestId: "original-request" },
		},
	]);
	assert.equal(result.profile, "cdp-original-request-body-v2");
	assert.equal(result.records[0].sha256, expected.sha256);
	assert.equal(Object.isFrozen(result.records[0]), true);
	assert.equal(JSON.stringify(result).includes(expected.url), false);
	assert.equal(f.session.listenerCount("Network.responseReceived"), 0);
});
test("unrelated response/finished events and missing evidence do not read bytes or pass", async () => {
	const f = await fixture();
	f.response("unrelated", { url: expected.url + "?other" });
	f.finish("unrelated");
	assert.equal((await f.observed.drain()).ok, false);
	assert.equal(f.calls.length, 1);
});
test("empty, truncated, wrong, malformed and protocol-error bodies fail closed without refetch", async () => {
	for (const body of [
		async () => ({ body: "", base64Encoded: true }),
		async () => ({
			body: bytes.subarray(0, 3).toString("base64"),
			base64Encoded: true,
		}),
		async () => ({
			body: Buffer.from([1, 2, 3, 4]).toString("base64"),
			base64Encoded: true,
		}),
		async () => ({ body: "!!!!", base64Encoded: true }),
		async () => ({ body: "anything", base64Encoded: "not-boolean" }),
		async () => {
			throw Error("private://protocol-error");
		},
	]) {
		const f = await fixture(body);
		f.response();
		f.finish();
		const result = await f.observed.drain();
		assert.equal(result.ok, false);
		assert.equal(f.calls.length, 2);
		assert.equal(JSON.stringify(result).includes("private://"), false);
	}
});
test("404, failed loading and incomplete transfer drain without waiting for a body", async () => {
	for (const failure of ["404", "failed", "incomplete"]) {
		const f = await fixture();
		f.response("original-request", failure === "404" ? { status: 404 } : {});
		if (failure === "failed")
			f.session.emit("Network.loadingFailed", {
				requestId: "original-request",
				errorText: "private://failure",
			});
		const result = await f.observed.drain();
		assert.equal(result.ok, false);
		assert.equal(f.calls.length, 1);
		assert.equal(JSON.stringify(result).includes("private://"), false);
	}
});
test("eight-record limit and duplicate original IDs cannot masquerade as success", async () => {
	const f = await fixture();
	for (let i = 0; i < 9; i++) {
		f.response(String(i));
		f.finish(String(i));
	}
	const result = await f.observed.drain();
	assert.equal(result.records.length, 8);
	assert.equal(result.overflow, true);
	assert.equal(result.ok, false);
	assert.equal(
		f.calls.filter((call) => call.method === "Network.getResponseBody").length,
		8,
	);
	const duplicate = await fixture();
	duplicate.response();
	duplicate.response();
	duplicate.finish();
	assert.equal((await duplicate.observed.drain()).ok, false);
});
test("post-oracle drain waits for already-started body before caller closes context", async () => {
	let finish;
	const order = [];
	const f = await fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	f.response();
	f.finish();
	order.push("original-pixel-export-complete");
	const drained = f.observed.drain().then((result) => {
		order.push("drained");
		return result;
	});
	assert.deepEqual(order, ["original-pixel-export-complete"]);
	finish({ body: bytes.toString("base64"), base64Encoded: true });
	assert.equal((await drained).ok, true);
	order.push("context-close");
	assert.deepEqual(order, [
		"original-pixel-export-complete",
		"drained",
		"context-close",
	]);
});
test("unexpected session closure fails pending body without replacing an earlier native error", async () => {
	const f = await fixture(() => new Promise(() => {}));
	f.response();
	f.finish();
	const nativeError = Error("original-oracle-error");
	const attempt = { ok: false, failure: nativeError.message };
	f.session.emit("close");
	attempt.wasmHttp = await f.observed.drain();
	attempt.ok = attempt.ok && attempt.wasmHttp.ok;
	assert.equal(attempt.failure, "original-oracle-error");
	assert.equal(attempt.wasmHttp.ok, false);
});
test("matching late response during body drain fails closed and cannot trigger another retrieval", async () => {
	let finish;
	const f = await fixture(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	f.response();
	f.finish();
	const drained = f.observed.drain();
	f.response("late");
	f.finish("late");
	finish({ body: bytes.toString("base64"), base64Encoded: true });
	const result = await drained;
	assert.equal(result.ok, false);
	assert.equal(result.lateResponse, true);
	assert.equal(f.calls.length, 2);
});
test("integration keeps original checks before drain, drain before close, and first error intact", async () => {
	const source = await readFile(
		new URL("../probe-liquid-effects.mjs", import.meta.url),
		"utf8",
	);
	assert.match(source, /page\.context\(\)\.newCDPSession\(page\)/);
	assert.match(source, /await observeProbeWasmHttp\(wasmCdp/);
	const checked = source.indexOf("attempt.decoded = decodeLiquid");
	const drain = source.indexOf("attempt.wasmHttp = await wasmHttp.drain()");
	const close = source.indexOf("await context?.close()", drain);
	assert(checked < drain && drain < close);
	assert.match(
		source,
		/attempt\.failure \?\?= String\(error\.stack \?\? error\)/,
	);
	const helper = await readFile(
		new URL("../fixtures/wasm-http-observation.mjs", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		helper,
		/session\.send\("Network\.loadNetworkResource"|fetch\(|response\.body\(|setTimeout\(|requestAnimationFrame|drawImage|currentTime\s*=/,
	);
});
test("binary expectation over 15MiB rejects before enabling network", async () => {
	let calls = 0;
	await assert.rejects(
		observeProbeWasmHttp(
			{
				on() {
					calls++;
				},
				send() {
					calls++;
				},
			},
			{ ...expected, byteLength: 15 * 1024 * 1024 + 1 },
		),
	);
	assert.equal(calls, 0);
});
