import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { auditFiniteClaims } from "./fixtures/stylized-finite-acceptance.mjs";
import { collectFiniteEvidencePins } from "./fixtures/finite-evidence-pins.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const base = new URL("../docs/evidence/", import.meta.url);
const names = {
	bubble: "bubble-current-standalone-export.json",
	canvas: "canvas-current-author-export.json",
	lifecycle: "canvas-current-capture-lifecycle.json",
	material: "canvas-material-reference-gpu.json",
	flameTopology: "flame-wrap-topology.json",
	flameCurrent: "flame-current-admission-export.json",
	frost: "frost-finite-scope-current.json",
};
const sources = {}, manifests = {}, pins = new Map(), historical = [];
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
for (const [key, name] of Object.entries(names)) {
	const path = fileURLToPath(new URL(name, base)), bytes = await readFile(path);
	assert(bytes.length <= 2_000_000, "Evidence manifest exceeds size bound");
	const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	assert(!text.startsWith("\uFEFF") && !text.includes("\uFFFD"), "Evidence encoding mismatch");
	sources[key] = JSON.parse(text);
	manifests[name] = sha256(bytes);
	collectFiniteEvidencePins(sources[key], { manifest: name, workspaceRoot, retained: pins, historical });
}
const claims = auditFiniteClaims(sources);
for (const [path, expected] of pins) {
	const metadata = await stat(path);
	assert(metadata.isFile() && metadata.size <= 256 * 1024 * 1024, "Artifact type or size mismatch");
	assert.equal(sha256(await readFile(path)), expected, `Retained artifact changed: ${path}`);
}
const historicalSourcePins = [];
for (const item of historical) {
	const metadata = await stat(item.path);
	assert(metadata.isFile() && metadata.size <= 2_000_000, "Historical source type or size mismatch");
	const currentSha256 = sha256(await readFile(item.path));
	historicalSourcePins.push({ ...item, currentSha256, changedSinceExecution: currentSha256 !== item.executedSha256 });
}
process.stdout.write(`${JSON.stringify({
	ok: true,
	scope: "Read-only finite claim and direct retained artifact audit; no render, install or release",
	manifests, directArtifactPins: pins.size, claims,
	historicalSourcePins,
	sourceDrift: historicalSourcePins.filter((item) => item.changedSinceExecution),
	currentWorktreeOrNewProducerCertified: false,
}, null, 2)}\n`);
