import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { expect } from "@playwright/test";

export async function createUiExportFixture({ page, work, sourceVideo }) {
	const video = sourceVideo ?? join(work, "format-underlay.mp4");
	if (!sourceVideo)
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
				"sine=frequency=880:duration=2",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-shortest",
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
		.getByLabel(`Add ${basename(video)} to timeline`, { exact: true })
		.click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(2);
	await page.getByLabel("Settings", { exact: true }).click();
}

export async function downloadUiExport(cdp, dialog, work) {
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
