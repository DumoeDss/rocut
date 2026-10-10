import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const bubbleHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const bubblePackageNames = ["opencut_wasm.js", "opencut_wasm_bg.js", "opencut_wasm_bg.wasm", "opencut_wasm.d.ts", "package.json"];
export const bubbleRunnerNames = ["probe-bubble.mjs", "probe-bubble-session.mjs", "probe-bubble-loading.mjs", "probe-bubble-evidence.mjs", "probe-bubble-artifacts.mjs", "browser-probe-toolchain.mjs", "liquid-diagnostic-wasm.mjs"];
export const BUBBLE_WASM_HELPER_ID = "/__vite-plugin-wasm-helper";
export const bubbleRequiredFixtures = ["bubble-cases.mjs", "bubble-oracle.mjs", "bubble-oracle-time.mjs", "bubble-metrics.mjs", "bubble-negatives.mjs", "bubble-browser-support.mjs", "bubble-browser-probe.mjs", "bubble-browser-probe.html"].map((name) => `script/fixtures/${name}`);

export function bubbleContained(root, target, allowRoot = false) {
	const tail = relative(root, target);
	assert((allowRoot || tail) && !tail.startsWith("..") && !isAbsolute(tail), `Bubble path escapes root: ${target}`);
}
export async function bubbleScratch(path) {
	assert(isAbsolute(path) && /^c:[/\\]tmps(?:[/\\]|$)/i.test(path), "Bubble requires absolute C:/tmps paths");
	const resolved = await realpath(path);
	assert(/^c:[/\\]tmps(?:[/\\]|$)/i.test(resolved), "Bubble path redirects outside C:/tmps");
	return resolved;
}
async function input(root, name) {
	assert(typeof name === "string" && !name.includes(":") && !name.includes("\0"));
	const path = join(root, name);
	bubbleContained(root, path);
	bubbleContained(root, await realpath(path));
	const bytes = await readFile(path);
	return { path, bytes: bytes.length, sha256: bubbleHash(bytes) };
}
export async function collectBubbleInputs(snapshot, packageDirectory, runnerDirectory) {
	const manifest = await input(snapshot, "fixture-source.json");
	const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(manifest.path)));
	assert(Array.isArray(parsed.files), "Missing Bubble snapshot file manifest");
	assert.equal(new Set(parsed.files.map((file) => file.path)).size, parsed.files.length, "Duplicate snapshot paths");
	const records = parsed.files.filter((file) => file.path?.startsWith("rust/") || file.path?.startsWith("script/fixtures/bubble-"));
	for (const name of [...bubbleRequiredFixtures, "rust/crates/effects/src/bubble.rs", "rust/crates/effects/src/shaders/bubble.wgsl"])
		assert(records.some((file) => file.path === name), `Snapshot missing ${name}`);
	const inputs = [];
	for (const record of records) {
		assert(/^[a-f0-9]{64}$/.test(record.sha256), `Invalid input hash: ${record.path}`);
		const actual = await input(snapshot, record.path);
		assert.equal(actual.sha256, record.sha256, `Changed frozen input ${record.path}`);
		inputs.push({ ...actual, relative: record.path });
	}
	return {
		snapshot, packageDirectory, manifest, inputs,
		sourceCommit: parsed.sourceCommit, sourceWorktreeClean: parsed.sourceWorktreeClean === true,
		packageFiles: await Promise.all(bubblePackageNames.map((name) => input(packageDirectory, name))),
		runnerFiles: await Promise.all(bubbleRunnerNames.map((name) => input(runnerDirectory, name))),
	};
}
export async function verifyBubbleInputs(frozen) {
	const failures = [];
	const files = [frozen.manifest, ...frozen.inputs, ...frozen.packageFiles, ...frozen.runnerFiles];
	for (const file of files) {
		try {
			assert.equal(await realpath(file.path), file.path, `Input redirected: ${file.path}`);
			assert.equal(bubbleHash(await readFile(file.path)), file.sha256, `Input changed: ${file.path}`);
		} catch (error) { failures.push(String(error)); }
	}
	return { ok: !failures.length, files: files.length, failures };
}
export function bubbleSourceGuard(frozen, liveRepository, virtualProviders = []) {
	const normalize = (path) => path.replaceAll("\\", "/").toLowerCase();
	const allowed = new Map([...frozen.inputs, ...frozen.packageFiles].map((file) => [normalize(file.path), file]));
	const loaded = new Map(), loadedVirtual = new Map();
	assert(virtualProviders.length <= 1, "Only the exact WASM helper provider is supported");
	const virtual = new Map(virtualProviders.map((record) => {
		assert(record.id === BUBBLE_WASM_HELPER_ID && record.provider === "vite-plugin-wasm", "Unexpected virtual module provider");
		assert(/^[a-f0-9]{64}$/.test(record.codeSha256), "Invalid virtual module code hash");
		return [record.id, record];
	}));
	const under = (root, path) => {
		const tail = relative(root, path).replaceAll("\\", "/");
		return !tail.startsWith("..") && !isAbsolute(tail) ? tail : null;
	};
	return { loaded, loadedVirtual, plugin: {
		name: "bubble-frozen-source-closure", enforce: "pre",
		async transform(_code, id) {
			const provider = virtual.get(id);
			if (provider) {
				assert.equal(bubbleHash(_code), provider.codeSha256, "WASM virtual helper content differs from pinned provider");
				loadedVirtual.set(id, { ...provider });
				return null;
			}
			if (id.startsWith("\0")) return null;
			const path = id.split("?")[0];
			if (!isAbsolute(path)) return null;
			const snapshotPath = under(frozen.snapshot, path), packagePath = under(frozen.packageDirectory, path);
			const livePath = under(liveRepository, path);
			if (snapshotPath === null && packagePath === null) {
				assert(!livePath || !/^(packages|script\/fixtures|rust)\//.test(livePath), `Bubble loaded live source: ${path}`);
				assert(livePath?.startsWith("node_modules/") || livePath?.startsWith("apps/vite-example/node_modules/"), `Bubble source escaped frozen roots: ${path}`);
				return null;
			}
			const record = allowed.get(normalize(path));
			assert(record, `Unlisted Bubble dependency: ${path}`);
			assert.equal(normalize(await realpath(path)), normalize(record.path), "Bubble source redirected");
			const hash = bubbleHash(await readFile(path));
			assert.equal(hash, record.sha256, `Bubble source changed: ${path}`);
			loaded.set(record.relative ?? `WASM/${packagePath}`, hash);
			return null;
		},
	} };
}
