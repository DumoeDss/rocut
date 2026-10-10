import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve, win32 } from "node:path";
import { createRequire } from "node:module";
import { bubbleHostDigest } from "./bubble-host-source.mjs";

export const bubbleHostOwnedFiles = ["script/probe-bubble-host.mjs",
	... ["contract", "source", "cases", "checks", "paths", "static.test"]
		.map((name) => `script/fixtures/bubble-host-${name}.mjs`), "script/fixtures/bubble-host.mjs"];
export function assertBubbleHostPrivatePath(target, parent = "C:/tmps") {
	assert(target && win32.isAbsolute(target), "Expected absolute private path");
	const child = win32.relative(win32.resolve(parent), win32.resolve(target));
	assert(child && !child.startsWith("..") && !win32.isAbsolute(child), "Expected strict private descendant");
	return win32.resolve(target);
}
export async function assertBubbleHostRealPath(target) {
	assertBubbleHostPrivatePath(target);
	const canonical = await realpath(target);
	assertBubbleHostPrivatePath(canonical);
	assert.equal(win32.resolve(canonical).toLowerCase(), win32.resolve(target).toLowerCase(), "Path redirects");
	return canonical;
}
export async function assertBubbleHostAbsentChild(target, parent) {
	assertBubbleHostPrivatePath(target, parent);
	await assertBubbleHostRealPath(parent);
	await assert.rejects(lstat(target), { code: "ENOENT" });
}
export async function bubbleHostFile(path) {
	const canonical = await assertBubbleHostRealPath(path), bytes = await readFile(canonical);
	return { path: resolve(path), sha256: bubbleHostDigest(bytes), bytes: bytes.length };
}
export async function bubbleHostTree(root) {
	await assertBubbleHostRealPath(root);
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		assert(!entry.isSymbolicLink(), `Unexpected evidence/package link: ${entry.name}`);
		const file = join(root, entry.name);
		if (entry.isDirectory()) files.push(...await bubbleHostTree(file));
		else files.push(await bubbleHostFile(file));
	}
	return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function assertBubbleHostSource({ snapshot, manifestSha256, wasmSha256 }) {
	await assertBubbleHostRealPath(snapshot);
	for (const hash of [manifestSha256, wasmSha256]) assert(/^[a-f0-9]{64}$/.test(hash));
	const manifestPath = join(snapshot, "fixture-source.json"), bytes = await readFile(manifestPath);
	assert.equal(bubbleHostDigest(bytes), manifestSha256, "Source manifest changed");
	const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	for (const file of manifest.files) {
		const path = join(snapshot, file.path); assertBubbleHostPrivatePath(path, snapshot);
		assert.equal((await bubbleHostFile(path)).sha256, file.sha256, `Source changed: ${file.path}`);
	}
	const wasmEntry = createRequire(join(snapshot, "apps/cli/package.json")).resolve("opencut-wasm");
	assertBubbleHostPrivatePath(wasmEntry, join(snapshot, "rust/wasm/pkg"));
	await assertBubbleHostRealPath(wasmEntry);
	const pkg = await bubbleHostTree(join(snapshot, "rust/wasm/pkg"));
	assert.equal(pkg.find((file) => file.path.endsWith("opencut_wasm_bg.wasm")).sha256, wasmSha256);
	return { manifestPath, manifestSha256, sourceFilesChecked: manifest.files.length, wasmEntry, pkg,
		versionBoundary: "Inherited preflight-fix source snapshot; Host admission interfaces unchanged. Not latest full acceptance." };
}
export async function assertBubbleHostHarness(root) {
	await assertBubbleHostRealPath(root);
	const manifest = JSON.parse(await readFile(join(root, "harness-source.json"), "utf8"));
	assert.deepEqual(manifest.files.map((file) => file.relative).sort(), [...bubbleHostOwnedFiles].sort());
	for (const file of manifest.files) {
		const filename = join(root, file.relative); assertBubbleHostPrivatePath(filename, root);
		assert.equal((await bubbleHostFile(filename)).sha256, file.sha256, `Harness changed: ${file.relative}`);
	}
	return manifest;
}
