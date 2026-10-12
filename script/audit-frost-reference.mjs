import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditFrostReferenceCapture } from "./fixtures/frost-reference-gpu-audit.mjs";

const root = resolve(process.argv[2] ?? "");
const checkOnly = process.argv[3] === "--check";
assert(
	process.argv[2] && (process.argv[3] === undefined || checkOnly),
	"Usage: node script/audit-frost-reference.mjs <capture-directory> [--check]",
);
const bytes = await readFile(join(root, "capture-receipt.json"));
const capture = JSON.parse(bytes);
assert.equal(capture.ok, true);
assert.equal(capture.inputsUnchanged, true);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = (value) => new Uint8Array(Buffer.from(value, "base64"));
const modes = Object.fromEntries(
	capture.modes.map((mode) => [mode.label, mode]),
);
for (const mode of Object.values(modes)) {
	assert.equal(mode.ok, true);
	assert.equal(mode.capture.ok, true);
	assert.equal(mode.capture.backend, "webgl");
	assert.equal(mode.capture.gpuDisposed, true);
	assert.equal(mode.capture.queryFreed, true);
	assert.equal(mode.cleanup.browserClosed, true);
	assert.equal(mode.cleanup.serverClosed, true);
}
assert.deepEqual(Object.keys(modes).sort(), ["default", "diagnostic"]);
const defaults = new Map(
	modes.default.capture.records.map((item) => [item.id, item]),
);
assert.equal(defaults.size, 10);
assert.equal(modes.diagnostic.capture.records.length, 10);
const binaryArtifacts = {
	"source.rgba": new Uint8Array(await readFile(join(root, "source.rgba"))),
	"canonical-source.rgba": decode(modes.default.capture.canonicalSource),
};
assert.deepEqual(
	decode(modes.diagnostic.capture.canonicalSource),
	binaryArtifacts["canonical-source.rgba"],
);
const records = modes.diagnostic.capture.records.map((item) => {
	const normal = defaults.get(item.id);
	assert(normal);
	assert.equal(item.passCount, normal.passCount);
	assert.deepEqual(item.actualResolution, normal.actualResolution);
	const record = { id: item.id, passCount: item.passCount };
	if (!item.passCount) {
		record.fixtureRgba = decode(item.fixtureRgba);
		assert.deepEqual(record.fixtureRgba, decode(normal.fixtureRgba));
	} else {
		assert.equal(item.format, item.canonicalFormat);
		assert(["rgba8unorm", "bgra8unorm"].includes(item.format));
		record.defaultCanvasRgba = decode(normal.canvasRgba);
		record.diagnosticCanvasRgba = decode(item.canvasRgba);
		for (const name of [
			"nativeRgba",
			"canonicalNativeRgba",
			"rawCanvasRgba",
			"readbackCanvasRgba",
		])
			record[name] = decode(item[name]);
	}
	for (const [field, pixels] of Object.entries(record))
		if (pixels instanceof Uint8Array)
			binaryArtifacts[`${item.id}.${field}.rgba`] = pixels;
	return record;
});
const result = auditFrostReferenceCapture({
	source: binaryArtifacts["source.rgba"],
	canonicalSource: binaryArtifacts["canonical-source.rgba"],
	records,
});
const artifacts = {};
for (const [name, pixels] of Object.entries(binaryArtifacts)) {
	// Source already belongs to capture; all newly decoded artifacts are create-only.
	if (!checkOnly && name !== "source.rgba")
		await writeFile(join(root, name), pixels, { flag: "wx" });
	artifacts[name] = { bytes: pixels.length, sha256: hash(pixels) };
}
const report = {
	...result,
	captureSha256: hash(bytes),
	artifacts,
	actualResolverPairExact: true,
	actualRawAndCanonicalFormatEqual: true,
	backend: "webgl",
	softwareRenderer:
		"SwiftShader requested by launch flags; independent adapter vendor not captured",
	actualRejectionRecovery: modes.diagnostic.capture.recovery,
	actualArbitrarySeek: capture.modes.map((mode) => ({
		label: mode.label,
		seek: mode.capture.seek,
	})),
	notClaimed: [
		"Editor or encoded video quality",
		"Installed app",
		"Hardware or WebGPU",
		"Diagnostic texture loss or OOM fault injection",
	],
};
if (!checkOnly)
	await writeFile(
		join(root, "audit-receipt.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
console.log(
	JSON.stringify({
		ok: report.ok,
		root,
		metrics: report.allmetrics.length,
		hardChecks: Object.keys(report.hardInvariants).length,
		failures: report.failures,
	}),
);
if (!report.ok) process.exitCode = 1;
