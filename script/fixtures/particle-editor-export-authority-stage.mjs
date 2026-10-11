import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	admitParticleAuthority,
	admitParticleCompileBaseline,
	assertParticleAuthorityRuntime,
} from "./particle-editor-export-authority.mjs";
import { plain, treeManifest } from "../particle-c4-export-support.mjs";

export const particleAuthorityPaths = (options) => ({
	wasmSync: options["wasm-sync"],
	samplerDirectory: options["sampler-dir"],
	toolchain: options.toolchain,
	node: process.execPath,
	bun: options.bun,
	chromium: options.chromium,
	ffmpeg: options.ffmpeg,
	ffprobe: options.ffprobe,
});
async function stageDirectory(root, path) {
	await plain(root, true);
	const parts = relative(root, path).split(sep).filter(Boolean);
	assert.ok(
		parts.every((part) => part !== ".."),
		"Staging directory escaped output root",
	);
	let current = root;
	for (const part of parts) {
		current = join(current, part);
		try {
			await mkdir(current);
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		await plain(current, true);
	}
}
export async function stageParticleAuthority({ authority, root, remember }) {
	await authority.assertUnchanged();
	await authority.assertOutputRoot(root);
	for (const [name, destination] of [
		["sourceSync", join(root, "authority-source-sync")],
		["bundler", join(root, "authority-bundler")],
		["packedSampler", root],
	]) {
		if (destination !== root) await mkdir(destination);
		await plain(destination, true);
		for (const entry of authority.metadata.packages[name].files) {
			const original = join(authority.metadata.packages[name].root, entry.path);
			const output = join(destination, entry.path);
			await authority.assertOutputRoot(root);
			await stageDirectory(root, dirname(output));
			await writeFile(output, authority.readCapturedFile(original), {
				flag: "wx",
			});
			await plain(output, false);
			assert.deepEqual(
				await remember(output),
				authority.readCapturedFile(original),
			);
		}
	}
	return {
		wasmSync: join(root, "authority-source-sync/opencut_wasm_sync.js"),
		bundlerEntry: join(root, "authority-bundler/opencut_wasm.js"),
	};
}
export async function verifyParticleAuthorityStage({ authority, root }) {
	await authority.assertOutputRoot(root);
	for (const [name, stagedRoot] of [
		["sourceSync", join(root, "authority-source-sync")],
		["bundler", join(root, "authority-bundler")],
		["packedSampler", root],
	]) {
		const pkg = authority.metadata.packages[name];
		if (stagedRoot !== root) {
			const actual = await treeManifest(stagedRoot);
			assert.deepEqual(
				actual.files.map(({ path }) => path).sort(),
				pkg.files.map(({ path }) => path),
			);
		}
		for (const entry of pkg.files) {
			const staged = join(stagedRoot, entry.path);
			await plain(staged, false);
			assert.deepEqual(
				await readFile(staged),
				authority.readCapturedFile(join(pkg.root, entry.path)),
				"Staged authority changed",
			);
		}
	}
}
export async function writeParticleAuthorityContext({
	authority,
	root,
	selection,
	paths,
	baselineReceiptPath,
}) {
	await authority.assertOutputRoot(root);
	const path = join(root, "particle-authority-context.json");
	await writeFile(
		path,
		JSON.stringify(
			{
				version: 1,
				root,
				selection,
				paths,
				authorityReceiptSha256: authority.authorityReceiptSha256,
				baselineReceiptPath,
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	return path;
}
export async function admitParticleAuthorityHostContext({
	root,
	path,
	executable,
	version,
}) {
	assert.equal(resolve(path), resolve(root, "particle-authority-context.json"));
	await plain(path, false);
	const context = JSON.parse(
		new TextDecoder("utf8", { fatal: true }).decode(await readFile(path)),
	);
	assert.equal(context.version, 1);
	assert.equal(resolve(context.root), resolve(root));
	const authority = await admitParticleAuthority({
		selection: context.selection,
		paths: context.paths,
	});
	assert.equal(
		context.authorityReceiptSha256,
		authority.authorityReceiptSha256,
	);
	assertParticleAuthorityRuntime({
		authority,
		name: "bun",
		executable,
		version,
	});
	const baseline = await admitParticleCompileBaseline({
		authority,
		receiptPath: context.baselineReceiptPath,
	});
	await verifyParticleAuthorityStage({ authority, root });
	return { authority, baseline, context };
}
export async function writeParticleAuthorityBootstrap({
	root,
	authority,
	remember,
}) {
	await authority.assertOutputRoot(root);
	const observer = new URL(
		"./particle-editor-export-authority-browser.mjs",
		import.meta.url,
	).href;
	const source = `import { join } from "node:path";
import { admitParticleAuthorityHostContext } from ${JSON.stringify(import.meta.url)};
import { installParticleAuthorityBrowserObserver } from ${JSON.stringify(observer)};
const root = process.argv[2];
await admitParticleAuthorityHostContext({ root, path: join(root, "particle-authority-context.json"), executable: process.execPath, version: process.versions.bun });
installParticleAuthorityBrowserObserver({ expectedWasmSha256: ${JSON.stringify(authority.metadata.nativeAuthority.wasmSha256)} });
await import("./host-body.mjs");
`;
	await writeFile(join(root, "host.mjs"), source, { flag: "wx" });
	await remember(join(root, "host.mjs"));
}
