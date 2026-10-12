import { strict as assert } from "node:assert";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { resolveHtmlProbeWasmBinding } from "../html-probe-wasm-binding.mjs";

/** An explicit empty/bad value is an error, never permission to use defaults. */
export function resolveProbeBrowserExecutable({ configured, fallback }) {
	const executable = configured === undefined ? fallback : configured;
	assert.ok(typeof executable === "string" && isAbsolute(executable), "Explicit probe browser must be an absolute existing executable");
	const resolved = realpathSync(executable);
	assert.ok(statSync(resolved).isFile() && statSync(resolved).size > 0, "Probe browser executable is empty or not a file");
	return resolved;
}

/** Require a web initializer; a legacy bundler package must not silently pass. */
export function resolveRequiredProbeWasmBinding({ directory, expectedWasmSha256 }) {
	assert.ok(typeof directory === "string" && isAbsolute(directory), "Probe requires an explicit nonempty private WASM directory");
	const binding = resolveHtmlProbeWasmBinding(directory);
	const entry = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(binding.entry));
	assert.match(entry, /export default async function /, "Probe requires a genuine asynchronous web WASM initializer, not a legacy bundler entry");
	if (expectedWasmSha256 !== undefined) {
		assert.match(expectedWasmSha256, /^[a-f0-9]{64}$/, "Expected probe WASM SHA256 must be explicit and nonempty");
		assert.equal(binding.identity.files.find((file) => file.name.endsWith(".wasm")).sha256, expectedWasmSha256, "Probe WASM binary differs from expected identity");
	}
	return binding;
}
