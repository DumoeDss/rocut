import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";

export async function probeJizuraImport(parent, frame, evidence) {
	const source = JSON.parse(readFileSync(new URL("../rust/crates/motion-text/fixtures/jizura-v1-project.json", import.meta.url), "utf8"));
	const expected = JSON.parse(readFileSync(new URL("../rust/crates/motion-text/fixtures/jizura-v1-expected.json", import.meta.url), "utf8"));
	const readState = () => frame.evaluate(async () => {
		const { record } = await (await fetch(new URL("api/record", location.href))).json();
		return {
			sequences: record.data.motionTextSequences,
			clips: record.data.scenes.flatMap(scene => [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio].flatMap(track => track.elements)).filter(clip => clip.type === "motion-text"),
		};
	});
	await frame.locator('[aria-label="Media"]').locator("..").locator('[aria-label="Motion text"]').click();
	const importButton = frame.getByRole("button", { name: "Import", exact: true });
	const importCard = importButton.locator("..").locator("..");
	const initial = await readState();
	const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
	const upload = async buffer => {
		const chooserPromise = parent.waitForEvent("filechooser");
		await importButton.click();
		const chooser = await chooserPromise;
		await chooser.setFiles({ name: "regression.jizura.json", mimeType: "application/json", buffer: Buffer.from(buffer) });
	};
	for (const invalid of ["{not-json", JSON.stringify({ version: 99, lyrics: "unsupported" })]) {
		await upload(invalid);
		await expect(importCard.getByRole("alert")).toBeVisible();
		assert.deepEqual(await readState(), initial, "Rejected import must leave sequences and timeline unchanged");
	}
	// This source snapshot models an actual JIZURA line lock, not just a flag.
	source.overrides["0"].lock = true;
	source.overrides["0"].lockedCuts = [{ utext: "风从城里来", layout: "huge", enter: "pop", hold: "pulse", exit: "shrink", seed: 12345 }];
	const sourceText = JSON.stringify(source);
	await upload(sourceText);
	await expect(importCard.getByRole("status")).toContainText("Imported 2 lyric lines");
	await expect.poll(async () => (await readState()).sequences.length).toBe(initial.sequences.length + 1);
	const imported = await readState();
	const sequence = imported.sequences.find(entry => !initial.sequences.some(before => before.id === entry.id));
	assert(sequence, "Import must create a new sequence");
	assert.equal(sequence.language, expected.language);
	assert.equal(sequence.duration, expected.duration);
	assert.equal(sequence.defaults.preset.style, expected.defaultStyle);
	assert.equal(sequence.defaults.fontId, expected.defaultFontId);
	assert.equal(sequence.defaults.colors.foreground ?? sequence.defaults.colors.fg, source.colors.fg);
	assert.equal(sequence.defaults.colors.accent, source.colors.accent);
	assert.deepEqual(sequence.cues.map(cue => cue.text), source.lyrics.split("\n"));
	assert.deepEqual(sequence.cues.map(cue => cue.startTime), expected.cueStarts);
	assert.deepEqual(sequence.cues.map(cue => cue.duration), expected.cueDurations);
	assert.deepEqual(sequence.cues.map(cue => cue.timingSource), expected.timingSources);
	assert(sequence.cues[0].locks.some(lock => lock.scope === "cue" && lock.key === "all"));
	const locked = sequence.resolvedPlan.cuts.find(cut => cut.cueId === sequence.cues[0].id);
	assert.equal(locked.seed, 12345);
	for (const [group, preset] of Object.entries(expected.line0Preset)) assert.equal(locked.preset[group], preset);
	const secondCut = sequence.resolvedPlan.cuts.find(cut => cut.cueId === sequence.cues[1].id);
	for (const [group, preset] of Object.entries(expected.line1FirstCutPreset)) assert.equal(secondCut.preset[group], preset);
	assert.equal(sequence.source.text, sourceText, "Original source must survive for provenance");
	const clip = imported.clips.find(entry => entry.sequenceId === sequence.id);
	assert(clip && clip.name === `${expected.title} · JIZURA` && clip.duration === expected.duration);
	assert.deepEqual(imported.sequences.filter(entry => entry.id !== sequence.id), initial.sequences);
	evidence.checks.push({ name: "JIZURA import preserves lyrics/timing/colors/fonts/locked snapshots/per-cut overrides/provenance", pass: true });
	evidence.checks.push({ name: "JIZURA import focus", ...await frame.evaluate(() => ({ tag: document.activeElement?.tagName, insideSurface: !!document.activeElement?.closest("[data-editor-surface]") })) });
	await parent.keyboard.press("Control+z");
	await expect.poll(async () => digest(await readState()), { message: "Undo must remove only the imported sequence and clip" }).toBe(digest(initial));
	await parent.keyboard.press("Control+Shift+z");
	await expect.poll(async () => digest(await readState()), { message: "Redo must restore the identical imported sequence and clip" }).toBe(digest(imported));
	await Promise.all([
		frame.waitForNavigation({ waitUntil: "domcontentloaded" }),
		frame.evaluate(() => location.reload()),
	]);
	await expect(frame.locator('[aria-label="Media"]')).toBeVisible({ timeout: 30000 });
	assert.deepEqual(await readState(), imported, "Import and clip must survive reopening");
	evidence.checks.push({ name: "JIZURA file chooser rejects invalid/versioned files without mutation, import undo/redo and reopen persist", pass: true });
}
