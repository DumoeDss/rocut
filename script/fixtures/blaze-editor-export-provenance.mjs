import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { blazeEditorDigest as digest } from "./blaze-editor-control.mjs";
import { validateBlazeEditorInputs } from "./blaze-editor-provenance.mjs";
import { assertBlazeHostRealPath } from "./blaze-host-paths.mjs";
import { blazeEditorExportFiles } from "./blaze-editor-export-contract.mjs";

async function packageDescriptor(entry, expectedName) {
	let directory = dirname(await realpath(entry));
	for (let depth = 0; depth < 8; depth++) {
		const candidate = join(directory, "package.json");
		const bytes = await readFile(candidate).catch((error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (bytes && JSON.parse(bytes).name === expectedName) return candidate;
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	throw Error(`Missing package descriptor for ${expectedName}`);
}

export async function validateBlazeEditorExportInputs(configPath, sourceRoot) {
	await assertBlazeHostRealPath(configPath);
	const bytes = await readFile(configPath),
		config = JSON.parse(bytes);
	assert.deepEqual(
		Object.keys(config).sort(),
		[
			"uiConfigPath",
			"uiConfigSha256",
			"uiEvidence",
			"uiEvidenceSha256",
			"ffmpegDirectory",
		].sort(),
	);
	for (const key of ["uiConfigSha256", "uiEvidenceSha256"])
		assert(/^[a-f0-9]{64}$/.test(config[key]));
	for (const key of ["uiConfigPath", "uiEvidence"])
		await assertBlazeHostRealPath(config[key]);
	assert.equal(
		digest(await readFile(config.uiConfigPath)),
		config.uiConfigSha256,
	);
	const ui = await validateBlazeEditorInputs(config.uiConfigPath, sourceRoot);
	const previousBytes = await readFile(config.uiEvidence),
		previous = JSON.parse(previousBytes);
	assert.equal(digest(previousBytes), config.uiEvidenceSha256);
	assert(
		previous.ok &&
			previous.cleanup.browserClosed &&
			previous.cleanup.hostClosed &&
			!previous.cleanup.forced,
	);
	assert.deepEqual(previous.cleanup.errors, []);
	assert.equal(previous.uiHistory.length, 10);
	assert.equal(previous.seekSequences.length, 2);
	assert(
		previous.hostRestart.byteIdentical &&
			previous.hostRestart.resourceStillAvailable,
	);
	assert.equal(previous.hostRestart.snapshot.revision, 31);
	assert.equal(previous.provenance.wasmSha256, ui.config.wasmSha256);
	const manifest = JSON.parse(
		await readFile(join(ui.config.snapshot, "fixture-source.json")),
	);
	const buildManifest = JSON.parse(
		await readFile(ui.config.editorSourceManifest),
	);
	const frozenReceipts = [
		[
			"C:/tmps/blaze-oracle-f0fafdf06643/handoff.json",
			"992769537b5776f5a8fdfaf2b665bba096ab917e7236f4ccb2a7f264d6abe60f",
		],
		[
			"C:/tmps/blaze-host-fixtures-61df29a602/handoff-r2.json",
			"ba896274fba30631b40c282e8e97dc75f8ab3ed727028ae47733564fb5eedd7e",
		],
		[
			"C:/tmps/blaze-editor-r2-2gmjdK/handoff-r2.json",
			"a98293d940ff45cbe4d9e2684c053176d07f4b7277126c1a2d157632a280c4ae",
		],
	];
	for (const [path, expectedSha256] of frozenReceipts) {
		const receiptBytes = await readFile(path);
		assert.equal(digest(receiptBytes), expectedSha256);
		for (const source of JSON.parse(receiptBytes).sources)
			assert.equal(
				manifest.files.find((file) => file.path === source.path)?.sha256,
				source.sha256,
				`Frozen prerequisite changed: ${source.path}`,
			);
	}
	const required = [
		...blazeEditorExportFiles,
		"script/fixtures/blaze-oracle.ts",
		"script/fixtures/blaze-oracle-field.ts",
		"script/fixtures/blaze-oracle-noise.ts",
		"script/fixtures/blaze-oracle-time.ts",
		"script/fixtures/blaze-oracle-sampling.ts",
		"script/probe-blaze-pipeline-metrics.mjs",
		"script/probe-blaze-pipeline-contract.mjs",
		"script/probe-blaze-pipeline-png.mjs",
	];
	const inputs = [];
	for (const path of required) {
		const entry = manifest.files.find((file) => file.path === path);
		assert(entry, `Missing export input ${path}`);
		if (path.startsWith("script/probe-blaze-pipeline-"))
			assert.equal(
				entry.sha256,
				buildManifest.files.find((file) => file.path === path)?.sha256,
				`Frozen codec helper changed: ${path}`,
			);
		const absolute = join(ui.config.snapshot, path);
		await assertBlazeHostRealPath(absolute);
		assert.equal(digest(await readFile(absolute)), entry.sha256, path);
		inputs.push({ path: absolute, sha256: entry.sha256 });
	}
	const toolPaths = [
		process.execPath,
		process.env.OPENCUT_BUN,
		ui.config.executablePath,
		join(config.ffmpegDirectory, "ffmpeg.exe"),
		join(config.ffmpegDirectory, "ffprobe.exe"),
	];
	const require = createRequire(
		join(ui.config.snapshot, "apps/vite-example/package.json"),
	);
	for (const name of [
		"@playwright/test",
		"vite",
		"vite-plugin-wasm",
		"vite-plugin-top-level-await",
	]) {
		const entry = require.resolve(name);
		toolPaths.push(entry, await packageDescriptor(entry, name));
	}
	for (const path of toolPaths) {
		assert(path && isAbsolute(path));
		const canonical = await realpath(path);
		if (path.includes("ffmpeg.exe") || path.includes("ffprobe.exe"))
			assert.equal(
				resolve(canonical).toLowerCase(),
				resolve(path).toLowerCase(),
				"Redirected FFmpeg executable",
			);
		inputs.push({ path: canonical, sha256: digest(await readFile(canonical)) });
	}
	return {
		...ui,
		exportConfig: config,
		inputs,
		exportProvenance: {
			configPath,
			configSha256: digest(bytes),
			priorUiEvidence: config.uiEvidence,
			priorUiEvidenceSha256: config.uiEvidenceSha256,
			uiConfigSha256: config.uiConfigSha256,
			inputs,
		},
	};
}
export async function verifyBlazeEditorExportInputHashes(inputs) {
	for (const input of inputs)
		assert.equal(digest(await readFile(input.path)), input.sha256, input.path);
}
