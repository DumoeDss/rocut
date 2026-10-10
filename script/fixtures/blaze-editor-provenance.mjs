import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, win32 } from "node:path";
import {
	assertBlazeHostPrivatePath,
	assertBlazeHostRealPath,
	blazeHostOwnedFiles,
} from "./blaze-host-paths.mjs";
import { blazeEditorDigest as digest } from "./blaze-editor-control.mjs";
import { blazeEditorFiles } from "./blaze-editor-contract.mjs";

export async function validateBlazeEditorInputs(configPath, launcherRoot) {
	await assertBlazeHostRealPath(configPath);
	const configBytes = await readFile(configPath),
		config = JSON.parse(configBytes);
	const keys = [
		"snapshot",
		"manifestSha256",
		"wasmSha256",
		"creatorModule",
		"hostEvidence",
		"hostEvidenceSha256",
		"editorDist",
		"editorSourceManifest",
		"editorSourceManifestSha256",
		"executablePath",
		"artifactParent",
	];
	assert.deepEqual(
		Object.keys(config).sort(),
		keys.sort(),
		"Explicit Blaze editor run configuration required",
	);
	for (const key of keys.filter((key) => key.endsWith("Sha256")))
		assert(/^[a-f0-9]{64}$/.test(config[key]), key);
	for (const key of [
		"snapshot",
		"editorDist",
		"artifactParent",
		"editorSourceManifest",
		"hostEvidence",
	])
		await assertBlazeHostRealPath(config[key]);
	for (const key of ["creatorModule", "executablePath"]) {
		assert(isAbsolute(config[key]), key);
		assert.equal(
			resolve(await realpath(config[key])).toLowerCase(),
			resolve(config[key]).toLowerCase(),
			key,
		);
	}
	assert.equal(
		resolve(launcherRoot).toLowerCase(),
		resolve(config.snapshot).toLowerCase(),
		"Run only the derived snapshot's launcher",
	);
	const outputLocation = win32.relative(config.snapshot, config.artifactParent);
	assert(
		outputLocation.startsWith("..") || win32.isAbsolute(outputLocation),
		"Do not write artifacts into the frozen source snapshot",
	);
	const manifestBytes = await readFile(
		join(config.snapshot, "fixture-source.json"),
	);
	assert.equal(digest(manifestBytes), config.manifestSha256);
	const manifest = JSON.parse(manifestBytes);
	for (const path of [
		...blazeEditorFiles,
		...blazeHostOwnedFiles,
		"script/fixtures/blaze-cases.ts",
		"script/fixtures/blaze-cases-source.ts",
		"script/browser-probe-toolchain.mjs",
	]) {
		const entry = manifest.files.find((file) => file.path === path);
		assert(entry, `Missing fixture provenance ${path}`);
		assert.equal(
			digest(await readFile(join(config.snapshot, path))),
			entry.sha256,
			path,
		);
	}
	const hostBytes = await readFile(config.hostEvidence),
		host = JSON.parse(hostBytes);
	assert.equal(digest(hostBytes), config.hostEvidenceSha256);
	assert(
		host.ok &&
			host.hostClosed &&
			host.authorUnavailable &&
			host.positiveControlAccepted,
	);
	assert.equal(host.provenance.wasmSha256, config.wasmSha256);
	assert.equal(host.rejected.length, 147);
	assert.equal(host.reopens.length, 2);
	assert.equal(host.resourceChecks, 3);
	const editorManifestBytes = await readFile(config.editorSourceManifest);
	assert.equal(digest(editorManifestBytes), config.editorSourceManifestSha256);
	const rendererFiles = (source) =>
		source.files
			.filter(
				(file) =>
					!file.path.startsWith("script/") &&
					!file.path.startsWith("apps/cli/"),
			)
			.sort((a, b) => a.path.localeCompare(b.path, "en"));
	assert.deepEqual(
		rendererFiles(JSON.parse(editorManifestBytes)),
		rendererFiles(manifest),
		"Editor build source does not match current production sources",
	);
	const files = [];
	const inventory = async (directory, prefix = "") => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			assert(
				!entry.isSymbolicLink(),
				"Editor build must not contain redirected entries",
			);
			const path = join(directory, entry.name),
				relative = `${prefix}${entry.name}`;
			assertBlazeHostPrivatePath(path, config.editorDist);
			if (entry.isDirectory()) await inventory(path, relative + "/");
			else if (entry.isFile())
				files.push({ path: relative, sha256: digest(await readFile(path)) });
		}
	};
	await inventory(config.editorDist);
	const wasm = files.filter((file) =>
		/(?:^|\/)opencut_wasm_bg-[^/]+\.wasm$/.test(file.path),
	);
	assert.equal(wasm.length, 1);
	assert.equal(wasm[0].sha256, config.wasmSha256);
	assert(files.some((file) => file.path === "index.html"));
	return {
		config,
		provenance: {
			configPath,
			configSha256: digest(configBytes),
			sourceManifestSha256: config.manifestSha256,
			wasmSha256: config.wasmSha256,
			hostEvidenceSha256: config.hostEvidenceSha256,
			editorSourceManifestSha256: config.editorSourceManifestSha256,
			editorDist: config.editorDist,
			editorFiles: files.sort((a, b) => a.path.localeCompare(b.path)),
		},
	};
}
