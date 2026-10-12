import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

// A Node-only pack is intentionally separate from editor/installed acceptance.
// Every attempt keeps its own output and logs, including failed attempts.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [artifactParent, expectedWasm] = process.argv.slice(2);
assert(artifactParent && isAbsolute(artifactParent), "Explicit absolute artifact parent required");
assert(/^[a-f0-9]{64}$/.test(expectedWasm ?? ""), "Explicit expected WASM SHA-256 required");
const equalPath = (a, b) => process.platform === "win32"
	? resolve(a).toLowerCase() === resolve(b).toLowerCase()
	: resolve(a) === resolve(b);
assert(!lstatSync(artifactParent).isSymbolicLink() && lstatSync(artifactParent).isDirectory());
assert(equalPath(realpathSync(artifactParent), artifactParent), "Artifact parent redirected");
const root = mkdtempSync(join(artifactParent, "rocut-node-runtime-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });
const filePin = (path) => {
	const stat = lstatSync(path);
	assert(stat.isFile() && !stat.isSymbolicLink(), `Non-regular input: ${path}`);
	const bytes = readFileSync(path);
	return { path, bytes: bytes.length, sha256: sha(bytes) };
};
const env = { ...process.env, NO_COLOR: "1", GOMAXPROCS: "2" };
for (const key of Object.keys(env)) {
	if (["node_options", "bun_options"].includes(key.toLowerCase())) delete env[key];
}
function run(name, command, args, extraEnv = {}, timeout = 240000) {
	const startedAt = new Date().toISOString();
	const result = spawnSync(command, args, {
		cwd: repoRoot, env: { ...env, ...extraEnv }, windowsHide: true,
		encoding: null, timeout, maxBuffer: 8 * 1024 * 1024,
	});
	const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
	const logs = { stdout: join(root, `${name}.stdout.log`), stderr: join(root, `${name}.stderr.log`) };
	writeFileSync(logs.stdout, stdout, { flag: "wx" });
	writeFileSync(logs.stderr, stderr, { flag: "wx" });
	const output = stripVTControlCharacters(decoder.decode(stdout) + "\n" + decoder.decode(stderr));
	return {
		command: [command, ...args], startedAt, finishedAt: new Date().toISOString(),
		status: result.status, signal: result.signal,
		error: result.error ? { name: result.error.name, code: result.error.code, message: result.error.message } : null,
		stdoutSha256: sha(stdout), stderrSha256: sha(stderr), logs,
		summary: output.split(/\r?\n/).filter((line) => /pass|fail|skip|REAL_EXIT_CODE|bundle:|determinism:|error|Error|Assertion/.test(line)),
	};
}
const report = {
	version: 1, root, repoRoot, startedAt: new Date().toISOString(), node: process.version,
	expectedWasm, helper: filePin(fileURLToPath(import.meta.url)), ok: false,
	scope: "Private Node runtime pack with editor surface omitted; two-build determinism, target-list/ensure smoke, and real fixed Particle worker using the packed WASM module. No browser/GPU/editor export, epkg, or installed Electron proof.",
	removedByPacker: "Only this attempt's .determinism-second and dedicated empty smoke project/registry; author projects and installation untouched.",
};
try {
	const tracked = spawnSync("git", ["ls-files", "-z", "--", "apps/cli/src", "packages", "script/pack-runtime.mjs", "script/pack-particle-sampler.mjs", "script/pack-liquid-object.mjs", "script/runtime-wasm-package-closure.mjs", "script/build-particle-browser.mjs", "package.json", "bun.lock"], {
		cwd: repoRoot, windowsHide: true, encoding: null, maxBuffer: 4 * 1024 * 1024,
	});
	assert.equal(tracked.status, 0);
	const sourceFiles = decoder.decode(tracked.stdout).split("\0").filter((path) => path && !path.includes("/__tests__/") && !/\.test\.[^/]+$/.test(path)).sort();
	assert(sourceFiles.includes("apps/cli/src/main.ts"), "Source inventory is vacuous");
	const sourcePins = () => sourceFiles.map((path) => filePin(join(repoRoot, path)));
	const wasmRoot = join(repoRoot, "rust/wasm/pkg");
	assert(equalPath(realpathSync(wasmRoot), wasmRoot), "Canonical WASM package redirected");
	const wasmPins = () => readdirSync(wasmRoot).sort().map((name) => filePin(join(wasmRoot, name)));
	report.sourceBefore = sourcePins();
	report.wasmBefore = wasmPins();
	assert.equal(filePin(join(wasmRoot, "opencut_wasm_bg.wasm")).sha256, expectedWasm);
	const manifestPath = join(root, "pack-manifest.json"), out = join(root, "runtime");
	report.pack = run("pack", process.execPath, [join(repoRoot, "script/pack-runtime.mjs"), "--out", out, "--manifest", manifestPath, "--skip-surface", "--allow-dirty"]);
	assert.equal(report.pack.status, 0, `Pack failed; inspect ${report.pack.logs.stderr}`);
	report.manifest = filePin(manifestPath);
	const manifest = JSON.parse(decoder.decode(readFileSync(manifestPath)));
	assert.equal(manifest.wasmSibling.sha256, expectedWasm);
	assert.equal(filePin(join(out, "opencut_wasm_bg.wasm")).sha256, expectedWasm);
	assert.equal(manifest.determinism.reproduced, true);
	assert.deepEqual(manifest.smoke.ensureRoundTrip.states, ["started", "reused"]);
	assert.equal(manifest.smoke.listCheck.exitCode, 0);
	assert.equal(manifest.surface.copied, false, "This probe must not consume an existing editor dist");
	report.packedWorker = filePin(join(out, "particle-sampler-worker-entry.mjs"));
	assert.equal(report.packedWorker.sha256, filePin(join(repoRoot, "apps/cli/src/programmatic/particle-sampler-worker-entry.mjs")).sha256);
	const workerTest = "apps/cli/src/__tests__/particle-sampler-worker-real.test.ts";
	report.workerTestBefore = filePin(join(repoRoot, workerTest));
	report.workers = run("workers", "bun", ["test", workerTest], { ROCUT_PARTICLE_WASM_MODULE: join(out, "particle-sampler-wasm.mjs") }, 120000);
	assert.equal(report.workers.status, 0, "Real packed-module worker test failed");
	assert(report.workers.summary.some((line) => line.trim() === "8 pass"), "Expected all eight fixed worker tests; reject vacuous or partial runs");
	assert(report.workers.summary.some((line) => line.trim() === "0 fail"), "Worker zero-failure summary required");
	assert(!report.workers.summary.some((line) => /\b[1-9][0-9]* skip\b/.test(line)), "Worker tests skipped");
	report.workerTestAfter = filePin(join(repoRoot, workerTest));
	assert.deepEqual(report.workerTestAfter, report.workerTestBefore);
	report.sourceAfter = sourcePins();
	report.wasmAfter = wasmPins();
	assert.deepEqual(report.sourceAfter, report.sourceBefore, "Runtime source changed during probe");
	assert.deepEqual(report.wasmAfter, report.wasmBefore, "WASM package changed during probe");
	report.sourceStable = true;
	report.wasmStable = true;
	report.ok = true;
} catch (error) {
	report.failure = { name: error.name, message: error.message };
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	writeFileSync(join(root, "evidence.json"), JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
	console.log(JSON.stringify({ root, ok: report.ok, failure: report.failure, pack: report.pack?.summary, workers: report.workers?.summary }));
}
