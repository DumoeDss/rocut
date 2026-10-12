// Existing six modes, untouched gates. --prepare is CPU-only; --run is exclusive.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parent = join(root, ".artifacts/canvas-browser-authority");
const modes = [
	"default",
	"generators",
	"spatial",
	"magnify",
	"displacement",
	"wave",
];
const authority = productionWasmSha256;
const chrome =
	"C:/Users/Sayo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browserSha =
	"9b07943f834485b43c9d54caea2951c78715f9f07070a80ab6658465ebd3e711";
const preload = "script/fixtures/glass-current-baseline-browser-pins.mjs";
const entry = "script/probe-stylized-effects.mjs";
const extraSources = [
	"script/production-probe-wasm.mjs",
	"script/html-probe-wasm-binding.mjs",
	"script/fixtures/browser-probe-identity.mjs",
	"script/probe-canvas-browser-authority.mjs",
	"script/fixtures/frozen-attempt-identity.mjs",
	"script/fixtures/probe-toolchain-closure.mjs",
	"script/__tests__/probe-toolchain-closure.test.mjs",
	"script/__tests__/frozen-attempt-identity.test.mjs",
	preload,
	"script/fixtures/glass-current-baseline-observer.mjs",
	entry,
	"script/browser-probe-toolchain.mjs",
];
const snapshot = async () => {
	const frozen = await snapshotFrozenAttempt({
		root,
		manifestPath: join(root, "fixture-source.json"),
		extraSources,
		closures: { wasm: productionWasmDirectory, browser: dirname(chrome) },
		executables: [process.execPath, chrome],
	});
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
		{
			manifestPath: join(root, "packages/editor-classic/package.json"),
			names: ["mediabunny"],
		},
	]);
	return frozen;
};
const save = (directory, name, value) =>
	writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n", {
		encoding: "utf8",
		flag: "wx",
	});
const prefix = {
	default: "stylized-effects",
	generators: "stylized-generators",
	spatial: "spatial-effects",
	magnify: "magnify-effects",
	displacement: "displacement-effects",
	wave: "wave-effects",
};

function lastArtifact(stdout) {
	for (const line of stdout.split(/\r?\n/).reverse()) {
		try {
			const result = JSON.parse(line);
			if (typeof result.artifacts === "string") return result.artifacts;
		} catch {
			/* Only the existing probe's final JSON is relevant. */
		}
	}
	throw Error("Existing probe did not return an artifact location");
}

async function invoke(mode, attempt) {
	const env = {
		...process.env,
		NO_COLOR: "1",
		ROCUT_PROBE_BROWSER_PATH: chrome,
		ROCUT_GLASS_BROWSER_PIN_RECEIPT: join(attempt, "browser-pins-export.json"),
		ROCUT_GLASS_EXPECTED_WASM_SHA256: authority,
		ROCUT_TEST_WASM_DIRECTORY: productionWasmDirectory,
		ROCUT_PROBE_WASM_SHA256: authority,
	};
	for (const key of Object.keys(env)) {
		if (
			[
				"NODE_OPTIONS",
				"BUN_OPTIONS",
				"ELFTIA_HTML_FRAME_CONNECTION_FILE",
			].includes(key.toUpperCase())
		)
			delete env[key];
	}
	const args = [
		"--import",
		pathToFileURL(join(root, preload)).href,
		entry,
		...(mode === "default" ? [] : [`--${mode}`]),
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

async function run(group, plan) {
	const report = {
		schema: "rocut-canvas-authority-attempt/v1",
		group,
		startedAt: new Date().toISOString(),
		passed: false,
		results: [],
		retries: 0,
		capped: false,
		skipped: false,
		installedPluginTested: false,
		electronTested: false,
		expectedWasmSha256: authority,
		scope:
			"Six existing standalone Chromium WebGPU/SwiftShader modes; not editor UI, installed Electron, all hardware or full MV. Legacy-named Glass byte observer is reused only as an independent actual served/loaded witness.",
	};
	let before;
	try {
		before = await snapshot();
		assertFrozenAttemptUnchanged(plan.frozen, before);
		await save(group, "before.json", before);
		for (const mode of modes) {
			const attempt = await mkdtemp(join(group, `${mode}-attempt-`));
			const caseReport = {
				mode,
				attempt,
				passed: false,
				startedAt: new Date().toISOString(),
			};
			report.results.push(caseReport);
			try {
				const beforeCase = await snapshot();
				await save(attempt, "before.json", beforeCase);
				assertFrozenAttemptUnchanged(before, beforeCase);
				console.log(JSON.stringify({ starting: mode, attempt }));
				const result = await invoke(mode, attempt);
				caseReport.process = {
					exitCode: result.exitCode,
					signal: result.signal,
					error: result.error,
					command: result.command,
				};
				assert.equal(
					result.exitCode,
					0,
					"Existing probe failed; logs retained, no retry",
				);
				const artifacts = await realpath(lastArtifact(result.stdout));
				assert.equal(
					dirname(artifacts).toLowerCase(),
					join(root, ".artifacts", prefix[mode]).toLowerCase(),
				);
				assert(/^run-[a-zA-Z0-9]+$/.test(basename(artifacts)));
				caseReport.artifacts = artifacts;
				caseReport.probeEvidence = await pinFile(
					join(artifacts, "evidence.json"),
				);
				const evidence = parseUtf8Json(
					await readFile(join(artifacts, "evidence.json")),
				);
				assert.equal(evidence.ok, true);
				assert.deepEqual(evidence.errors, []);
				assert.deepEqual(evidence.externalRequests, []);
				assert.equal(evidence.wasmSha256, authority);
				assert.equal(evidence.sourceCommit, before.head);
				assert.equal(evidence.sourceManifestSha256, before.fixture.sha256);
				const witness = parseUtf8Json(
					await readFile(join(attempt, "browser-pins-export.json")),
				);
				assert.equal(
					witness.ok,
					true,
					"Actual served/loaded WASM witness failed",
				);
				assert.equal(witness.expectedSha256, authority);
				assert.equal(witness.identity.servedAuthority, true);
				assert.equal(witness.identity.loadedAuthority, true);
				caseReport.byteWitness = await pinFile(
					join(attempt, "browser-pins-export.json"),
				);
				const afterCase = await snapshot();
				await save(attempt, "after.json", afterCase);
				assertFrozenAttemptUnchanged(beforeCase, afterCase);
				caseReport.identitiesUnchanged = true;
				caseReport.passed = true;
			} catch (error) {
				caseReport.failure = { name: error.name, message: error.message };
				// Keep after identity even when native/oracle/encode gates fail.
				const afterFailure = await snapshot();
				await save(attempt, "after-failure.json", afterFailure);
				caseReport.afterFailureHashes = frozenAttemptDigest(afterFailure);
			} finally {
				caseReport.finishedAt = new Date().toISOString();
				await save(attempt, "receipt.json", caseReport);
			}
			if (!caseReport.passed) break;
		}
		report.passed =
			report.results.length === modes.length &&
			report.results.every((value) => value.passed);
	} catch (error) {
		report.failure = { name: error.name, message: error.message };
	} finally {
		try {
			const after = await snapshot();
			await save(group, "after.json", after);
			if (before) assertFrozenAttemptUnchanged(before, after);
			report.identitiesUnchanged = !!before;
		} catch (error) {
			report.passed = false;
			report.identityFailure = { name: error.name, message: error.message };
		}
		report.unexecuted = modes.slice(report.results.length);
		report.finishedAt = new Date().toISOString();
		await save(group, "receipt.json", report);
		console.log(
			JSON.stringify({
				group,
				passed: report.passed,
				completed: report.results.length,
				total: modes.length,
				failure: report.failure,
				caseFailure: report.results.at(-1)?.failure,
			}),
		);
	}
	process.exitCode = report.passed ? 0 : 1;
}

assert.equal(
	(await pinFile(chrome)).sha256,
	browserSha,
	"Browser differs from frozen authority",
);
assert.equal(
	(await pinFile(join(productionWasmDirectory, "opencut_wasm_bg.wasm"))).sha256,
	authority,
);
if (process.argv[2] === "--prepare" && process.argv.length === 3) {
	await mkdir(parent, { recursive: true });
	const group = await mkdtemp(join(parent, "run-"));
	const frozen = await snapshot();
	assert.equal(frozen.fixture.valid, true);
	await save(group, "plan.json", {
		schema: "rocut-canvas-authority-plan/v1",
		root,
		group,
		modes,
		frozen,
		authority,
		browserLaunched: false,
	});
	console.log(
		JSON.stringify({ prepared: true, group, browserLaunched: false }),
	);
} else if (process.argv[2] === "--run" && process.argv.length === 4) {
	assert.equal(process.env.ROCUT_BROWSER_WINDOW_AUTHORIZED, "1");
	const group = await realpath(process.argv[3]);
	assert.equal(dirname(group).toLowerCase(), parent.toLowerCase());
	assert(/^run-[a-zA-Z0-9]+$/.test(basename(group)));
	const plan = parseUtf8Json(await readFile(join(group, "plan.json")));
	assert.equal(plan.schema, "rocut-canvas-authority-plan/v1");
	assert.equal(plan.root, root);
	assert.equal(plan.group, group);
	assert.equal(plan.authority, authority);
	assert.deepEqual(plan.modes, modes);
	await run(group, plan);
} else
	throw Error(
		"Use --prepare, then --run <group> after exclusive browser allocation",
	);
