import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBubbleHostHarness, assertBubbleHostRealPath, assertBubbleHostSource,
	bubbleHostOwnedFiles, bubbleHostTree } from "./fixtures/bubble-host-paths.mjs";
import { bubbleHostDigest } from "./fixtures/bubble-host-source.mjs";

const [snapshot, manifestSha256, wasmSha256, creatorModule, artifactParent] = process.argv.slice(2);
assert.equal(process.argv.length, 7,
	"Usage: node probe-bubble-host.mjs <private-snapshot> <manifest-sha256> <wasm-sha256> <private/bubble.mjs> <private-artifact-parent>");
for (const path of [snapshot, creatorModule, artifactParent]) await assertBubbleHostRealPath(path);
const location = win32.relative(snapshot, artifactParent);
assert(location.startsWith("..") || win32.isAbsolute(location), "Artifacts must be outside frozen source");
const before = await assertBubbleHostSource({ snapshot, manifestSha256, wasmSha256 });
const root = await mkdtemp(join(artifactParent, "bubble-host-")), harness = join(root, "harness");
const fixture = join(root, "fixture"), temp = join(root, "temp");
for (const path of [harness, fixture, temp]) await mkdir(path);
const shared = resolve(fileURLToPath(new URL("../", import.meta.url))), files = [];
for (const relative of bubbleHostOwnedFiles) {
	const source = join(shared, relative), target = join(harness, relative), bytes = await readFile(source);
	await mkdir(dirname(target), { recursive: true }); await copyFile(source, target);
	assert.equal(bubbleHostDigest(await readFile(target)), bubbleHostDigest(bytes));
	files.push({ relative, source, sha256: bubbleHostDigest(bytes), bytes: bytes.length });
}
await writeFile(join(harness, "harness-source.json"), JSON.stringify({ files }, null, 2) + "\n", { flag: "wx" });
await assertBubbleHostHarness(harness);
const helperBefore = await Promise.all(["bubble.mjs", "spatial.mjs"].map(async (name) => {
	const path = join(dirname(creatorModule), name); await assertBubbleHostRealPath(path);
	return { path, sha256: bubbleHostDigest(await readFile(path)) };
}));
const env = { ...process.env, TMP: temp, TEMP: temp, ROCUT_BUBBLE_CREATOR_MODULE: creatorModule };
async function run(label, command, args) {
	const startedAt = new Date().toISOString();
	const child = spawn(command, args, { cwd: harness, windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"], env });
	let stdout = "", stderr = "", timedOut = false, exitCode, signal, spawnError;
	child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
	child.stdout.on("data", (text) => { stdout += text; }); child.stderr.on("data", (text) => { stderr += text; });
	const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
	try { ({ exitCode, signal } = await new Promise((done, reject) => {
		child.once("error", reject); child.once("close", (exitCode, signal) => done({ exitCode, signal }));
	})); } catch (error) { spawnError = error.message; } finally { clearTimeout(timer); }
	for (const [name, text] of [["stdout", stdout], ["stderr", stderr]])
		await writeFile(join(root, `${label}-${name}.log`), text, { encoding: "utf8", flag: "wx" });
	return { label, command, args, startedAt, endedAt: new Date().toISOString(), exitCode, signal, spawnError,
		timedOut, stdoutSha256: bubbleHostDigest(stdout), stderrSha256: bubbleHostDigest(stderr) };
}
const checks = [await run("static", process.execPath,
	["--test", join(harness, "script/fixtures/bubble-host-static.test.mjs")])];
if (checks[0].exitCode === 0 && !checks[0].timedOut)
	checks.push(await run("host", process.env.OPENCUT_BUN || "bun", [join(harness, "script/fixtures/bubble-host.mjs"),
		fixture, snapshot, creatorModule, manifestSha256, wasmSha256]));
let evidence, provenanceAfter, provenanceError;
try {
	provenanceAfter = await assertBubbleHostSource({ snapshot, manifestSha256, wasmSha256 });
	assert.deepEqual(provenanceAfter, before); await assertBubbleHostHarness(harness);
	for (const file of helperBefore) assert.equal(bubbleHostDigest(await readFile(file.path)), file.sha256);
	for (const file of files) assert.equal(bubbleHostDigest(await readFile(file.source)), file.sha256);
} catch (error) { provenanceError = String(error.message); }
try { evidence = JSON.parse(await readFile(join(fixture, "evidence.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const result = { ok: checks.length === 2 && checks.every((item) => item.exitCode === 0 && !item.timedOut)
	&& evidence?.ok === true && evidence.hostClosed === true && !provenanceError,
	root, fixture, snapshot, manifestSha256, wasmSha256, creatorModule, checks,
	provenanceBefore: before, provenanceAfter, provenanceError, helperBefore,
	harnessFiles: files, outputs: await bubbleHostTree(root),
	renderingTested: false, gpuTested: false, uiTested: false, codecTested: false,
	versionBoundary: before.versionBoundary };
await writeFile(join(root, "run.json"), JSON.stringify(result, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ ok: result.ok, root, checks: checks.map(({ label, exitCode }) => ({ label, exitCode })),
	provenanceError, reopens: evidence?.reopens.length, rejected: evidence?.rejected.length }));
process.exitCode = result.ok ? 0 : 1;
