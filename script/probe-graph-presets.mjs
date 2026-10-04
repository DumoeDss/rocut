import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { reloadEditorFrame } from "./probe-reload-editor.mjs";

export async function probeGraphPresets({
	page,
	hostPage,
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
	const clip = async () => (await readData()).scenes[0].tracks.main.elements[0];
	const library = () =>
		page.evaluate(async () => {
			const r = await fetch(
				new URL("api/library/graph-editor-presets/user-presets", location.href),
			);
			return r.status === 404 ? null : (await r.json()).data;
		});
	const fixture = join(work, "graph-keyframes.mp4");
	onPhase("create graph fixture and two position keyframes through real UI");
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
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-an",
			fixture,
		],
		{ windowsHide: true, timeout: 30000 },
	);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator("input[type=file]").setInputFiles(fixture);
	const list = page.getByLabel("Switch to list view", { exact: true });
	if (await list.count()) await list.click();
	await page
		.getByLabel("Add graph-keyframes.mp4 to timeline", { exact: true })
		.click();
	await expect.poll(async () => Boolean(await clip())).toBe(true);
	const id = (await clip()).id;
	const select = () =>
		page
			.locator('[data-testid="timeline-clip"][data-element-id="' + id + '"]')
			.click();
	const seek = async (seconds) => {
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page
			.getByLabel("Playhead time", { exact: true })
			.fill("00:00:0" + seconds + ":00");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	};
	await seek(0);
	await select();
	await page.getByLabel("Transform", { exact: true }).click();
	await page
		.getByRole("button", { name: "Toggle position x keyframe", exact: true })
		.click();
	await expect.poll(async () => Boolean((await clip()).animations)).toBe(true);
	await seek(1);
	const position = page.getByRole("textbox", {
		name: "Position X",
		exact: true,
	});
	await position.fill("400");
	await position.press("Enter");
	await expect(
		page.getByRole("button", { name: "Select keyframe", exact: true }),
	).toHaveCount(2);
	const initial = (await clip()).animations;
	evidence.graphInitial = initial;
	const open = async () => {
		await page
			.getByRole("button", { name: "Select keyframe", exact: true })
			.first()
			.click();
		await page
			.getByRole("button", { name: "Open graph editor", exact: true })
			.click();
	};
	await open();
	await page.getByRole("button", { name: /Smooth$/ }).click();
	await expect
		.poll(async () => JSON.stringify((await clip()).animations))
		.not.toBe(JSON.stringify(initial));
	const curved = (await clip()).animations;
	evidence.graphCurved = curved;
	await hostPage.keyboard.press("Escape");
	await hostPage.keyboard.press("Control+z");
	await expect.poll(async () => (await clip()).animations).toEqual(initial);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await clip()).animations).toEqual(curved);
	check("keyframe graph preset persists and supports one-step undo redo");
	onPhase("save custom curve and inspect durable library");
	await open();
	await page.getByRole("tab", { name: "Saved", exact: true }).click();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect.poll(async () => (await library())?.presets?.length).toBe(1);
	const preset = (await library()).presets[0];
	assert.deepEqual(preset.value, [0.25, 0.1, 0.25, 1]);
	assert.equal(preset.label, "Custom 1");
	assert.deepEqual(
		(await clip()).animations,
		curved,
		"Saving a library preset must not change animation",
	);
	await hostPage.screenshot({ path: join(work, "graph-saved-baseline.png") });
	const nestedButtons = await page.locator("button button").count();
	const namedDelete = page.getByRole("button", {
		name: "Delete Custom 1 preset",
		exact: true,
	});
	evidence.graphPresetAccessibility = {
		nestedButtons,
		namedDelete: await namedDelete.count(),
	};
	await reloadEditorFrame(page);
	await select();
	await open();
	await page.getByRole("button", { name: /Linear$/ }).click();
	await expect.poll(async () => (await clip()).animations).toEqual(initial);
	await page.getByRole("tab", { name: "Saved", exact: true }).click();
	await page.getByRole("button", { name: /Custom 1$/ }).click();
	await expect.poll(async () => (await clip()).animations).toEqual(curved);
	check("saved curve reloads and reapplies after reverting to linear", {
		preset: preset.value,
	});
	assert.equal(
		nestedButtons,
		0,
		"Preset cards must not nest interactive buttons",
	);
	await expect(namedDelete).toHaveCount(1);
	onPhase("delete custom curve with keyboard without changing animation");
	await hostPage.mouse.move(1200, 100);
	await page.getByRole("button", { name: "Custom 1", exact: true }).focus();
	await hostPage.keyboard.press("Tab");
	await expect(namedDelete).toBeFocused();
	await expect(namedDelete).toBeVisible();
	await expect(namedDelete).toHaveCSS("opacity", "1");
	await namedDelete.press("Enter");
	await expect.poll(async () => (await library())?.presets?.length).toBe(0);
	assert.deepEqual(
		(await clip()).animations,
		curved,
		"Deleting a library entry must not edit the timeline",
	);
	await reloadEditorFrame(page);
	await select();
	await open();
	await page.getByRole("tab", { name: "Saved", exact: true }).click();
	await expect(page.getByRole("button", { name: /Custom 1$/ })).toHaveCount(0);
	await hostPage.screenshot({ path: join(work, "graph-preset-deleted.png") });
	check("custom preset keyboard deletion persists without editing timeline");
	onPhase("saved preset collection scrolls in a constrained popover");
	for (let count = 1; count <= 18; count++) {
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect
			.poll(async () => (await library())?.presets?.length)
			.toBe(count);
	}
	const region = page.getByRole("region", {
		name: "Saved curve presets",
		exact: true,
	});
	const dimensions = await region.evaluate((node) => ({
		height: node.clientHeight,
		content: node.scrollHeight,
	}));
	assert(dimensions.height <= 240 && dimensions.content > dimensions.height);
	await region.hover();
	await hostPage.mouse.wheel(0, -1500);
	await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBe(0);
	await hostPage.mouse.wheel(0, 1000);
	await expect
		.poll(() => region.evaluate((node) => node.scrollTop))
		.toBeGreaterThan(50);
	await hostPage.screenshot({ path: join(work, "graph-preset-scroll.png") });
	await reloadEditorFrame(page);
	await select();
	await open();
	await page.getByRole("tab", { name: "Saved", exact: true }).click();
	await expect(
		page.getByRole("button", { name: /^Custom \d+$/, exact: true }),
	).toHaveCount(18);
	assert.deepEqual((await clip()).animations, curved);
	check(
		"18 saved curves survive reopen with native wheel scrolling and unchanged timeline",
		dimensions,
	);
}
