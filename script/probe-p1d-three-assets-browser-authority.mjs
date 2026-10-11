// Scheduling boundary: --prepare performs CPU Host work only; --run requires a fresh explicit window.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pinInkHostToolchain } from "./fixtures/ink-object-host-toolchain.mjs";
import { resolveRequiredProbeWasmBinding, resolveProbeBrowserExecutable } from "./fixtures/browser-probe-identity.mjs";
import { snapshotHtmlProbeSources } from "./html-probe-wasm-binding.mjs";
import { P1D_TIMES, P1D_SVG_CONTRACT } from "./fixtures/p1d-three-browser-oracle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), mode = process.argv[2];
const expectedWasmSha256 = "084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12";
const featureToolchain = join(root, ".artifacts/p1d-feature-toolchain/run-lCXGLZ");
const ordinaryToolchain = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/.artifacts/three-toolchain/run-3Hn5Nw";
const wasmDirectory = "C:/Users/Sayo/AppData/Local/Temp/rocut-wasm-authority-20261011-GVDTX4/browser-pkg-v2-sntQBC";
const browserExecutable = resolveProbeBrowserExecutable({ configured: "C:/Users/Sayo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe", fallback: "not-permitted" });
const bun = "C:/Users/Sayo/.bun/bin/bun.exe";
const binding = resolveRequiredProbeWasmBinding({ directory: wasmDirectory, expectedWasmSha256 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const decode = bytes => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const readJson = async path => JSON.parse(decode(await readFile(path)));
const newSources = ["script/probe-p1d-three-assets-browser-authority.mjs", "script/fixtures/p1d-three-browser-host.ts", "script/fixtures/p1d-three-browser-oracle.mjs", "script/fixtures/p1d-three-browser-oracle.test.mjs", "script/fixtures/p1d-three-browser.tsconfig.json"];
const readySources = ["script/prepare-p1-d-feature-toolchain.mjs", "script/prepare-p1-d-feature-toolchain.test.mjs", "apps/cli/src/__tests__/p1-d-three-assets-feature-fixture.ts", "apps/cli/src/__tests__/p1-d-three-assets-feature.test.ts", "apps/cli/src/__tests__/p1-d-three-assets-fixture.ts", "apps/cli/src/__tests__/p1-d-three-assets.test.ts"];
const originalCases = [
	{ id: "ordinary", artifact: ".artifacts/three-archive-revision/run-2uS2sC", evidence: ".artifacts/three-archive-revision/run-2uS2sC/p1-d-evidence.json", expected: "positive-model-pixels" },
	{ id: "feature", artifact: ".artifacts/three-archive-revision/run-9awg6K", evidence: ".artifacts/three-archive-revision/run-9awg6K/p1-d-feature-evidence.json", expected: "unsupported-svg-negative" },
];
async function filePin(path) { const body = await readFile(path); return { path, bytes: body.length, sha256: hash(body) }; }
async function browserClosure(directory) {
	assert.equal(await realpath(directory), resolve(directory));
	const files = []; let bytes = 0;
	async function walk(current) {
		for (const name of (await readdir(current)).sort()) {
			const path = join(current, name), stat = await lstat(path); assert(!stat.isSymbolicLink());
			if (stat.isDirectory()) await walk(path);
			else { assert(stat.isFile() && files.length < 10000 && bytes + stat.size <= 1024 * 1024 * 1024); const pin = await filePin(path); bytes += pin.bytes; files.push(pin); }
		}
	}
	await walk(directory); return { directory, bytes, files, manifestSha256: hash(JSON.stringify(files)) };
}
async function snapshot() {
	const sourceCommit = decode(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })).trim();
	const manifestPath = await realpath(process.env.ROCUT_FIXTURE_SOURCE_MANIFEST ?? join(root, "fixture-source.json"));
	const bytes = await readFile(manifestPath), manifest = JSON.parse(decode(bytes));
	assert.equal(manifest.schema, "fixture-source/v2"); assert(manifest.files.length > 0);
	for (const { path } of manifest.files) assert(typeof path === "string" && !isAbsolute(path) && !relative(root, resolve(root, path)).startsWith(".."));
	const actual = snapshotHtmlProbeSources(root, manifest.files.map(file => file.path));
	const drift = manifest.files.filter((file, index) => file.sha256 !== actual[index].sha256).map(file => file.path);
	const tracked = decode(execFileSync("git", ["ls-files", "-z", "apps/cli/src", "packages/editor-classic/src/services/renderer/programmatic", "packages/editor-contracts/src", "packages/editor-ports/src", "script"], { cwd: root })).split("\0").filter(Boolean);
	const sources = snapshotHtmlProbeSources(root, [...new Set([...tracked, ...newSources, ...readySources])].sort());
	return { sourceCommit, fixtureSource: { ...await filePin(manifestPath), sourceCommit: manifest.sourceCommit, drift, valid: manifest.sourceCommit === sourceCommit && !drift.length, actualManifestSha256: hash(JSON.stringify(actual)) },
		source: { manifestSha256: hash(JSON.stringify(sources)), files: sources }, toolchain: await pinInkHostToolchain(featureToolchain), ordinaryToolchain: await pinInkHostToolchain(ordinaryToolchain),
		wasm: await pinInkHostToolchain(binding.directory), browser: await browserClosure(dirname(browserExecutable)), bun: await filePin(bun), node: await filePin(process.execPath),
		originalProjects: await Promise.all(originalCases.map(async item => ({ id: item.id, evidence: await filePin(join(root, item.evidence)), project: await pinInkHostToolchain(join(root, item.artifact, "project")) }))) };
}
const digest = pin => ({ sourceCommit: pin.sourceCommit, fixtureSource: pin.fixtureSource, source: pin.source.manifestSha256,
	toolchain: hash(JSON.stringify(pin.toolchain)), ordinaryToolchain: hash(JSON.stringify(pin.ordinaryToolchain)), wasm: hash(JSON.stringify(pin.wasm)), browser: pin.browser.manifestSha256, bun: pin.bun, node: pin.node, originals: hash(JSON.stringify(pin.originalProjects)) });
async function preparedInputs(group) {
	return Promise.all(["ordinary/project", "feature/project", "feature/restored-source", "feature/diagnostic-author-unavailable"].map(async path => {
		const directory = join(group, path); assert.equal(await realpath(directory), directory);
		return { path, pin: await pinInkHostToolchain(directory) };
	}));
}
async function execute(phase, group) {
	const args = ["--preload", "./script/fixtures/local-wasm-preload.mjs", "script/fixtures/p1d-three-browser-host.ts", phase, group];
	const env = { ...process.env, ROCUT_TEST_WASM_DIRECTORY: wasmDirectory, ROCUT_PROBE_WASM_SHA256: expectedWasmSha256, NO_COLOR: "1" };
	for (const key of ["ELFTIA_HTML_FRAME_CONNECTION_FILE", "ROCUT_PROBE_SWIFTSHADER", "ROCUT_PROBE_NATIVE_ONLY", "ROCUT_HTML_BROWSER_PATH", "ROCUT_NATIVE_FFMPEG_PATH", "ROCUT_NATIVE_FFPROBE_PATH", "ROCUT_THREE_REVISION_RECEIPT"]) delete env[key];
	let stdout = "", stderr = "";
	const result = await new Promise(complete => {
		const child = spawn(bun, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		child.stdout.on("data", bytes => { stdout += bytes.toString("utf8"); process.stdout.write(bytes); });
		child.stderr.on("data", bytes => { stderr += bytes.toString("utf8"); process.stderr.write(bytes); });
		child.once("error", error => complete({ exitCode: null, error: String(error) }));
		child.once("close", (exitCode, signal) => complete({ exitCode, signal }));
	});
	const identities = stdout.split(/\r?\n/).flatMap(line => { try { const value = JSON.parse(line); return value.wasmIdentity ? [value.wasmIdentity] : []; } catch { return []; } });
	assert.equal(identities.length, 1, "Actual Bun native WASM identity stamp is required"); assert.deepEqual(identities[0], binding.identity);
	return { executable: bun, args, cwd: root, explicitEnvironment: { ROCUT_TEST_WASM_DIRECTORY: wasmDirectory, ROCUT_PROBE_WASM_SHA256: expectedWasmSha256, ROCUT_BROWSER_WINDOW_AUTHORIZED: env.ROCUT_BROWSER_WINDOW_AUTHORIZED ?? null }, hostWasmIdentity: identities[0], ...result, stdout, stderr };
}
assert.equal((await filePin(browserExecutable)).sha256, "9b07943f834485b43c9d54caea2951c78715f9f07070a80ab6658465ebd3e711");
assert.equal(binding.identity.files.find(file => file.name === "opencut_wasm.js").sha256, "cc62ca83fb09032be1bf5427a156f572587ef21cc6a6c185d4743ac4fe7ddb39");
if (mode === "--prepare") {
	const before = await snapshot();
	const base = join(root, ".artifacts/p1d-browser-authority"); await mkdir(base, { recursive: true }); assert.equal(await realpath(base), base);
	const group = await mkdtemp(join(base, "run-"));
	const plan = { version: 1, root, group, preparedAt: new Date().toISOString(), featureToolchain, ordinaryToolchain, originalCases, browserExecutable, bun,
		binding: binding.identity, expectedWasmSha256, times: P1D_TIMES, svgContract: P1D_SVG_CONTRACT, browserLaunched: false, exportPlanned: false,
		runRequires: "Separately allocated browser/GPU window; fresh --prepare after source/HEAD/fixture-source changes; no hidden retry or identity rebase",
		limitations: ["Ordinary persisted model positive, original feature unsupported-SVG runtime negative, new bounded legal SVG/animation positive", "HTTP Host frames plus production capture seam observations, not installed Electron or arbitrary codecs", "Independent known geometry/pose/color gates precede repeat-hash and adapter-parity checks"] };
	await writeFile(join(group, "plan.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
	const execution = await execute("--prepare", group), after = await snapshot();
	const unchanged = JSON.stringify(digest(before)) === JSON.stringify(digest(after));
	const receipt = { version: 1, prepared: execution.exitCode === 0 && unchanged, browserLaunched: false, group, plan, execution, before, after, unchanged,
		preparationFixtureSourceValid: before.fixtureSource.valid && after.fixtureSource.valid, runBlockedUntilFreshFixtureSource: !after.fixtureSource.valid,
		casePlan: execution.exitCode === 0 ? await filePin(join(group, "case-plan.json")) : null,
		preparedInputs: execution.exitCode === 0 ? await preparedInputs(group) : null };
	await writeFile(join(group, "prepare-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
	console.log(JSON.stringify({ prepared: receipt.prepared, browserLaunched: false, group, fixtureSourceValid: after.fixtureSource.valid }));
	process.exitCode = receipt.prepared ? 0 : 1;
} else if (mode === "--run") {
	assert.equal(process.env.ROCUT_BROWSER_WINDOW_AUTHORIZED, "1", "A browser window must be explicitly allocated before --run");
	const group = await realpath(process.argv[3]);
	assert.equal(dirname(group), join(root, ".artifacts/p1d-browser-authority")); assert.match(group.split(/[\\/]/).at(-1), /^run-[A-Za-z0-9]+$/);
	assert(!existsSync(join(group, "run-receipt.json")) && !existsSync(join(group, "browser-evidence.json")), "Attempt already executed; prepare a fresh run, never overwrite/retry it");
	const prepared = await readJson(join(group, "prepare-receipt.json")), plan = await readJson(join(group, "plan.json"));
	assert(prepared.prepared); assert.equal(plan.root, root); assert.equal(plan.group, group);
	assert.deepEqual(plan.binding, binding.identity); assert.deepEqual(plan.originalCases, originalCases);
	assert.deepEqual(await filePin(join(group, "case-plan.json")), prepared.casePlan);
	const inputBefore = await preparedInputs(group); assert.deepEqual(inputBefore, prepared.preparedInputs, "Prepared persisted project/archive/author closure drift blocks launch");
	const before = await snapshot(); assert(before.fixtureSource.valid, "Invalid current fixture-source manifest blocks launch");
	assert.deepEqual(digest(before), digest(prepared.after), "Source/toolchain/WASM/browser/original-case drift blocks launch; prepare fresh after freeze");
	await writeFile(join(group, "run-before.json"), JSON.stringify(before, null, 2) + "\n", { flag: "wx" });
	const execution = await execute("--run", group), after = await snapshot();
	const inputAfter = await preparedInputs(group);
	const unchanged = JSON.stringify(digest(before)) === JSON.stringify(digest(after)) && JSON.stringify(inputBefore) === JSON.stringify(inputAfter);
	let evidence, evidenceError;
	try { evidence = await readJson(join(group, "browser-evidence.json")); assert.equal(evidence.passed, true); assert.equal(evidence.cases.length, 3); } catch (error) { evidenceError = String(error); }
	const passed = execution.exitCode === 0 && unchanged && after.fixtureSource.valid && !evidenceError;
	await writeFile(join(group, "run-receipt.json"), JSON.stringify({ version: 1, passed, plan, execution, before, after, inputBefore, inputAfter, unchanged, evidence, evidenceError, retries: 0, exportTested: false }, null, 2) + "\n", { flag: "wx" });
	console.log(JSON.stringify({ group, passed })); process.exitCode = passed ? 0 : 1;
} else throw Error("Use --prepare (CPU only) or --run <fresh-group> after explicit browser-window allocation");
