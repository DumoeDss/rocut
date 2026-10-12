import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { test } from "node:test";
import { installParticleAuthorityBrowserObserver } from "./particle-editor-export-authority-browser.mjs";

const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const sha = createHash("sha256").update(bytes).digest("hex");
function realm(overrides = {}) {
	return {
		ArrayBuffer,
		crypto: webcrypto,
		WebAssembly: {
			Module: WebAssembly.Module,
			Instance: WebAssembly.Instance,
			compile: WebAssembly.compile,
			compileStreaming: WebAssembly.compileStreaming,
			instantiate: WebAssembly.instantiate,
			instantiateStreaming: WebAssembly.instantiateStreaming,
			...overrides,
		},
	};
}
test("real CPU WASM instantiate records actual byte range without changing promise result", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	const padded = new Uint8Array(12);
	padded.set(bytes, 2);
	const result = await r.WebAssembly.instantiate(padded.subarray(2, 10));
	assert.ok(result.instance instanceof WebAssembly.Instance);
	const evidence = await observer.assertConsumed();
	assert.equal(evidence.events[0].byteLength, 8);
	assert.equal(evidence.events[0].sha256, sha);
	assert.equal(evidence.consumedCount, 1);
	observer.restore();
});
test("compile to Module retains actual byte proof for later native instantiate", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	const module = await r.WebAssembly.compile(bytes);
	const instance = await r.WebAssembly.instantiate(module);
	assert.ok(instance instanceof WebAssembly.Instance);
	assert.equal((await observer.assertConsumed()).events[1].inputKind, "module");
	observer.restore();
});
test("synchronous sync-package Module/Instance constructors retain actual bytes", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	const module = new r.WebAssembly.Module(bytes);
	const instance = new r.WebAssembly.Instance(module);
	assert.ok(module instanceof WebAssembly.Module);
	assert.ok(instance instanceof WebAssembly.Instance);
	assert.equal(
		(await observer.assertConsumed()).events[1].operation,
		"Instance",
	);
	observer.restore();
});
test("pending native operations do not make diagnostic snapshots wait indefinitely", async () => {
	const r = realm({
		instantiate() {
			return new Promise(() => {});
		},
	});
	const observer = installParticleAuthorityBrowserObserver({
		realm: r,
		expectedWasmSha256: sha,
	});
	r.WebAssembly.instantiate(bytes);
	assert.equal(
		(await observer.snapshot({ timeoutMs: 50 })).actualBytesVerified,
		false,
	);
	observer.restore();
});
test("unobserved Module cannot be guessed from a matching served or built binary", async () => {
	const module = await WebAssembly.compile(bytes),
		r = realm();
	const observer = installParticleAuthorityBrowserObserver({
		realm: r,
		expectedWasmSha256: sha,
	});
	assert.ok(
		(await r.WebAssembly.instantiate(module)) instanceof WebAssembly.Instance,
	);
	await assert.rejects(observer.assertConsumed(), /missing or differ/);
	assert.match((await observer.snapshot()).errors[0], /Unobserved/);
	observer.restore();
});
test("wrong valid actual binary rejects despite successful native instantiation", async () => {
	const wrong = Uint8Array.from([...bytes, 0, 1, 0]),
		r = realm();
	const observer = installParticleAuthorityBrowserObserver({
		realm: r,
		expectedWasmSha256: sha,
	});
	assert.ok(
		(await r.WebAssembly.instantiate(wrong)).instance instanceof
			WebAssembly.Instance,
	);
	await assert.rejects(observer.assertConsumed());
	observer.restore();
});
test("streaming observation clones response and supports native fallback buffer", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	const response = new Response(bytes, {
		headers: { "content-type": "application/wasm" },
	});
	assert.ok(
		(await r.WebAssembly.instantiateStreaming(response)).instance instanceof
			WebAssembly.Instance,
	);
	assert.equal(response.bodyUsed, true);
	assert.equal((await observer.assertConsumed()).events[0].sha256, sha);
	observer.restore();
	const fallback = realm(),
		second = installParticleAuthorityBrowserObserver({
			realm: fallback,
			expectedWasmSha256: sha,
		});
	await assert.rejects(
		fallback.WebAssembly.instantiateStreaming(
			new Response(bytes, { headers: { "content-type": "text/plain" } }),
		),
	);
	await fallback.WebAssembly.instantiate(bytes);
	assert.equal((await second.assertConsumed()).consumedCount, 1);
	second.restore();
});
test("streaming compile then Module instantiate inherits consumed byte proof", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	const module = await r.WebAssembly.compileStreaming(
		new Response(bytes, { headers: { "content-type": "application/wasm" } }),
	);
	await r.WebAssembly.instantiate(module);
	assert.equal((await observer.assertConsumed()).consumedCount, 1);
	observer.restore();
});
test("observer preserves exact original promise, receiver, arguments and synchronous throw", async () => {
	const originalPromise = Promise.resolve({ instance: {} });
	let receiver, arg;
	const r = realm({
		instantiate(input) {
			receiver = this;
			arg = input;
			return originalPromise;
		},
	});
	const observer = installParticleAuthorityBrowserObserver({
		realm: r,
		expectedWasmSha256: sha,
	});
	assert.equal(r.WebAssembly.instantiate(bytes), originalPromise);
	assert.equal(receiver, r.WebAssembly);
	assert.equal(arg, bytes);
	await observer.assertConsumed();
	observer.restore();
	const error = Error("original throw"),
		throws = realm({
			instantiate() {
				throw error;
			},
		});
	const failed = installParticleAuthorityBrowserObserver({
		realm: throws,
		expectedWasmSha256: sha,
	});
	assert.throws(
		() => throws.WebAssembly.instantiate(bytes),
		(value) => value === error,
	);
	assert.equal((await failed.snapshot()).events[0].status, "rejected");
	failed.restore();
});
test("missing proof, duplicate observer and changed hooks never claim verified bytes", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	await assert.rejects(observer.assertConsumed());
	assert.throws(
		() =>
			installParticleAuthorityBrowserObserver({
				realm: r,
				expectedWasmSha256: sha,
			}),
		/already installed/,
	);
	r.WebAssembly.instantiate = () => {};
	assert.throws(() => observer.restore(), /hook changed/);
});
test("changed hook after successful native instantiation invalidates final proof", async () => {
	const r = realm(),
		observer = installParticleAuthorityBrowserObserver({
			realm: r,
			expectedWasmSha256: sha,
		});
	await r.WebAssembly.instantiate(bytes);
	assert.equal((await observer.assertConsumed()).actualBytesVerified, true);
	r.WebAssembly.compile = WebAssembly.compile;
	assert.equal((await observer.snapshot()).actualBytesVerified, false);
	await assert.rejects(observer.assertConsumed());
});
