import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { hash, readJson, writeJson } from "../particle-c4-export-support.mjs";
import { poll, seek } from "./stylized-fusion-checks.mjs";
import { createSweepScrollHistory } from "./sweep-scroll-editor-history.mjs";
import { finalParticleReferences } from "./particle-editor-references.mjs";
import {
	assertParticleSnapshot,
	byId,
	opacitySnapshot,
	particleEditorContract as contract,
} from "./particle-editor-contract.mjs";

// Observe real HTTP requests only; never inject an editor store, mock renderer,
// test-only globals or authored source. Do not retain request bodies/tokens.
export function observeParticleFrames(page) {
	const pending = new Set(),
		completed = new Set(),
		requests = [];
	const isFrame = (request) =>
		new URL(request.url()).pathname.endsWith("/api/programmatic/frame");
	page.on("request", (request) => {
		if (isFrame(request)) pending.add(request);
	});
	page.on("requestfinished", (request) => {
		if (!isFrame(request)) return;
		pending.delete(request);
		const ticks = request.postDataJSON()?.timelineTime;
		// requestfinished alone does not imply HTTP success; response listener below does.
		requests.push({ ticks, transport: "finished" });
	});
	page.on("response", (response) => {
		if (!isFrame(response.request())) return;
		const ticks = response.request().postDataJSON()?.timelineTime;
		if (response.ok()) completed.add(ticks);
	});
	page.on("requestfailed", (request) => {
		if (!isFrame(request)) return;
		pending.delete(request);
		requests.push({
			ticks: request.postDataJSON()?.timelineTime,
			transport: "failed",
		});
	});
	return { pending, completed, requests };
}

export async function captureParticleEditorFrame(
	page,
	root,
	name,
	dimensions,
	frames,
	ticks,
	{ expected, different } = {},
) {
	const canvas = page
		.locator(
			`canvas[width="${dimensions.width}"][height="${dimensions.height}"]`,
		)
		.filter({ visible: true });
	let previous,
		stable = 0,
		pixels,
		bounds;
	await poll(async () => {
		if (frames.pending.size || !frames.completed.has(ticks)) {
			stable = 0;
			return false;
		}
		const count = await canvas.count();
		assert.ok(count <= 1, "At most one visible project-sized canvas");
		if (!count) {
			stable = 0;
			return false;
		}
		pixels = await canvas.screenshot();
		const current = hash(pixels);
		stable = current === previous ? stable + 1 : 0;
		previous = current;
		bounds = await canvas.boundingBox();
		return (
			stable >= 3 &&
			(!expected || current === expected) &&
			(!different || current !== different)
		);
	}, 120000);
	await writeFile(join(root, `${name}.png`), pixels, { flag: "wx" });
	return { name, ticks, sha256: previous, bytes: pixels.length, bounds };
}

export async function runParticleEditorChecks({
	page,
	root,
	request,
	frames,
	evidence,
}) {
	const initial = await readJson(join(root, "initial-state.json"));
	const disk = await readJson(join(root, "project/project.json"));
	const dimensions = disk.record.data.settings.canvasSize;
	assert.deepEqual(disk.record.data.settings.fps, {
		numerator: 30,
		denominator: 1,
	});
	const readState = async () => ({
		clips: byId(await request("clips")),
		tracks: byId(await request("tracks")),
		revision: (await request("context")).revision,
	});
	assertParticleSnapshot(await readState(), initial);
	assert.equal(initial.revision, contract.initialRevision);
	const authored = initial.clips.find((clip) => clip.id === contract.clipId)
		.editing.programmatic.build.inputProps;
	assert.deepEqual(authored.rotationSpeed, contract.phaseBasis.rotationSpeed);
	for (const [key, value] of Object.entries(contract.phaseBasis.motion))
		assert.equal(
			authored.motion[key],
			value,
			`Archived motion ${key} must match declared phase basis`,
		);
	const history = createSweepScrollHistory(request);
	const initialHistory = await history(
		"history.status",
		"particle-editor-initial",
	);
	assert.equal(initialHistory.scope, "attached-session");
	assert.equal(initialHistory.count, 0);
	assert.equal(initialHistory.canUndo, false);
	evidence.history = [{ phase: "initial", result: initialHistory }];
	evidence.canvas = dimensions;
	evidence.samples = [];
	const at = (frame) => seek(page, Math.floor(frame / 30), frame % 30);
	const shot = (name, frame, options) =>
		captureParticleEditorFrame(
			page,
			root,
			name,
			dimensions,
			frames,
			frame * 4000,
			options,
		);
	const baseline = new Map();
	for (const frame of contract.frames) {
		await at(frame);
		const sample = await shot(`baseline-${frame}`, frame);
		baseline.set(frame, sample);
		evidence.samples.push(sample);
	}
	assert.ok(
		new Set([...baseline.values()].map((item) => item.sha256)).size >= 3,
		"Particle preview must visibly animate, not remain a blank/stale canvas",
	);
	for (const [label, order] of [
		["reverse", contract.reverseFrames],
		["random", contract.randomFrames],
	]) {
		for (const frame of order) {
			await at(frame);
			const sample = await shot(`${label}-${frame}`, frame, {
				expected: baseline.get(frame).sha256,
			});
			assert.deepEqual(
				sample.bounds,
				baseline.get(frame).bounds,
				"Deterministic captures use fixed canvas bounds",
			);
			evidence.samples.push(sample);
		}
	}
	await at(60);
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${contract.clipId}"]`,
		)
		.click();
	await page
		.getByRole("button", { name: "Blending", exact: true })
		.last()
		.click();
	const opacity = page.getByRole("textbox", { name: "Opacity", exact: true });
	assert.equal(Number(await opacity.inputValue()), contract.initialOpacity);
	// Selection/panel layout can change the display size, so history gets its own reference.
	const before = await shot("ui-before", 60);
	await opacity.fill(String(contract.editedOpacity));
	await opacity.press("Tab");
	const edited = opacitySnapshot(
		initial,
		contract.clipId,
		contract.editedOpacity,
	);
	await poll(async () =>
		isDeepStrictEqual((await readState()).clips, edited.clips),
	);
	let state = await readState();
	assert.ok(state.revision > initial.revision);
	assertParticleSnapshot(state, edited, { revision: state.revision });
	const changed = await shot("ui-edited", 60, { different: before.sha256 });
	assert.deepEqual(changed.bounds, before.bounds);
	evidence.samples.push(before, changed);
	evidence.history.push({
		phase: "edited",
		revision: state.revision,
		result: await history("history.status", "particle-editor-edited"),
	});
	assert.equal(evidence.history.at(-1).result.count, 1);
	assert.equal(evidence.history.at(-1).result.canUndo, true);
	for (const [index, kind] of [
		"history.undo",
		"history.redo",
		"history.undo",
		"history.redo",
	].entries()) {
		const previousRevision = state.revision;
		const result = await history(kind, `particle-editor-${index}-${kind}`);
		const target = kind === "history.undo" ? initial : edited;
		await poll(async () =>
			isDeepStrictEqual((await readState()).clips, target.clips),
		);
		state = await readState();
		assert.ok(
			state.revision > previousRevision,
			"Each local history transition persists a newer revision",
		);
		assertParticleSnapshot(state, target, { revision: state.revision });
		const sample = await shot(`ui-history-${index}`, 60, {
			expected: kind === "history.undo" ? before.sha256 : changed.sha256,
		});
		assert.deepEqual(sample.bounds, before.bounds);
		evidence.samples.push(sample);
		evidence.history.push({ phase: kind, revision: state.revision, result });
	}
	const expected = await readState();
	assertParticleSnapshot(expected, edited, { revision: expected.revision });
	const persisted = await poll(async () => {
		const saved = await readJson(join(root, "project/project.json"));
		return isDeepStrictEqual(saved.record, (await request("record")).record)
			? saved
			: null;
	});
	assert.equal(persisted.wrapperVersion, 1);
	await writeJson(join(root, "expected-final-state.json"), expected);
	await writeFile(
		join(root, "ui-saved-project.json"),
		await readFile(join(root, "project/project.json")),
		{ flag: "wx" },
	);
	await page.reload({ waitUntil: "commit" });
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${contract.clipId}"]`,
		)
		.waitFor({ timeout: 60000 });
	await poll(async () => (await request("export")).surfaces === 1);
	assertParticleSnapshot(await readState(), expected);
	await at(60);
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${contract.clipId}"]`,
		)
		.click();
	await page
		.getByRole("button", { name: "Blending", exact: true })
		.last()
		.click();
	assert.equal(
		Number(
			await page
				.getByRole("textbox", { name: "Opacity", exact: true })
				.inputValue(),
		),
		contract.editedOpacity,
	);
	const reloaded = await shot("ui-reloaded", 60, { expected: changed.sha256 });
	assert.deepEqual(reloaded.bounds, changed.bounds);
	evidence.samples.push(reloaded);
	const reloadHistory = await history(
		"history.status",
		"particle-editor-reloaded",
	);
	assert.equal(reloadHistory.scope, "attached-session");
	assert.equal(
		reloadHistory.count,
		0,
		"A browser reload must not claim to restore local session history",
	);
	assert.equal(reloadHistory.canUndo, false);
	evidence.history.push({ phase: "reloaded", result: reloadHistory });
	evidence.previewReferences = await finalParticleReferences({
		page,
		root,
		dimensions,
		revision: expected.revision,
		at,
		shot,
	});
	assertParticleSnapshot(await readState(), expected);
	assert.deepEqual(
		(await request("record")).record,
		persisted.record,
		"Reference capture must preserve the complete saved record",
	);
	evidence.finalRevision = expected.revision;
	evidence.finalOpacity = contract.editedOpacity;
	evidence.uiSavedProjectSha256 = hash(
		await readFile(join(root, "ui-saved-project.json")),
	);
	evidence.checks = [
		"real timeline selection and Blending/Opacity edit",
		"complete clip/track preservation",
		"attached-session undo/redo twice",
		"five-frame reverse and random-order exact hashes",
		"saved record and browser reload full state",
		"reloaded opacity control and preview readback",
	];
}
