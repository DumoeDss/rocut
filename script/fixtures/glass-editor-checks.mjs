import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { poll, seek } from "./stylized-fusion-checks.mjs";
import { createSweepScrollHistory } from "./sweep-scroll-editor-history.mjs";

async function glassCapture(
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

export async function runGlassEditor(page, artifacts, evidence, request) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.ok && prepared.hostReopened);
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const clips = async () => byId(await request("clips"));
	const clip = async () =>
		(await clips()).find((item) => item.id === "glass-object");
	const at = async (ticks) => {
		const totalSeconds = ticks / 1000000;
		const seconds = Math.floor(totalSeconds);
		const frame = Math.round((totalSeconds - seconds) * 24);
		await seek(page, seconds, frame);
	};
	const history = createSweepScrollHistory(request);
	assert.deepEqual(await clips(), prepared.clips);
	assert.deepEqual(byId(await request("tracks")), prepared.tracks);
	const initialHistory = await history("history.status", "glass-initial-history");
	assert.equal(initialHistory.scope, "attached-session");
	assert.equal(initialHistory.count, 0);
	evidence.authoring = {
		source: "Host-authored archived Three glass source rendered by actual editor",
		parameterEdits:
			"actual Input props JSON edit with recompile-apply, attached-session undo and redo",
	};
	const original = await clip();
	assert.equal(original.editing.programmatic.build.engine, "three");
	const inputProps = original.editing.programmatic.build.inputProps;
	assert.equal(inputProps.glass.transmission, 0.9);
	evidence.uiHistory = [];
	await at(100000);
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="glass-object"]')
		.click();
	await page
		.getByRole("button", { name: "Graphic", exact: true })
		.last()
		.click();
	const propsBox = page.getByRole("textbox", { name: "Input props (JSON)" });
	await propsBox.waitFor({ timeout: 60000 });
	const before = await glassCapture(page, artifacts, "glass-before-transmission");
	const edited = structuredClone(JSON.parse(JSON.stringify(inputProps)));
	edited.glass.transmission = 0.35;
	await propsBox.fill(JSON.stringify(edited, null, 2));
	await page
		.getByRole("button", { name: "Recompile and apply", exact: true })
		.click();
	await poll(
		async () => {
			const current = await clip();
			return (
				current.editing.programmatic.build.inputProps.glass.transmission === 0.35
			);
		},
		180000,
	);
	await at(0);
	await at(100000);
	const editedShot = await glassCapture(
		page,
		artifacts,
		"glass-edited-transmission",
		undefined,
		before.sha256,
	);
	assert.notEqual(editedShot.sha256, before.sha256);
	const status = await history("history.status", "glass-status-transmission");
	assert.equal(status.scope, "attached-session");
	assert.equal(status.canUndo, true);
	await history("history.undo", "glass-undo-transmission");
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
	await glassCapture(page, artifacts, "glass-undone-transmission", before.sha256);
	await history("history.redo", "glass-redo-transmission");
	await poll(
		async () => {
			const current = await clip();
			return (
				current.editing.programmatic.build.inputProps.glass.transmission === 0.35
			);
		},
		180000,
	);
	await at(100000);
	await glassCapture(page, artifacts, "glass-redone-transmission", editedShot.sha256);
	evidence.uiHistory.push({
		key: "transmission",
		before,
		edited: editedShot,
		status,
		completeClipRestored: true,
	});
	console.log(
		JSON.stringify({ phase: "glass-ui-history-verified", key: "transmission" }),
	);
	const expected = {
		clips: await clips(),
		tracks: byId(await request("tracks")),
		revision: (await request("context")).revision,
		authoredTrackIds: (await request("tracks"))
			.filter((track) => track.id === "glass-shots")
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
		.locator('[data-testid="timeline-clip"][data-element-id="glass-object"]')
		.click();
	await page
		.getByRole("button", { name: "Graphic", exact: true })
		.last()
		.click();
	await propsBox.waitFor({ timeout: 60000 });
	await glassCapture(page, artifacts, "glass-reloaded-edited", editedShot.sha256);
	assert.deepEqual(await clips(), expected.clips);
	assert.deepEqual(byId(await request("tracks")), expected.tracks);
	assert.equal((await request("context")).revision, expected.revision);
	await writeFile(
		join(artifacts, "expected-edited.json"),
		JSON.stringify(expected, null, 2),
		{ flag: "wx" },
	);
	evidence.checks.push({
		name: "real Glass archived-source Input props UI edit with recompile-apply, undo/redo, disk save and editor reload",
		pass: true,
	});
}
