#!/usr/bin/env node
// Independent current-authority receipts. Preparation never launches a browser,
// builds Vite, generates fixture-source.json, or overwrites historical evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import {
	basename,
	dirname,
	join,
	relative,
	resolve,
	isAbsolute,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pinInkHostToolchain } from "./fixtures/ink-object-host-toolchain.mjs";
import { assertGlassBrowserIdentity } from "./fixtures/glass-current-baseline-observer.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const group = resolve(repo, "../..");
const authoritySha256 =
	"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12";
const config = {
	repo,
	creator: join(
		group,
		"elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/glass-object.mjs",
	),
	canonicalPkg: join(repo, "rust/wasm/pkg"),
	browserPkg:
		"C:/Users/Sayo/AppData/Local/Temp/rocut-wasm-authority-20261011-GVDTX4/browser-pkg-v2-sntQBC",
	toolchain:
		"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/.artifacts/three-toolchain/run-3Hn5Nw",
	chromium:
		"C:/Users/Sayo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
	bun: "C:/Users/Sayo/.bun/bin/bun.exe",
	ffmpeg: "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe",
	ffprobe: "E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe",
};
const ownedFiles = [
	"script/run-glass-current-baseline.mjs",
	"script/fixtures/glass-current-baseline-observer.mjs",
	"script/fixtures/glass-current-baseline-observer.test.mjs",
	"script/fixtures/glass-current-baseline-browser-pins.mjs",
	"script/fixtures/glass-current-baseline-host-pins.mjs",
];
const fixedSources = [
	...ownedFiles,
	"script/probe-glass-editor.mjs",
	"script/probe-glass-object-editor-export.mjs",
	"script/fixtures/glass-editor-host.ts",
	"script/fixtures/glass-editor-checks.mjs",
	"script/fixtures/glass-object-editor-export-host.ts",
	"script/fixtures/glass-object-editor-export-browser.ts",
	"script/fixtures/glass-object-gpu-assets.ts",
	"script/fixtures/local-wasm-preload.mjs",
	"script/browser-probe-toolchain.mjs",
	"apps/vite-example/vite.config.ts",
	"apps/vite-example/build/editor-assets.ts",
	"apps/cli/src/programmatic/engines/three-driver.ts",
	"apps/cli/src/programmatic/engines/three-assets-driver.ts",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function pin(path) {
	const physical = await realpath(path);
	const bytes = await readFile(physical);
	return {
		path: resolve(path),
		physical,
		bytes: bytes.length,
		sha256: hash(bytes),
	};
}
async function tree(path) {
	const items = [];
	async function walk(directory) {
		for (const name of (await readdir(directory)).sort()) {
			const next = join(directory, name),
				stats = await lstat(next);
			assert(!stats.isSymbolicLink(), "Pinned asset tree may not redirect");
			if (stats.isDirectory()) await walk(next);
			else {
				assert(stats.isFile() && items.length < 10000);
				items.push(await pin(next));
			}
		}
	}
	await walk(path);
	return items;
}
async function pins() {
	const result = {
		sources: await Promise.all(
			fixedSources.map((path) => pin(join(repo, path))),
		),
		creator: await Promise.all(
			[
				config.creator,
				join(dirname(config.creator), "glass-object-scene.ts"),
			].map(pin),
		),
		canonicalPkg: await tree(config.canonicalPkg),
		browserPkg: await tree(config.browserPkg),
		toolchain: await pinInkHostToolchain(config.toolchain),
		fonts: [
			...(await tree(join(repo, "apps/web/public/fonts"))),
			...(await tree(join(repo, "apps/web/public/motion-text/fonts"))),
		],
		executables: await Promise.all(
			[
				process.execPath,
				config.bun,
				config.chromium,
				config.ffmpeg,
				config.ffprobe,
			].map(pin),
		),
	};
	for (const files of [result.canonicalPkg, result.browserPkg])
		assert.equal(
			files.find((file) => basename(file.path) === "opencut_wasm_bg.wasm")
				?.sha256,
			authoritySha256,
		);
	return result;
}
const gitHead = () =>
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: repo,
		encoding: "utf8",
		windowsHide: true,
	}).trim();
const parent = join(repo, ".artifacts/glass-current-baseline");
const [mode, planArg] = process.argv.slice(2);
assert(
	(mode === "--prepare" && !planArg) || (mode === "--run" && planArg),
	"Usage: run-glass-current-baseline.mjs --prepare | --run <owned plan.json>",
);

if (mode === "--prepare") {
	await mkdir(parent, { recursive: true });
	const root = await mkdtemp(join(parent, "run-"));
	const plan = {
		version: 1,
		mode: "prepared-only",
		root,
		config,
		authoritySha256,
		createdAt: new Date().toISOString(),
		sourceHeadAtPreparation: gitHead(),
		pins: await pins(),
		browserStarted: false,
		viteBuilt: false,
		fixtureSourceGenerated: false,
		awaiting:
			"Parent unified source manifest/commit and explicit browser-window release",
		scope:
			"Real editor inputProps edit/recompile/apply/undo/redo/reload/reopen, then actual production all-49-frame export and independent FFmpeg decode. No installed plugin or Electron claims.",
		standaloneCaptureIdentity: {
			observedLoadedWasm: false,
			opencutAuthorityWasmApplicable: false,
			reason:
				"Glass ordinary Three driver imports Three/three-assets/noble hashes, not opencut-wasm. Standalone Chromium is not wrapped by the Playwright observer. No derivative-loaded claim is made for that realm.",
		},
		commands: {
			editor:
				"probe-glass-editor.mjs with browser observer import and separate Bun Host byte/resolver preload",
			export:
				"ROCUT_GLASS_EXPORT_FULL=1 probe-glass-object-editor-export.mjs with browser observer and explicit Node Host byte/resolver preload",
		},
	};
	await writeFile(
		join(root, "plan.json"),
		JSON.stringify(plan, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			ok: true,
			preparedOnly: true,
			root,
			plan: join(root, "plan.json"),
			sourceFiles: plan.pins.sources.length,
			fonts: plan.pins.fonts.length,
			toolchainFiles: plan.pins.toolchain.files.length,
		}),
	);
} else {
	assert(isAbsolute(planArg));
	const planPath = resolve(planArg),
		root = dirname(planPath);
	assert.equal(dirname(root), parent);
	assert(
		/^run-[A-Za-z0-9]+$/.test(basename(root)) &&
			basename(planPath) === "plan.json",
	);
	assert.equal(await realpath(root), root);
	const plan = JSON.parse(await readFile(planPath, "utf8"));
	assert.deepEqual(plan.config, config);
	assert.equal(plan.root, root);
	const evidencePath = join(root, "evidence.json");
	// Exclusive claim prevents a second run from replacing a completed/failed run.
	await writeFile(evidencePath, "{}\n", { flag: "wx" });
	const report = {
		version: 1,
		ok: false,
		root,
		startedAt: new Date().toISOString(),
		sourceHead: gitHead(),
		plan: await pin(planPath),
		authoritySha256,
		config,
		standaloneCaptureIdentity: plan.standaloneCaptureIdentity,
		installedPluginTested: false,
		electronTested: false,
	};
	const persist = () =>
		writeFile(evidencePath, JSON.stringify(report, null, 2) + "\n");
	const env = {
		...process.env,
		ROCUT_TEST_WASM_DIRECTORY: config.browserPkg,
		ROCUT_GLASS_HOST_WASM_DIRECTORY: config.browserPkg,
		ROCUT_GLASS_EXPECTED_WASM_SHA256: authoritySha256,
		GOMAXPROCS: "2",
	};
	for (const name of [
		"NODE_OPTIONS",
		"BUN_OPTIONS",
		"OPENCUT_WASM_ALLOW_UNPINNED",
		"ELFTIA_HTML_FRAME_CONNECTION_FILE",
	])
		delete env[name];
	const browserObserver = join(
		repo,
		"script/fixtures/glass-current-baseline-browser-pins.mjs",
	);
	const hostObserver = join(
		repo,
		"script/fixtures/glass-current-baseline-host-pins.mjs",
	);
	async function run(stage, args, extraEnv) {
		const child = spawn(process.execPath, args, {
			cwd: repo,
			windowsHide: true,
			env: { ...env, ...extraEnv },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			process.stdout.write(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			process.stderr.write(chunk);
		});
		const code = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		await writeFile(join(root, `${stage}.stdout.log`), stdout, { flag: "wx" });
		await writeFile(join(root, `${stage}.stderr.log`), stderr, { flag: "wx" });
		const envelopes = stdout.split(/\r?\n/).flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
		report[stage] = {
			code,
			args,
			stdout: await pin(join(root, `${stage}.stdout.log`)),
			stderr: await pin(join(root, `${stage}.stderr.log`)),
			terminal: envelopes.at(-1),
		};
		await persist();
		assert.equal(
			code,
			0,
			`${stage} technical failure retained; no automatic retry`,
		);
		assert.equal(
			envelopes.at(-1)?.ok,
			true,
			`${stage} probe did not report success`,
		);
		return envelopes.at(-1);
	}
	try {
		report.pinsBefore = await pins();
		assert.deepEqual(
			report.pinsBefore,
			plan.pins,
			"Preparation inputs changed before run; prepare a fresh owned run",
		);
		const manifestPath = join(repo, "fixture-source.json"),
			bytes = await readFile(manifestPath);
		const manifest = JSON.parse(bytes);
		report.sourceManifest = await pin(manifestPath);
		report.sourceManifestFilesBefore = [];
		for (const file of manifest.files) {
			assert(
				!isAbsolute(file.path) &&
					!relative(repo, resolve(repo, file.path)).startsWith(".."),
			);
			const item = await pin(join(repo, file.path));
			assert.equal(
				item.sha256,
				file.sha256,
				`Unified manifest drift: ${file.path}`,
			);
			report.sourceManifestFilesBefore.push(item);
		}
		await persist();
		const editor = await run(
			"editor",
			[
				"--import",
				pathToFileURL(browserObserver).href,
				"script/probe-glass-editor.mjs",
				root,
				config.chromium,
				config.bun,
				config.creator,
				config.browserPkg,
				config.toolchain,
			],
			{
				ROCUT_GLASS_BROWSER_PIN_RECEIPT: join(root, "browser-pins-editor.json"),
				ROCUT_GLASS_HOST_PIN_RECEIPT: join(root, "host-pins-editor.json"),
			},
		);
		report.editorEvidence = await pin(join(editor.artifacts, "evidence.json"));
		for (const role of ["browser", "host"]) {
			const value = JSON.parse(
				await readFile(join(root, `${role}-pins-editor.json`), "utf8"),
			);
			assert.equal(value.ok, true, `${role} editor byte identity failed`);
			if (role === "browser")
				assertGlassBrowserIdentity(value, authoritySha256);
			report[`${role}EditorIdentity`] = value;
		}
		const exported = await run(
			"export",
			[
				"--import",
				pathToFileURL(hostObserver).href,
				"--import",
				pathToFileURL(browserObserver).href,
				"script/probe-glass-object-editor-export.mjs",
				editor.artifacts,
				config.browserPkg,
				config.toolchain,
				config.chromium,
				config.ffmpeg,
				config.ffprobe,
			],
			{
				ROCUT_GLASS_EXPORT_FULL: "1",
				ROCUT_GLASS_BROWSER_PIN_RECEIPT: join(root, "browser-pins-export.json"),
				ROCUT_GLASS_HOST_PIN_RECEIPT: join(root, "host-pins-export.json"),
			},
		);
		report.exportEvidence = await pin(join(exported.root, "evidence.json"));
		const exportedReceipt = JSON.parse(
			await readFile(report.exportEvidence.path, "utf8"),
		);
		assert.equal(exportedReceipt.production.frameCount, 49);
		assert.equal(exportedReceipt.probe.streams[0].nb_read_frames, "49");
		assert.equal(exportedReceipt.projectUnchanged, true);
		for (const role of ["browser", "host"]) {
			const value = JSON.parse(
				await readFile(join(root, `${role}-pins-export.json`), "utf8"),
			);
			assert.equal(value.ok, true, `${role} export byte identity failed`);
			if (role === "browser")
				assertGlassBrowserIdentity(value, authoritySha256);
			report[`${role}ExportIdentity`] = value;
		}
		report.workflowSucceeded = true;
	} catch (error) {
		report.failure = {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
		process.exitCode = 1;
	} finally {
		report.pinsAfter = await pins();
		report.pinsUnchanged =
			JSON.stringify(report.pinsBefore) === JSON.stringify(report.pinsAfter);
		if (report.sourceManifestFilesBefore) {
			report.sourceManifestFilesAfter = await Promise.all(
				report.sourceManifestFilesBefore.map((item) => pin(item.path)),
			);
			report.sourceManifestAfter = await pin(join(repo, "fixture-source.json"));
			report.sourceManifestUnchanged =
				JSON.stringify(report.sourceManifest) ===
					JSON.stringify(report.sourceManifestAfter) &&
				JSON.stringify(report.sourceManifestFilesBefore) ===
					JSON.stringify(report.sourceManifestFilesAfter);
		}
		report.ok =
			report.workflowSucceeded === true &&
			report.pinsUnchanged &&
			report.sourceManifestUnchanged;
		if (!report.ok) process.exitCode = 1;
		report.finishedAt = new Date().toISOString();
		await persist();
		console.log(
			JSON.stringify({
				ok: report.ok,
				root,
				evidence: evidencePath,
				failure: report.failure?.message,
			}),
		);
	}
}
