import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRequiredProbeWasmBinding } from "./fixtures/browser-probe-identity.mjs";

export const productionWasmSha256 =
	"4256dce59571c721b8f9d13b04aba6d9e8ef835f33376515850c92c716ef7a3d";
// 2026-11-11: re-pinned from the frozen 2026-10-11 preparation directory to the
// repository's own canonical build output, so any clean clone that runs
// `node script/build-wasm.mjs` reproduces the authority instead of a path that
// only existed on the machine that recorded the previous lane.
export const productionWasmDirectory = new URL(
	"../rust/wasm/pkg/",
	import.meta.url,
).pathname;

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
		"bdab4576f790ffe9aa146aaac0c4c7aa82159d24689d6296e56c133a748a0a72",
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
