import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { bubbleHash } from "./probe-bubble-evidence.mjs";
import { captureBubble, compareBubblePackages, validateBubbleRaw } from "./probe-bubble-artifacts.mjs";

const pixels = (value) => Buffer.alloc(8, value).toString("base64");
const plan = [{ id: "first", width: 2, height: 1, enabled: true }, { id: "disabled", width: 2, height: 1, enabled: false }];
function raw(diagnostic = true) {
	return { version: 1, kind: "bubble-raster-native-and-presentation-separate", diagnostic,
		sources: [{ id: "source", width: 2, height: 1, authoredRgba: pixels(11), rgba: pixels(12) }],
		frames: [{ id: "first", sourceId: "source", sample: plan[0], resolved: { passes: [{ shader: "bubble" }] },
			renderPath: diagnostic ? "applyEffectPassesReadback" : "applyEffectPasses", nativeCaptured: diagnostic,
			nativeRgba: diagnostic ? pixels(21) : null, canvasRgba: pixels(22), expectedRgba: pixels(23) }],
		negatives: [{ id: "negative", caseId: "first", sourceId: "source", mutantRgba: pixels(31), referenceRgba: pixels(23) }],
	};
}
function pageFor(raw) {
	const globals = { __bubbleRaw: raw, __bubbleResult: { ok: false, failure: "preserved sample failure" }, __bubbleProgress: { currentCase: "first" } };
	return { isClosed: () => false, evaluate: async (fn, payload) => JSON.parse(JSON.stringify(runInNewContext(`(${fn.toString()})(payload)`, { ...globals, payload }))) };
}
test("Bubble capture contract distinguishes native diagnostics, ordinary Canvas and missing frames", () => {
	assert.doesNotThrow(() => validateBubbleRaw(raw(), plan, false));
	assert.throws(() => validateBubbleRaw(raw(), plan), /Incomplete/);
	const ordinary = raw(false);
	ordinary.frames[0].nativeCaptured = true;
	assert.throws(() => validateBubbleRaw(ordinary, plan, false));
	const duplicate = raw();
	duplicate.frames.push(duplicate.frames[0]);
	assert.throws(() => validateBubbleRaw(duplicate, plan, false), /duplicate/);
});
test("Bubble partial failures retain authored/canonical/native/Canvas/expected/negative bytes separately", async () => {
	const directory = await mkdtemp("C:/tmps/bubble-artifacts-test-");
	const report = { captureErrors: [] };
	await captureBubble(pageFor(raw()), directory, report, plan);
	assert.equal(report.rawComplete, undefined);
	assert(report.captureErrors.some((error) => error.includes("Incomplete")));
	const retained = JSON.parse(await readFile(join(directory, "raw-frames.json"), "utf8"));
	for (const [file, value] of [[retained.sources[0].files.authoredRgba, 11], [retained.sources[0].files.rgba, 12], [retained.frames[0].files.nativeRgba, 21], [retained.frames[0].files.canvasRgba, 22], [retained.frames[0].files.expectedRgba, 23], [retained.negatives[0].files.mutantRgba, 31]]) {
		const bytes = await readFile(join(directory, file.filename));
		assert.deepEqual(bytes, Buffer.alloc(8, value));
		assert.equal(file.sha256, bubbleHash(bytes));
	}
	assert.equal(JSON.parse(await readFile(join(directory, "browser-result.json"), "utf8")).failure, "preserved sample failure");
});
test("Bubble failed render attempt retains precomputed expected bytes without inventing actual pixels", async () => {
	const directory = await mkdtemp("C:/tmps/bubble-pending-test-"), value = raw();
	value.pendingFrame = { id: "disabled", sourceId: "source", sample: plan[1], expectedRgba: pixels(41) };
	const report = { captureErrors: [] };
	await captureBubble(pageFor(value), directory, report, plan);
	const pending = report.raw.pendingFrame;
	assert.deepEqual(await readFile(join(directory, pending.expected.filename)), Buffer.alloc(8, 41));
	assert.equal(pending.nativeRgba, undefined);
	assert.equal(report.rawComplete, undefined);
});
test("Bubble paired comparison requires exact default/diagnostic Canvas and expected bytes", () => {
	const file = (sha256) => ({ sha256 });
	const frame = { id: "frame", files: { canvasRgba: file("canvas"), expectedRgba: file("expected") } };
	const source = { id: "source", files: { rgba: file("canonical"), authoredRgba: file("authored") } };
	const ordinary = { diagnostic: false, rawComplete: true, raw: { sources: [source], frames: [frame] } };
	const diagnostic = structuredClone({ ...ordinary, diagnostic: true });
	diagnostic.raw.frames[0].nativeCaptured = true;
	assert.equal(compareBubblePackages(ordinary, diagnostic).ok, true);
	diagnostic.raw.frames[0].files.canvasRgba.sha256 = "different";
	assert.equal(compareBubblePackages(ordinary, diagnostic).ok, false);
	diagnostic.raw.frames[0].files.canvasRgba.sha256 = "canvas";
	diagnostic.rawComplete = false;
	assert.equal(compareBubblePackages(ordinary, diagnostic).ok, false);
});
