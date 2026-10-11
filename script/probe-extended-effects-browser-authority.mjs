// Seven original direct probes, unchanged oracles/inputs/timeouts. CPU prepare;
// one authorized browser lane, first failure retained, never an automatic retry.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { productionWasmDirectory, productionWasmSha256 } from "./production-probe-wasm.mjs";
import {
	assertFrozenAttemptUnchanged,
	frozenAttemptDigest,
	parseUtf8Json,
	pinFile,
	snapshotFrozenAttempt,
} from "./fixtures/frozen-attempt-identity.mjs";
import { pinProbeToolchain } from "./fixtures/probe-toolchain-closure.mjs";
import { assertGlassBrowserIdentity } from "./fixtures/glass-current-baseline-observer.mjs";
import {
	parseExtendedEffectsAuthorityCommand,
	selectExtendedEffectsCases,
	summarizeExtendedEffectsCoverage,
	validateExtendedEffectsPreparedCases,
} from "./fixtures/extended-effects-case-selection.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parent = join(root, ".artifacts/extended-effects-browser-authority");
const authority = productionWasmSha256;
const chrome =
	"C:/Users/Sayo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browserSha =
	"9b07943f834485b43c9d54caea2951c78715f9f07070a80ab6658465ebd3e711";
const browserVersion = "153.0.8010.12";
const ffmpegDirectory = "E:/Software/ffmpeg-6.0-full_build/bin";
const preload = "script/fixtures/extended-effects-browser-pins.mjs";
const extraSources = [
	"script/production-probe-wasm.mjs",
	"script/html-probe-wasm-binding.mjs",
	"script/fixtures/browser-probe-identity.mjs",
	"script/probe-extended-effects-browser-authority.mjs",
	"script/fixtures/extended-effects-case-selection.mjs",
	"script/__tests__/extended-effects-case-selection.test.mjs",
	"script/fixtures/extended-effects-browser-observer.mjs",
	"script/__tests__/extended-effects-browser-observer.test.mjs",
	preload,
	"script/fixtures/glass-current-baseline-observer.mjs",
	"script/fixtures/frozen-attempt-identity.mjs",
	"script/fixtures/probe-toolchain-closure.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/liquid-diagnostic-wasm.mjs",
	...new Set(
		selectExtendedEffectsCases({ chrome, ffmpegDirectory }).cases.map(
			({ entry }) => entry,
		),
	),
];
const config = {
	authority,
	chrome,
	browserSha,
	browserVersion,
	ffmpegDirectory,
	preload,
	extraSources,
};
const requireTools = createRequire(
	join(root, "apps/vite-example/package.json"),
);
const requireCompiler = createRequire(
	requireTools.resolve("vite/package.json"),
);
const browserEntries = [
	"script/fixtures/reveal-effects.ts",
	"script/fixtures/sweep-scroll.ts",
	"script/fixtures/mesh-scenes-browser.ts",
	"script/fixtures/liquid-browser-probe.ts",
	"packages/editor-contracts/src/index.ts",
	// Existing lazy imports in try/catch remain external in esbuild's metafile.
	// Audit their dependency graphs explicitly; this does not execute the probes.
	"packages/editor-classic/src/services/renderer/nodes/video-node.ts",
	"packages/editor-classic/src/services/renderer/nodes/blur-background-node.ts",
	"packages/editor-classic/src/services/renderer/nodes/transition-track-node.ts",
];
const save = (directory, name, value) =>
	writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n", {
		encoding: "utf8",
		flag: "wx",
	});
const fail = (error) => ({ name: error.name, message: error.message });
const samePath = (a, b) =>
	assert.equal(resolve(a).toLowerCase(), resolve(b).toLowerCase());

async function snapshot() {
	const frozen = await snapshotFrozenAttempt({
		root,
		manifestPath: join(root, "fixture-source.json"),
		extraSources,
		closures: { wasm: productionWasmDirectory, browser: dirname(chrome) },
		executables: [
			process.execPath,
			chrome,
			join(ffmpegDirectory, "ffmpeg.exe"),
			join(ffmpegDirectory, "ffprobe.exe"),
		],
	});
	// CPU-only module discovery, with no output files or evaluation of application
	// code. Pin whole actual resolved packages, not only package-lock declarations.
	const { metafile } = await requireCompiler("esbuild").build({
		absWorkingDir: root,
		entryPoints: browserEntries,
		bundle: true,
		write: false,
		outdir: "unused-cpu-only",
		packages: "external",
		platform: "browser",
		format: "esm",
		metafile: true,
		logLevel: "silent",
	});
	const runtimeRoots = [],
		resolutions = [];
	const manifest = parseUtf8Json(
		await readFile(join(root, "fixture-source.json")),
	);
	const manifestPaths = new Set(
		manifest.files.map(({ path }) => path.replaceAll("\\", "/")),
	);
	for (const [file, input] of Object.entries(metafile.inputs)) {
		assert(
			manifestPaths.has(file.replaceAll("\\", "/")),
			`Runtime source absent from frozen manifest: ${file}`,
		);
		for (const entry of input.imports) {
			if (!entry.external || entry.path.startsWith(".")) continue;
			if (entry.path === "opencut-wasm") {
				resolutions.push({
					importer: file,
					name: entry.path,
					alias: "rocut-html-private-wasm",
					entry: join(productionWasmDirectory, "opencut_wasm.js"),
					bootstrap: "html-probe-private-wasm",
				});
			} else if (entry.path === "@opencut/editor-contracts") {
				const actual = await realpath(
					createRequire(join(root, file)).resolve(entry.path),
				);
				samePath(actual, join(root, "packages/editor-contracts/src/index.ts"));
				resolutions.push({
					importer: file,
					name: entry.path,
					entry: actual,
					frozenBy: "fixture-source.json",
				});
			} else
				runtimeRoots.push({
					manifestPath: join(root, file),
					names: [entry.path],
				});
		}
	}
	frozen.runtimeGraph = {
		inputs: Object.keys(metafile.inputs).sort(),
		roots: runtimeRoots,
		resolutions,
	};
	frozen.toolchain = await pinProbeToolchain([
		{
			manifestPath: join(root, "apps/vite-example/package.json"),
			names: [
				"@playwright/test",
				"vite",
				"vite-plugin-wasm",
				"vite-plugin-top-level-await",
			],
		},
		...runtimeRoots,
	]);
	const mediabunny = frozen.toolchain.packages.find(
		({ name }) => name === "mediabunny",
	);
	assert(
		mediabunny,
		"Actual browser graph must include the independent media exporter",
	);
	samePath(
		mediabunny.closure.directory,
		await realpath(
			join(root, "packages/editor-classic/node_modules/mediabunny"),
		),
	);
	frozen.versions = {
		node: process.version,
		browser: {
			version: browserVersion,
			source:
				"fixed executable SHA256; actual context version must match at run",
		},
		ffmpeg: execFileSync(join(ffmpegDirectory, "ffmpeg.exe"), ["-version"], {
			windowsHide: true,
			encoding: "utf8",
		}).split(/\r?\n/)[0],
		ffprobe: execFileSync(join(ffmpegDirectory, "ffprobe.exe"), ["-version"], {
			windowsHide: true,
			encoding: "utf8",
		}).split(/\r?\n/)[0],
	};
	assert.equal(
		frozen.executables.files[1].sha256,
		browserSha,
		"Pinned Chromium differs",
	);
	assert.equal(
		(await pinFile(join(productionWasmDirectory, "opencut_wasm_bg.wasm"))).sha256,
		authority,
		"Clean-LF production WASM differs",
	);
	assert(
		!/\bapplyEffectPassesReadback\b/.test(
			new TextDecoder("utf-8", { fatal: true }).decode(
				await readFile(join(productionWasmDirectory, "opencut_wasm.js")),
			),
		),
		"Diagnostic exports cannot be production authority",
	);
	return frozen;
}
function unchanged(before, after) {
	assertFrozenAttemptUnchanged(before, after);
	assert.deepEqual(after.versions, before.versions, "Tool versions changed");
	assert.deepEqual(
		after.runtimeGraph,
		before.runtimeGraph,
		"Actual runtime dependency graph changed",
	);
}
function artifactFrom(stdout) {
	for (const line of stdout.split(/\r?\n/).reverse()) {
		try {
			const value = JSON.parse(line);
			if (typeof value.artifacts === "string") return value.artifacts;
		} catch {
			/* Original probe emits its artifact location as JSON. */
		}
	}
	throw Error("Original probe did not emit an artifact location");
}
async function invoke(fixed, attempt) {
	const env = { ...process.env, NO_COLOR: "1" };
	for (const key of Object.keys(env))
		if (
			/^(ROCUT_|ELFTIA_)/i.test(key) ||
			["NODE_OPTIONS", "BUN_OPTIONS"].includes(key.toUpperCase())
		)
			delete env[key];
	Object.assign(env, {
		ROCUT_GLASS_BROWSER_PIN_RECEIPT: join(attempt, "browser-pins-export.json"),
		ROCUT_GLASS_EXPECTED_WASM_SHA256: authority,
		ROCUT_TEST_WASM_DIRECTORY: productionWasmDirectory,
		ROCUT_PROBE_WASM_SHA256: authority,
	});
	const args = [
		"--import",
		pathToFileURL(join(root, preload)).href,
		fixed.entry,
		...fixed.args,
	];
	const output = [],
		errors = [];
	const result = await new Promise((complete) => {
		const child = spawn(process.execPath, args, {
			cwd: root,
			env,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
		child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
		child.once("error", (error) =>
			complete({ exitCode: null, error: String(error) }),
		);
		child.once("close", (exitCode, signal) => complete({ exitCode, signal }));
	});
	const stdout = Buffer.concat(output),
		stderr = Buffer.concat(errors);
	await writeFile(join(attempt, "stdout.log"), stdout, { flag: "wx" });
	await writeFile(join(attempt, "stderr.log"), stderr, { flag: "wx" });
	return {
		...result,
		command: [process.execPath, ...args],
		stdout: new TextDecoder("utf-8", { fatal: true }).decode(stdout),
	};
}
function validateEvidence(fixed, evidence, before) {
	assert.equal(evidence.ok, true, "Original probe oracle/decode failed");
	assert.equal(evidence.sourceCommit, before.head);
	assert.equal(evidence.sourceManifestSha256, before.fixture.sha256);
	assert.equal(evidence.wasmSha256, authority);
	if (fixed.mode !== null) assert.equal(evidence.mode, fixed.mode);
	if (fixed.id.startsWith("liquid-2d-")) {
		assert.equal(evidence.defaultWasmSha256, authority);
		assert.equal(
			evidence.diagnosticWasmSha256,
			null,
			"Diagnostic WASM is not a production result",
		);
		assert.equal(evidence.attempts.length, 1, "No hidden second backend");
		const attempt = evidence.attempts[0];
		assert.equal(attempt.requestedBackend, fixed.args[2]);
		assert.equal(
			attempt.backend,
			fixed.args[2],
			"Native initialization must select the requested backend",
		);
		assert.equal(attempt.ok, true);
		assert.equal(attempt.decoded?.ok, true);
		assert.equal(attempt.mode, "production-surface");
		assert.equal(attempt.raster?.ok, true);
		assert.equal(attempt.timeline?.ok, true);
		assert.equal(attempt.video?.ok, true);
		assert.equal(
			attempt.video.frames,
			6,
			"Full original native export must complete",
		);
		assert.deepEqual(attempt.failures, []);
		assert.equal(attempt.browser, browserVersion);
		assert.deepEqual(attempt.errors, []);
		assert.deepEqual(attempt.externalRequests, []);
	} else {
		assert.equal(evidence.browser, browserVersion);
		assert.deepEqual(evidence.errors, []);
		assert.deepEqual(evidence.externalRequests, []);
		if (fixed.id === "mesh-refraction-raster") {
			assert.equal(
				evidence.backend,
				"private Chromium direct production WebGL2 mesh raster; no WASM scene/export/Host/Electron",
			);
			assert.deepEqual(
				evidence.decoded,
				[],
				"Raster-only case must not acquire export coverage",
			);
		} else {
			assert(
				Array.isArray(evidence.exports) && evidence.exports.length > 0,
				"Original full native init/render/export must complete, not only WASM instantiate",
			);
			assert(
				Array.isArray(evidence.decoded) &&
					evidence.decoded.length === evidence.exports.length,
			);
			assert(evidence.decoded.every(({ ok }) => ok === true));
			assert.deepEqual(
				evidence.decoded.map(({ name }) => name),
				evidence.exports.map(({ name }) => name),
			);
			for (const exported of evidence.exports) {
				const video =
					fixed.id === "mesh" || fixed.id === "cloth"
						? exported.evidence
						: exported;
				assert.equal(
					video.frames,
					6,
					"Uncapped original native export frame count",
				);
				assert(video.bytes > 0, "Native export artifact bytes are required");
			}
			const names = evidence.exports.map(({ name }) => name);
			if (fixed.id === "reveal")
				assert.deepEqual(names, ["laser", "decrypt-reveal"]);
			else if (fixed.id === "sweep")
				assert.deepEqual(names, ["ascii-sweep", "particle-scroll", "overlay"]);
			else {
				assert(names.includes("cloth-events") && names.includes("cloth-wind"));
				if (fixed.id === "mesh")
					assert(
						names.includes("bend") &&
							names.includes("bend-back") &&
							names.includes("shatter") &&
							names.some((name) => name.startsWith("grid")) &&
							names.some((name) => name.startsWith("hex")),
					);
			}
		}
	}
}
async function retainEvidence(fixed, attempt, result, caseReport) {
	// Keep failure artifacts and actual byte witness even when the child exits nonzero.
	let evidence, witness;
	try {
		const artifacts = await realpath(artifactFrom(result.stdout));
		samePath(
			dirname(artifacts),
			join(root, ".artifacts", fixed.artifactParent),
		);
		assert(/^run-[a-zA-Z0-9]+$/.test(basename(artifacts)));
		caseReport.artifacts = artifacts;
		caseReport.probeEvidence = await pinFile(join(artifacts, "evidence.json"));
		evidence = parseUtf8Json(await readFile(join(artifacts, "evidence.json")));
	} catch (error) {
		caseReport.probeEvidenceFailure = fail(error);
	}
	try {
		const path = join(attempt, "browser-pins-export.json");
		caseReport.byteWitness = await pinFile(path);
		witness = parseUtf8Json(await readFile(path));
	} catch (error) {
		caseReport.byteWitnessFailure = fail(error);
	}
	return { evidence, witness };
}
async function run(group, plan, selected) {
	// Atomic create is deliberately outside the run catch: a used group can never
	// retry or replace an original attempt receipt, including bootstrap failures.
	await save(group, "run-start.json", {
		startedAt: new Date().toISOString(),
		pid: process.pid,
		plan: await pinFile(join(group, "plan.json")),
	});
	const report = {
		schema: "rocut-extended-effects-authority-attempt/v1",
		group,
		startedAt: new Date().toISOString(),
		selection: selected.selection,
		results: [],
		passed: false,
		retries: 0,
		capped: false,
		skipped: false,
		installedPluginTested: false,
		electronTested: false,
		expectedWasmSha256: authority,
		scopeDescription:
			"Seven existing direct Chromium subchains; refraction is raster-only, not export. No Host/editor/installed Electron/full MV/all hardware acceptance.",
	};
	let before;
	try {
		before = await snapshot();
		unchanged(plan.frozen, before);
		await save(group, "before.json", before);
		for (const fixed of selected.cases) {
			const attempt = await mkdtemp(join(group, `${fixed.id}-attempt-`));
			const caseReport = {
				id: fixed.id,
				attempt,
				passed: false,
				startedAt: new Date().toISOString(),
			};
			report.results.push(caseReport);
			let beforeCase;
			try {
				beforeCase = await snapshot();
				await save(attempt, "before.json", beforeCase);
				unchanged(before, beforeCase);
				console.log(JSON.stringify({ starting: fixed.id, attempt }));
				const result = await invoke(fixed, attempt);
				caseReport.process = {
					exitCode: result.exitCode,
					signal: result.signal,
					error: result.error,
					command: result.command,
				};
				const { evidence, witness } = await retainEvidence(
					fixed,
					attempt,
					result,
					caseReport,
				);
				assert.equal(
					result.exitCode,
					0,
					"Original probe failed; first attempt retained, no retry",
				);
				assert(evidence, "Original probe evidence unavailable");
				validateEvidence(fixed, evidence, beforeCase);
				assert(witness, "Actual served/loaded witness unavailable");
				assert.equal(witness.ok, true);
				assert.equal(witness.expectedSha256, authority);
				assert.equal(witness.launches, 1);
				assert.equal(witness.browserVersion, browserVersion);
				assert.equal(witness.identity?.servedAuthority, true);
				assert.equal(witness.identity?.loadedAuthority, true);
				assert.deepEqual(
					witness.identity,
					assertGlassBrowserIdentity(witness, authority),
					"Witness must validate actual recorded bytes, not claimed booleans",
				);
				const afterCase = await snapshot();
				await save(attempt, "after.json", afterCase);
				unchanged(beforeCase, afterCase);
				caseReport.identitiesUnchanged = true;
				caseReport.passed = true;
			} catch (error) {
				caseReport.failure = fail(error);
				try {
					const afterFailure = await snapshot();
					await save(attempt, "after-failure.json", afterFailure);
					caseReport.afterFailureHashes = frozenAttemptDigest(afterFailure);
					if (beforeCase) {
						unchanged(beforeCase, afterFailure);
						caseReport.identitiesUnchanged = true;
					}
				} catch (identityError) {
					caseReport.identityFailure = fail(identityError);
				}
			} finally {
				caseReport.finishedAt = new Date().toISOString();
				await save(attempt, "receipt.json", caseReport);
			}
			if (!caseReport.passed) break;
		}
	} catch (error) {
		report.failure = fail(error);
	} finally {
		Object.assign(
			report,
			summarizeExtendedEffectsCoverage({
				selection: selected.selection,
				results: report.results,
			}),
		);
		try {
			const after = await snapshot();
			await save(group, "after.json", after);
			if (before) {
				unchanged(before, after);
				report.identitiesUnchanged = true;
			}
		} catch (error) {
			report.identityFailure = fail(error);
		}
		if (
			report.failure ||
			report.identityFailure ||
			!report.identitiesUnchanged
		) {
			report.passed = false;
			report.status = "failed";
			report.fullSevenAcceptance = false;
		}
		report.finishedAt = new Date().toISOString();
		await save(group, "receipt.json", report);
		console.log(
			JSON.stringify({
				group,
				passed: report.passed,
				status: report.status,
				scope: report.scope,
				fullSevenAcceptance: report.fullSevenAcceptance,
				caseFailure: report.results.at(-1)?.failure,
			}),
		);
	}
	process.exitCode = report.passed ? 0 : 1;
}

const command = parseExtendedEffectsAuthorityCommand(process.argv.slice(2));
if (command.mode === "--prepare") {
	const selected = selectExtendedEffectsCases({
		chrome,
		ffmpegDirectory,
		caseId: command.caseId,
	});
	await mkdir(parent, { recursive: true });
	samePath(await realpath(parent), parent);
	const group = await mkdtemp(join(parent, "run-"));
	const frozen = await snapshot();
	assert.equal(
		frozen.fixture.valid,
		true,
		"Fresh freeze required before preparing",
	);
	const plan = {
		schema: "rocut-extended-effects-authority-plan/v1",
		version: 1,
		root,
		group,
		config,
		...selected,
		frozen,
		browserLaunched: false,
	};
	await save(group, "prepare-before.json", frozen);
	const after = await snapshot();
	await save(group, "prepare-after.json", after);
	unchanged(frozen, after);
	await save(group, "plan.json", plan);
	await save(group, "plan-pin.json", await pinFile(join(group, "plan.json")));
	console.log(
		JSON.stringify({
			prepared: true,
			group,
			selection: selected.selection,
			browserLaunched: false,
		}),
	);
} else {
	assert.equal(
		process.env.ROCUT_BROWSER_WINDOW_AUTHORIZED,
		"1",
		"Exclusive browser allocation required",
	);
	const group = await realpath(command.group);
	samePath(dirname(group), parent);
	assert(/^run-[a-zA-Z0-9]+$/.test(basename(group)));
	const plan = parseUtf8Json(await readFile(join(group, "plan.json")));
	assert.deepEqual(
		await pinFile(join(group, "plan.json")),
		parseUtf8Json(await readFile(join(group, "plan-pin.json"))),
		"Prepared plan changed",
	);
	assert.equal(plan.schema, "rocut-extended-effects-authority-plan/v1");
	assert.equal(plan.root, root);
	assert.equal(plan.group, group);
	assert.deepEqual(plan.config, config);
	const selected = validateExtendedEffectsPreparedCases({
		plan,
		chrome,
		ffmpegDirectory,
	});
	await run(group, plan, selected);
}
