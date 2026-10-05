import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { verifyUiFormatMedia } from "./probe-ui-format-media.mjs";
import {
	createUiExportFixture,
	downloadUiExport as download,
} from "./probe-ui-export-fixture.mjs";

// Every configuration and export is authored through the installed editor UI.
// HTTP is used only to read back persistence, never to start an export.
export async function probeUiFormatExport({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const check = (name, details = {}) =>
		evidence.checks.push({ name, ...details, pass: true });
	const record = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	onPhase("F06 actual UI format fixture");
	await createUiExportFixture({ page, work });
	// This option is deliberately required: rounding 29.97 to 30 is not coverage.
	await page.getByRole("combobox", { name: "Frame rate", exact: true }).click();
	await expect(
		page.getByRole("option", { name: "29.97 fps", exact: true }),
	).toBeVisible();
	await page.getByRole("option", { name: "29.97 fps", exact: true }).click();
	await expect
		.poll(async () => (await record()).data.settings.fps)
		.toEqual({ numerator: 30000, denominator: 1001 });
	await expect(
		page.getByRole("combobox", { name: "Frame rate", exact: true }),
	).toHaveText("29.97 fps");
	check(
		"fractional frame rate is selectable and displayed without integer rounding",
	);
	const undoFrameRate = async () => {
		await hostPage.keyboard.press("Control+z");
		await expect
			.poll(async () => (await record()).data.settings.fps)
			.toEqual({ numerator: 30, denominator: 1 });
		const restored = (await record()).data.scenes[0].tracks;
		for (const track of [restored.main, ...restored.overlay]) {
			for (const clip of track.elements) assert.equal(clip.duration, 240000);
		}
	};
	await undoFrameRate();
	const trigger = page.getByTestId("editor-menu-trigger");
	const dialog = page.getByRole("dialog", {
		name: "Export project",
		exact: true,
	});
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		for (const [aspect, width, height] of [
			["16x9", 1920, 1080],
			["9x16", 1080, 1920],
			["1x1", 1080, 1080],
		]) {
			// The selected Custom button includes its width/height field values.
			await page.getByRole("button", { name: /^Custom(?:\s|$)/ }).click();
			for (const [name, value] of [
				["Canvas width", width],
				["Canvas height", height],
			]) {
				await page.getByLabel(name, { exact: true }).fill(String(value));
				await page.getByLabel(name, { exact: true }).press("Enter");
				await page.getByLabel(name, { exact: true }).press("Tab");
			}
			await expect
				.poll(async () => (await record()).data.settings.canvasSize)
				.toEqual({ width, height });
			for (const [label, numerator, denominator] of [
				["23.976", 24000, 1001],
				["24", 24, 1],
				["25", 25, 1],
				["30", 30, 1],
				["60", 60, 1],
				["29.97", 30000, 1001],
				["59.94", 60000, 1001],
				["120", 120, 1],
			]) {
				const id = aspect + "-" + label;
				onPhase("F06 UI export " + id);
				await page
					.getByRole("combobox", { name: "Frame rate", exact: true })
					.click();
				await page
					.getByRole("option", { name: label + " fps", exact: true })
					.click();
				await expect
					.poll(async () => (await record()).data.settings.fps)
					.toEqual({ numerator, denominator });
				await trigger.click();
				await page
					.getByRole("menuitem", { name: "Export project", exact: true })
					.click();
				await expect(dialog).toBeVisible();
				const output = await download(cdp, dialog, work);
				await expect(dialog).toHaveCount(0);
				await expect(trigger).toBeFocused();
				check(
					"actual UI download " + id,
					verifyUiFormatMedia(output, {
						width,
						height,
						numerator,
						denominator,
					}),
				);
				if (numerator !== 30 || denominator !== 1) await undoFrameRate();
			}
			await hostPage.screenshot({
				path: join(work, "format-" + aspect + ".png"),
			});
		}
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
	onPhase("F06 frame-rate refusal preserves an existing one-frame clip");
	const original = (await record()).data.scenes[0].tracks.main.elements;
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${original[0].id}"]`,
		)
		.click();
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:01");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	await page.getByLabel("Split element", { exact: true }).click();
	await expect
		.poll(
			async () => (await record()).data.scenes[0].tracks.main.elements.length,
		)
		.toBe(2);
	const splitClips = (await record()).data.scenes[0].tracks.main.elements;
	assert.equal(splitClips[0].duration, 4000);
	await page.getByRole("combobox", { name: "Frame rate", exact: true }).click();
	await page.getByRole("option", { name: "24 fps", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("shorter than one frame");
	assert.deepEqual((await record()).data.settings.fps, {
		numerator: 30,
		denominator: 1,
	});
	assert.deepEqual(
		(await record()).data.scenes[0].tracks.main.elements,
		splitClips,
	);
	await hostPage.screenshot({ path: join(work, "frame-rate-refusal.png") });
	// A rejected change adds no history: one Undo restores the actual split.
	await hostPage.keyboard.press("Control+z");
	await expect
		.poll(async () => (await record()).data.scenes[0].tracks.main.elements)
		.toEqual(original);
	check(
		"unrepresentable one-frame clip gives a visible refusal with no mutation or history entry",
	);
}
