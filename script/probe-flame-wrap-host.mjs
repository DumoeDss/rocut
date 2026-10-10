import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const [pkg, creator, expectedWasmSha256] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	5,
	"Usage: node probe-flame-wrap-host.mjs <private-pkg> <Creator/flame-wrap.mjs> <wasm-sha256>",
);
assert(/^[a-f0-9]{64}$/.test(expectedWasmSha256));
const rel = win32.relative("C:/tmps", await realpath(pkg));
assert(rel && !rel.startsWith("..") && !win32.isAbsolute(rel));
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("C:/tmps/flame-wrap-host-");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pinned = [];
const bun =
	process.env.OPENCUT_BUN ||
	execFileSync("where.exe", ["bun"], { encoding: "utf8", windowsHide: true })
		.trim()
		.split(/\r?\n/)[0];
for (const path of [process.execPath, bun])
	pinned.push({ path, sha256: sha(await readFile(path)) });
for (const file of [
	"opencut_wasm_sync.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
	"package.json",
])
	pinned.push({
		path: join(pkg, file),
		sha256: sha(await readFile(join(pkg, file))),
	});
assert.equal(
	pinned.find((f) => f.path.endsWith(".wasm")).sha256,
	expectedWasmSha256,
);
for (const path of [
	creator,
	join(dirname(creator), "spatial.mjs"),
	fileURLToPath(import.meta.url),
	join(workspace, "script/fixtures/flame-wrap-host-build.mjs"),
	join(workspace, "script/fixtures/flame-wrap-host.mjs"),
])
	pinned.push({ path, sha256: sha(await readFile(path)) });
async function run(label, args) {
	let child,
		timer,
		stdout = "",
		stderr = "";
	const receipt = {
		label,
		code: null,
		signal: null,
		closeObserved: false,
		exitObserved: false,
		exitCode: null,
		exitSignal: null,
		timedOut: false,
		timeoutMs: 180000,
		killReturned: null,
		error: null,
	};
	try {
		child = spawn(bun, args, {
			cwd: workspace,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, TMP: root, TEMP: root },
		});
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		await new Promise((done) => {
			child.once("error", (error) => {
				receipt.error = {
					name: error.name,
					code: error.code,
					message: error.message,
				};
			});
			child.once("exit", (code, signal) => {
				receipt.exitObserved = true;
				receipt.exitCode = code;
				receipt.exitSignal = signal;
			});
			child.once("close", (code, signal) => {
				receipt.closeObserved = true;
				receipt.code = code;
				receipt.signal = signal;
				done();
			});
			timer = setTimeout(() => {
				receipt.timedOut = true;
				try {
					receipt.killReturned = child.kill();
				} catch (error) {
					receipt.killError = String(error);
				}
			}, receipt.timeoutMs);
		});
	} catch (error) {
		receipt.error = {
			name: error.name,
			code: error.code,
			message: error.message,
		};
	} finally {
		clearTimeout(timer);
		for (const [stream, contents] of [
			["stdout", stdout],
			["stderr", stderr],
		]) {
			try {
				await writeFile(join(root, `${label}-${stream}.log`), contents, {
					flag: "wx",
				});
			} catch (error) {
				receipt.logWriteErrors ??= [];
				receipt.logWriteErrors.push({ stream, message: error.message });
			}
		}
	}
	receipt.ok =
		receipt.closeObserved &&
		receipt.code === 0 &&
		!receipt.signal &&
		!receipt.error &&
		!receipt.timedOut &&
		!receipt.logWriteErrors;
	return receipt;
}
const result = {
	root,
	checks: [],
	beforeAfterPin: false,
	pinned,
	closure: null,
	failure: null,
	ok: false,
	gpuTested: false,
	browserTested: false,
	exportTested: false,
	pinScope:
		"Explicit runtime/package/Creator files and bundler-supplied source buffers; not a transitive closure of external or dynamic imports.",
};
try {
	result.checks.push(
		await run("bundle", [
			join(workspace, "script/fixtures/flame-wrap-host-build.mjs"),
			workspace,
			pkg,
			root,
			creator,
		]),
	);
	if (result.checks[0].ok) {
		result.closure = JSON.parse(
			await readFile(join(root, "closure.json"), "utf8"),
		);
		for (const file of result.closure.files)
			assert.equal(
				sha(await readFile(file.path)),
				file.sha256,
				`Before execution changed: ${file.path}`,
			);
		pinned.push({
			path: join(root, "host.mjs"),
			sha256: sha(await readFile(join(root, "host.mjs"))),
		});
		result.checks.push(await run("host", [join(root, "host.mjs")]));
	}
} catch (error) {
	result.failure = {
		name: error.name,
		code: error.code,
		message: error.message,
	};
} finally {
	result.pinFailures = [];
	for (const file of [...pinned, ...(result.closure?.files || [])]) {
		try {
			assert.equal(
				sha(await readFile(file.path)),
				file.sha256,
				`After execution changed: ${file.path}`,
			);
		} catch (error) {
			result.pinFailures.push({ path: file.path, message: error.message });
		}
	}
	result.beforeAfterPin = !result.failure && result.pinFailures.length === 0;
	result.ok =
		!result.failure &&
		result.beforeAfterPin &&
		result.checks.length === 2 &&
		result.checks.every((check) => check.ok);
	await writeFile(join(root, "run.json"), JSON.stringify(result, null, 2), {
		flag: "wx",
	});
	console.log(
		JSON.stringify({
			root,
			checks: result.checks,
			ok: result.ok,
			beforeAfterPin: result.beforeAfterPin,
			failure: result.failure,
		}),
	);
	process.exitCode = result.ok ? 0 : 1;
}
