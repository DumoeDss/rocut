import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
	parseHfRemotionAuthorityCommand, selectHfRemotionCases,
	validateHfRemotionPreparedCases, summarizeHfRemotionCoverage,
} from "../fixtures/hf-remotion-case-selection.mjs";

const toolchain = "C:/owned/pinned-toolchain";
const ids = ["hyperframes-basic", "remotion-basic", "hyperframes-audio-editor", "remotion-audio-editor"];
const clone = (value) => JSON.parse(JSON.stringify(value));

test("default preparation preserves the fixed four entries, argv and order", () => {
	assert.deepEqual(parseHfRemotionAuthorityCommand(["--prepare"]), { mode: "--prepare", caseId: null });
	const selected = selectHfRemotionCases({ toolchain });
	assert.deepEqual(selected.cases, [
		{ id: ids[0], entry: "script/probe-hyperframes.mjs", args: [toolchain] },
		{ id: ids[1], entry: "script/probe-remotion.mjs", args: [toolchain] },
		{ id: ids[2], entry: "script/probe-hyperframes-audio-editor.mjs", args: [toolchain] },
		{ id: ids[3], entry: "script/probe-remotion-audio.mjs", args: [toolchain, "--editor"] },
	]);
	assert.equal(selected.selection.kind, "full-four");
	assert.equal(selected.selection.selectedCount, 4);
	assert.deepEqual(selected.selection.notSelectedCaseIds, []);
});

test("all and only four fixed IDs can prepare an explicit independent1/4 group", () => {
	for (const id of ids) {
		assert.deepEqual(parseHfRemotionAuthorityCommand(["--prepare", "--case", id]), { mode: "--prepare", caseId: id });
		const selected = selectHfRemotionCases({ toolchain, caseId: id });
		assert.equal(selected.cases.length, 1);
		assert.equal(selected.cases[0].id, id);
		assert.equal(selected.selection.selectedCount, 1);
		assert.equal(selected.selection.universeCount, 4);
		assert.deepEqual(selected.selection.notSelectedCaseIds, ids.filter((other) => other !== id));
		assert.deepEqual(validateHfRemotionPreparedCases({ plan: { version: 2, ...clone(selected) }, toolchain }), selected);
	}
});

test("illegal selection, arbitrary entry/argv and run-time case overrides reject", () => {
	for (const args of [[], ["--prepare", "--case"], ["--prepare", "--case", "other"], ["--prepare", "--case", ""],
		["--prepare", "--case", ids[1], "--entry", "evil.mjs"], ["--run"], ["--run", ""],
		["--run", "C:/old/group", "--case", ids[1]], ["--prepare", "--entry", "script/probe-remotion.mjs"]])
		assert.throws(() => parseHfRemotionAuthorityCommand(args));
	assert.throws(() => selectHfRemotionCases({ toolchain, caseId: "other" }));
	assert.deepEqual(parseHfRemotionAuthorityCommand(["--run", "C:/prepared/group"]), { mode: "--run", group: "C:/prepared/group" });
	const selected = selectHfRemotionCases({ toolchain, caseId: ids[1] });
	for (const change of [
		(plan) => { plan.cases[0].entry = "evil.mjs"; },
		(plan) => { plan.cases[0].args.push("--native-only"); },
		(plan) => { plan.selection.caseId = ids[0]; },
		(plan) => { plan.selection.universeCount = 1; },
	]) {
		const plan = { version: 2, ...clone(selected) };
		change(plan);
		assert.throws(() => validateHfRemotionPreparedCases({ plan, toolchain }));
	}
});

test("legacy prepared groups remain all four and cannot be converted by a selection field", () => {
	const selected = selectHfRemotionCases({ toolchain });
	assert.deepEqual(validateHfRemotionPreparedCases({ plan: { version: 1, cases: clone(selected.cases) }, toolchain }), selected);
	assert.throws(() => validateHfRemotionPreparedCases({ plan: { version: 1, ...clone(selectHfRemotionCases({ toolchain, caseId: ids[1] })) }, toolchain }));
	assert.throws(() => validateHfRemotionPreparedCases({ plan: { version: 1, cases: [clone(selected.cases[1])] }, toolchain }));
});

test("scoped success is not four-case acceptance and other cases remain unexecuted, not passed/skipped", () => {
	const { selection } = selectHfRemotionCases({ toolchain, caseId: ids[1] });
	const success = summarizeHfRemotionCoverage({ selection, results: [{ id: ids[1], passed: true }] });
	assert.deepEqual(success, { passed: true, status: "scoped-passed", scope: "1/4", fullFourAcceptance: false,
		unexecutedSelectedCases: [], notSelectedCases: [ids[0], ids[2], ids[3]], unexecutedCases: [ids[0], ids[2], ids[3]] });
	const failed = summarizeHfRemotionCoverage({ selection, results: [{ id: ids[1], passed: false }] });
	assert.equal(failed.passed, false);
	assert.equal(failed.status, "failed");
	assert.equal(failed.fullFourAcceptance, false);
	assert.deepEqual(summarizeHfRemotionCoverage({ selection, results: [] }).unexecutedCases, ids);
});

test("default first-failure prefix and all-four success retain truthful coverage", () => {
	const { selection } = selectHfRemotionCases({ toolchain });
	const failure = summarizeHfRemotionCoverage({ selection, results: [{ id: ids[0], passed: false }] });
	assert.equal(failure.scope, "4/4");
	assert.deepEqual(failure.unexecutedSelectedCases, ids.slice(1));
	assert.deepEqual(failure.unexecutedCases, ids.slice(1));
	assert.equal(summarizeHfRemotionCoverage({ selection, results: ids.map((id) => ({ id, passed: true })) }).fullFourAcceptance, true);
	assert.throws(() => summarizeHfRemotionCoverage({ selection, results: [{ id: ids[1], passed: true }] }));
	assert.throws(() => summarizeHfRemotionCoverage({ selection, results: [{ id: ids[0], passed: true }, { id: ids[0], passed: true }] }));
});

test("runner retains first-failure stop and default180s behavioral watchdog", async () => {
	const read = async (path) => new TextDecoder("utf8", { fatal: true }).decode(await readFile(new URL(path, import.meta.url)));
	assert.match(await read("../probe-hf-remotion-browser-authority.mjs"), /if \(!passed\) break;/);
	assert.match(await read("../probe-html-frames.mjs"), /timeout: styledThree \? 300000 : 180000/);
});
