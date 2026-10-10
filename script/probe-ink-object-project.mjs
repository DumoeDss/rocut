import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { createPrivateEffectInputs } from "./fixtures/private-effect-inputs.mjs";
import { pinInkHostToolchain } from "./fixtures/ink-object-host-toolchain.mjs";
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const original = "C:/tmps/ink-object-host-P3xegw",
	pkg = "C:/tmps/liquid-object-wasm-development-35IsB3/pkg";
const threeToolchain =
	"C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9";
const root = await mkdtemp("C:/tmps/ink-object-project-");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pin = async (path) => {
	const bytes = await readFile(path);
	return { path, bytes: bytes.length, sha256: sha(bytes) };
};
const report = {
	ok: false,
	root,
	original,
	gpuExecuted: false,
	scope:
		"Existing unchanged Ink dedicated project, production Host frame API, four captures maximum; no export or editor UI history",
};
const processes = [],
	errors = [],
	exceptions = [],
	sockets = [];
const originalSpawn = childProcess.spawn,
	NativeWebSocket = globalThis.WebSocket;
childProcess.spawn = function (...args) {
	const child = originalSpawn(...args),
		flags = args[1] ?? [];
	const item = {
		executable: basename(args[0]),
		pid: child.pid,
		closed: false,
		profile: flags.find((x) => x.startsWith("--user-data-dir="))?.slice(16),
	};
	processes.push(item);
	child.once("close", (code, signal) =>
		Object.assign(item, { closed: true, code, signal }),
	);
	return child;
};
syncBuiltinESMExports();
globalThis.WebSocket = class extends NativeWebSocket {
	constructor(...args) {
		super(...args);
		const item = { closed: false };
		sockets.push(item);
		this.addEventListener("close", () => {
			item.closed = true;
		});
		this.addEventListener("message", (event) => {
			try {
				const message = JSON.parse(String(event.data));
				if (
					message.method === "Runtime.consoleAPICalled" &&
					message.params.type === "error"
				)
					errors.push(
						message.params.args
							.map((x) => x.value ?? x.description)
							.join(" ")
							.slice(0, 2000),
					);
				if (message.method === "Runtime.exceptionThrown")
					exceptions.push(message.params.exceptionDetails);
			} catch {
				/* Non-JSON transport frames only. */
			}
		});
	}
};
let inputs,
	files = [],
	toolchainBefore;
try {
	report.packageBefore = await Promise.all(
		[
			"opencut_wasm_bg.wasm",
			"opencut_wasm_bg.js",
			"opencut_wasm_sync.js",
			"package.json",
		].map((x) => pin(join(pkg, x))),
	);
	assert.equal(
		report.packageBefore[0].sha256,
		"7f7dba6b40fa79618d1e2f7fedab82e1731dee9c26564796f597bf31758b349c",
	);
	report.originalReceipt = await pin(join(original, "evidence.json"));
	assert.equal(
		report.originalReceipt.sha256,
		"f613865970a38aa4e95f1cd52cbba86a47a06adcee55af9f7af5a3f92e5a7d68",
	);
	const executable = chromium.executablePath();
	report.browserExecutable = await pin(executable);
	toolchainBefore = await pinInkHostToolchain(threeToolchain);
	await writeFile(
		join(root, "toolchain-closure.json"),
		JSON.stringify(toolchainBefore, null, 2),
		{ flag: "wx" },
	);
	const temporary = join(root, "temp");
	await mkdir(temporary);
	for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = temporary;
	inputs = await createPrivateEffectInputs(root);
	const esbuild = await import(
		pathToFileURL(join(threeToolchain, "node_modules/esbuild/lib/main.js")).href
	);
	const result = await esbuild.build({
		entryPoints: [
			join(workspace, "script/fixtures/ink-object-project-frame.mjs"),
		],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
		logLevel: "silent",
		banner: {
			js: "import {createRequire as __probeRequire} from 'node:module';const require=__probeRequire(import.meta.url);",
		},
		plugins: [
			{
				name: "private-ink-project-snapshot",
				setup(builder) {
					builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({
						path: pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href,
						external: true,
					}));
					builder.onLoad(
						{ filter: /\.(ts|tsx|js|mjs|cjs|json)$/ },
						async ({ path }) => {
							const suffix = extname(path),
								loader =
									suffix === ".ts"
										? "ts"
										: suffix === ".tsx"
											? "tsx"
											: suffix === ".json"
												? "json"
												: "js";
							const captured = await inputs.capture(path, { loader });
							files.push(captured.file);
							return { contents: captured.bytes, loader };
						},
					);
				},
			},
		],
	});
	esbuild.stop();
	assert.equal(result.outputFiles.length, 1);
	const bundle = join(root, "host-frame.mjs");
	await writeFile(bundle, result.outputFiles[0].contents, { flag: "wx" });
	report.bundle = await pin(bundle);
	report.inputs = {
		files,
		validation: await inputs.verify(files),
		snapshot: inputs.evidence(),
	};
	const api = await import(pathToFileURL(bundle).href);
	report.gpuExecuted = true;
	report.frame = await api.runInkProjectFrame({
		root,
		original,
		executable,
		threeToolchain,
	});
	assert(report.frame.ok);
	assert.equal(errors.length, 0);
	assert.equal(exceptions.length, 0);
	assert(
		processes.filter((x) => x.profile).length === 4 &&
			processes.every((x) => x.closed),
		"All four owned browser processes must close",
	);
	assert(
		sockets.every((x) => x.closed),
		"All owned CDP sockets must close",
	);
	report.ok = true;
} catch (error) {
	report.failure = {
		name: error.name,
		message: error.message.replace(/https?:\/\/[^\s"'<>]+/g, "[private URL]"),
	};
	process.exitCode = 1;
} finally {
	report.processes = processes;
	report.sockets = sockets;
	report.consoleErrors = errors;
	report.exceptions = exceptions;
	for (const item of processes)
		if (item.profile) {
			try {
				await access(item.profile);
				item.profileRemoved = false;
			} catch (error) {
				assert.equal(error.code, "ENOENT");
				item.profileRemoved = true;
			}
		}
	if (inputs) report.finalInputValidation = await inputs.verify(files);
	if (toolchainBefore) {
		assert.deepEqual(
			await pinInkHostToolchain(threeToolchain),
			toolchainBefore,
		);
		report.toolchainUnchanged = true;
	}
	if (report.packageBefore) {
		assert.deepEqual(
			await Promise.all(report.packageBefore.map((x) => pin(x.path))),
			report.packageBefore,
		);
		report.wasmPackageUnchanged = true;
	}
	if (report.originalReceipt)
		assert.deepEqual(
			await pin(report.originalReceipt.path),
			report.originalReceipt,
		);
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	childProcess.spawn = originalSpawn;
	syncBuiltinESMExports();
	globalThis.WebSocket = NativeWebSocket;
	console.log(JSON.stringify({ root, ok: report.ok, failure: report.failure }));
}
