import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bubbleScratch, bubbleHash, collectBubbleInputs } from "./probe-bubble-evidence.mjs";
import { bubbleSaveJson, compareBubblePackages } from "./probe-bubble-artifacts.mjs";
import { runBubbleSession } from "./probe-bubble-session.mjs";

const args = process.argv.slice(2);
assert([5, 6].includes(args.length), "Usage: node script/probe-bubble.mjs <C:/tmps snapshot> <C:/tmps default pkg> <C:/tmps diagnostic pkg> <C:/tmps artifacts parent> <absolute Chromium executable> [--mode=paired|default|diagnostic]");
const mode = args[5]?.replace(/^--mode=/, "") ?? "paired";
assert(["paired", "default", "diagnostic"].includes(mode) && (!args[5] || args[5].startsWith("--mode=")));
assert(args.slice(0, 5).every(isAbsolute));
const [root, defaultPackage, diagnosticPackage, parent] = await Promise.all(args.slice(0, 4).map(bubbleScratch));
const executablePath = await realpath(args[4]);
assert.notEqual(defaultPackage, diagnosticPackage, "Default and diagnostic packages must be distinct frozen packages");
for (const input of [root, defaultPackage, diagnosticPackage]) {
	const tail = relative(input, parent);
	assert(tail.startsWith("..") || isAbsolute(tail), "Artifacts must not be inside immutable inputs");
}
const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const artifacts = await mkdtemp(join(parent, "bubble-paired-"));
const report = { ok: false, kind: "bubble-private-wasm-raster", mode, artifacts, startedAt: new Date().toISOString(), sessions: [] };
try {
	// Verify the frozen case module and its source closure before Node imports it.
	const preflight = await collectBubbleInputs(root, mode === "diagnostic" ? diagnosticPackage : defaultPackage, runnerDirectory);
	const { bubbleCases } = await import(pathToFileURL(join(root, "script/fixtures/bubble-cases.mjs")).href);
	assert(Array.isArray(bubbleCases) && bubbleCases.length > 0 && bubbleCases.length <= 256);
	report.casePlanSha256 = bubbleHash(Buffer.from(JSON.stringify(bubbleCases)));
	report.snapshotManifestSha256 = preflight.manifest.sha256;
	const run = (diagnostic) => runBubbleSession({ root, packageDirectory: diagnostic ? diagnosticPackage : defaultPackage, parent: artifacts, executablePath, diagnostic, runnerDirectory, plan: bubbleCases });
	if (mode !== "diagnostic") report.sessions.push(await run(false));
	if (mode !== "default") report.sessions.push(await run(true));
	if (mode === "paired") report.packageComparison = compareBubblePackages(report.sessions[0], report.sessions[1]);
	report.nativeAcceptance = mode === "default" ? null : report.sessions.find((session) => session.diagnostic)?.checks?.nativeAcceptance === true;
	report.ok = report.sessions.every((session) => session.ok) && (mode !== "paired" || report.packageComparison.ok);
	report.scope = "Actual Bubble resolver and WASM effect raster only. Native gates use diagnostic same-call pre-presentation texture readback; ordinary package and diagnostic Canvas must match in paired mode. Fixture stack bypass is not timeline/Host/editor/codec validation. No pooling/performance acceptance.";
} catch (error) { report.failure = error.stack ?? String(error); }
finally {
	report.finishedAt = new Date().toISOString();
	await bubbleSaveJson(artifacts, "paired-evidence.json", report);
	console.log(JSON.stringify({ ok: report.ok, artifacts, mode, nativeAcceptance: report.nativeAcceptance ?? null, failure: report.failure ?? report.packageComparison?.failures }));
	if (!report.ok) process.exitCode = 1;
}
