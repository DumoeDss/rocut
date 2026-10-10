import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { join, resolve, win32 } from "node:path";
import { assertBlazeHostRealPath } from "./fixtures/blaze-host-paths.mjs";

const [snapshot, manifestSha256, wasmSha256, creatorModule, artifactParent] =
	process.argv.slice(2);
assert(
	process.argv.length === 7,
	"Usage: node probe-blaze-host.mjs <private-snapshot> <manifest-sha256> <wasm-sha256> <creator/blaze.mjs> <private-artifact-parent>",
);
await assertBlazeHostRealPath(snapshot);
await assertBlazeHostRealPath(artifactParent);
const outputLocation = win32.relative(snapshot, artifactParent);
assert(
	outputLocation.startsWith("..") || win32.isAbsolute(outputLocation),
	"Artifacts must not be created inside the frozen source snapshot",
);
assert.equal(resolve(await realpath(creatorModule)), resolve(creatorModule));
for (const value of [manifestSha256, wasmSha256])
	assert(/^[a-f0-9]{64}$/.test(value));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(
	hash(await readFile(join(snapshot, "fixture-source.json"))),
	manifestSha256,
);
const root = await mkdtemp(join(artifactParent, "blaze-host-"));
const fixture = join(root, "fixture"),
	temp = join(root, "temp");
await mkdir(fixture);
await mkdir(temp);
const args = [
	join(snapshot, "script/fixtures/blaze-host.ts"),
	fixture,
	creatorModule,
	manifestSha256,
	wasmSha256,
];
const startedAt = new Date().toISOString();
const command = process.env.OPENCUT_BUN || "bun";
const child = spawn(command, args, {
	cwd: snapshot,
	windowsHide: true,
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, TMP: temp, TEMP: temp },
});
let stdout = "",
	stderr = "",
	timedOut = false;
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (text) => {
	stdout += text;
});
child.stderr.on("data", (text) => {
	stderr += text;
});
const timer = setTimeout(() => {
	timedOut = true;
	child.kill();
}, 120000);
let exitCode, signal, spawnError;
try {
	({ exitCode, signal } = await new Promise((done, reject) => {
		child.once("error", reject);
		child.once("close", (exitCode, signal) => done({ exitCode, signal }));
	}));
} catch (error) {
	spawnError = error.message;
} finally {
	clearTimeout(timer);
}
await writeFile(join(root, "stdout.log"), stdout, {
	encoding: "utf8",
	flag: "wx",
});
await writeFile(join(root, "stderr.log"), stderr, {
	encoding: "utf8",
	flag: "wx",
});
let evidence;
try {
	evidence = JSON.parse(await readFile(join(fixture, "evidence.json"), "utf8"));
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
const ok =
	exitCode === 0 &&
	!timedOut &&
	evidence?.ok === true &&
	evidence.hostClosed === true;
const result = {
	ok,
	root,
	fixture,
	snapshot,
	manifestSha256,
	wasmSha256,
	creatorModule,
	command,
	args,
	startedAt,
	endedAt: new Date().toISOString(),
	exitCode,
	signal,
	spawnError,
	timedOut,
	stdoutSha256: hash(stdout),
	stderrSha256: hash(stderr),
	renderingTested: false,
	uiTested: false,
	gpuTested: false,
};
await writeFile(
	join(root, "run.json"),
	JSON.stringify(result, null, 2) + "\n",
	{ encoding: "utf8", flag: "wx" },
);
console.log(JSON.stringify(result));
process.exitCode = ok ? 0 : 1;
