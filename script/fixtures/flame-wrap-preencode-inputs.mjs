import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

export const preencodeSha = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const json = async (path) =>
	JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
	);
export const savePreencodeJson = (root, name, value) =>
	writeFile(join(root, name), JSON.stringify(value, null, 2), { flag: "wx" });
async function treeFiles(root) {
	const files = [];
	async function visit(directory) {
		for (const name of await readdir(directory)) {
			const path = join(directory, name),
				info = await lstat(path);
			assert(!info.isSymbolicLink(), `Symlink refused: ${path}`);
			if (info.isDirectory()) await visit(path);
			else {
				assert(info.isFile());
				files.push(path);
			}
		}
	}
	await visit(root);
	return files;
}
export function derivePreencodeHostModule(source) {
	const marker =
		"// ../../../../../../../../C:/tmps/flame-wrap-editor-nl0MSk/editor-entry.ts\n";
	const at = source.indexOf(marker);
	assert(
		at > 0 && source.indexOf(marker, at + 1) === -1,
		"Original entry marker must be unique",
	);
	const tail = source.slice(at + marker.length);
	assert(
		/^await run\(\{ startHost, TargetRegistry, root: "C:\/tmps\/flame-wrap-editor-nl0MSk",[^\n]+\}\);\s*$/.test(
			tail,
		),
		"Unexpected original Host entry footer",
	);
	assert(
		source.includes("async function startHost(args)") &&
			source.includes("class TargetRegistry"),
	);
	return {
		module: source.slice(0, at) + "export { startHost, TargetRegistry };\n",
		removedEntry: tail,
		retainedPrefixBytes: Buffer.byteLength(source.slice(0, at)),
	};
}
export async function verifyPreencodePins(pins) {
	for (const pin of pins)
		assert.equal(preencodeSha(await readFile(pin.path)), pin.sha256, pin.path);
}
export async function preparePreencodeInputs({ sourceRoot, root }) {
	assert(isAbsolute(sourceRoot) && isAbsolute(root) && sourceRoot !== root);
	const prior = await json(join(sourceRoot, "evidence.json"));
	assert(
		prior.ui.ok &&
			prior.inputsUnchanged &&
			prior.hostClosed &&
			prior.browserClosed,
	);
	const config = await json(join(sourceRoot, "config.json")),
		build = await json(prior.buildReceipt);
	assert(
		build.ok && build.inputsUnchanged && build.editorDist === config.editorDist,
	);
	assert.equal(config.wasmSha256, build.wasmSha256);
	const manifest = await json(join(sourceRoot, "editor-closure.json"));
	const frozenPins = [
		...manifest.files,
		...manifest.pinned,
		...build.frozen,
		...build.textModules,
	];
	await verifyPreencodePins(frozenPins);
	assert.equal(
		preencodeSha(await readFile(build.emittedWasm)),
		build.wasmSha256,
	);
	assert.equal(
		preencodeSha(await readFile(join(build.pkg, "opencut_wasm_bg.wasm"))),
		build.wasmSha256,
	);
	const privateFiles = [
		join(sourceRoot, "editor-host.mjs"),
		join(sourceRoot, "evidence.json"),
		join(sourceRoot, "config.json"),
		prior.buildReceipt,
		join(sourceRoot, "editor-closure.json"),
		join(sourceRoot, "flame-wrap-editor-final-expected.json"),
		join(sourceRoot, "flame-wrap-editor-expected-frames.json"),
		...(await treeFiles(config.editorDist)),
		...(await treeFiles(join(sourceRoot, "project/attachments"))),
		join(sourceRoot, "project/project.json"),
	];
	const pins = [];
	for (const path of [
		...new Set([...privateFiles, ...frozenPins.map((p) => p.path)]),
	])
		pins.push({ path, sha256: preencodeSha(await readFile(path)) });
	assert.equal(
		pins.find((p) => p.path === join(sourceRoot, "evidence.json")).sha256,
		"0a105c217fe321ead446096ac6f0fdf9a0acb0158968033841dc169f5ecb8929",
	);
	const projectPath = join(root, "project");
	await mkdir(projectPath);
	const copies = [];
	for (const path of [
		join(sourceRoot, "project/project.json"),
		...(await treeFiles(join(sourceRoot, "project/attachments"))),
	]) {
		const local = relative(join(sourceRoot, "project"), path);
		assert(local && !local.startsWith("..") && !isAbsolute(local));
		const destination = join(projectPath, local),
			bytes = await readFile(path);
		await mkdir(join(destination, ".."), { recursive: true });
		await writeFile(destination, bytes, { flag: "wx" });
		copies.push({
			path: destination,
			sourcePath: path,
			sha256: preencodeSha(bytes),
			bytes: bytes.length,
		});
	}
	const hostBytes = await readFile(join(sourceRoot, "editor-host.mjs"));
	const derived = derivePreencodeHostModule(
		new TextDecoder("utf-8", { fatal: true }).decode(hostBytes),
	);
	const hostModule = join(root, "original-host-module.mjs");
	await writeFile(hostModule, derived.module, { flag: "wx" });
	const prepared = {
		sourceRoot,
		root,
		projectPath,
		editorDist: config.editorDist,
		pkg: build.pkg,
		hostModule,
		browserVersion: prior.browserVersion,
		wasmSha256: build.wasmSha256,
		hostDerivation: {
			originalSha256: preencodeSha(hostBytes),
			derivedSha256: preencodeSha(derived.module),
			retainedPrefixBytes: derived.retainedPrefixBytes,
			removedEntry: derived.removedEntry,
			scope:
				"Original bundled Host prefix retained byte-for-byte; only old mutating fixture entry removed and existing bindings exported; no rebuild",
		},
		pins,
		copies,
		originalProjectSha256: copies.find((p) => p.path.endsWith("project.json"))
			.sha256,
	};
	await savePreencodeJson(root, "prepared.json", prepared);
	return prepared;
}
