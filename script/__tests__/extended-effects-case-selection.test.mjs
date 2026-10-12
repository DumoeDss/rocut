import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	parseExtendedEffectsAuthorityCommand as parse,
	selectExtendedEffectsCases as select,
	summarizeExtendedEffectsCoverage as summarize,
	validateExtendedEffectsPreparedCases as validate,
} from "../fixtures/extended-effects-case-selection.mjs";

const pins = {
	chrome: "C:/private/chrome.exe",
	ffmpegDirectory: "E:/private/ffmpeg/bin",
};
const ids = [
	"reveal",
	"sweep",
	"mesh",
	"cloth",
	"mesh-refraction-raster",
	"liquid-2d-webgpu",
	"liquid-2d-webgl",
];
const prepared = (caseId = null) => ({
	version: 1,
	...select({ ...pins, caseId }),
});
const clone = (value) => JSON.parse(JSON.stringify(value));

test("default seven-case order, original entry points and exact argv are fixed", () => {
	const { selection, cases } = select(pins);
	assert.deepEqual(
		cases.map(({ id }) => id),
		ids,
	);
	assert.deepEqual(
		cases.map(({ entry }) => entry),
		[
			"script/probe-reveal-effects.mjs",
			"script/probe-sweep-scroll.mjs",
			...Array(3).fill("script/probe-mesh-scenes.mjs"),
			...Array(2).fill("script/probe-liquid-effects.mjs"),
		],
	);
	assert.deepEqual(
		cases.map(({ args }) => args),
		[
			[pins.chrome, pins.ffmpegDirectory],
			[pins.chrome, pins.ffmpegDirectory],
			[pins.chrome, pins.ffmpegDirectory],
			[pins.chrome, pins.ffmpegDirectory, "--cloth"],
			[pins.chrome, pins.ffmpegDirectory, "--refraction-only"],
			[pins.chrome, pins.ffmpegDirectory, "webgpu"],
			[pins.chrome, pins.ffmpegDirectory, "webgl"],
		],
	);
	assert.equal(selection.kind, "full-seven");
	assert.equal(selection.universeCount, 7);
	assert.equal(cases[4].mode, "raster-refraction-only-no-export");
	assert.equal(cases[5].mode, "production-surface");
	assert.equal(cases[6].mode, "production-surface");
	assert.equal(Object.isFrozen(cases), true);
	assert.equal(Object.isFrozen(cases[0].args), true);
});
for (const id of ids)
	test(`single ${id} freezes one case and never claims 7/7`, () => {
		assert.deepEqual(parse(["--prepare", "--case", id]), {
			mode: "--prepare",
			caseId: id,
		});
		const selected = select({ ...pins, caseId: id });
		const scope = summarize({
			selection: selected.selection,
			results: [{ id, passed: true }],
		});
		assert.equal(scope.status, "scoped-passed");
		assert.equal(scope.scope, "1/7");
		assert.equal(scope.fullSevenAcceptance, false);
		assert.equal(scope.notSelectedCases.length, 6);
		assert.equal(scope.unexecutedCases.length, 6);
		assert.deepEqual(validate({ plan: prepared(id), ...pins }), selected);
	});
test("prepare and run grammar cannot introduce entries, flags or run overrides", () => {
	assert.deepEqual(parse(["--prepare"]), { mode: "--prepare", caseId: null });
	assert.deepEqual(parse(["--run", "group"]), {
		mode: "--run",
		group: "group",
	});
	for (const argv of [
		[],
		["--prepare", "--case", "unknown"],
		["--prepare", "--case", ""],
		["--run"],
		["--run", ""],
		["--run", "group", "--case", "cloth"],
		["--prepare", "--timeout", "1"],
		["--case", "mesh"],
	])
		assert.throws(() => parse(argv));
	assert.throws(() => select({ ...pins, caseId: "unknown" }));
	assert.throws(() => select({ ...pins, chrome: "relative.exe" }));
});
test("forged plan version, scope, mode, entry, argv, tool paths and order reject", () => {
	const mutations = [
		(p) => {
			p.version = 2;
		},
		(p) => {
			delete p.selection;
		},
		(p) => {
			p.selection.selectedCount = 1;
		},
		(p) => {
			p.selection.caseId = "mesh";
		},
		(p) => {
			p.cases[0].entry = "script/other.mjs";
		},
		(p) => {
			p.cases[0].args.push("--retry");
		},
		(p) => {
			p.cases[0].args[0] = "C:/other/chrome.exe";
		},
		(p) => {
			p.cases[0].mode = "diagnostic";
		},
		(p) => {
			p.cases.reverse();
		},
		(p) => {
			p.cases[0].artifactParent = "liquid-readback";
		},
	];
	for (const mutate of mutations) {
		const plan = clone(prepared());
		mutate(plan);
		assert.throws(() => validate({ plan, ...pins }));
	}
});
test("first failure retains ordered prefix and marks remaining cases unexecuted", () => {
	const { selection } = select(pins);
	const scope = summarize({
		selection,
		results: [
			{ id: "reveal", passed: true },
			{ id: "sweep", passed: false },
		],
	});
	assert.equal(scope.status, "failed");
	assert.equal(scope.fullSevenAcceptance, false);
	assert.deepEqual(scope.unexecutedSelectedCases, ids.slice(2));
	assert.deepEqual(scope.notSelectedCases, []);
	for (const results of [
		[{ id: "sweep", passed: true }],
		[
			{ id: "reveal", passed: false },
			{ id: "sweep", passed: true },
		],
		[{ id: "reveal" }],
	])
		assert.throws(() => summarize({ selection, results }));
});
test("only seven successful selected results grant full-seven acceptance", () => {
	const { selection } = select(pins);
	const complete = summarize({
		selection,
		results: ids.map((id) => ({ id, passed: true })),
	});
	assert.equal(complete.status, "passed");
	assert.equal(complete.fullSevenAcceptance, true);
	assert.deepEqual(complete.unexecutedCases, []);
	assert.equal(summarize({ selection, results: [] }).status, "failed");
	assert.equal(
		summarize({
			selection,
			results: ids.slice(0, 6).map((id) => ({ id, passed: true })),
		}).status,
		"failed",
	);
});
test("runner adds neither timeout overrides nor diagnostics and locks groups before invocation", async () => {
	const source = await readFile(
		new URL("../probe-extended-effects-browser-authority.mjs", import.meta.url),
		"utf8",
	);
	assert.equal(source.includes("timeout:"), false);
	assert.match(source, /if \(!caseReport.passed\) break/);
	assert.match(source, /"run-start.json"/);
	assert.match(source, /flag: "wx"/);
	assert.match(source, /\^\(ROCUT_\|ELFTIA_\)/);
	assert.match(source, /diagnosticWasmSha256,\s*null/);
	for (const [entry, timeout] of [
		["probe-reveal-effects.mjs", 180000],
		["probe-sweep-scroll.mjs", 180000],
		["probe-mesh-scenes.mjs", 300000],
		["probe-liquid-effects.mjs", 180000],
	]) {
		const original = await readFile(
			new URL(`../${entry}`, import.meta.url),
			"utf8",
		);
		assert.match(original, new RegExp(`timeout: ${timeout}`));
		assert.match(original, /chromium.launchPersistentContext/);
	}
});

async function actualEvidenceValidator() {
	const source = await readFile(
		new URL("../probe-extended-effects-browser-authority.mjs", import.meta.url),
		"utf8",
	);
	const declaration = source.slice(
		source.indexOf("function validateEvidence("),
		source.indexOf("async function retainEvidence("),
	);
	assert(declaration.startsWith("function validateEvidence("));
	// CPU-only schema tests execute the actual runner validator. These fabricated
	// objects are test inputs, never production receipts or browser witnesses.
	return new Function(
		"assert",
		"authority",
		"browserVersion",
		declaration + "\nreturn validateEvidence;",
	)(assert, "a".repeat(64), "153.0.8010.12");
}
const testBefore = {
	head: "frozen-test-head",
	fixture: { sha256: "manifest-test-hash" },
};
function completedEvidence(fixed) {
	const base = {
		ok: true,
		sourceCommit: testBefore.head,
		sourceManifestSha256: testBefore.fixture.sha256,
		wasmSha256: "a".repeat(64),
		mode: fixed.mode,
	};
	if (fixed.id.startsWith("liquid-2d-"))
		return {
			...base,
			defaultWasmSha256: base.wasmSha256,
			diagnosticWasmSha256: null,
			attempts: [
				{
					mode: "production-surface",
					requestedBackend: fixed.args[2],
					backend: fixed.args[2],
					ok: true,
					browser: "153.0.8010.12",
					errors: [],
					externalRequests: [],
					failures: [],
					raster: { ok: true },
					timeline: { ok: true },
					video: { ok: true, frames: 6 },
					decoded: { ok: true },
				},
			],
		};
	Object.assign(base, {
		browser: "153.0.8010.12",
		errors: [],
		externalRequests: [],
	});
	if (fixed.id === "mesh-refraction-raster")
		return {
			...base,
			backend:
				"private Chromium direct production WebGL2 mesh raster; no WASM scene/export/Host/Electron",
			decoded: [],
		};
	const names =
		fixed.id === "reveal"
			? ["laser", "decrypt-reveal"]
			: fixed.id === "sweep"
				? ["ascii-sweep", "particle-scroll", "overlay"]
				: fixed.id === "cloth"
					? ["cloth-events", "cloth-wind"]
					: [
							"cloth-events",
							"cloth-wind",
							"bend",
							"bend-back",
							"shatter",
							"grid-check",
							"hex-check",
						];
	const video = { frames: 6, bytes: 100 };
	return {
		...base,
		exports: names.map((name) => ({ name, ...video, evidence: { ...video } })),
		decoded: names.map((name) => ({ name, ok: true })),
	};
}
test("actual validator requires completed original stages for six native chains and keeps raster-only separate", async () => {
	const validateEvidence = await actualEvidenceValidator();
	for (const fixed of select(pins).cases)
		validateEvidence(fixed, completedEvidence(fixed), testBefore);
});
test("process/served/top-level success cannot replace native init/export/decode or liquid production stages", async () => {
	const validateEvidence = await actualEvidenceValidator();
	const cases = select(pins).cases;
	for (const fixed of cases.filter(
		({ id }) => id !== "mesh-refraction-raster",
	)) {
		const evidence = completedEvidence(fixed);
		if (fixed.id.startsWith("liquid-2d-")) delete evidence.attempts[0].video;
		else delete evidence.exports;
		assert.throws(() => validateEvidence(fixed, evidence, testBefore));
	}
	const liquid = cases.find(({ id }) => id === "liquid-2d-webgpu");
	for (const mutate of [
		(e) => {
			e.diagnosticWasmSha256 = "b".repeat(64);
		},
		(e) => {
			e.attempts[0].backend = "webgl";
		},
		(e) => {
			e.attempts[0].video.frames = 4;
		},
		(e) => {
			e.attempts[0].timeline.ok = false;
		},
		(e) => {
			e.attempts[0].raster.ok = false;
		},
		(e) => {
			e.attempts[0].decoded.ok = false;
		},
		(e) => {
			e.attempts.push(e.attempts[0]);
		},
	]) {
		const evidence = completedEvidence(liquid);
		mutate(evidence);
		assert.throws(() => validateEvidence(liquid, evidence, testBefore));
	}
	const raster = cases.find(({ id }) => id === "mesh-refraction-raster");
	const evidence = completedEvidence(raster);
	evidence.decoded.push({ ok: true });
	assert.throws(() => validateEvidence(raster, evidence, testBefore));
});
