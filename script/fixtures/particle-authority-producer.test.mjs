import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	parseParticleEditorOptions,
	frozenParticleFiles,
	particleEditorContract,
} from "./particle-editor-contract.mjs";
import { PARTICLE_AUTHORITY_LANE } from "./particle-editor-export-authority.mjs";
import {
	PARTICLE_BASELINE_CONTRACT,
	assertParticleBaselineState,
	parseParticleAuthorityPrepareOptions,
	particleClosureFiles,
} from "./particle-authority-prepare-contract.mjs";
import {
	admitParticleCompileHostContext,
	writeParticleCompileContext,
	writeParticleCompileBootstrap,
} from "./particle-authority-compile-context.mjs";
import { admitParticleAuthorityHostContext } from "./particle-editor-export-authority-stage.mjs";
import { baselineState } from "./particle-authority-baseline-topology-fixture.mjs";

const path = process.platform === "win32" ? "C:/tmps/fixture" : "/tmp/fixture";
const tools = ["bun", "wasm-sync", "sampler-dir", "toolchain", "chromium"];
const ui = ["artifacts-root", "source-project", ...tools].flatMap((name) => [
	"--" + name,
	path,
]);
const lane = [
	"--authority",
	PARTICLE_AUTHORITY_LANE,
	"--authority-receipt",
	path,
];
const baseline = [
	"--compile-baseline-receipt",
	path,
	"--ffmpeg",
	path,
	"--ffprobe",
	path,
];
const compile = [
	"artifacts-root",
	"creator-root",
	...tools,
	"ffmpeg",
	"ffprobe",
].flatMap((name) => ["--" + name, path]);
test("new UI lane needs paired authority, separate baseline and full executables", () => {
	assert.equal(
		parseParticleEditorOptions([...ui, ...lane, ...baseline]).mode,
		"build-only",
	);
	for (const args of [
		[...ui, ...lane],
		[...ui, ...baseline],
		[...ui, ...lane, ...baseline, "--authority-receipt", path],
		[...ui, ...lane, ...baseline, "--unknown", path],
	])
		assert.throws(() => parseParticleEditorOptions(args));
});
test("legacy default, retained project and C3 sidecars are unchanged", () => {
	assert.equal(parseParticleEditorOptions(ui).mode, "build-only");
	assert.equal(
		particleEditorContract.initialProjectSha256,
		"96672b702d66ea305126147ecdb10fa21f773ea12ba8e77af383b41e2216fa36",
	);
	assert.equal(
		frozenParticleFiles["opencut_wasm_bg.wasm"],
		"328a2a4313812c356f28d74f27cfeaa10cad3a933e2c4f3de5ded20d8d98c221",
	);
	assert.deepEqual(
		particleEditorContract.finalReferenceFrames,
		[0, 15, 30, 60, 75, 120],
	);
});
test("compile-only parser cannot authorize browser or accept baseline/expected hashes", () => {
	// The old dummy Creator path cannot pass independent raw recipe admission.
	// Dedicated authored-recipe tests supply independently pinned positive bytes.
	assert.throws(() =>
		parseParticleAuthorityPrepareOptions([...compile, ...lane]),
	);
	for (const args of [
		compile,
		[...compile, ...lane, "--mode", "run"],
		[...compile, ...lane, "--compile-baseline-receipt", path],
		[...compile, ...lane, "--expected-sha", path],
		[...compile, ...lane, "--bun", path],
	])
		assert.throws(() => parseParticleAuthorityPrepareOptions(args));
});
test("baseline assertion distinguishes source dimensions from saved canvas and exact revision", () => {
	assertParticleBaselineState(baselineState());
	assert.deepEqual(PARTICLE_BASELINE_CONTRACT, {
		frameCount: 121,
		fps: { numerator: 30, denominator: 1 },
		durationTicks: 484000,
		width: 1920,
		height: 1080,
		opacity: 0.85,
	});
	for (const change of [
		(v) => {
			v.state.revision = 7;
		},
		(v) => {
			v.state.clips[0].editing.params.opacity = 0.55;
		},
		(v) => {
			v.state.clips[0].editing.type = "video";
			v.record.data.scenes[0].tracks.overlay[0].elements[0].type = "video";
		},
		(v) => {
			v.state.clips[0].editing.name = "Unexpected";
			v.record.data.scenes[0].tracks.overlay[0].elements[0].name = "Unexpected";
		},
		(v) => {
			v.state.clips[0].editing.definitionId = "Unexpected";
			v.record.data.scenes[0].tracks.overlay[0].elements[0].definitionId =
				"Unexpected";
		},
		(v) => {
			v.state.clips[0].editing.effects.push({ id: "unexpected" });
			v.record.data.scenes[0].tracks.overlay[0].elements[0].effects.push({
				id: "unexpected",
			});
		},
		(v) => {
			v.state.clips[0].editing.params.unexpected = true;
			v.record.data.scenes[0].tracks.overlay[0].elements[0].params.unexpected = true;
		},
		(v) => {
			v.source.width = 1920;
		},
		(v) => {
			v.record.data.settings.canvasSize.width = 320;
		},
		(v) => {
			v.state.clips[0].duration = 480000;
		},
		(v) => {
			v.source.build.inputProps.motion.scatterDurationTicks = 60000;
		},
	]) {
		const value = baselineState();
		change(value);
		assert.throws(() => assertParticleBaselineState(value));
	}
});
test("project closure conversion binds bytes as declared lengths in lexical order", () => {
	assert.deepEqual(
		particleClosureFiles({
			files: [
				{ path: "z", bytes: 2, sha256: "b" },
				{ path: "a", bytes: 1, sha256: "a" },
			],
		}),
		[
			{ path: "a", byteLength: 1, sha256: "a" },
			{ path: "z", byteLength: 2, sha256: "b" },
		],
	);
});
test("compile context is a distinct stage and cannot be reused as UI admission", async () => {
	const root = await mkdtemp(join(tmpdir(), "particle-compile-context-cpu-"));
	const authority = {
		authorityReceiptSha256: "a".repeat(64),
		metadata: { nativeAuthority: { wasmSha256: "b".repeat(64) } },
		assertOutputRoot: async () => {},
	};
	const selection = {
		kind: "new-authority",
		laneId: PARTICLE_AUTHORITY_LANE,
		receiptPath: join(root, "unapproved-authority.json"),
	};
	await writeFile(selection.receiptPath, "{}\n", { flag: "wx" });
	const path = await writeParticleCompileContext({
		authority,
		root,
		selection,
		paths: {},
	});
	const context = JSON.parse(await readFile(path, "utf8"));
	assert.equal(context.stage, "compile-only");
	assert.equal(Object.hasOwn(context, "baselineReceiptPath"), false);
	await assert.rejects(
		admitParticleAuthorityHostContext({
			root,
			path,
			executable: "",
			version: "",
		}),
	);
	await assert.rejects(
		admitParticleCompileHostContext({
			root,
			path,
			executable: "",
			version: "",
		}),
		/Receipt is not independently approved/,
	);
	await writeParticleCompileBootstrap({ authority, root, remember: readFile });
	const source = await readFile(join(root, "host.mjs"), "utf8");
	assert.ok(
		source.indexOf("await admitParticleCompileHostContext") <
			source.indexOf("installParticleAuthorityBrowserObserver({"),
	);
	assert.ok(
		source.indexOf("installParticleAuthorityBrowserObserver({") <
			source.indexOf('await import("./host-body.mjs")'),
	);
});
test("unexpected baseline or stage fields in compile context reject before authority access", async () => {
	const root = await mkdtemp(join(tmpdir(), "particle-compile-context-cpu-"));
	await mkdir(join(root, "unrelated"));
	const path = join(root, "particle-compile-authority-context.json");
	await writeFile(
		path,
		JSON.stringify({
			version: 1,
			stage: "compile-only",
			root,
			selection: {},
			paths: {},
			authorityReceiptSha256: "a".repeat(64),
			baselineReceiptPath: "b",
		}),
		{ flag: "wx" },
	);
	await assert.rejects(
		admitParticleCompileHostContext({
			root,
			path,
			executable: "",
			version: "",
		}),
		/deep-equal/,
	);
});
test("producer source preserves real two compile/apply/reopen and has no renderer/browser operation", async () => {
	const source = (
		await Promise.all(
			["host", "session", "inputs", "workflow"].map((part) =>
				readFile(
					new URL(`./particle-authority-compile-${part}.ts`, import.meta.url),
					"utf8",
				),
			),
		)
	).join("\n");
	assert.match(source, /programmatic\/build\/compile/);
	assert.match(source, /firstReceipt = await apply/);
	assert.match(source, /secondReceipt = await apply/);
	assert.match(source, /firstReopen/);
	assert.match(source, /secondReopen/);
	assert.match(source, /parseThreeParticleArchive/);
	assert.match(source, /loadThreeParticleRuntime/);
	assert.match(source, /actualWorkerClosedBeforeReceipt/);
	assert.doesNotMatch(
		source,
		/chromium\.launch|newPage\(|page\.evaluate|__ROCUT_TEST/,
	);
	assert.match(source, /compiled-unapproved/);
	assert.ok(
		/selfApproved:\s*false/.test(source),
		"Producer output must explicitly remain unapproved",
	);
});
