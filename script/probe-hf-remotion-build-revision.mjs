// Compile/archive/real Host persistence only. Never installs or launches a browser.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, readdir, realpath, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [toolchainArgument, bunArgument, priorReceiptArgument] = process.argv.slice(2);
assert.ok(toolchainArgument && bunArgument, "Supply existing toolchain and Bun executable paths");
const toolchain = await realpath(toolchainArgument);
const bun = await realpath(bunArgument);
const wasmDirectory = await realpath(join(root, "rust/wasm/pkg"));
const expectedWasmSha256 = "084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12";
const test = "apps/cli/src/__tests__/programmatic-build-revision.test.ts";
const preload = "script/fixtures/build-revision-wasm-identity.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const strictText = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const json = (bytes) => JSON.parse(strictText(bytes));

async function fileIdentity(path, base = root) {
	const bytes = await readFile(join(base, path));
	return { path: path.replaceAll("\\", "/"), byteLength: bytes.length, sha256: hash(bytes) };
}
async function closure(directory) {
	const paths = [];
	async function walk(current) {
		for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
			const path = join(current, entry.name);
			assert.ok(!entry.isSymbolicLink(), `Closure contains unaccounted symbolic link: ${path}`);
			if (entry.isDirectory()) await walk(path);
			else {
				assert.ok(entry.isFile(), `Closure contains non-ordinary file: ${path}`);
				paths.push(relative(directory, path));
			}
		}
	}
	await walk(directory);
	const files = [];
	for (let index = 0; index < paths.length; index += 16)
		files.push(...await Promise.all(paths.slice(index, index + 16).map((path) => fileIdentity(path, directory))));
	files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	return { directory, fileCount: files.length, byteLength: files.reduce((sum, file) => sum + file.byteLength, 0), manifestSha256: hash(JSON.stringify(files)), files };
}

const requiredVersions = { "@hyperframes/core": "0.8.139", acorn: "8.19.0", remotion: "4.0.440", react: "18.3.1", "react-dom": "18.3.1", esbuild: "0.27.3" };
const priorTestAttempts = [];
if (priorReceiptArgument) {
	const bytes = await readFile(priorReceiptArgument);
	const prior = json(bytes);
	priorTestAttempts.push(...(prior.priorTestAttempts ?? []));
	priorTestAttempts.push({
		receiptPath: await realpath(priorReceiptArgument), receiptSha256: hash(bytes),
		status: prior.status, run: prior.run, loadedWasm: prior.loadedWasm,
		invariants: prior.invariants, sourceInputs: prior.sourceInputs,
		toolchainManifestBefore: prior.toolchainClosure.before.manifestSha256,
		toolchainManifestAfter: prior.toolchainClosure.after.manifestSha256,
		diagnosis: prior.run.stderr.includes("Remotion archive has no adapter identity")
			? "Different-lock negative control discarded valid Remotion adapter, triggering earlier metadata-policy admission. Test-only fix separates missing-adapter and different-package-version controls, each preserving every unrelated field and checking unchanged persistence."
			: "Exact rebuild expectation omitted existing runtimeMetadata field. Test-only fix derives fixture result type from real compiler, verifies metadata against archived adapter, and compares the complete original/revised result with only reusedDocument changed; production unchanged.",
		...(prior.invariants.bothRealTestsExecuted === false ? {
			priorProbeMetricCorrection: "Initial bothRealTestsExecuted parser expected [pass], but Bun 1.4.2 prints (pass)/(fail). Both engines actually ran; the Remotion test failed. Original prior receipt is preserved unchanged.",
		} : {}),
	});
}
const lock = json(await readFile(join(toolchain, "package-lock.json")));
for (const [name, version] of Object.entries(requiredVersions)) {
	assert.equal(lock.packages[`node_modules/${name}`].version, version);
	assert.equal(json(await readFile(join(toolchain, "node_modules", name, "package.json"))).version, version);
}
const sourcePaths = [
	test, "apps/cli/src/__tests__/programmatic-build-revision-fixture.ts",
	"apps/cli/src/host.ts", "apps/cli/src/file-store.ts",
	"apps/cli/src/programmatic/engines/build-revision.ts",
	"apps/cli/src/programmatic/engines/build-service.ts",
	"apps/cli/src/programmatic/engines/compile-project.ts",
	"apps/cli/src/programmatic/engines/toolchain.ts",
	"apps/cli/src/programmatic/engines/engine-versions.ts",
	"apps/cli/src/programmatic/remotion-metadata-archive.ts",
	"apps/cli/src/programmatic/remotion-metadata-policy.ts",
	preload, "script/probe-hf-remotion-build-revision.mjs",
];
const sourceBefore = await Promise.all(sourcePaths.map((path) => fileIdentity(path)));
const productionCompilePath = "apps/cli/src/programmatic/engines/compile-project.ts";
const productionHeadBytes = execFileSync("git", ["show", `HEAD:${productionCompilePath}`], { cwd: root });
const productionIdentity = {
	path: productionCompilePath,
	currentSha256: sourceBefore.find((file) => file.path === productionCompilePath).sha256,
	headSha256: hash(productionHeadBytes),
	headAlreadyContainsRuntimeMetadata: strictText(productionHeadBytes).includes("runtimeMetadata:"),
};
assert.equal(productionIdentity.currentSha256, productionIdentity.headSha256);
assert.equal(productionIdentity.headAlreadyContainsRuntimeMetadata, true);
const toolchainBefore = await closure(toolchain);
const wasmBefore = await closure(wasmDirectory);
assert.equal(wasmBefore.files.find((file) => file.path === "opencut_wasm_bg.wasm").sha256, expectedWasmSha256);
const packageBindings = [];
for (const owner of ["", "apps/cli/", "packages/editor-classic/", "packages/editor-contracts/"]) {
	let lookupDirectory = resolve(root, owner);
	let resolved;
	const lookupPaths = [];
	while (!resolved) {
		const path = join(lookupDirectory, "node_modules/opencut-wasm/opencut_wasm_sync.js");
		lookupPaths.push(path);
		try { resolved = await realpath(path); }
		catch (error) {
			if (error.code !== "ENOENT" || lookupDirectory === root) throw error;
			lookupDirectory = dirname(lookupDirectory);
		}
	}
	assert.equal(dirname(resolved), wasmDirectory);
	packageBindings.push({ owner: owner || "workspace-root", lookupPaths, resolvedEntry: resolved, sha256: hash(await readFile(resolved)) });
}
const environment = { ...process.env };
const clearedEnvironmentKeys = ["ROCUT_HTML_BROWSER_PATH", "ELFTIA_HTML_FRAME_CONNECTION_FILE", "ROCUT_TEST_WASM_DIRECTORY", "ROCUT_ENGINE_TOOLCHAIN_DIR"];
for (const key of clearedEnvironmentKeys) delete environment[key];
environment.ROCUT_TEST_BUILD_REVISION_TOOLCHAIN = toolchain;
environment.ROCUT_REVISION_WASM_DIRECTORY = wasmDirectory;
environment.ROCUT_REVISION_WASM_SHA256 = expectedWasmSha256;
environment.NO_COLOR = "1";
const args = ["test", "--preload", `./${preload}`, test];
const startedAt = new Date().toISOString();
let stdout = "", stderr = "", timedOut = false;
const result = await new Promise((complete, reject) => {
	const child = spawn(bun, args, { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	child.stdout.on("data", (bytes) => { stdout += bytes.toString("utf8"); });
	child.stderr.on("data", (bytes) => { stderr += bytes.toString("utf8"); });
	const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
	child.on("error", (error) => { clearTimeout(timeout); reject(error); });
	child.on("close", (exitCode, signal) => { clearTimeout(timeout); complete({ exitCode, signal }); });
});
const finishedAt = new Date().toISOString();
const toolchainAfter = await closure(toolchain);
const wasmAfter = await closure(wasmDirectory);
const sourceAfter = await Promise.all(sourcePaths.map((path) => fileIdentity(path)));
const output = `${stdout}\n${stderr}`;
const totals = {
	passed: Number(output.match(/(\d+) pass\b/)?.[1] ?? -1),
	failed: Number(output.match(/(\d+) fail\b/)?.[1] ?? -1),
	skipped: Number(output.match(/(\d+) skip\b/)?.[1] ?? 0),
	assertions: Number(output.match(/(\d+) expect\(\) calls/)?.[1] ?? -1),
};
const identityLine = stdout.split(/\r?\n/).find((line) => line.startsWith('{"buildRevisionWasmIdentity":'));
const loadedWasm = identityLine ? JSON.parse(identityLine).buildRevisionWasmIdentity : undefined;
const invariants = {
	toolchainUnchanged: toolchainBefore.manifestSha256 === toolchainAfter.manifestSha256,
	wasmUnchanged: wasmBefore.manifestSha256 === wasmAfter.manifestSha256,
	selectedSourceInputsUnchanged: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
	actualWasmIdentityConfirmed: loadedWasm?.wasmSha256 === expectedWasmSha256,
	bothRealTestsExecuted: ["hyperframes", "remotion"].every((engine) => new RegExp(`\\((?:pass|fail)\\) ${engine} real archive revision`).test(output)),
	bothRealTestsPassed: ["hyperframes", "remotion"].every((engine) => output.includes(`(pass) ${engine} real archive revision`)),
};
const passed = result.exitCode === 0 && !timedOut && totals.passed === 4 && totals.failed === 0 && totals.skipped === 0 && Object.values(invariants).every(Boolean);
const receipt = {
	version: 1, date: "2026-10-11", status: passed ? "passed" : "failed",
	scope: "Existing real HyperFrames/Remotion archive compile-revise-rebuild tests, authenticated Host and FileProjectStore persistence; no browser rendering/export or Electron acceptance",
	workspace: root, requiredVersions, packageLockEntries: Object.keys(lock.packages).length,
	runtime: { node: process.version, bun: execFileSync(bun, ["--version"], { encoding: "utf8" }).trim(), bunExecutable: bun, bunSha256: hash(await readFile(bun)) },
	run: { command: [bun, ...args], startedAt, finishedAt, ...result, timedOut, totals, stdout, stderr, explicitEnvironment: { ROCUT_TEST_BUILD_REVISION_TOOLCHAIN: toolchain, ROCUT_REVISION_WASM_DIRECTORY: wasmDirectory, ROCUT_REVISION_WASM_SHA256: expectedWasmSha256 }, clearedEnvironmentKeys },
	loadedWasm, packageBindings, invariants, priorTestAttempts, productionIdentity,
	toolchainClosure: { before: toolchainBefore, after: { ...toolchainAfter, files: undefined }, manifestFormat: "SHA256 of UTF-8 JSON.stringify(sorted files with path, byteLength, sha256); full before manifest included; unchanged after hash verifies same complete closure" },
	wasmClosure: { before: wasmBefore, after: wasmAfter },
	sourceInputs: { before: sourceBefore, after: sourceAfter, scope: "Selected execution entry/Host/persistence/compiler/adapter files only; not a complete transitive source closure" },
	executedAssertions: [
		"Rust validation precedes transport membership; Three gate only reaches missing-resource rejection (not real Three archive acceptance)",
		"Both engines compile real immutable text/CSS/PNG archives after author directory rename",
		"Host capability and unauthorized route checks",
		"Unknown/duplicate/binary changes, invalid input props, lone surrogate and malformed archive UTF-8 reject without archive/record mutation",
		"Tampered source/image/lock attachments, different pinned lock, compiler failure and >1MB body reject with unchanged state",
		"Concurrent revision returns one 200 and one 429",
		"Unicode revised source round-trips losslessly while original source remains intact",
		"Original and revised sources rebuild reproducibly with reusedDocument true",
		"Remotion props-only revision preserves archived inputs and changes compiled document",
		"Cancellation preserves attachments and project record; automation revision remains zero",
	],
	originalFailures: [
		{ kind: "supporting-probe-preflight", exitCode: 1, testsStarted: false,
			originalCommand: [process.execPath, "script/probe-hf-remotion-build-revision.mjs", toolchain, bun],
			originalError: "ENOENT: no such file or directory, realpath 'E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\elftia\\.worktrees\\rocut-acceptance-20261011-6fa23f6b\\_others\\rocut\\packages\\editor-contracts\\node_modules\\opencut-wasm\\opencut_wasm_sync.js'",
			diagnosis: "Probe wrongly required a direct per-owner package copy; editor-contracts normally resolves upward to workspace-root node_modules. Corrected only probe inventory to record nearest existing ancestor; no dependency or existing-test change.",
			originalProbeSha256: "1a79886c0b9f39998513b499ea58bfee648a544e5a4d5e656f35f6182764fb14" },
		...(passed ? [] : [{ kind: "first-bun-test-run-result", exitCode: result.exitCode, timedOut, outputPreserved: "run.stdout and run.stderr" }]),
	],
	testOnlyCorrections: ["Preserve real archived adapter and mutate only one package version for the different-toolchain control; independently delete only adapter for missing-identity control", "Derive fixture result type from actual compiler and compare complete original/revised compile result on rebuild with only reusedDocument changed; explicitly validate runtimeMetadata against archived adapter"],
	limitations: ["No browser resources launched; no frame, audio, export, Electron or whole ecosystem acceptance claimed", "Fixture deliberately does not apply returned source to project timeline; it tests archive attachment persistence and unchanged real project record", "No dependency installation or changes to production source, Rust, API contracts or source-freeze/Tunnel helpers; parent-authorized corrections are test-only"],
};
const artifact = await mkdtemp(join(tmpdir(), "rocut-hf-remotion-revision-20261011-"));
const receiptPath = join(artifact, "evidence.json");
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(stdout);
console.log(stderr);
console.log(JSON.stringify({ receiptPath, passed, totals, invariants, receiptSha256: hash(await readFile(receiptPath)), toolchainManifestSha256: toolchainBefore.manifestSha256 }));
process.exitCode = passed ? 0 : 1;
