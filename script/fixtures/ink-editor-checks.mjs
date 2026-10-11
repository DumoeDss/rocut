import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { poll, seek } from "./stylized-fusion-checks.mjs";
import { createSweepScrollHistory } from "./sweep-scroll-editor-history.mjs";

async function inkCapture(
	page,
	artifacts,
	name,
	expectedSha256,
	rejectedSha256,
) {
	const canvas = page
		.locator('canvas[width="192"][height="128"]')
		.filter({ visible: true });
	let previous,
		stable = 0,
		pixels;
	await poll(
		async () => {
			const count = await canvas.count();
			assert(count <= 1, "At most one visible native preview canvas");
			if (count === 0) {
				previous = undefined;
				stable = 0;
				return false;
			}
			pixels = await canvas.screenshot();
			const hash = createHash("sha256").update(pixels).digest("hex");
			stable = hash === previous ? stable + 1 : 0;
			previous = hash;
			return (
			stable >= 3 &&
			(rejectedSha256 === undefined || hash !== rejectedSha256) &&
			(expectedSha256 === undefined || hash === expectedSha256)
			);
		},
		120000,
	);
	await writeFile(join(artifacts, `${name}.png`), pixels, { flag: "wx" });
	return { name, sha256: previous, bytes: pixels.length };
}

export async function runInkEditor(page, artifacts, evidence, request) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.ok && prepared.hostReopened);
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const clips = async () => byId(await request("clips"));
	const clip = async () =>
		(await clips()).find((item) => item.id === "ink-object");
	const at = async (ticks) => {
		const totalSeconds = ticks / 1000000;
		const seconds = Math.floor(totalSeconds);
		const frame = Math.round((totalSeconds - seconds) * 24);
		await seek(page, seconds, frame);
	};
	const history = createSweepScrollHistory(request);
	assert.deepEqual(await clips(), prepared.clips);
	assert.deepEqual(byId(await request("tracks")), prepared.tracks);
	const initialHistory = await history("history.status", "ink-initial-history");
	assert.equal(initialHistory.scope, "attached-session");
	assert.equal(initialHistory.count, 0);
	evidence.authoring = {
		source: "Host-authored archived Three ink source rendered by actual editor",
		parameterEdits:
			"actual Input props JSON edit with recompile-apply, attached-session undo and redo",
	};
	const original = await clip();
	assert.equal(original.editing.programmatic.build.engine, "three");
	const inputProps = original.editing.programmatic.build.inputProps;
	assert.equal(inputProps.ink.inkDensity, 0.85);
	evidence.uiHistory = [];
	await at(100000);
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="ink-object"]')
		.click();
	await page
		.getByRole("button", { name: "Graphic", exact: true })
		.last()
		.click();
	const propsBox = page.getByRole("textbox", { name: "Input props (JSON)" });
	await propsBox.waitFor({ timeout: 60000 });
	const before = await inkCapture(page, artifacts, "ink-before-density");
	const edited = structuredClone(JSON.parse(JSON.stringify(inputProps)));
	edited.ink.inkDensity = 0.45;
	await propsBox.fill(JSON.stringify(edited, null, 2));
	await page
		.getByRole("button", { name: "Recompile and apply", exact: true })
		.click();
	await poll(
		async () => {
			const current = await clip();
			return (
				current.editing.programmatic.build.inputProps.ink.inkDensity === 0.45
			);
		},
		180000,
	);
	// Force a fresh frame request: leave the sample position and return, so the
	// preview pipeline cannot reuse the pre-revision cached frame.
	await at(0);
	await at(100000);
	const editedShot = await inkCapture(
		page,
		artifacts,
		"ink-edited-density",
		undefined,
		before.sha256,
	);
	assert.notEqual(editedShot.sha256, before.sha256);
	const status = await history("history.status", "ink-status-density");
	assert.equal(status.scope, "attached-session");
	assert.equal(status.canUndo, true);
	await history("history.undo", "ink-undo-density");
	await poll(
		async () => {
			const current = await clip();
			return isDeepStrictEqual(
				current.editing.programmatic.build.inputProps,
				inputProps,
			);
		},
		180000,
	);
	await at(100000);
	await inkCapture(page, artifacts, "ink-undone-density", before.sha256);
	await history("history.redo", "ink-redo-density");
	await poll(
		async () => {
			const current = await clip();
			return (
				current.editing.programmatic.build.inputProps.ink.inkDensity === 0.45
			);
		},
		180000,
	);
	await at(100000);
	await inkCapture(page, artifacts, "ink-redone-density", editedShot.sha256);
	evidence.uiHistory.push({
		key: "inkDensity",
		before,
		edited: editedShot,
		status,
		completeClipRestored: true,
	});
	console.log(
		JSON.stringify({ phase: "ink-ui-history-verified", key: "inkDensity" }),
	);
	const expected = {
		clips: await clips(),
		tracks: byId(await request("tracks")),
		revision: (await request("context")).revision,
		authoredTrackIds: (await request("tracks"))
			.filter((track) => track.id === "ink-shots")
			.map((track) => track.id),
	};
	await poll(async () => {
		const disk = JSON.parse(
			await readFile(join(artifacts, "project/project.json"), "utf8"),
		);
		return isDeepStrictEqual(disk.record, (await request("record")).record);
	});
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	await at(100000);
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="ink-object"]')
		.click();
	await page
		.getByRole("button", { name: "Graphic", exact: true })
		.last()
		.click();
	await propsBox.waitFor({ timeout: 60000 });
	await inkCapture(page, artifacts, "ink-reloaded-edited", editedShot.sha256);
	assert.deepEqual(await clips(), expected.clips);
	assert.deepEqual(byId(await request("tracks")), expected.tracks);
	assert.equal((await request("context")).revision, expected.revision);
	await writeFile(
		join(artifacts, "expected-edited.json"),
		JSON.stringify(expected, null, 2),
		{ flag: "wx" },
	);
	evidence.checks.push({
		name: "real Ink archived-source Input props UI edit with recompile-apply, undo/redo, disk save and editor reload",
		pass: true,
	});
}
