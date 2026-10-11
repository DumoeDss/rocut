import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
	installGlassWasmObserver,
	assertGlassBrowserIdentity,
} from "./glass-current-baseline-observer.mjs";

test("Glass observer sees actual successful WASM bytes and rejects wrong or empty identity", async () => {
	// Actual valid module exporting an empty function; not fake instantiate behavior.
	const bytes = new Uint8Array([
		0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 5, 1, 1, 102,
		0, 0, 10, 4, 1, 2, 0, 11,
	]);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const loaded = [];
	const realm = {
		WebAssembly: Object.create(WebAssembly),
		ArrayBuffer,
		Uint8Array,
		crypto: webcrypto,
		__rocutGlassWasmPin: async (entry) => loaded.push(entry),
		bytes,
	};
	runInNewContext(`(${installGlassWasmObserver.toString()})();`, realm);
	const result = await realm.WebAssembly.instantiate(bytes);
	assert.equal(result.instance.exports.f(), undefined);
	assert.equal(loaded[0].sha256, sha256);
	const module = await realm.WebAssembly.compile(bytes);
	await realm.WebAssembly.instantiate(module);
	assert.equal(loaded[1].sha256, sha256);
	const served = [{ sha256, bytes: bytes.length, status: 200 }];
	assert.equal(
		assertGlassBrowserIdentity({ served, loaded, errors: [] }, sha256)
			.loadedAuthority,
		true,
	);
	assert.throws(
		() =>
			assertGlassBrowserIdentity(
				{ served, loaded, errors: [] },
				"0".repeat(64),
			),
		/not observed/,
	);
	assert.throws(
		() =>
			assertGlassBrowserIdentity(
				{ served: [], loaded: [], errors: [] },
				sha256,
			),
		/not observed/,
	);
	assert.throws(
		() =>
			assertGlassBrowserIdentity({ served, loaded: [], errors: [] }, sha256),
		/not successfully instantiated/,
	);
	assert.throws(
		() =>
			assertGlassBrowserIdentity(
				{ served, loaded, errors: ["body read failed"] },
				sha256,
			),
		/observer failed/,
	);
	const count = loaded.length;
	await assert.rejects(
		realm.WebAssembly.instantiate(new Uint8Array([0, 1, 2])),
	);
	assert.equal(
		loaded.length,
		count,
		"Failed instantiate must not produce loaded success",
	);
});
