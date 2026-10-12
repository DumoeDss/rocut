import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
	observeProbeWasmHttp,
	WASM_HTTP_BUFFER_PROFILES,
} from "../fixtures/wasm-http-observation.mjs";

const binaryLimit = 15 * 1024 * 1024;
const representativeBinary = () => {
	const bytes = Buffer.alloc(15069189);
	bytes.set([0, 97, 115, 109, 1, 0, 0, 0]);
	return bytes;
};
test("A/B profiles are finite, derived from base64 cache versus binary admission, immutable", () => {
	assert.deepEqual(WASM_HTTP_BUFFER_PROFILES["legacy-15mib"], {
		total: binaryLimit,
		resource: binaryLimit,
	});
	const encodedLimit = Math.ceil(binaryLimit / 3) * 4;
	assert.equal(encodedLimit, 20 * 1024 * 1024);
	assert.deepEqual(WASM_HTTP_BUFFER_PROFILES["base64-plus-peer"], {
		total: 2 * encodedLimit,
		resource: encodedLimit,
	});
	assert(Object.isFrozen(WASM_HTTP_BUFFER_PROFILES));
	assert(Object.isFrozen(WASM_HTTP_BUFFER_PROFILES["base64-plus-peer"]));
});
async function modelFixture(profile, raw, peerBytes = 0, overrides = {}) {
	const body = raw.toString("base64"),
		session = new EventEmitter(),
		calls = [];
	let buffers;
	session.send = async (method, params) => {
		calls.push({ method, params });
		if (method === "Network.enable") {
			buffers = params;
			return {};
		}
		assert.equal(method, "Network.getResponseBody");
		assert.equal(params.requestId, "original-wasm");
		// CPU model of the pinned Chromium storage inequalities, not a browser simulation.
		if (
			body.length > buffers.maxResourceBufferSize ||
			body.length + peerBytes > buffers.maxTotalBufferSize
		)
			throw Error("Request content was evicted from inspector cache");
		return { body, base64Encoded: true };
	};
	const expected = {
		url: "http://127.0.0.1:12345/only.wasm",
		byteLength: raw.length,
		sha256: createHash("sha256").update(raw).digest("hex"),
		...overrides,
	};
	const observer = await observeProbeWasmHttp(session, expected, {
		totalBufferProfile: profile,
	});
	session.emit("Network.responseReceived", {
		requestId: "original-wasm",
		response: { url: expected.url, status: 200 },
	});
	session.emit("Network.loadingFinished", { requestId: "original-wasm" });
	return { result: await observer.drain(), calls };
}
test("representative same-size binary base64 cost is above old resource15MiB; B admits original request only in bounded CPU cache model", async () => {
	const raw = representativeBinary();
	assert.equal(raw.length, 15069189);
	assert.equal(raw.toString("base64").length, 20092252);
	const a = await modelFixture("legacy-15mib", raw),
		b = await modelFixture("base64-plus-peer", raw);
	assert.equal(a.result.ok, false);
	assert.equal(a.result.records[0].failureCategory, "protocol-body-evicted");
	assert.equal(b.result.ok, true);
	assert.equal(b.result.records[0].byteLength, raw.length);
	assert.equal(a.calls.length, 2);
	assert.equal(b.calls.length, 2);
});
test("larger transport cache never weakens decoded-size/SHA/status/matching body gates", async () => {
	const raw = representativeBinary();
	const wrongSha = await modelFixture("base64-plus-peer", raw, 0, {
		sha256: "0".repeat(64),
	});
	const wrongSize = await modelFixture("base64-plus-peer", raw, 0, {
		byteLength: raw.length - 1,
	});
	assert.equal(wrongSha.result.ok, false);
	assert.equal(wrongSize.result.ok, false);
	for (const byteLength of [binaryLimit + 1, 20 * 1024 * 1024]) {
		let sends = 0;
		await assert.rejects(
			observeProbeWasmHttp(
				{
					on() {},
					off() {},
					async send() {
						sends++;
					},
				},
				{ url: "exact", sha256: "0".repeat(64), byteLength },
				{ totalBufferProfile: "base64-plus-peer" },
			),
		);
		assert.equal(sends, 0);
	}
});
test("peer-cache overcapacity and unknown/unbounded profile fail closed with no fallback", async () => {
	const raw = representativeBinary(),
		over = await modelFixture("base64-plus-peer", raw, 40 * 1024 * 1024);
	assert.equal(over.result.ok, false);
	assert.equal(over.result.records[0].failureCategory, "protocol-body-evicted");
	assert.equal(over.calls.length, 2);
	for (const profile of ["unlimited", "__proto__", 1e12]) {
		let sends = 0;
		await assert.rejects(
			observeProbeWasmHttp(
				{
					on() {},
					off() {},
					async send() {
						sends++;
					},
				},
				{ url: "exact", sha256: "0".repeat(64), byteLength: 4 },
				{ totalBufferProfile: profile },
			),
			/Unknown bounded/,
		);
		assert.equal(sends, 0);
	}
});
