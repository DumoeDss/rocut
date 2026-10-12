import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRequiredProbeWasmBinding } from "./fixtures/browser-probe-identity.mjs";

export const productionWasmSha256 =
	"362d29a7dba0b29fcf00965a5eba5342e70acd334c7171e2b73ca8ff06eb75be";
export const productionWasmDirectory =
	"C:/Users/Sayo/AppData/Local/Temp/rocut-wasm-lf-preparation-20261011-9ad208e4/browser-pkg-lf-v1";

/** Production authority is not the separately opted-in Liquid readback build. */
export function resolveProductionProbeWasm(env = process.env) {
	const expectedWasmSha256 =
		env.ROCUT_PROBE_WASM_SHA256 ?? productionWasmSha256;
	assert.equal(
		expectedWasmSha256,
		productionWasmSha256,
		"Production authority override differs",
	);
	const binding = resolveRequiredProbeWasmBinding({
		directory: env.ROCUT_TEST_WASM_DIRECTORY ?? productionWasmDirectory,
		expectedWasmSha256,
	});
	assert.equal(
		binding.identity.files.find((file) => file.name === "opencut_wasm.js")
			.sha256,
		"cc62ca83fb09032be1bf5427a156f572587ef21cc6a6c185d4743ac4fe7ddb39",
		"Production initializer differs",
	);
	assert(
		!/\bapplyEffectPassesReadback\b/.test(
			new TextDecoder("utf-8", { fatal: true }).decode(
				readFileSync(binding.entry),
			),
		),
		"Diagnostic exports cannot be production authority",
	);
	return binding;
}
