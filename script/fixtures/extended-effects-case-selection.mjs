import assert from "node:assert/strict";
import { isAbsolute } from "node:path";

const definitions = Object.freeze(
	[
		["reveal", "script/probe-reveal-effects.mjs", [], "reveal-effects", null],
		["sweep", "script/probe-sweep-scroll.mjs", [], "sweep-scroll", null],
		[
			"mesh",
			"script/probe-mesh-scenes.mjs",
			[],
			"mesh-scenes",
			"full-mesh-scenes",
		],
		[
			"cloth",
			"script/probe-mesh-scenes.mjs",
			["--cloth"],
			"mesh-scenes",
			"cloth-scenes",
		],
		[
			"mesh-refraction-raster",
			"script/probe-mesh-scenes.mjs",
			["--refraction-only"],
			"mesh-scenes",
			"raster-refraction-only-no-export",
		],
		[
			"liquid-2d-webgpu",
			"script/probe-liquid-effects.mjs",
			["webgpu"],
			"liquid-effects",
			"production-surface",
		],
		[
			"liquid-2d-webgl",
			"script/probe-liquid-effects.mjs",
			["webgl"],
			"liquid-effects",
			"production-surface",
		],
	].map(([id, entry, args, artifactParent, mode]) =>
		Object.freeze({
			id,
			entry,
			args: Object.freeze(args),
			artifactParent,
			mode,
		}),
	),
);

function selectionFor(caseId) {
	assert(
		caseId === null || definitions.some(({ id }) => id === caseId),
		"Unknown fixed extended-effects case",
	);
	const selectedCaseIds = definitions
		.filter(({ id }) => caseId === null || id === caseId)
		.map(({ id }) => id);
	return Object.freeze({
		kind: caseId === null ? "full-seven" : "single-case",
		caseId,
		selectedCaseIds: Object.freeze(selectedCaseIds),
		notSelectedCaseIds: Object.freeze(
			definitions
				.filter(({ id }) => !selectedCaseIds.includes(id))
				.map(({ id }) => id),
		),
		selectedCount: selectedCaseIds.length,
		universeCount: definitions.length,
	});
}

export function parseExtendedEffectsAuthorityCommand(args) {
	if (args.length === 1 && args[0] === "--prepare")
		return { mode: "--prepare", caseId: null };
	if (args.length === 3 && args[0] === "--prepare" && args[1] === "--case") {
		selectionFor(args[2]);
		return { mode: "--prepare", caseId: args[2] };
	}
	if (
		args.length === 2 &&
		args[0] === "--run" &&
		typeof args[1] === "string" &&
		args[1].length > 0
	)
		return { mode: "--run", group: args[1] };
	throw Error(
		"Use --prepare [--case <fixed-id>] or --run <prepared-group>; no run-time overrides",
	);
}

export function selectExtendedEffectsCases({
	chrome,
	ffmpegDirectory,
	caseId = null,
}) {
	assert(
		[chrome, ffmpegDirectory].every(
			(path) => typeof path === "string" && isAbsolute(path),
		),
		"Absolute pinned executables required",
	);
	const selection = selectionFor(caseId);
	const cases = definitions
		.filter(({ id }) => selection.selectedCaseIds.includes(id))
		.map(({ args, ...definition }) =>
			Object.freeze({
				...definition,
				args: Object.freeze([chrome, ffmpegDirectory, ...args]),
			}),
		);
	return { selection, cases: Object.freeze(cases) };
}

export function validateExtendedEffectsPreparedCases({
	plan,
	chrome,
	ffmpegDirectory,
}) {
	assert.equal(plan.version, 1, "Unsupported extended-effects plan version");
	assert(
		plan.selection && Object.hasOwn(plan.selection, "caseId"),
		"Prepared selection required",
	);
	const selected = selectExtendedEffectsCases({
		chrome,
		ffmpegDirectory,
		caseId: plan.selection.caseId,
	});
	assert.deepEqual(
		plan.selection,
		selected.selection,
		"Prepared scope changed",
	);
	assert.deepEqual(
		plan.cases,
		selected.cases,
		"Prepared fixed entries/argv changed",
	);
	return selected;
}

export function summarizeExtendedEffectsCoverage({ selection, results }) {
	assert.deepEqual(
		selection,
		selectionFor(selection.caseId),
		"Invalid fixed-case selection",
	);
	assert(
		Array.isArray(results) && results.length <= selection.selectedCount,
		"Invalid case results",
	);
	assert.deepEqual(
		results.map(({ id }) => id),
		selection.selectedCaseIds.slice(0, results.length),
		"Results must be the ordered executed prefix",
	);
	assert(
		results.every(({ passed }) => typeof passed === "boolean"),
		"Every result must retain pass/fail",
	);
	const failure = results.findIndex(({ passed }) => !passed);
	assert(
		failure < 0 || failure === results.length - 1,
		"No execution after first failure",
	);
	const passed =
		results.length === selection.selectedCount &&
		results.every((result) => result.passed);
	const executed = results.map(({ id }) => id);
	return {
		passed,
		status: passed
			? selection.kind === "full-seven"
				? "passed"
				: "scoped-passed"
			: "failed",
		scope: `${selection.selectedCount}/${selection.universeCount}`,
		fullSevenAcceptance: passed && selection.kind === "full-seven",
		unexecutedSelectedCases: selection.selectedCaseIds.slice(results.length),
		notSelectedCases: [...selection.notSelectedCaseIds],
		unexecutedCases: definitions
			.filter(({ id }) => !executed.includes(id))
			.map(({ id }) => id),
	};
}
