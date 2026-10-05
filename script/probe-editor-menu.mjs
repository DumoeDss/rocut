import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";

// Real iframe input and Chromium download events; never substitute /api/export.
export async function probeEditorMenu({ page, hostPage, work, evidence, onPhase }) {
	const check = (name, details = {}) => evidence.checks.push({ name, ...details, pass: true });
	onPhase("editor menu fixture");
	const video = join(work, "menu-video.mp4");
	execFileSync("ffmpeg", ["-v", "error", "-n", "-f", "lavfi", "-i",
		"color=c=red:s=640x360:r=30:d=3", "-f", "lavfi", "-i",
		"sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-shortest", video], { windowsHide: true });
	await page.getByLabel("Motion text", { exact: true }).click();
	await page.getByRole("combobox", { name: "Lyrics format", exact: true }).click();
	await page.getByRole("option", { name: "LRC timestamps", exact: true }).click();
	await page.locator("#motion-text-source").fill("[00:00.00]真实界面导出\n[00:01.50]字幕与音画");
	await page.getByRole("spinbutton", { name: "Duration (seconds)", exact: true }).fill("3");
	await page.getByTestId("motion-text-add").click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(video);
	await page.getByLabel("Add menu-video.mp4 to timeline", { exact: true }).click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(2);
	await expect(page.locator("[data-editor-header]")).toBeHidden();
	const trigger = page.getByTestId("editor-menu-trigger");
	await expect(trigger).toBeInViewport();
	onPhase("editor menu keyboard and layout");
	await trigger.focus();
	await page.keyboard.press("Enter");
	await page.getByRole("menuitem", { name: "Keyboard shortcuts", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByRole("dialog").getByRole("heading", { name: "Keyboard shortcuts", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	check("keyboard opens and closes shortcuts without restoring outer header");
	const openExport = async () => {
		await trigger.click();
		await page.getByRole("menuitem", { name: "Export project", exact: true }).click();
		await expect(page.getByRole("dialog", { name: "Export project", exact: true })).toBeVisible();
	};
	await hostPage.setViewportSize({ width: 1000, height: 650 });
	await openExport();
	const dialog = page.getByRole("dialog", { name: "Export project", exact: true });
	for (const name of ["Format", "Quality", "Range", "Audio"]) {
		await dialog.getByRole("button", { name, exact: true }).click();
	}
	const geometry = await dialog.evaluate(el => {
		const box = el.getBoundingClientRect();
		return { top: box.top, bottom: box.bottom, height: innerHeight, width: el.clientWidth,
			contentWidth: el.scrollWidth, scrollable: el.scrollHeight > el.clientHeight };
	});
	assert(geometry.top >= 0 && geometry.bottom <= geometry.height + 1);
	assert(geometry.contentWidth <= geometry.width + 1);
	assert(geometry.scrollable, "Expanded options must scroll inside the short iframe");
	await dialog.getByRole("button", { name: "Export", exact: true }).scrollIntoViewIfNeeded();
	await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeInViewport();
	await hostPage.screenshot({ path: join(work, "export-options-short.png") });
	check("expanded export options and action fit a short embedded viewport", geometry);
	await page.keyboard.press("Escape");
	await hostPage.setViewportSize({ width: 1280, height: 900 });
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: work, eventsEnabled: true });
		const download = async () => {
			let guid;
			let suggestedFilename;
			let completed = false;
			const began = event => { guid = event.guid; suggestedFilename = event.suggestedFilename; };
			const progress = event => { if (event.guid === guid && event.state === "completed") completed = true; };
			cdp.on("Browser.downloadWillBegin", began);
			cdp.on("Browser.downloadProgress", progress);
			try {
				await dialog.getByRole("button", { name: "Export", exact: true }).click();
				await expect.poll(() => completed, { timeout: 120000, message: "Actual UI download must complete" }).toBe(true);
				assert.match(guid, /^[a-zA-Z0-9-]+$/);
				await expect(dialog).toHaveCount(0);
				return { path: join(work, guid), suggestedFilename };
			} finally {
				cdp.off("Browser.downloadWillBegin", began);
				cdp.off("Browser.downloadProgress", progress);
			}
		};
		onPhase("UI MP4 full project export");
		await openExport();
		const full = await download();
		verifyDownload(full, { duration: 3, codec: "h264", audio: true }, check);
		onPhase("UI WebM cue range export without audio");
		await page.getByTestId("timeline-clip").filter({ hasText: "Clean caption" }).click();
		await page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').first().click();
		await page.getByRole("button", { name: "Use cue as export range", exact: true }).click();
		await openExport();
		await dialog.getByRole("button", { name: "Format", exact: true }).click();
		await dialog.getByRole("radio", { name: "WebM (VP9) - Smaller file size", exact: true }).click();
		await dialog.getByRole("button", { name: "Audio", exact: true }).click();
		await dialog.getByRole("checkbox", { name: "Include audio in export", exact: true }).uncheck();
		const ranged = await download();
		verifyDownload(ranged, { duration: 1.5, codec: "vp9", audio: false }, check);
		await openExport();
		await dialog.getByRole("button", { name: "Use full timeline", exact: true }).click();
		await expect(dialog.getByText("Full timeline", { exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		check("export range can be cleared through the internal dialog");
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}

function verifyDownload(file, expected, check) {
	const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file.path], { encoding: "utf8", windowsHide: true }));
	const videos = metadata.streams.filter(stream => stream.codec_type === "video");
	assert.equal(videos.length, 1);
	assert.equal(videos[0].codec_name, expected.codec);
	assert.equal(metadata.streams.filter(stream => stream.codec_type === "audio").length, expected.audio ? 1 : 0);
	assert(Math.abs(Number(metadata.format.duration) - expected.duration) < 0.15);
	assert(file.suggestedFilename.endsWith(expected.codec === "h264" ? ".mp4" : ".webm"));
	const pixels = execFileSync("ffmpeg", ["-v", "error", "-ss", "0.75", "-i", file.path, "-frames:v", "1", "-vf", "scale=320:180", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { windowsHide: true });
	let red = 0, light = 0;
	for (let i = 0; i < pixels.length; i += 3) {
		if (pixels[i] > 150 && pixels[i + 1] < 100 && pixels[i + 2] < 100) red++;
		if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180) light++;
	}
	const count = pixels.length / 3;
	assert(count > 0 && red / count > 0.4, "Downloaded output must include video pixels");
	assert(light / count > 0.001, "Downloaded output must include motion-text glyphs");
	let rms;
	if (expected.audio) {
		const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file.path, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"], { windowsHide: true });
		let energy = 0;
		for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
		rms = Math.sqrt(energy / (pcm.length / 4));
		assert(rms > 0.01, "Actual downloaded audio must not be silent");
	}
	check("UI download decoded " + expected.codec, { ...file, ...expected, rms, redFraction: red / count, glyphFraction: light / count });
}
