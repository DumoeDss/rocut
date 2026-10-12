import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { installFrostScheduleClockAdapter } from "./frost-schedule-clock-adapter.mjs";
import { FIXED_PARAMS, FROST_SCHEDULE_VERSION, TICKS, sha256 } from "./frost-schedule-fixture.mjs";

const [pkg, root, mode] = process.argv.slice(2);
assert.equal(process.argv.length, 5, "Expected fixedWasmPackage privateRoot advance|freeze");
assert(["advance", "freeze"].includes(mode));
const binary = fs.readFileSync(pkg + "/opencut_wasm_bg.wasm");
assert.equal(sha256(binary), "8afce2680db2514a6f0c01e2fc563506dadef2f73ab15dd0ddf47c82d01fea30");
const originalStringify = JSON.stringify;
const adapter = installFrostScheduleClockAdapter({ version: FROST_SCHEDULE_VERSION,
	params: FIXED_PARAMS, frozenTicks: 0, mode });
const report = { ok: false, mode, stage: "Actual immutable current production WASM/glue CPU calls, not rendering/GPU/encoder proof",
	binary: { path: pkg + "/opencut_wasm_bg.wasm", byteLength: binary.length, sha256: sha256(binary) }, responses: [] };
try {
	const glue = await import(pathToFileURL(pkg + "/opencut_wasm_bg.js"));
	const module = new WebAssembly.Module(binary), imports = {};
	for (const entry of WebAssembly.Module.imports(module)) imports[entry.module] = glue;
	const instance = await WebAssembly.instantiate(module, imports);
	glue.__wbg_set_wasm(instance.exports);
	instance.exports.__wbindgen_start();
	for (const ticks of TICKS) {
		const dto = { effectType: "frost", params: { ...FIXED_PARAMS }, localTime: ticks,
			frameRate: { numerator: 30, denominator: 1 } };
		const expectedDto = originalStringify(dto);
		const response = JSON.parse(glue.resolveStylizedEffectJson(JSON.stringify(dto)));
		assert(!response.error, response.error);
		assert.equal(originalStringify(dto), expectedDto);
		assert.equal(response.frameIndex, mode === "freeze" ? 0 : ticks / 4000);
		assert.equal(response.passes.length, 1);
		assert.equal(response.passes[0].shader, "frost");
		const uniforms = response.passes[0].uniforms;
		for (const key of ["amount", "coverage", "scale", "seed", "blur", "refraction", "tintStrength", "tintR", "tintG", "tintB"])
			assert.equal(uniforms[key], FIXED_PARAMS[key]);
		if (mode === "freeze") assert.equal(uniforms.strokeCount, 0);
		report.responses.push({ originalTicks: ticks, response });
	}
	assert.equal(adapter.state.serializations.length, 13);
	assert.equal(adapter.state.wasmCalls.length, 13);
	assert.deepEqual(adapter.state.errors, []);
	assert(adapter.state.serializations.every(record => record.dtoRestored && record.mutatedOnlyLocalTime));
	assert.deepEqual(adapter.state.wasmCalls.map(call => call.response), report.responses.map(row => row.response));
	report.ok = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
	adapter.restore();
	assert.equal(JSON.stringify, originalStringify);
	report.audit = adapter.state;
	report.intrinsicsRestored = true;
	fs.writeFileSync(root + "/actual-wasm-" + mode + ".json", JSON.stringify(report, null, 2) + "\n");
	console.log(JSON.stringify({ ok: report.ok, mode, calls: report.audit.wasmCalls.length, restored: report.intrinsicsRestored, error: report.error }));
}
