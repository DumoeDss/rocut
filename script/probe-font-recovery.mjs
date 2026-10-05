import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

export async function probeFontRecovery({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const owner = page.url();
	const origin = new URL(owner).origin;
	let blocked = true,
		failures = 0,
		recovered = 0,
		downloads = 0;
	const match = (url) =>
		url.origin === origin &&
		url.pathname.endsWith("/motion-text/fonts/noto-sans-sc-variable.ttf");
	const route = async (route) => {
		if (route.request().frame().url() !== owner) return route.continue();
		if (blocked) {
			failures++;
			await route.fulfill({
				status: 503,
				contentType: "text/plain",
				body: "E2E temporary font unavailability",
			});
		} else {
			recovered++;
			await route.continue();
		}
	};
	const state = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				sequences: record.data.motionTextSequences,
				scenes: record.data.scenes,
				settings: record.data.settings,
			};
		});
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	const onDownload = () => downloads++;
	cdp.on("Browser.downloadWillBegin", onDownload);
	await hostPage.route(match, route);
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		onPhase("import with unavailable Chinese font");
		await page.getByLabel("Motion text", { exact: true }).click();
		const source = JSON.parse(
			readFileSync(
				new URL(
					"../rust/crates/motion-text/fixtures/jizura-v1-project.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const chooser = hostPage.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Import", exact: true }).click();
		await (
			await chooser
		).setFiles({
			name: "font-recovery.jizura.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(source)),
		});
		await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:24");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await hostPage.keyboard.press("Escape");
		await expect.poll(() => failures, { timeout: 20000 }).toBeGreaterThan(0);
		const before = await state();
		await page.getByTestId("editor-menu-trigger").click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "Export project",
			exact: true,
		});
		await dialog.getByRole("button", { name: "Export", exact: true }).click();
		await expect(
			dialog.getByRole("button", { name: "Retry", exact: true }),
		).toBeVisible({ timeout: 20000 });
		const error = await dialog.innerText();
		assert.match(
			error,
			/Failed to prepare motion-text font gothic_bold_zh_hans/,
		);
		assert.equal(
			downloads,
			0,
			"failed export must not download fallback glyphs",
		);
		assert.deepEqual(await state(), before);
		evidence.checks.push({
			name: "font failure is visible and export fails closed without changing project",
			pass: true,
			failures,
			error,
		});
		onPhase("restore font and Retry without reloading");
		blocked = false;
		const output = await downloadUiExport(cdp, dialog, work, "Retry");
		assert(
			recovered > 0,
			"Retry must fetch restored font rather than reuse a rejected promise",
		);
		assert.equal(downloads, 1);
		const fonts = await page.evaluate(() =>
			Array.from(document.fonts, (f) => ({
				family: f.family,
				status: f.status,
			})),
		);
		assert(
			fonts.some(
				(f) =>
					/^__rocut_mt_gothic_bold_zh_hans_[a-f0-9]{16}$/.test(f.family) &&
					f.status === "loaded",
			),
		);
		const info = JSON.parse(
			execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-count_frames",
					"-show_entries",
					"stream=codec_name,width,height,nb_read_frames",
					"-of",
					"json",
					output.path,
				],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		assert(
			info.streams.some(
				(s) => s.codec_name === "h264" && Number(s.nb_read_frames) > 30,
			),
		);
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				"0.8",
				"-i",
				output.path,
				"-frames:v",
				"1",
				"-vf",
				"scale=320:180",
				"-pix_fmt",
				"rgb24",
				"-f",
				"rawvideo",
				"pipe:1",
			],
			{ windowsHide: true },
		);
		let lit = 0;
		for (let i = 0; i < pixels.length; i += 3)
			if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 100) lit++;
		assert(lit > 100, "recovered export must contain rendered glyph pixels");
		assert.deepEqual(await state(), before);
		evidence.checks.push({
			name: "actual Retry recovers font without reload and exports decoded glyph pixels without project mutations",
			pass: true,
			recovered,
			info,
			lit,
		});
	} finally {
		await hostPage.unroute(match, route);
		cdp.off("Browser.downloadWillBegin", onDownload);
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
