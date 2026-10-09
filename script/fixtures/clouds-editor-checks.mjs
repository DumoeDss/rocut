import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	capture as captureCanvas,
	poll,
	seek,
} from "./stylized-fusion-checks.mjs";
import { createSweepScrollHistory } from "./sweep-scroll-editor-history.mjs";
import { selectIntegerPreview } from "./clouds-editor-lifecycle.mjs";
import { waitForCloudsPersistence } from "./clouds-editor-persistence.mjs";

export async function runCloudsEditor(page, artifacts, evidence, request) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.ok && prepared.hostReopened);
	await page.getByLabel("Preview zoom", { exact: true }).click();
	await page.getByRole("option", { name: "100%", exact: true }).click();
	const canvas = page
		.locator('canvas[width="640"][height="360"]')
		.filter({ visible: true });
	evidence.previewGeometry = await selectIntegerPreview(page, canvas);
	const capture = async (...args) => {
		const result = await captureCanvas(...args);
		assert.deepEqual(
			result.bounds,
			evidence.previewGeometry.bounds,
			"Complete integer reference canvas moved or resized",
		);
		return result;
	};
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const clips = async () => byId(await request("clips"));
	const clip = async (id = "clouds-0") =>
		(await clips()).find((item) => item.id === id);
	const at = (ticks) =>
		seek(page, Math.floor(ticks / 120000), (ticks % 120000) / 4000);
	const history = createSweepScrollHistory(request);
	evidence.selectionOverlays = [];
	const stableHandles = async (phase) => {
		const overlay = page
			.getByRole("application", { name: "Preview canvas", exact: true })
			.locator("..");
		let previous,
			stable = 0,
			rectangles;
		await poll(async () => {
			rectangles = await overlay.locator("button").evaluateAll((buttons) =>
				buttons
					.filter((button) => getComputedStyle(button).visibility !== "hidden")
					.map((button) => {
						const { x, y, width, height } = button.getBoundingClientRect();
						return { x, y, width, height };
					})
					.filter((rect) => rect.width > 0 && rect.height > 0),
			);
			const current = JSON.stringify(rectangles);
			stable = current === previous ? stable + 1 : 0;
			previous = current;
			return rectangles.length === 8 && stable >= 2;
		});
		evidence.selectionOverlays.push({ phase, handles: rectangles });
	};
	assert.deepEqual(await clips(), prepared.clips);
	assert.deepEqual(byId(await request("tracks")), prepared.tracks);
	const projectSettings = structuredClone(
		(await request("record")).record.data.settings,
	);
	const initialHistory = await history(
		"history.status",
		"clouds-initial-history",
	);
	assert.equal(initialHistory.scope, "attached-session");
	assert.equal(initialHistory.count, 0);
	evidence.authoring = {
		keyframes: "Host-authored nine optical channels rendered by actual editor",
		keyframeCreationUi: false,
		parameterEdits:
			"actual Effects textbox with attached-session undo and redo",
	};
	evidence.keyframeSamples = [];
	const animated = await clip("clouds-1");
	assert.equal(Object.keys(animated.editing.animations).length, 9);
	for (const local of prepared.sampleLocalTicks) {
		await at(120000 + local);
		const sample = await capture(page, artifacts, `clouds-keyframes-${local}`);
		evidence.keyframeSamples.push({
			local,
			timelineTicks: 120000 + local,
			...sample,
		});
	}
	assert.equal(
		new Set(evidence.keyframeSamples.map((sample) => sample.sha256)).size,
		3,
	);
	for (const [index, sample] of evidence.keyframeSamples.entries()) {
		await at((index + 2) * 120000 + sample.local);
		await capture(
			page,
			artifacts,
			`clouds-static-reference-${sample.local}`,
			sample.sha256,
		);
	}
	for (const sample of [...evidence.keyframeSamples].reverse()) {
		await at(sample.timelineTicks);
		await capture(
			page,
			artifacts,
			`clouds-reverse-${sample.local}`,
			sample.sha256,
		);
	}
	evidence.uiHistory = [];
	for (const { key, label, value } of prepared.changes) {
		const original = await clip();
		const untouched = (await clips()).filter((item) => item.id !== original.id);
		await at(24000);
		await page
			.locator('[data-testid="timeline-clip"][data-element-id="clouds-0"]')
			.click();
		await page
			.getByRole("button", { name: "Effects", exact: true })
			.last()
			.click();
		await stableHandles(`before-${key}`);
		const before = await capture(page, artifacts, `clouds-before-${key}`);
		const input = page
			.getByRole("textbox", { name: label, exact: true })
			.first();
		await input.fill(String(value));
		await input.press("Enter");
		await poll(
			async () => (await page.locator("[data-focus-locked]").count()) === 0,
		);
		const expected = structuredClone(original);
		expected.editing.effects[0].params[key] = value;
		await poll(async () => isDeepStrictEqual(await clip(), expected));
		await at(24000);
		await stableHandles(`edited-${key}`);
		const edited = await capture(page, artifacts, `clouds-edited-${key}`);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${key} UI input must change visible pixels`,
		);
		const status = await history("history.status", `clouds-status-${key}`);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.canUndo, true);
		await history("history.undo", `clouds-undo-${key}`);
		await poll(async () => isDeepStrictEqual(await clip(), original));
		await stableHandles(`undone-${key}`);
		await capture(page, artifacts, `clouds-undone-${key}`, before.sha256);
		await history("history.redo", `clouds-redo-${key}`);
		await poll(async () => isDeepStrictEqual(await clip(), expected));
		await stableHandles(`redone-${key}`);
		await capture(page, artifacts, `clouds-redone-${key}`, edited.sha256);
		assert.deepEqual(
			(await clips()).filter((item) => item.id !== original.id),
			untouched,
		);
		assert.deepEqual(byId(await request("tracks")), prepared.tracks);
		assert.deepEqual(
			(await request("record")).record.data.settings,
			projectSettings,
		);
		evidence.uiHistory.push({
			key,
			value,
			before,
			edited,
			status,
			completeClipRestored: true,
		});
		console.log(JSON.stringify({ phase: "clouds-ui-history-verified", key }));
	}
	assert.deepEqual(await clip("clouds-1"), animated);
	const expected = {
		clips: await clips(),
		tracks: byId(await request("tracks")),
		revision: (await request("context")).revision,
		authoredTrackIds: (await request("tracks"))
			.filter((track) => prepared.authoredTrackIds.includes(track.id))
			.map((track) => track.id),
	};
	await waitForCloudsPersistence(artifacts, request);
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	await page.getByLabel("Preview zoom", { exact: true }).click();
	await page.getByRole("option", { name: "100%", exact: true }).click();
	for (const sample of evidence.keyframeSamples) {
		await at(sample.timelineTicks);
		await capture(
			page,
			artifacts,
			`clouds-reloaded-${sample.local}`,
			sample.sha256,
		);
	}
	await at(24000);
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="clouds-0"]')
		.click();
	await page
		.getByRole("button", { name: "Effects", exact: true })
		.last()
		.click();
	await stableHandles("reloaded");
	await capture(
		page,
		artifacts,
		"clouds-reloaded-edited",
		evidence.uiHistory.at(-1).edited.sha256,
	);
	assert.deepEqual(await clips(), expected.clips);
	assert.deepEqual(byId(await request("tracks")), expected.tracks);
	assert.deepEqual(
		(await request("record")).record.data.settings,
		projectSettings,
	);
	assert.equal((await request("context")).revision, expected.revision);
	await waitForCloudsPersistence(artifacts, request);
	evidence.uiPersistenceQuietMs = 1600;
	await writeFile(
		join(artifacts, "expected-edited.json"),
		JSON.stringify(expected, null, 2),
		{ flag: "wx" },
	);
	evidence.checks.push({
		name: "nine optical channels, reverse seeks, twelve real Clouds parameter UI edits with undo/redo, disk save and editor reload",
		pass: true,
	});
}
