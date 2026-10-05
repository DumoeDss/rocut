import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";

export async function createUiMaskFixture({ page, work }) {
	const source = join(work, "mask-red.mp4");
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-n",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=640x360:r=30:d=1",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			source,
		],
		{ windowsHide: true },
	);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(source);
	await page
		.getByLabel("Add mask-red.mp4 to timeline", { exact: true })
		.click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	// A first video sets the project canvas to its native 640x360 size.
	// Author 1080p explicitly rather than assuming the empty-project default.
	await page.getByLabel("Settings", { exact: true }).click();
	await page.getByRole("button", { name: /^Custom(?:\s|$)/ }).click();
	for (const [name, value] of [
		["Canvas width", "1920"],
		["Canvas height", "1080"],
	]) {
		await page.getByLabel(name, { exact: true }).fill(value);
		await page.getByLabel(name, { exact: true }).press("Enter");
		await page.getByLabel(name, { exact: true }).press("Tab");
	}
	await page.getByTestId("timeline-clip").click();
	await page.getByLabel("Masks", { exact: true }).click();
}
