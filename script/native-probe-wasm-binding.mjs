import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { productionWasmSha256 } from "./production-probe-wasm.mjs";

export const legacyNativeWasmDirectory =
	"C:/tmps/liquid-object-wasm-development-35IsB3/pkg";
export const legacyNativeWasmSha256 =
	"7f7dba6b40fa79618d1e2f7fedab82e1731dee9c26564796f597bf31758b349c";
const files = [
	"package.json",
	"opencut_wasm.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_sync.js",
	"opencut_wasm_bg.wasm",
	"opencut_wasm.d.ts",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });
const GLUE_EXPORT = /export\s+(?:function|const|let|var|class)\s+(\w+)/g;

/** Only the archived default and fixed production authority are acceptance lanes. */
export function resolveNativeProbeWasm({ directory, env = process.env } = {}) {
	const configured = env.ROCUT_TEST_LIQUID_WASM_DIR;
	const fallback =
		configured === undefined ? legacyNativeWasmDirectory : configured;
	const selected = directory === undefined ? fallback : directory;
	assert(
		typeof selected === "string" && isAbsolute(selected),
		"Native probe requires an explicit absolute package directory",
	);
	if (directory !== undefined && configured !== undefined) {
		assert(
			typeof configured === "string" && isAbsolute(configured),
			"Native override directory must be absolute",
		);
		assert.equal(
			realpathSync(selected),
			realpathSync(configured),
			"Native argv and environment package differ",
		);
	}
	const legacy =
		configured === undefined &&
		env.ROCUT_TEST_LIQUID_WASM_SHA256 === undefined &&
		selected.replaceAll("\\", "/") === legacyNativeWasmDirectory;
	const expected = legacy ? legacyNativeWasmSha256 : productionWasmSha256;
	if (env.ROCUT_TEST_LIQUID_WASM_SHA256 !== undefined)
		assert.equal(
			env.ROCUT_TEST_LIQUID_WASM_SHA256,
			productionWasmSha256,
			"Native production authority override differs",
		);
	assert(
		!env.ROCUT_LIQUID_READBACK_PKG,
		"Diagnostic readback package cannot be object production authority",
	);
	return readNativeProbeWasm({
		directory: selected,
		wasmSha256: expected,
		lane: legacy ? "legacy" : "production",
	});
}

function readNativeProbeWasm({ directory, wasmSha256: expected, lane }) {
	const physical = realpathSync(directory),
		bytes = new Map();
	assert(statSync(physical).isDirectory(), "Native package is not a directory");
	const identity = files.map((name) => {
		const path = join(physical, name);
		assert(statSync(path).isFile(), `Native package missing file: ${name}`);
		const source = readFileSync(path);
		assert(source.length > 0, `Native package empty file: ${name}`);
		bytes.set(name, source);
		return { name, bytes: source.length, sha256: hash(source) };
	});
	const manifest = JSON.parse(decoder.decode(bytes.get("package.json")));
	assert.equal(manifest.name, "opencut-wasm");
	assert.equal(manifest.type, "module");
	assert.equal(
		manifest.exports?.["./sync"]?.default,
		"./opencut_wasm_sync.js",
		"Native package sync declaration differs",
	);
	assert.equal(
		manifest.exports?.["."]?.default,
		"./opencut_wasm.js",
		"Native package browser declaration differs",
	);
	const sync = decoder.decode(bytes.get("opencut_wasm_sync.js"));
	const asyncEntry = decoder.decode(bytes.get("opencut_wasm.js"));
	const glue = decoder.decode(bytes.get("opencut_wasm_bg.js"));
	decoder.decode(bytes.get("opencut_wasm.d.ts"));
	assert.match(
		sync,
		/readFileSync\(\s*new URL\(\s*["']\.\/opencut_wasm_bg\.wasm["']\s*,\s*import\.meta\.url/,
		"Native sync must load its fixed WASM sibling",
	);
	assert.match(
		asyncEntry,
		/from\s*["']\.\/opencut_wasm_bg\.wasm["']/,
		"Native browser must load its fixed WASM sibling",
	);
	assert.equal(
		identity.find((item) => item.name.endsWith(".wasm")).sha256,
		expected,
		"Native WASM binary differs from authority",
	);
	const binary = new WebAssembly.Module(bytes.get("opencut_wasm_bg.wasm"));
	const exports = new Set(
		WebAssembly.Module.exports(binary).map((item) => item.name),
	);
	for (const name of new Set(
		[...glue.matchAll(/\bwasm\.(\w+)/g)].map((match) => match[1]),
	))
		assert(exports.has(name), `Native glue ABI missing binary export: ${name}`);
	const glueExports = new Set(
		[...glue.matchAll(GLUE_EXPORT)].map((match) => match[1]),
	);
	for (const entry of [sync, asyncEntry]) {
		const reexport = entry.match(
			/export\s*\{([^}]+)\}\s*from\s*["']\.\/opencut_wasm_bg\.js["']/,
		);
		const names = new Set(
			reexport?.[1].split(",").map((name) => name.trim()) ?? [],
		);
		for (const name of [
			"resolveInkObjectParamsJson",
			"resolveLiquidObjectParamsJson",
			"evaluateLiquidObjectFrameJson",
			"liquidObjectTransportPolicyJson",
			"LiquidObjectTransportOwner",
		])
			assert(
				names.has(name) && glueExports.has(name),
				`Native public object ABI missing: ${name}`,
			);
	}
	for (const item of WebAssembly.Module.imports(binary))
		assert(
			item.module === "./opencut_wasm_bg.js" && glueExports.has(item.name),
			`Native binary import missing glue: ${item.name}`,
		);
	return {
		directory: physical,
		entry: join(physical, "opencut_wasm.js"),
		syncEntry: join(physical, "opencut_wasm_sync.js"),
		wasmSha256: expected,
		lane,
		identity,
	};
}

export function assertNativeProbeWasmIdentity(binding, observed) {
	if (arguments.length === 1) observed = binding.identity;
	assert.deepEqual(observed, binding.identity, "Native identity differs");
	const current = readNativeProbeWasm(binding);
	assert.deepEqual(
		current.identity,
		binding.identity,
		"Native package changed during probe",
	);
}
