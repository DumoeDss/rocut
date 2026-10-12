import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const archiveRoot =
	process.argv[2] ?? "C:/tmps/rocut-three-pinned-features-1F6RU9";
const pkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg";
const root = await mkdtemp("C:/tmps/rocut-three-feature-browser-");
const executable = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const lease = "C:/tmps/elftia-owned-three-feature-gpu.lease";
const owner = JSON.stringify({
	pid: process.pid,
	nonce: randomBytes(16).toString("hex"),
	root,
});
await writeFile(lease, owner, { flag: "wx" });
const report: Record<string, any> = {
	root,
	archiveRoot,
	lease,
	leaseScope: "team task registration only, not a cross-session global lock",
	ok: false,
};
const processes: {
	pid?: number;
	executable: string;
	closed: boolean;
	code?: number | null;
}[] = [];
const consoleErrors: string[] = [],
	exceptions: unknown[] = [];
const nativeSpawn = childProcess.spawn,
	NativeWebSocket = globalThis.WebSocket;
childProcess.spawn = ((...args: Parameters<typeof nativeSpawn>) => {
	const child = nativeSpawn(...args);
	const record = {
		pid: child.pid,
		executable: basename(String(args[0])),
		closed: false,
	};
	processes.push(record);
	child.once("close", (code) => Object.assign(record, { closed: true, code }));
	return child;
}) as typeof nativeSpawn;
syncBuiltinESMExports();
globalThis.WebSocket = class extends NativeWebSocket {
	constructor(...args: ConstructorParameters<typeof NativeWebSocket>) {
		super(...args);
		this.addEventListener("message", (event) => {
			const value = JSON.parse(String(event.data));
			if (value.method === "Runtime.exceptionThrown")
				exceptions.push(value.params.exceptionDetails);
			if (
				value.method === "Runtime.consoleAPICalled" &&
				value.params.type === "error"
			)
				consoleErrors.push(
					value.params.args
						.map(
							(arg: { value?: unknown; description?: string }) =>
								arg.value ?? arg.description,
						)
						.join(" ")
						.slice(0, 1200),
				);
		});
	}
};
try {
	const temporary = join(root, "temp");
	await mkdir(temporary);
	for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = temporary;
	const built = await Bun.build({
		entrypoints: [
			join(workspace, "script/fixtures/three-feature-pinned-browser-worker.ts"),
		],
		outdir: root,
		naming: "browser.mjs",
		target: "node",
		plugins: [
			{
				name: "private-real-wasm",
				setup(builder) {
					builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({
						path: pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href,
						external: true,
					}));
				},
			},
		],
	});
	assert(built.success, built.logs.map(String).join("\n"));
	const child = nativeSpawn(
		"node",
		[
			join(workspace, "script/fixtures/three-feature-pinned-browser-node.mjs"),
			root,
			archiveRoot,
			executable,
		],
		{ windowsHide: true, stdio: "inherit" },
	);
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	Object.assign(
		report,
		JSON.parse(await readFile(join(root, "node-observation.json"), "utf8")),
	);
	assert.equal(code, 0);
	assert.equal(report.processes.length, 9);
	assert(
		report.processes.every((item: { closed: boolean }) => item.closed),
		"Owned browser did not exit",
	);
	assert.equal(report.consoleErrors.length, 0);
	assert.equal(report.exceptions.length, 0);
	report.ok = true;
} catch (error) {
	report.failure = String(error);
	process.exitCode = 1;
} finally {
	report.processes ??= processes;
	report.consoleErrors ??= consoleErrors;
	report.exceptions ??= exceptions;
	childProcess.spawn = nativeSpawn;
	syncBuiltinESMExports();
	globalThis.WebSocket = NativeWebSocket;
	if ((await readFile(lease, "utf8")) === owner) {
		await unlink(lease);
		report.leaseReleased = true;
	}
	await writeFile(
		join(root, "browser-receipt.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			root,
			ok: report.ok,
			failure: report.failure,
			processes: report.processes,
			leaseReleased: report.leaseReleased,
		}),
	);
}
