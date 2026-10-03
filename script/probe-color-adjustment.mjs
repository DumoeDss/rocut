import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { verifyAdjustmentExport } from "./probe-color-adjustment-export.mjs";
import { expect } from "@playwright/test";

const run = (command, args) =>
	execFileSync(command, args, { windowsHide: true });
const seek = async (page, seconds) => {
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page
		.getByLabel("Playhead time", { exact: true })
		.fill("00:00:0" + seconds + ":00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
};
const clips = (page) =>
	page.evaluate(async () => {
		const { record } = await (
			await fetch(new URL("api/record", location.href))
		).json();
		const tracks = record.data.scenes[0].tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
			(track) => track.elements,
		);
	});
const adjustment = async (page) =>
	(await clips(page)).find((clip) => clip.adjustment);
async function sample(page) {
	const bytes = await page.locator("canvas").first().screenshot();
	return page.evaluate(async (bytes) => {
		const image = await createImageBitmap(
			new Blob([new Uint8Array(bytes)], { type: "image/png" }),
		);
		const canvas = new OffscreenCanvas(image.width, image.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, 0);
		const rgba = Array.from(
			ctx.getImageData(
				Math.floor(image.width / 2),
				Math.floor(image.height / 2),
				1,
				1,
			).data,
		);
		image.close();
		return rgba;
	}, Array.from(bytes));
}
async function color(page, predicate, label) {
	let rgba;
	await expect
		.poll(
			async () => {
				rgba = await sample(page);
				return predicate(rgba);
			},
			{ timeout: 15000, message: label },
		)
		.toBe(true);
	return rgba;
}
const mono = (rgba) =>
	Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3)) < 4;
const original = (rgba) =>
	rgba[0] > 110 &&
	rgba[0] < 145 &&
	rgba[1] > 50 &&
	rgba[1] < 80 &&
	rgba[2] < 50;

export async function probeColorAdjustment({
	page,
	project,
	work,
	evidence,
	onPhase,
}) {
	onPhase("adjustment fixture and neutral preview");
	const source = join(work, "fixture-adjustment.mp4");
	run("ffmpeg", [
		"-v",
		"error",
		"-n",
		"-f",
		"lavfi",
		"-i",
		"color=c=0x804020:s=640x360:r=30:d=6",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=660:duration=6",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		source,
	]);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(source);
	const list = page.getByLabel("Switch to list view", { exact: true });
	if (await list.count()) await list.click();
	await page
		.getByLabel("Add fixture-adjustment.mp4 to timeline", { exact: true })
		.click();
	await expect.poll(async () => (await clips(page)).length).toBe(1);
	await seek(page, 2);
	const before = await color(page, original, "Original brown source preview");
	await page.getByLabel("Adjustment", { exact: true }).click();
	await page
		.getByRole("button", { name: "Add Neutral adjustment", exact: true })
		.click();
	await expect.poll(async () => Boolean(await adjustment(page))).toBe(true);
	const initial = await adjustment(page);
	assert.equal(initial.startTime, 0);
	assert.equal(initial.duration, 720000);
	const identity = await sample(page);
	assert(
		identity
			.slice(0, 3)
			.every((value, index) => Math.abs(value - before[index]) <= 2),
	);
	evidence.checks.push({
		name: "neutral adjustment inserts durably above source with selected clip range and unchanged preview",
		pass: true,
		before,
		identity,
	});
	onPhase("adjustment presets and property controls");
	await page
		.getByRole("button", { name: "Apply Monochrome adjustment", exact: true })
		.click();
	await expect
		.poll(async () => (await adjustment(page)).adjustment.saturation)
		.toBe(-100);
	await color(page, mono, "Monochrome must remove color");
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await adjustment(page)).adjustment.saturation)
		.toBe(0);
	await color(page, original, "Undo must restore source color");
	await page.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await adjustment(page)).adjustment.saturation)
		.toBe(-100);
	await page.getByRole("button", { name: "Reset colors", exact: true }).click();
	await expect
		.poll(async () => (await adjustment(page)).adjustment.saturation)
		.toBe(0);
	const exposure = page.getByLabel("Exposure (EV)", { exact: true });
	await exposure.fill("1");
	await exposure.press("Tab");
	await expect
		.poll(async () => (await adjustment(page)).adjustment.exposure)
		.toBe(1);
	const brighter = await color(
		page,
		(rgba) => rgba[0] > before[0] + 30 && rgba[1] > before[1] + 15,
		"Exposure increases light in preview",
	);
	for (const [label, key, value] of [
		["Contrast", "contrast", 20],
		["Saturation", "saturation", 30],
		["Temperature", "temperature", 25],
		["Tint", "tint", 30],
	]) {
		const input = page.getByLabel(label, { exact: true });
		await input.fill(String(value));
		await input.press("Tab");
		await expect
			.poll(async () => (await adjustment(page)).adjustment[key])
			.toBe(value);
	}
	await page.getByRole("button", { name: "Reset colors", exact: true }).click();
	await color(page, original, "Reset returns all colors to source");
	await page
		.getByRole("button", { name: "Apply Warm adjustment", exact: true })
		.click();
	await expect
		.poll(async () => (await adjustment(page)).adjustment.temperature)
		.toBe(35);
	const warm = await color(
		page,
		(rgba) => rgba[0] > before[0] && rgba[2] < before[2],
		"Warm preset warms source",
	);
	await page
		.getByRole("button", { name: "Apply Cool adjustment", exact: true })
		.click();
	await expect
		.poll(async () => (await adjustment(page)).adjustment.temperature)
		.toBe(-35);
	const cool = await color(
		page,
		(rgba) => rgba[0] < warm[0] && rgba[2] > warm[2],
		"Cool preset cools source",
	);
	evidence.checks.push({
		name: "all five fields, presets, reset, keyboard undo and redo persist and affect real preview",
		pass: true,
		brighter,
		warm,
		cool,
	});
	await page
		.getByRole("button", { name: "Apply Monochrome adjustment", exact: true })
		.click();
	await expect
		.poll(async () => (await adjustment(page)).adjustment.saturation)
		.toBe(-100);
	await page.reload();
	await page.getByText("Color adjustment", { exact: true }).last().click();
	await expect(page.getByLabel("Saturation", { exact: true })).toHaveValue(
		"-100",
	);
	await seek(page, 2);
	await color(page, mono, "Reopened layer stays monochrome");
	evidence.checks.push({
		name: "adjustment survives real iframe reload",
		pass: true,
	});
	onPhase("adjustment split delete range and export");
	await seek(page, 4);
	await page.getByLabel("Split element", { exact: true }).click();
	await expect
		.poll(
			async () => (await clips(page)).filter((clip) => clip.adjustment).length,
		)
		.toBe(2);
	await page.getByLabel("Delete element", { exact: true }).click();
	await expect
		.poll(
			async () => (await clips(page)).filter((clip) => clip.adjustment).length,
		)
		.toBe(1);
	const remaining = await adjustment(page);
	assert.equal(remaining.startTime, 0);
	assert.equal(remaining.duration, 480000);
	await seek(page, 1);
	await color(page, mono, "Color layer range starts gray");
	await seek(page, 5);
	await color(page, original, "Color layer range end restores source");
	evidence.checks.push({
		name: "split and remove adjustment tail preserve parameters and restrict preview range",
		pass: true,
	});
	evidence.checks.push({
		name: "decoded MP4 matches in-range grayscale and out-of-range source color with unchanged audible track",
		pass: true,
		...(await verifyAdjustmentExport(page, project)),
	});
}
