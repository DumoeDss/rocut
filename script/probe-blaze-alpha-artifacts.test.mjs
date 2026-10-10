import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	captureAlpha,
	validateAlphaStages,
} from "./probe-blaze-alpha-artifacts.mjs";
import { alphaHash, alphaSourceGuard } from "./probe-blaze-alpha-evidence.mjs";

function raw(nativeReadback = false) {
	const stages = [];
	function add(id, referenceId) {
		const width = id.startsWith("C") ? 16 : 256,
			height = 16;
		stages.push({
			id,
			width,
			height,
			role: "unit fixture",
			referenceId,
			rgba: Buffer.alloc(width * height * 4, 7).toString("base64"),
		});
	}
	add("A0-authored");
	add("A1-put-get", "A0-authored");
	add("A2-copy-get", "A1-put-get");
	add("A3-copy-again-get", "A2-copy-get");
	add("C0-black-authored");
	add("C1-black-put-get", "C0-black-authored");
	if (nativeReadback) add("B0-identity-native-texture", "A1-put-get");
	add(
		"B0-identity-returned",
		nativeReadback ? "B0-identity-native-texture" : "A1-put-get",
	);
	add("B1-identity-copy", "B0-identity-returned");
	for (const contrast of [-32, -36, -40]) {
		add(`C-${contrast}-analytic`);
		if (nativeReadback)
			add(`C-${contrast}-native-texture`, `C-${contrast}-analytic`);
		add(
			`C-${contrast}-returned`,
			nativeReadback
				? `C-${contrast}-native-texture`
				: `C-${contrast}-analytic`,
		);
		add(`C-${contrast}-copy`, `C-${contrast}-returned`);
	}
	return {
		version: 2,
		kind: "independent-alpha-calibration-not-Blaze-acceptance",
		nativeReadback,
		emptyStackRejection: {
			attempted: true,
			rejected: true,
			matched: true,
			error: "At least one effect pass is required",
		},
		stages,
	};
}
const page = (value) => ({
	isClosed: () => false,
	evaluate: async (_, key) => (key === "__alphaRaw" ? value : null),
});
test("both exact calibration matrices reject missing, duplicate and mislinked stages", () => {
	validateAlphaStages(raw());
	validateAlphaStages(raw(true));
	const missing = raw();
	missing.stages.pop();
	assert.throws(() => validateAlphaStages(missing));
	const duplicate = raw();
	duplicate.stages[1] = duplicate.stages[0];
	assert.throws(() => validateAlphaStages(duplicate));
	const mislinked = raw();
	mislinked.stages[2].referenceId = "A0-authored";
	assert.throws(() => validateAlphaStages(mislinked));
	const unsupported = raw();
	unsupported.stages[0].width = 1;
	assert.throws(() => validateAlphaStages(unsupported));
	const mode = raw(true);
	mode.nativeReadback = false;
	assert.throws(() => validateAlphaStages(mode));
	const noRejection = raw();
	noRejection.emptyStackRejection.matched = false;
	assert.throws(() => validateAlphaStages(noRejection));
	const previous = raw();
	previous.version = 1;
	assert.throws(() => validateAlphaStages(previous));
});
test("all native and presentation stages retain byte lengths and independently checkable hashes", async () => {
	const directory = await mkdtemp("C:/tmps/blaze-alpha-artifact-unit-");
	const report = { captureErrors: [] };
	await captureAlpha(page(raw(true)), directory, report);
	assert.equal(report.rawComplete, true);
	assert.deepEqual(report.captureErrors, []);
	const manifest = JSON.parse(
		await readFile(join(directory, "raw-stages.json"), "utf8"),
	);
	assert.equal(manifest.stages.length, 21);
	for (const stage of manifest.stages) {
		const bytes = await readFile(join(directory, stage.file.filename));
		assert.equal(bytes.length, stage.width * stage.height * 4);
		assert.equal(alphaHash(bytes), stage.file.sha256);
		assert.equal(stage.rgba, undefined);
	}
});
test("partial failures retain captured bytes without claiming complete; invalid bytes fail closed", async () => {
	const partial = raw();
	partial.stages = partial.stages.slice(0, 2);
	const directory = await mkdtemp("C:/tmps/blaze-alpha-partial-unit-");
	const report = { captureErrors: [] };
	await captureAlpha(page(partial), directory, report);
	assert.equal(report.rawComplete, undefined);
	assert.equal(report.captureErrors.length, 1);
	assert.equal(
		JSON.parse(await readFile(join(directory, "raw-stages.json"), "utf8"))
			.stages.length,
		2,
	);
	const invalid = raw();
	invalid.stages[0].rgba = "AA==";
	const invalidDirectory = await mkdtemp("C:/tmps/blaze-alpha-invalid-unit-");
	const invalidReport = { captureErrors: [] };
	await captureAlpha(page(invalid), invalidDirectory, invalidReport);
	assert.equal(invalidReport.rawComplete, undefined);
	assert.equal(invalidReport.captureErrors.length, 1);
});
test("source guard rejects any Blaze oracle dependency even under a valid snapshot", async () => {
	const guard = alphaSourceGuard({
		snapshot: "C:/tmps/fixture",
		packageDirectory: "C:/tmps/package",
		fixtures: [],
		packageFiles: [],
	});
	await assert.rejects(() =>
		guard.plugin.load("C:/tmps/fixture/script/fixtures/blaze-oracle.ts"),
	);
	await assert.rejects(() =>
		guard.plugin.load(
			"C:/tmps/fixture/script/fixtures/blaze-browser-metrics.ts",
		),
	);
});
