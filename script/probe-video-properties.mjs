import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { reloadEditorFrame } from "./probe-reload-editor.mjs";
import { inspectVideoPropertyExport } from "./probe-video-property-export.mjs";

export async function probeVideoProperties({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	const check = (name, details = {}) =>
		evidence.checks.push({ name, ...details, pass: true });
	const readData = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record.data,
		);
	const clips = async () => (await readData()).scenes[0].tracks.main.elements;
	const fixture = join(work, "properties-retime.mp4");
	onPhase("import red-blue source video with 440 Hz audio");
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-n",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=640x360:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=640x360:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=4:sample_rate=48000",
			"-filter_complex",
			"[0:v][1:v]concat=n=2:v=1:a=0[base];[base]drawbox=x=0:y=0:w=160:h=90:color=white:t=fill[v]",
			"-map",
			"[v]",
			"-map",
			"2:a",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-shortest",
			fixture,
		],
		{ windowsHide: true, timeout: 30000 },
	);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator("input[type=file]").setInputFiles(fixture);
	const list = page.getByLabel("Switch to list view", { exact: true });
	if (await list.count()) await list.click();
	await page
		.getByLabel("Add properties-retime.mp4 to timeline", { exact: true })
		.click();
	await expect.poll(async () => (await clips()).length).toBe(1);
	const original = (await clips())[0];
	assert.equal(original.duration, 4 * 120000);
	const select = () =>
		page
			.locator(
				'[data-testid="timeline-clip"][data-element-id="' + original.id + '"]',
			)
			.click();
	await select();
	await page.getByLabel("Speed", { exact: true }).click();
	const namedSpeed = page.getByRole("textbox", {
		name: "Playback speed",
		exact: true,
	});
	const missingSpeedLabel = (await namedSpeed.count()) === 0;
	// Baseline fallback is restricted to the sole visible input on this inspected
	// panel. The final accessibility assertion still fails if the label is absent.
	const speed = missingSpeedLabel ? page.locator("input:visible") : namedSpeed;
	await expect(speed).toHaveCount(1);
	const pitch = page.getByRole("switch");
	const missingPitchLabel =
		(await page
			.getByRole("switch", { name: "Change pitch", exact: true })
			.count()) === 0;
	evidence.videoPropertyAccessibility = {
		missingSpeedLabel,
		missingPitchLabel,
	};
	onPhase("commit 2x speed and preserve source bounds through history");
	await speed.fill("2");
	await speed.press("Enter");
	await expect.poll(async () => (await clips())[0].retime?.rate).toBe(2);
	const faster = (await clips())[0];
	assert.equal(faster.duration, 2 * 120000);
	assert.equal(faster.startTime, original.startTime);
	assert.equal(faster.trimStart, original.trimStart);
	assert.equal(faster.trimEnd, original.trimEnd);
	await select();
	await hostPage.keyboard.press("Control+z");
	await expect.poll(async () => (await clips())[0].duration).toBe(4 * 120000);
	assert.equal((await clips())[0].retime, undefined);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await clips())[0].duration).toBe(2 * 120000);
	check(
		"2x speed halves duration, preserves source bounds, supports one-step undo redo",
	);
	onPhase("decode 2x export with changed pitch");
	check(
		"2x export switches source color at 1s and shifts tone to 880 Hz",
		await inspectVideoPropertyExport({ page, project, frequency: 880 }),
	);
	onPhase("preserve pitch at 2x and reopen");
	await select();
	await page.getByLabel("Speed", { exact: true }).click();
	if (!missingPitchLabel) {
		const pitchId = await pitch.getAttribute("id");
		assert(pitchId, "Pitch switch must have an associated visible label");
		await page
			.locator("label")
			.filter({ hasText: /^Change pitch$/ })
			.click();
		await expect
			.poll(async () => (await clips())[0].retime?.maintainPitch)
			.toBe(true);
		await pitch.press("Space");
		await expect
			.poll(async () => (await clips())[0].retime?.maintainPitch)
			.toBe(false);
		await pitch.press("Space");
		check(
			"pitch label click and keyboard Space toggle the saved pitch setting",
		);
	} else {
		await pitch.click();
	}
	await expect
		.poll(async () => (await clips())[0].retime?.maintainPitch)
		.toBe(true);
	await reloadEditorFrame(page);
	await expect
		.poll(async () => (await clips())[0].retime?.maintainPitch)
		.toBe(true);
	assert.equal((await clips())[0].duration, 2 * 120000);
	check(
		"pitch-preserving 2x export keeps source timing and 440 Hz tone after reload",
		await inspectVideoPropertyExport({ page, project, frequency: 440 }),
	);
	onPhase(
		"transform scale, position and rotation commit without changing audio or timing",
	);
	await select();
	await page.getByLabel("Transform", { exact: true }).click();
	const positionX = (await readData()).settings.canvasSize.width / 8;
	for (const [label, value] of [
		["Scale X", "0.5"],
		["Scale Y", "0.5"],
		["Position X", String(positionX)],
		["Position Y", "0"],
		["Rotate", "180"],
	]) {
		const field = page.getByRole("textbox", { name: label, exact: true });
		await field.fill(value);
		await field.press("Enter");
	}
	await expect
		.poll(async () => (await clips())[0].params["transform.rotate"])
		.toBe(180);
	assert.equal((await clips())[0].params["transform.scaleX"], 0.5);
	assert.equal((await clips())[0].params["transform.scaleY"], 0.5);
	await reloadEditorFrame(page);
	check(
		"scale, translation and rotation survive reload and export with unchanged audio",
		await inspectVideoPropertyExport({
			page,
			project,
			frequency: 440,
			visibleArea: 0.25,
			markerCenter: [0.8125, 0.6875],
		}),
	);
	await select();
	await page.getByLabel("Speed", { exact: true }).click();
	await hostPage.screenshot({ path: join(work, "video-properties.png") });
	onPhase("reset speed to default and undo after reload");
	await page
		.getByRole("button", { name: "Reset to default", exact: true })
		.click();
	await expect.poll(async () => (await clips())[0].duration).toBe(4 * 120000);
	assert.equal((await clips())[0].retime?.rate, 1);
	assert.equal((await clips())[0].retime?.maintainPitch, true);
	await select();
	await hostPage.keyboard.press("Control+z");
	await expect.poll(async () => (await clips())[0].duration).toBe(2 * 120000);
	await reloadEditorFrame(page);
	assert.equal((await clips())[0].retime?.rate, 2);
	assert.equal((await clips())[0].retime?.maintainPitch, true);
	check("speed reset restores source duration and undo persists across reopen");
	assert(
		!missingSpeedLabel && !missingPitchLabel,
		"Speed and Change pitch controls must have accessible names",
	);
	check("speed textbox and pitch switch have accessible names");
}
