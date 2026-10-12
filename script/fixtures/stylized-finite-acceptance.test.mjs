import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditFiniteClaims } from "./stylized-finite-acceptance.mjs";
import { collectFiniteEvidencePins } from "./finite-evidence-pins.mjs";

const names = {
	bubble: "bubble-current-standalone-export.json",
	canvas: "canvas-current-author-export.json",
	lifecycle: "canvas-current-capture-lifecycle.json",
	material: "canvas-material-reference-gpu.json",
	flameCurrent: "flame-current-admission-export.json",
	frost: "frost-finite-scope-current.json",
};
function inputs() {
	return Object.fromEntries(Object.entries(names).map(([key, name]) => [
		key, JSON.parse(readFileSync(new URL(`../../docs/evidence/${name}`, import.meta.url), "utf8")),
	]));
}
test("bounded executed claims pass without claiming release or clean startup diagnostics", () => {
	const result = auditFiniteClaims(inputs());
	assert.match(result.bubble, /^accepted-bounded/);
	assert.match(result.canvas, /^accepted-bounded/);
	assert.match(result.flameWrap, /^accepted-bounded/);
	assert.match(result.frost, /^accepted-bounded/);
	assert.equal(result.installedOrRelease, false);
});
test("reject relabeled Frost temporal controls, missing history and weakened alpha scope", () => {
	for (const mutate of [
		(data) => { data.frost.scheduleClock.jobs[1].encodedTemporal[0].accepted = true; },
		(data) => { data.frost.ui.transactions[0].completeClipUndoRedo = false; },
		(data) => { data.frost.transparentRender.allAlphaErrors = 1; },
		(data) => { data.frost.opaqueVideo.pixelAcceptance.allFramesIdentifiable = true; },
	]) {
		const data = inputs(); mutate(data); assert.throws(() => auditFiniteClaims(data));
	}
});
test("reject a failed job, missing chroma target, relaxed threshold and relabeled original failure", () => {
	for (const mutate of [
		(data) => { data.bubble.correctedSupplement.jobs[0].accepted = false; },
		(data) => { data.bubble.correctedSupplement.jobs[0].key = "duplicate"; },
		(data) => { data.bubble.correctedSupplement.gates.enabledActiveRgbMaximum = 16; },
		(data) => { data.bubble.originalFailure.accepted = true; },
	]) {
		const data = inputs(); mutate(data); assert.throws(() => auditFiniteClaims(data));
	}
});
test("reject missing persistence, weak active masks, output error and stale publication", () => {
	for (const mutate of [
		(data) => { data.canvas.sameProject.authorSavedExportBeforeAfterAndParityAfterBytesIdentical = false; },
		(data) => { data.canvas.previewParityLayer.activePixels[0] = 47; },
		(data) => { data.canvas.previewParityLayer.maxActiveRgb = 6.01; },
		(data) => { data.canvas.previewParityLayer.allPublicationSerialsFresh = false; },
	]) {
		const data = inputs(); mutate(data); assert.throws(() => auditFiniteClaims(data));
	}
});
test("reject unseen pending cancellation, early reads and missing timer retirement", () => {
	for (const mutate of [
		(data) => { data.lifecycle.cases[0].pending.pendingObserved = false; },
		(data) => { data.lifecycle.cases[0].pending.mutationMappedDataReads = 1; },
		(data) => { data.lifecycle.cases[0].pending.pendingTimerLifecycle.cleared = false; },
	]) {
		const data = inputs(); mutate(data); assert.throws(() => auditFiniteClaims(data));
	}
});
test("reject missing material case, alpha error and loosened independent optical gate", () => {
	for (const mutate of [
		(data) => { data.material.cases.pop(); },
		(data) => { data.material.cases[0].metrics.alphaMismatch = 1; },
		(data) => { data.material.gates.gpuByteMean = 0.36; },
	]) {
		const data = inputs(); mutate(data); assert.throws(() => auditFiniteClaims(data));
	}
});
test("reject opt-in export, changed graph, reference substitution and concealed diagnostics", () => {
	for (const mutate of [
		(data) => { data.flameCurrent.current.explicitChromaOrQuantizerOverride = true; },
		(data) => { data.flameCurrent.current.originalGraphReopenedExact = false; },
		(data) => { data.flameCurrent.current.freshPresentationEqualsFixedHistoricalRgba = false; },
		(data) => { data.flameCurrent.current.retainedStartupDiagnostics.cleanConsoleClaim = true; },
	]) {
		const data = inputs(); mutate(data); assert.throws(() => auditFiniteClaims(data));
	}
});
test("only registered producer-source records are historical; retained bytes remain immutable", () => {
	const root = "E:/fixture", path = `${root}/rust/wasm/src/capture.rs`;
	const record = { path, sha256: "1".repeat(64) };
	const retained = new Map(), historical = [];
	const options = { manifest: "canvas-current-capture-lifecycle.json", workspaceRoot: root, retained, historical };
	collectFiniteEvidencePins({ productionSourcePins: [record], receipt: { path: "C:/tmps/receipt.json", sha256: "2".repeat(64) } }, options);
	assert.equal(historical.length, 1);
	assert.equal(historical[0].executedSha256, record.sha256);
	assert.equal(retained.size, 2);
	assert.equal(retained.get(historical[0].frozenPath), record.sha256);
	assert.throws(() => collectFiniteEvidencePins({ receipt: { path: "C:/tmps/receipt.json", sha256: "3".repeat(64) } }, options));
	assert.throws(() => collectFiniteEvidencePins({ productionSourcePins: [{ ...record, path: "C:/tmps/output.png" }] }, options));
	collectFiniteEvidencePins({ productionSourcePins: [record] }, { ...options, manifest: "other.json" });
	assert.equal(retained.get(path), record.sha256);
});
