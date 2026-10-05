import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { verifyUiFormatMedia } from "./probe-ui-format-media.mjs";

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
	const video = join(work, "format-underlay.mp4");
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
			video,
		],
		{ windowsHide: true },
	);
	await page.getByLabel("Motion text", { exact: true }).click();
	await page
		.getByRole("combobox", { name: "Lyrics format", exact: true })
		.click();
	await page
		.getByRole("option", { name: "LRC timestamps", exact: true })
		.click();
	await page
		.locator("#motion-text-source")
		.fill("[00:00.00]FIRST FRAME\n[00:01.00]FINAL FRAME");
	await page
		.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
		.fill("2");
	await page.getByTestId("motion-text-add").click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(video);
	await page
		.getByLabel("Add format-underlay.mp4 to timeline", { exact: true })
		.click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(2);
	await page.getByLabel("Settings", { exact: true }).click();
	// This option is deliberately required: rounding 29.97 to 30 is not coverage.
	await page.getByRole("combobox").first().click();
	await expect(
		page.getByRole("option", { name: "29.97 fps", exact: true }),
	).toBeVisible();
	await page.getByRole("option", { name: "29.97 fps", exact: true }).click();
	await expect
		.poll(async () => (await record()).data.settings.fps)
		.toEqual({ numerator: 30000, denominator: 1001 });
	await expect(page.getByRole("combobox").first()).toHaveText("29.97 fps");
	check(
		"fractional frame rate is selectable and displayed without integer rounding",
	);
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
			await page.getByRole("button", { name: "Custom", exact: true }).click();
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
				["24", 24, 1],
				["25", 25, 1],
				["30", 30, 1],
				["60", 60, 1],
				["29.97", 30000, 1001],
			]) {
				const id = aspect + "-" + label;
				onPhase("F06 UI export " + id);
				await page.getByRole("combobox").first().click();
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
			}
			await hostPage.screenshot({
				path: join(work, "format-" + aspect + ".png"),
			});
		}
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}

async function download(cdp, dialog, work) {
	let guid,
		suggestedFilename,
		completed = false;
	const begin = (event) => {
		guid = event.guid;
		suggestedFilename = event.suggestedFilename;
	};
	const progress = (event) => {
		if (event.guid === guid && event.state === "completed") completed = true;
	};
	cdp.on("Browser.downloadWillBegin", begin);
	cdp.on("Browser.downloadProgress", progress);
	try {
		await dialog.getByRole("button", { name: "Export", exact: true }).click();
		await expect
			.poll(() => completed, {
				timeout: 120000,
				message: "UI format download must complete",
			})
			.toBe(true);
		assert.match(guid, /^[a-zA-Z0-9-]+$/);
		return { path: join(work, guid), suggestedFilename };
	} finally {
		cdp.off("Browser.downloadWillBegin", begin);
		cdp.off("Browser.downloadProgress", progress);
	}
}
