import { strict as assert } from "node:assert";

const definitions = Object.freeze([
	["hyperframes-basic", "script/probe-hyperframes.mjs", []],
	["remotion-basic", "script/probe-remotion.mjs", []],
	["hyperframes-audio-editor", "script/probe-hyperframes-audio-editor.mjs", []],
	["remotion-audio-editor", "script/probe-remotion-audio.mjs", ["--editor"]],
].map(([id, entry, args]) => Object.freeze({ id, entry, args: Object.freeze(args) })));

function selectionFor(caseId) {
	assert.ok(caseId === null || definitions.some(({ id }) => id === caseId), "Unknown fixed HF/Remotion case");
	const selectedCaseIds = definitions.filter(({ id }) => caseId === null || id === caseId).map(({ id }) => id);
	return Object.freeze({
		kind: caseId === null ? "full-four" : "single-case", caseId,
		selectedCaseIds: Object.freeze(selectedCaseIds),
		notSelectedCaseIds: Object.freeze(definitions.filter(({ id }) => !selectedCaseIds.includes(id)).map(({ id }) => id)),
		selectedCount: selectedCaseIds.length, universeCount: definitions.length,
	});
}

export function parseHfRemotionAuthorityCommand(args) {
	if (args.length === 1 && args[0] === "--prepare") return { mode: "--prepare", caseId: null };
	if (args.length === 3 && args[0] === "--prepare" && args[1] === "--case") {
		selectionFor(args[2]);
		return { mode: "--prepare", caseId: args[2] };
	}
	if (args.length === 2 && args[0] === "--run" && typeof args[1] === "string" && args[1].length > 0)
		return { mode: "--run", group: args[1] };
	throw Error("Use --prepare [--case <fixed-id>] or --run <prepared-group>; run cannot change case selection");
}

export function selectHfRemotionCases({ toolchain, caseId = null }) {
	assert.ok(typeof toolchain === "string" && toolchain.length > 0, "Pinned internal toolchain required");
	const selection = selectionFor(caseId);
	const cases = definitions.filter(({ id }) => selection.selectedCaseIds.includes(id)).map(({ id, entry, args }) =>
		Object.freeze({ id, entry, args: Object.freeze([toolchain, ...args]) }));
	return { selection, cases: Object.freeze(cases) };
}

export function validateHfRemotionPreparedCases({ plan, toolchain }) {
	assert.ok(plan && typeof plan === "object", "Prepared plan required");
	let selected;
	if (plan.version === 1) {
		assert.equal(plan.selection, undefined, "Legacy four-case groups cannot acquire a case override");
		selected = selectHfRemotionCases({ toolchain });
	} else {
		assert.equal(plan.version, 2, "Unsupported prepared group version");
		assert.ok(plan.selection && Object.hasOwn(plan.selection, "caseId"), "Prepared selection required");
		selected = selectHfRemotionCases({ toolchain, caseId: plan.selection.caseId });
		assert.deepEqual(plan.selection, selected.selection, "Prepared scope changed");
	}
	assert.deepEqual(plan.cases, selected.cases, "Only the exact prepared fixed entries/argv are allowed");
	return selected;
}

export function summarizeHfRemotionCoverage({ selection, results }) {
	assert.deepEqual(selection, selectionFor(selection.caseId), "Invalid fixed-case selection");
	assert.ok(Array.isArray(results) && results.length <= selection.selectedCount, "Invalid case results");
	assert.deepEqual(results.map(({ id }) => id), selection.selectedCaseIds.slice(0, results.length), "Results must be the executed ordered prefix");
	const passed = results.length === selection.selectedCount && results.every((result) => result.passed === true);
	const executed = results.map(({ id }) => id);
	return {
		passed, status: passed ? (selection.kind === "full-four" ? "passed" : "scoped-passed") : "failed",
		scope: `${selection.selectedCount}/${selection.universeCount}`,
		fullFourAcceptance: passed && selection.kind === "full-four",
		unexecutedSelectedCases: selection.selectedCaseIds.slice(results.length),
		notSelectedCases: [...selection.notSelectedCaseIds],
		unexecutedCases: definitions.filter(({ id }) => !executed.includes(id)).map(({ id }) => id),
	};
}
