import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiNames, constantDifference, wireJson } from "./animation-scalar-reference.mjs";
import { sampleCases, errorCases } from "./animation-scalar-cases.mjs";
import { inspectCases } from "./animation-scalar-inspect-cases.mjs";
import { checkResponse } from "./animation-scalar-checks.mjs";
import { parseArguments, createIO, loadGeneratedWasm } from "./animation-scalar-io.mjs";

const fixtureNames = ["reference", "cases", "inspect-cases", "checks", "io", "roundtrip", "static.test"];
const text = value => JSON.stringify(value, null, 2) + "\n";

export async function runRoundtrip(options) {
	const io = await createIO(options), cases = [], failures = [];
	let generated;
	try {
		for (const name of fixtureNames) await io.read(join(dirname(fileURLToPath(import.meta.url)), `animation-scalar-${name}.mjs`));
		await io.tree(dirname(options.jsPath));
		await io.read(options.wasmPath);
		for (const name of ["animation_boundary", "animation_numeric"]) await io.tree(join(options.sourceRoot, "rust/crates/editor-api/src", name));
		for (const name of ["rust/crates/editor-api/src/animation_bridge.rs", "rust/crates/editor-api/src/lib.rs",
			"rust/crates/editor-api/tests/animation_boundary_contract.rs", "rust/crates/editor-api/tests/animation_numeric_contract.rs",
			"rust/crates/bridge/src/bridge.rs", "packages/editor-classic/src/animation/interpolation.ts",
			"packages/editor-classic/src/animation/bezier.ts"]) await io.read(join(options.sourceRoot, name));
		if (options.buildEvidence) await io.read(options.buildEvidence);
		await io.write("input-hashes-before.json", text([...io.inputs.values()]));
		generated = await loadGeneratedWasm(options, io);
		const specs = [...sampleCases(), ...errorCases(), ...inspectCases()];
		assert.equal(new Set(specs.map(spec => spec.name)).size, specs.length);
		for (const [index, spec] of specs.entries()) {
			const prefix = `${String(index).padStart(3, "0")}-${spec.name}`;
			const request = await io.write(prefix + "-request.json", spec.input);
			const expected = await io.write(prefix + "-expectations.json", text(spec.expected));
			let response, result, checked;
			const started = performance.now();
			try {
				response = generated.bindings[apiNames[spec.api]](spec.input);
				assert.equal(typeof response, "string");
				result = await io.write(prefix + "-response.json", response);
				checked = checkResponse(spec, response);
				const checks = await io.write(prefix + "-checks.json", text(checked));
				cases.push({ name: spec.name, api: apiNames[spec.api], ok: true, request, expected, result, checks,
					durationMs: performance.now() - started });
			} catch (error) {
				const failure = { name: spec.name, api: apiNames[spec.api], ok: false, request, expected, result,
					message: String(error), stack: error.stack, durationMs: performance.now() - started };
				failures.push(failure); cases.push(failure);
				await io.write(prefix + "-failure.json", text(failure));
			}
		}
	} catch (error) {
		failures.push({ stage: "setup", message: String(error), stack: error.stack });
	}
	const unchanged = await io.unchanged();
	if (!unchanged.ok) failures.push({ stage: "input-integrity", changed: unchanged.changed });
	const inputManifest = await io.write("input-hashes-after.json", text([...io.inputs.values()]));
	const difference = constantDifference();
	const constantObservation = { ...difference, item: JSON.parse(wireJson(difference.item)),
		wasmCaseName: "explicit-v1-constant-rule",
		note: "v1 returns a constant only when all four controls compare equal. Legacy TS arithmetic may differ; general legacy bit parity is not asserted." };
	const summary = { cases: cases.length, passed: cases.filter(item => item.ok).length, failures: failures.length,
		wasmInstantiated: generated !== undefined, publicExportsCalled: cases.length > 0 };
	const report = { ok: failures.length === 0, kind: "real-wasm-scalar-json-roundtrip", summary,
		options, generated: generated?.provenance, inputManifest, unchanged, constantObservation, cases, failures,
		limitations: [
			"Finite fixture corpus only; this does not prove legacy runtime migration or domain admission is complete.",
			"Independent JS sampling reference follows existing TS arithmetic and the explicitly declared v1 constant-control rule; it never calls Rust to compute expected values.",
			"Safe inspection has bounded contract assertions and independent point checks, not a second complete domain-certificate implementation.",
			"Signed local f64 times are not clip/frame/retime conversions. Input String capacity beyond its byte length cannot be manufactured through this JS boundary.",
			"Source and generated package hashes are recorded; associating compiled bytes with source requires the separately supplied build evidence.",
			"No GPU/browser/editor runtime was exercised; call durations are diagnostics, not performance acceptance.",
		] };
	const review = await io.write("report.json", text(report));
	const handoff = await io.write("handoff.json", text({ ok: report.ok, output: io.output, review, summary, limitations: report.limitations }));
	return { ok: report.ok, output: io.output, review, handoff, summary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const result = await runRoundtrip(parseArguments(process.argv.slice(2)));
		console.log(text(result));
		if (!result.ok) process.exitCode = 1;
	} catch (error) {
		console.error(String(error)); process.exitCode = 1;
	}
}
