// Explicit scheduling boundary: --prepare never launches a browser; --run is separate.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, readdir, realpath, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolveRequiredProbeWasmBinding, resolveProbeBrowserExecutable } from "./fixtures/browser-probe-identity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const expectedWasmSha256 = "084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12";
const toolchain = "C:/Users/Sayo/AppData/Local/Temp/rocut-media-toolchain-YbloF9";
const wasmDirectory = "C:/Users/Sayo/AppData/Local/Temp/rocut-wasm-authority-20261011-GVDTX4/browser-pkg-v2-sntQBC";
const browserExecutable = "C:/Users/Sayo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const ffmpeg = "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe";
const ffprobe = "E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe";
const bun = "C:/Users/Sayo/.bun/bin/bun.exe";
const cases = [
	{ id: "hyperframes-basic", entry: "script/probe-hyperframes.mjs", args: [toolchain] },
	{ id: "remotion-basic", entry: "script/probe-remotion.mjs", args: [toolchain] },
	{ id: "hyperframes-audio-editor", entry: "script/probe-hyperframes-audio-editor.mjs", args: [toolchain] },
	{ id: "remotion-audio-editor", entry: "script/probe-remotion-audio.mjs", args: [toolchain, "--editor"] },
];
const newSources = ["script/probe-hf-remotion-browser-authority.mjs", "script/fixtures/browser-probe-identity.mjs", "script/fixtures/browser-probe-identity.d.mts", "script/__tests__/browser-probe-identity.test.mjs", "script/fixtures/hf-remotion-browser-plumbing.tsconfig.json"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const parse = (bytes) => JSON.parse(decode(bytes));
async function identity(path, name = path) {
	const bytes = await readFile(path);
	return { path: name.replaceAll("\\", "/"), byteLength: bytes.length, sha256: hash(bytes) };
}
async function identities(paths, base) {
	const files = [];
	for (let offset = 0; offset < paths.length; offset += 16)
		files.push(...await Promise.all(paths.slice(offset, offset + 16).map((path) => identity(base ? join(base, path) : path, path))));
	return { fileCount: files.length, manifestSha256: hash(JSON.stringify(files)), files };
}
async function closure(directory) {
	const paths = [];
	async function walk(current) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			assert.ok(!entry.isSymbolicLink(), `Unaccounted closure link: ${path}`);
			if (entry.isDirectory()) await walk(path);
			else { assert.ok(entry.isFile(), `Nonordinary closure file: ${path}`); paths.push(relative(directory, path).replaceAll("\\", "/")); }
		}
	}
	await walk(directory);
	return { directory: await realpath(directory), ...await identities(paths.sort(), directory) };
}
function sourcePaths() {
	const tracked = decode(execFileSync("git", ["ls-files", "-z", "apps/cli/src", "apps/vite-example/src", "packages/editor-classic/src", "packages/editor-contracts/src", "packages/editor-ports/src", "script", "apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf"], { cwd: root })).split("\0").filter(Boolean);
	return [...new Set([...tracked, ...newSources])].sort();
}
async function snapshot() {
	return {
		capturedAt: new Date().toISOString(),
		source: await identities(sourcePaths(), root),
		toolchain: await closure(toolchain), wasm: await closure(wasmDirectory),
		browser: await closure(dirname(browserExecutable)),
		executables: await identities([process.execPath, bun, browserExecutable, ffmpeg, ffprobe]),
	};
}
const digest = (value) => Object.fromEntries(["source", "toolchain", "wasm", "browser", "executables"].map((key) => [key, value[key].manifestSha256]));
const binding = resolveRequiredProbeWasmBinding({ directory: wasmDirectory, expectedWasmSha256 });
assert.equal(binding.identity.files.find((file) => file.name === "opencut_wasm.js").sha256, "cc62ca83fb09032be1bf5427a156f572587ef21cc6a6c185d4743ac4fe7ddb39");
const pinnedBrowser = resolveProbeBrowserExecutable({ configured: browserExecutable, fallback: "not-permitted" });
assert.equal((await identity(pinnedBrowser)).sha256, "9b07943f834485b43c9d54caea2951c78715f9f07070a80ab6658465ebd3e711");

if (mode === "--prepare") {
	const group = await mkdtemp(join(tmpdir(), "rocut-hf-remotion-browser-20261011-"));
	const plan = { version: 1, preparedAt: new Date().toISOString(), root, group, cases, binding: binding.identity, browserExecutable: pinnedBrowser, expectedWasmSha256, ffmpeg, ffprobe, bun, browserLaunched: false,
		limitations: ["Four existing short probes only; no installed Electron, full MV or complete ecosystem acceptance", "--prepare does not execute browser or audio/video fixture creation; --run requires a separately allocated browser window", "Every case gets a new artifact directory; first failure stops the group without skip, cap or hidden retry"] };
	await writeFile(join(group, "plan.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
	console.log(JSON.stringify({ prepared: true, group, browserLaunched: false, cases: cases.map(({ id }) => id) }));
} else if (mode === "--run") {
	assert.equal(process.env.ROCUT_BROWSER_WINDOW_AUTHORIZED, "1", "Browser window must be explicitly allocated before --run");
	const group = await realpath(process.argv[3]);
	const plan = parse(await readFile(join(group, "plan.json")));
	assert.equal(plan.root, root); assert.equal(plan.group, group);
	assert.deepEqual(plan.cases, cases); assert.deepEqual(plan.binding, binding.identity);
	const results = [];
	const before = await snapshot();
	await writeFile(join(group, "before.json"), JSON.stringify(before, null, 2) + "\n", { flag: "wx" });
	for (const item of cases) {
		const attempt = await mkdtemp(join(group, `${item.id}-attempt-`));
		const artifacts = join(attempt, "artifacts"); await mkdir(artifacts);
		const env = { ...process.env, ROCUT_TEST_WASM_DIRECTORY: wasmDirectory, ROCUT_PROBE_WASM_SHA256: expectedWasmSha256,
			ROCUT_PROBE_BROWSER_PATH: pinnedBrowser, ROCUT_HTML_BROWSER_PATH: pinnedBrowser, ROCUT_PROBE_ARTIFACTS: artifacts,
			ROCUT_TEST_FFMPEG: ffmpeg, ROCUT_TEST_FFPROBE: ffprobe,
			PATH: `${dirname(bun)};${process.env.PATH ?? ""}`, NO_COLOR: "1" };
		for (const key of ["ELFTIA_HTML_FRAME_CONNECTION_FILE", "ROCUT_PROBE_NATIVE_ONLY", "ROCUT_PROBE_SWIFTSHADER", "ROCUT_PROBE_TRACE", "ROCUT_AUDIO_KEEP_DIAGNOSTIC", "ROCUT_PROBE_ENGINE_SPEC", "ROCUT_PROBE_ENGINE_DOCUMENT", "ROCUT_PROBE_STATIC_DIR"]) delete env[key];
		let stdout = "", stderr = "";
		const startedAt = new Date().toISOString();
		console.log(JSON.stringify({ starting: item.id, attempt }));
		const result = await new Promise((complete) => {
			const child = spawn(process.execPath, [item.entry, ...item.args], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
			child.stdout.on("data", (bytes) => { stdout += bytes.toString("utf8"); process.stdout.write(bytes); });
			child.stderr.on("data", (bytes) => { stderr += bytes.toString("utf8"); process.stderr.write(bytes); });
			child.once("error", (error) => complete({ exitCode: null, signal: null, error: String(error) }));
			child.once("close", (exitCode, signal) => complete({ exitCode, signal }));
		});
		let evidence, evidenceError;
		try {
			evidence = parse(await readFile(join(artifacts, "evidence.json")));
			assert.equal(evidence.passed, true); assert.deepEqual(evidence.wasmIdentity, binding.identity);
			assert.deepEqual(evidence.hostWasmIdentity, binding.identity);
			assert.equal(evidence.electronTested, false);
			assert.match(evidence.browser, /^153\./);
		} catch (error) { evidenceError = String(error); }
		const afterCase = await snapshot();
		await writeFile(join(attempt, "after.json"), JSON.stringify(afterCase, null, 2) + "\n", { flag: "wx" });
		const identitiesUnchanged = JSON.stringify(digest(before)) === JSON.stringify(digest(afterCase));
		const passed = result.exitCode === 0 && !evidenceError && identitiesUnchanged;
		const recorded = { ...item, attempt, startedAt, finishedAt: new Date().toISOString(), ...result, passed, identitiesUnchanged,
			explicitEnvironment: { ROCUT_TEST_WASM_DIRECTORY: wasmDirectory, ROCUT_PROBE_WASM_SHA256: expectedWasmSha256, ROCUT_PROBE_BROWSER_PATH: pinnedBrowser, ROCUT_PROBE_ARTIFACTS: artifacts, ROCUT_TEST_FFMPEG: ffmpeg, ROCUT_TEST_FFPROBE: ffprobe },
			stdout, stderr, evidence, evidenceError, beforeHashes: digest(before), afterHashes: digest(afterCase) };
		await writeFile(join(attempt, "receipt.json"), JSON.stringify(recorded, null, 2) + "\n", { flag: "wx" });
		results.push(recorded);
		if (!passed) break;
	}
	const passed = results.length === cases.length && results.every((result) => result.passed);
	const receipt = { version: 1, status: passed ? "passed" : "failed", group, workspace: root, plan, beforeHashes: digest(before), results,
		unexecutedCases: cases.slice(results.length).map(({ id }) => id), retries: 0, capped: false, skipped: false,
		limitations: plan.limitations };
	await writeFile(join(group, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
	console.log(JSON.stringify({ group, passed, completed: results.length, total: cases.length }));
	process.exitCode = passed ? 0 : 1;
} else throw Error("Use --prepare (no browser) or --run <prepared-group> after explicit window allocation");
