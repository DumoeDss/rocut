import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	preencodeSha,
	savePreencodeJson,
	verifyPreencodePins,
} from "./flame-wrap-preencode-inputs.mjs";

const [root] = process.argv.slice(2);
assert.equal(process.argv.length, 3);
const prepared = JSON.parse(
	await readFile(join(root, "prepared.json"), "utf8"),
);
await verifyPreencodePins(prepared.pins);
await verifyPreencodePins(prepared.copies);
assert.equal(
	preencodeSha(await readFile(prepared.hostModule)),
	prepared.hostDerivation.derivedSha256,
);
const { startHost, TargetRegistry } = await import(
	pathToFileURL(prepared.hostModule).href
);
const report = {
	hostClosed: false,
	reopened: false,
	projectByteIdentical: false,
};
let host;
const command = new Promise((resolve) => {
	let input = "";
	process.stdin.on("data", (bytes) => {
		input += bytes.toString("utf8");
		if (input.includes("\n")) resolve(input.split(/\r?\n/)[0]);
	});
	process.stdin.once("end", () => resolve(input.trim() || "stop"));
});
const options = {
	projectRoot: prepared.projectPath,
	staticDir: prepared.editorDist,
	port: 0,
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
};
try {
	host = await startHost(options);
	console.log(JSON.stringify({ ready: true, editorUrl: host.editorUrl }));
	const action = await command;
	process.stdin.pause();
	assert(["stop", "verify"].includes(action));
	await host.close();
	host = undefined;
	if (action === "verify") {
		await verifyPreencodePins(prepared.copies);
		host = await startHost(options);
		await host.close();
		host = undefined;
		await verifyPreencodePins(prepared.copies);
		report.reopened = true;
		report.projectByteIdentical = true;
	}
} catch (error) {
	report.error = String(error.message);
	process.exitCode = 1;
} finally {
	try {
		if (host) await host.close();
		report.hostClosed = true;
		await verifyPreencodePins(prepared.pins);
	} catch (error) {
		report.cleanupError = String(error.message);
		process.exitCode = 1;
	}
	await savePreencodeJson(root, "host-lifecycle.json", report);
}
