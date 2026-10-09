import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	hash,
	inside,
	plain,
	readJson,
	startPrivateHost,
	treeManifest,
	writeJson,
} from "../particle-c4-export-support.mjs";

const [root, bun, toolchain, chromium, mode = "reopen"] = process.argv.slice(2);
assert.ok(["reopen", "abort"].includes(mode));
assert.ok(
	[root, bun, toolchain, chromium].every((value) => value && isAbsolute(value)),
);
assert.ok(inside("C:/tmps/rocut-stylized-f6XU4z", root));
await plain(root, true);
const prepared = await readJson(join(root, "evidence.json"));
assert.equal(prepared.status, "build-only-passed");
const before = await treeManifest(join(root, "project"));
const secrets = new Set();
const host = startPrivateHost({
	executable: bun,
	args: [join(root, "host.mjs"), root, toolchain, chromium],
	cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
	env: {
		...process.env,
		TEMP: join(root, "temp"),
		TMP: join(root, "temp"),
		TMPDIR: join(root, "temp"),
		ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
		ROCUT_HTML_BROWSER_PATH: "",
	},
	root,
});
let failure, lifecycle;
try {
	const ready = await host.ready();
	secrets.add(ready.token);
	secrets.add(ready.editorUrl);
	if (mode === "abort")
		await writeJson(join(root, "probe-abort.json"), {
			status: "failed",
			reason: "CPU-only test of explicit failed-probe cleanup",
		});
	else
		await writeJson(
			join(root, "expected-final-state.json"),
			await readJson(join(root, "initial-state.json")),
		);
} catch (error) {
	failure = error;
} finally {
	try {
		lifecycle = await host.stop();
	} catch (error) {
		failure = new AggregateError(
			[failure, error].filter(Boolean),
			"CPU Host smoke or close failed",
		);
	}
	for (const name of [
		"host-ready.private.json",
		"host-ready.pending-private.json",
		"host-reopened.private.json",
	]) {
		const path = join(root, name);
		try {
			await plain(path, false);
			const descriptor = await readJson(path);
			if (descriptor.token) secrets.add(descriptor.token);
			if (descriptor.editorUrl) secrets.add(descriptor.editorUrl);
			await unlink(path);
		} catch (error) {
			if (error.code !== "ENOENT")
				failure = new AggregateError([failure, error].filter(Boolean));
		}
	}
}
const redact = (value) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-capability]");
	return text.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]");
};
const children = await readJson(join(root, "host-children.json"));
assert.deepEqual(
	children.processes,
	[],
	"CPU smoke must never launch a browser, compiler or render child",
);
assert.ok(children.allObservedDirectChildrenClosed);
assert.deepEqual(await treeManifest(join(root, "project")), before);
if (mode === "abort")
	assert.equal(
		(await readJson(join(root, "host-aborted.json"))).probeStatus,
		"failed",
	);
else
	assert.deepEqual(
		await readJson(join(root, "initial-state.json")),
		await readJson(join(root, "host-reopened-state.json")),
	);
const manifest = await treeManifest(root),
	leaks = [];
for (const entry of manifest.files) {
	const bytes = await readFile(join(root, entry.path));
	if ([...secrets].some((secret) => bytes.includes(Buffer.from(secret))))
		leaks.push(entry.path);
}
assert.deepEqual(leaks, []);
const evidence = {
	status: failure ? "failed" : "passed",
	error: failure ? redact(failure) : undefined,
	lifecycle,
	children,
	projectUnchanged: true,
	mode,
	initialAndReopenedStateEqual: mode === "reopen",
	...(mode === "abort" ? { failedAcceptanceStatusPreserved: true } : {}),
	credentialAudit: {
		secretsObserved: secrets.size,
		filesScanned: manifest.files.length,
		leaks,
		readinessFilesRemoved: true,
	},
	scope:
		"CPU-only Host resource reads and close/reopen; no browser attachment, frame request, UI, GPU or export",
	hostBundleSha256: hash(await readFile(join(root, "host.mjs"))),
};
await writeJson(join(root, "particle-editor-host-smoke.json"), evidence);
if (failure) throw Error(redact(failure));
console.log(
	JSON.stringify({
		status: "passed",
		root,
		directChildren: children.processes.length,
		noGpu: true,
		noUi: true,
		evidenceSha256: hash(
			await readFile(join(root, "particle-editor-host-smoke.json")),
		),
	}),
);
