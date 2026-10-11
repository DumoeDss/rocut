// Read-only actual binary/initializer/resolver witness. No mock.module or fake API.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { join, isAbsolute, basename } from "node:path";
import { pathToFileURL } from "node:url";

const directory = process.env.ROCUT_GLASS_HOST_WASM_DIRECTORY;
const expected = process.env.ROCUT_GLASS_EXPECTED_WASM_SHA256;
const receipt = process.env.ROCUT_GLASS_HOST_PIN_RECEIPT;
assert(isAbsolute(directory ?? "") && isAbsolute(receipt ?? ""));
assert(/^host-pins-(editor|export)\.json$/.test(basename(receipt)));
const root = await realpath(directory);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const binary = await readFile(join(root, "opencut_wasm_bg.wasm"));
assert.equal(hash(binary), expected);
const modules = new WeakMap(),
	initialized = [];
const OriginalModule = WebAssembly.Module,
	OriginalInstance = WebAssembly.Instance;
const report = {
	ok: false,
	pid: process.pid,
	runtime: process.versions.bun
		? "Host Bun preload"
		: "export Host Node preload",
	entry: join(root, "opencut_wasm_sync.js"),
	expectedSha256: expected,
	scope:
		"Actual explicit sync entry initialization byte witness plus genuine Rust Glass resolver invocation; no replacement exports. This is not a standalone capture-browser loaded-WASM witness.",
};
try {
	WebAssembly.Module = new Proxy(OriginalModule, {
		construct(target, args) {
			const value = args[0];
			const bytes = ArrayBuffer.isView(value)
				? Buffer.from(
						new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
					)
				: Buffer.from(new Uint8Array(value));
			const module = Reflect.construct(target, args);
			modules.set(module, { bytes: bytes.length, sha256: hash(bytes) });
			return module;
		},
	});
	WebAssembly.Instance = new Proxy(OriginalInstance, {
		construct(target, args) {
			const instance = Reflect.construct(target, args);
			initialized.push({
				...(modules.get(args[0]) ?? { unknownModuleBytes: true }),
				success: true,
			});
			return instance;
		},
	});
	const actual = await import(pathToFileURL(report.entry).href);
	assert(
		initialized.some((item) => item.sha256 === expected && item.success),
		"Explicit Host initialization did not consume expected bytes",
	);
	const input = JSON.stringify({
		version: 1,
		transmission: 0.35,
		ior: 1.5,
		thickness: 0.5,
		roughness: 0.05,
		dispersion: 0.05,
		environmentIntensity: 1,
	});
	const output = actual.resolveGlassObjectParamsJson(input);
	const parsed = JSON.parse(output);
	assert.equal(parsed.ok, true);
	assert.equal(parsed.params.transmission, 0.35);
	report.resolverInvocation = {
		name: "resolveGlassObjectParamsJson",
		inputSha256: hash(input),
		outputSha256: hash(output),
		ok: true,
		transmission: parsed.params.transmission,
	};
	report.initialized = initialized;
	report.wasmUnchanged =
		hash(await readFile(join(root, "opencut_wasm_bg.wasm"))) === expected;
	assert(report.wasmUnchanged);
	report.ok = true;
} catch (error) {
	report.failure = String(error);
	throw error;
} finally {
	WebAssembly.Module = OriginalModule;
	WebAssembly.Instance = OriginalInstance;
	await writeFile(receipt, JSON.stringify(report, null, 2) + "\n", {
		flag: "wx",
	});
}
