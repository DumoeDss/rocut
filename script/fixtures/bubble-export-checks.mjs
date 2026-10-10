import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import { bubbleExportContract as contract, bubbleExportJobs } from "./bubble-export-contract.mjs";
import { bubbleExportHash as hash, bubbleExportSave as save, bubbleExportScratch, saveBubbleExportReferences } from "./bubble-export-preflight.mjs";
import { canonicalBlazeEditorSource } from "./blaze-editor-export-canonical.mjs";
import { blazeEditorSnapshot } from "./blaze-editor-control.mjs";
import { blazeEditorProjectFiles, assertOnlyBlazeExportsAdded } from "./blaze-editor-export-persistence.mjs";
import { runBlazeEditorExportJob } from "./blaze-editor-export-jobs.mjs";
import { decodeBubbleExport } from "./bubble-export-decode.mjs";
import { bubbleExportClips } from "./bubble-export-reference.mjs";
import { decodeBlazeEditorSourcePng } from "./blaze-editor-export-source.mjs";

export function assertBubbleBootstrapSemantics(seed, current, seedSnapshot, currentSnapshot) {
	assert.deepEqual(currentSnapshot, seedSnapshot, "Bootstrap changed clips/tracks/revision");
	const metadata = current.record.data.metadata, seedMetadata = seed.record.data.metadata;
	assert.equal(metadata.updatedAt, current.summary.updatedAt, "Bootstrap timestamps disagree");
	assert(Number.isFinite(Date.parse(metadata.updatedAt)) && Date.parse(metadata.updatedAt) >= Date.parse(seedMetadata.updatedAt), "Invalid bootstrap updatedAt");
	if (metadata.thumbnail !== undefined) {
		assert(typeof metadata.thumbnail === "string" && metadata.thumbnail.startsWith("data:image/png;base64,"), "Unexpected bootstrap thumbnail encoding");
		const image = decodeBlazeEditorSourcePng(Buffer.from(metadata.thumbnail.slice(22), "base64"));
		assert.equal(image.width, contract.width); assert.equal(image.height, contract.height);
	}
	const view = current.record.data.timelineViewState;
	if (view !== undefined) {
		assert.deepEqual(Object.keys(view).sort(), ["playheadTime", "scrollLeft", "zoomLevel"]);
		assert(Number.isFinite(view.zoomLevel) && view.zoomLevel > 0);
		assert.equal(view.scrollLeft, 0); assert.equal(view.playheadTime, 0);
	}
	const content = (document) => {
		const copy = structuredClone(document);
		delete copy.record.data.metadata.updatedAt; delete copy.record.data.metadata.thumbnail;
		delete copy.record.data.timelineViewState; delete copy.summary.updatedAt;
		return copy;
	};
	assert.deepEqual(content(current), content(seed), "Bootstrap changed project content beyond its four explicit presentation fields");
}
export async function waitForBubbleBootstrap({ sample, validate, quietMs = 5000, timeoutMs = 60000,
	pollMs = 250, now = Date.now, pause = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
	const started = now(); let stableSince = started, previous = null, observations = 0;
	while (now() - started <= timeoutMs) {
		const candidate = await sample(); observations++; validate(candidate);
		const key = candidate.coherent ? JSON.stringify({ bytes: hash(candidate.bytes), record: candidate.record,
			snapshot: candidate.snapshot, context: candidate.context, files: candidate.files }) : null;
		if (key === null || key !== previous) stableSince = now();
		previous = key;
		if (key !== null && now() - stableSince >= quietMs) return { ...candidate, settle: { observations, quietMs, elapsedMs: now() - started } };
		await pause(pollMs);
	}
	throw Error("Production bootstrap persistence did not stabilize before export");
}
export function assertBubbleExportBaseline(observed, baseline, stage) {
	assert.deepEqual(observed.bytes, baseline.bytes, `${stage}: persisted project changed`);
	assert.deepEqual(observed.record, baseline.record, stage);
	assert.deepEqual(observed.snapshot, baseline.snapshot, stage);
	assert.deepEqual(observed.context, baseline.context, stage);
}

// Requires a fresh owned Host project containing bubbleExportClips, a live attached
// production export surface, and prepared.json {resource}. This function does not
// start a Host, build WASM, launch a browser, or amend a previously accepted project.
export async function runBubbleExportChecks({ root, page, request, editorUrl, ffmpegDirectory, creator, evidence = {} }) {
	await bubbleExportScratch(root);
	const projectRoot = join(root, "project"), projectPath = join(projectRoot, "project.json");
	const prepared = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(root, "prepared.json"))));
	const seedBytes = await readFile(join(root, "project-before-export.json"));
	const seed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(seedBytes));
	const stable = await waitForBubbleBootstrap({ sample: async () => {
		const bytes = await readFile(projectPath), document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		const record = await request("record"), snapshot = await blazeEditorSnapshot(request), context = await request("context");
		const files = await blazeEditorProjectFiles(projectRoot), after = await readFile(projectPath);
		return { bytes, document, record, snapshot, context, files, coherent: bytes.equals(after) &&
			JSON.stringify(record) === JSON.stringify({ record: document.record, summary: document.summary }) &&
			files.find((file) => file.path === "project.json")?.sha256 === hash(bytes) };
	}, validate: (candidate) => {
		assertBubbleBootstrapSemantics(seed, candidate.document, prepared.snapshot, candidate.snapshot);
		assert.deepEqual(candidate.record, { record: candidate.document.record, summary: candidate.document.summary }, "Bootstrap HTTP record differs from persisted record/summary");
		assert.deepEqual(candidate.context, prepared.context, "Bootstrap changed complete Host context");
		assert.deepEqual(candidate.files.filter((file) => file.path !== "project.json"), prepared.files.filter((file) => file.path !== "project.json"), "Bootstrap changed resources/project file inventory");
	} });
	const { bytes, record, document, snapshot, context } = stable;
	const settings = document.record.data.settings;
	assert.deepEqual(settings.fps, contract.frameRate);
	assert.deepEqual(settings.canvasSize, { width: contract.width, height: contract.height });
	assert.deepEqual(settings.background, { type: "color", color: "#000000" });
	const authored = bubbleExportClips(creator, prepared.resource);
	assert.equal(snapshot.clips.length, authored.length, "Fresh export project must contain exactly the three frozen clips");
	for (const expected of authored) {
		const actual = snapshot.clips.find((clip) => clip.id === expected.id); assert(actual);
		for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${expected.id}.${key}`);
	}
	const baselineFiles = stable.files;
	const baselineProject = await save(root, "project-export-baseline.json", bytes);
	evidence.exportBaseline = { projectSha256: hash(bytes), project: baselineProject, record, snapshot, context, files: baselineFiles, settle: stable.settle };
	const baselineObservation = await save(root, "export-baseline-observation.json", evidence.exportBaseline);
	evidence.exportBaselineObservation = baselineObservation;
	const verify = async (stage) => {
		assert.equal(hash(await readFile(join(root, baselineProject.filename))), baselineProject.sha256, "Frozen baseline bytes were modified");
		assert.equal(hash(await readFile(join(root, baselineObservation.filename))), baselineObservation.sha256, "Frozen baseline observation was modified");
		const observed = { bytes: await readFile(projectPath), record: await request("record"),
			snapshot: await blazeEditorSnapshot(request), context: await request("context") };
		assertBubbleExportBaseline(observed, { bytes, record, snapshot, context }, stage);
		const files = await blazeEditorProjectFiles(projectRoot);
		return { stage, record: observed.record, snapshot: observed.snapshot, context: observed.context,
			files, added: assertOnlyBlazeExportsAdded(baselineFiles, files) };
	};
	evidence.canonicalSource = await canonicalBlazeEditorSource({ root, page, editorUrl });
	const canonical = await readFile(join(root, "export-source-canonical.rgba"));
	assert.equal(hash(canonical), evidence.canonicalSource.canonicalSha256);
	evidence.independentExpected = await saveBubbleExportReferences(root, canonical, "canonical", true);
	assert(evidence.independentExpected.ok, "Canonical-source negative controls failed before export");
	await save(root, "export-independent-expected.json", evidence.independentExpected);
	evidence.exportReadOnly = [await verify("after-independent-source-decode")];
	const protocol = await request("export");
	assert.equal(protocol.surfaces, 1); assert.equal(protocol.protocol.version, 2);
	assert(protocol.protocol.videoChroma.includes("444"));
	evidence.exportJobs = []; let previousFiles = baselineFiles;
	for (const job of bubbleExportJobs) {
		evidence.exportReadOnly.push(await verify(`before-${job.jobKey}`));
		const finished = await runBlazeEditorExportJob({ root, request, editorUrl, spec: job });
		const persisted = await verify(`after-${job.jobKey}`);
		const added = assertOnlyBlazeExportsAdded(previousFiles, persisted.files);
		assert.equal(added.length, 1);
		const outputPath = await realpath(finished.outputPath), exportRoot = await realpath(join(projectRoot, "exports"));
		assert.equal(win32.resolve(outputPath).toLowerCase(), win32.resolve(finished.outputPath).toLowerCase());
		assert.equal(win32.relative(exportRoot, outputPath), `${finished.id}.webm`);
		assert.equal(added[0].path, `exports/${finished.id}.webm`);
		const media = await save(root, `${job.jobKey}-production.webm`, await readFile(outputPath));
		assert(media.bytes > 0);
		const reference = evidence.independentExpected.records.find((item) => item.segment === job.id);
		const decoded = await decodeBubbleExport({ root, ffmpegDirectory, job, media, reference });
		evidence.exportJobs.push({ job, finished, media, decoded });
		evidence.exportReadOnly.push(persisted); previousFiles = persisted.files;
		assert(decoded.ok, `Independent decode failed for ${job.jobKey}: ${decoded.failure}`);
	}
	assert.equal(new Set(evidence.exportJobs.map((item) => item.finished.id)).size, 6);
	evidence.videoExportTested = true; evidence.ok = true;
	await save(root, "bubble-export-evidence.json", evidence);
	return evidence;
}
