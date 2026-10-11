import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";
import {
	installGlassWasmObserver,
	assertGlassBrowserIdentity,
} from "./glass-current-baseline-observer.mjs";

// Actual valid module exporting an empty function, not fake instantiate behavior.
const bytes = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 5, 1, 1, 102,
	0, 0, 10, 4, 1, 2, 0, 11,
]);
const invalid = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sha256 = digest(bytes);
function createRealm(fetchImplementation = fetch) {
	const events = [],
		report = { served: [], loaded: [], errors: [] };
	const realm = {
		WebAssembly: Object.create(WebAssembly),
		ArrayBuffer,
		Uint8Array,
		URL,
		fetch: fetchImplementation,
		crypto: webcrypto,
		__rocutGlassWasmPin: async (entry) => {
			events.push(entry);
			if (entry.kind === "served") report.served.push(entry);
			else if (entry.kind === "loaded") report.loaded.push(entry);
			else if (entry.kind === "error") report.errors.push(entry);
			else throw Error("Unknown observer event");
		},
	};
	runInNewContext(`(${installGlassWasmObserver.toString()})();`, realm);
	return { realm, report, events };
}

test("Glass actual Response clone served and successful loaded byte witnesses", async (t) => {
	const server = createServer((request, response) => {
		response.writeHead(200, {
			"content-type": request.url.endsWith(".wasm")
				? "application/wasm"
				: "text/plain",
		});
		response.end(
			request.url.endsWith("invalid.wasm")
				? invalid
				: request.url.endsWith(".wasm")
					? bytes
					: "plain",
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	const base = `http://127.0.0.1:${server.address().port}/private-nonce-not-for-evidence/`;

	await t.test(
		"streaming records actual served bytes before successful init",
		async () => {
			const { realm, report, events } = createRealm();
			// An externally fetched Response is also pinned by the streaming hook.
			const response = await fetch(base + "authority.wasm");
			const result = await realm.WebAssembly.instantiateStreaming(response);
			assert.equal(result.instance.exports.f(), undefined);
			assert.equal(events[0].kind, "served");
			assert.equal(events[1].kind, "loaded");
			assert.equal(report.served[0].asset, "authority.wasm");
			assert.equal(report.served[0].sha256, sha256);
			assert.equal(report.loaded[0].bytes, report.served[0].bytes);
			assert.equal(
				assertGlassBrowserIdentity(report, sha256).linkedLoadedCount,
				1,
			);
			assert(!JSON.stringify(report).includes("private-nonce"));
		},
	);
	await t.test(
		"fetch plus streaming record two independently hashed response clones",
		async () => {
			const { realm, report } = createRealm();
			const response = await realm.fetch(base + "authority.wasm");
			await realm.WebAssembly.instantiateStreaming(response);
			assert.equal(report.served.length, 2);
			assert.deepEqual(
				report.served.map((entry) => entry.source),
				["fetch-response-clone", "instantiateStreaming-response-clone"],
			);
			for (const entry of report.served) {
				assert.equal(entry.sha256, sha256);
				assert.equal(entry.bytes, bytes.length);
			}
			assert.equal(
				assertGlassBrowserIdentity(report, sha256).loadedAuthority,
				true,
			);
		},
	);
	await t.test(
		"export nonstreaming fetch-arrayBuffer-compile-module instantiate",
		async () => {
			const { realm, report } = createRealm();
			const response = await realm.fetch(base + "authority.wasm");
			assert.equal(report.served.length, 1);
			assert.equal(
				report.loaded.length,
				0,
				"Served pin exists independently before init",
			);
			const module = await realm.WebAssembly.compile(
				await response.arrayBuffer(),
			);
			const instance = await realm.WebAssembly.instantiate(module);
			assert.equal(instance.exports.f(), undefined);
			assert.equal(report.served.length, 1);
			assert.equal(report.loaded[0].sha256, sha256);
			assert.equal(
				assertGlassBrowserIdentity(report, sha256).loadedAuthority,
				true,
			);
			assert.throws(
				() => assertGlassBrowserIdentity(report, "0".repeat(64)),
				/not observed/,
			);
			assert.throws(
				() => assertGlassBrowserIdentity({ ...report, served: [] }, sha256),
				/not observed/,
			);
			assert.throws(
				() => assertGlassBrowserIdentity({ ...report, loaded: [] }, sha256),
				/not successfully instantiated/,
			);
			assert.throws(
				() =>
					assertGlassBrowserIdentity(
						{
							...report,
							loaded: [{ ...report.loaded[0], bytes: bytes.length + 1 }],
						},
						sha256,
					),
				/not successfully instantiated/,
			);
		},
	);
	await t.test(
		"invalid native init retains served bytes but cannot write loaded success",
		async () => {
			for (const streaming of [true, false]) {
				const { realm, report } = createRealm();
				const response = await realm.fetch(base + "invalid.wasm");
				assert.equal(report.served[0].sha256, digest(invalid));
				if (streaming)
					await assert.rejects(
						realm.WebAssembly.instantiateStreaming(response),
					);
				else
					await assert.rejects(
						realm.WebAssembly.compile(await response.arrayBuffer()),
					);
				assert.equal(report.loaded.length, 0);
				assert.throws(
					() => assertGlassBrowserIdentity(report, digest(invalid)),
					/not successfully instantiated/,
				);
			}
		},
	);
	await t.test(
		"clone and body-read exceptions enter errors and cannot pass",
		async () => {
			for (const bodyFailure of [false, true]) {
				const { realm, report } = createRealm(async (...args) => {
					const response = await fetch(...args),
						clone = response.clone.bind(response);
					response.clone = () => {
						if (!bodyFailure) throw Error("clone witness negative");
						const value = clone();
						value.arrayBuffer = async () => {
							throw Error("body witness negative");
						};
						return value;
					};
					return response;
				});
				const response = await realm.fetch(base + "authority.wasm");
				const module = await realm.WebAssembly.compile(
					await response.arrayBuffer(),
				);
				const instance = await realm.WebAssembly.instantiate(module);
				assert.equal(
					instance.exports.f(),
					undefined,
					"Clone diagnostics must preserve native success",
				);
				assert.equal(report.errors.length, 1);
				assert.throws(
					() => assertGlassBrowserIdentity(report, sha256),
					/observer failed/,
				);
			}
		},
	);
	await t.test(
		"BufferSource hashing errors stay fatal without changing native success",
		async () => {
			const { realm, report } = createRealm();
			await realm.fetch(base + "authority.wasm");
			realm.crypto = {
				subtle: {
					async digest() {
						throw Error("hash witness negative");
					},
				},
			};
			const instance = await realm.WebAssembly.instantiate(bytes);
			assert.equal(instance.instance.exports.f(), undefined);
			assert.equal(report.errors.length, 1);
			assert.equal(report.loaded[0].unknownModuleBytes, true);
			assert.throws(
				() => assertGlassBrowserIdentity(report, sha256),
				/observer failed/,
			);
		},
	);
	await t.test(
		"actual aborted WASM fetch error remains fatal and non-WASM is untouched",
		async () => {
			const { realm, report } = createRealm();
			const abort = new AbortController();
			abort.abort();
			await assert.rejects(
				realm.fetch(base + "authority.wasm", { signal: abort.signal }),
			);
			assert.equal(report.errors.length, 1);
			assert.throws(
				() => assertGlassBrowserIdentity(report, sha256),
				/observer failed/,
			);
			const untouched = createRealm(async (...args) => {
				const response = await fetch(...args);
				response.clone = () => {
					throw Error("Must not clone non-WASM response");
				};
				return response;
			});
			assert.equal(
				await (await untouched.realm.fetch(base + "plain.txt")).text(),
				"plain",
			);
			assert.equal(untouched.events.length, 0);
		},
	);
	await t.test(
		"unknown precompiled modules never promote to identified loaded bytes",
		async () => {
			const { realm, report } = createRealm();
			await realm.fetch(base + "authority.wasm");
			const unknown = await WebAssembly.compile(bytes);
			const instance = await realm.WebAssembly.instantiate(unknown);
			assert.equal(instance.exports.f(), undefined);
			assert.equal(report.loaded[0].unknownModuleBytes, true);
			assert.equal(report.loaded[0].sha256, undefined);
			assert.throws(
				() => assertGlassBrowserIdentity(report, sha256),
				/not successfully instantiated/,
			);
		},
	);
});
