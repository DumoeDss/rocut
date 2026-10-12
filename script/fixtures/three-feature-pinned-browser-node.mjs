import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
const [root, archiveRoot, executable] = process.argv.slice(2);
const processes = [],
	consoleErrors = [],
	exceptions = [];
const nativeSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
	const child = nativeSpawn(...args);
	const record = {
		pid: child.pid,
		executable: basename(String(args[0])),
		closed: false,
	};
	processes.push(record);
	child.once("close", (code) => Object.assign(record, { closed: true, code }));
	return child;
};
syncBuiltinESMExports();
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends NativeWebSocket {
	constructor(...args) {
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
						.map((arg) => arg.value ?? arg.description)
						.join(" ")
						.slice(0, 1200),
				);
		});
	}
};
const report = { processes, consoleErrors, exceptions };
try {
	const { run } = await import(pathToFileURL(join(root, "browser.mjs")).href);
	report.capture = await run({
		root,
		archiveRoot,
		executable,
		observe: () => processes,
	});
} catch (error) {
	report.failure = String(error);
	process.exitCode = 1;
} finally {
	await writeFile(
		join(root, "node-observation.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
}
