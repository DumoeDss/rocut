import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { reloadEditorFrame } from "./probe-reload-editor.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";
import { verifyLinkedRangeMedia } from "./probe-linked-range-media.mjs";
import {
	compositionPreview,
	assertCompositionPixels,
} from "./probe-composition-pixels.mjs";

// Continue the edited multilingual fixture. Only the dedicated editor's font
// request is faulted; no installed assets or authored project files are edited.
export async function probeLinkedFontRecovery({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const owner = new URL(await page.evaluate(() => location.href));
	const font = new URL("motion-text/fonts/noto-sans-sc-variable.ttf", owner)
		.href;
	const state = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				id: record.id,
				sequences: record.data.motionTextSequences,
				scenes: record.data.scenes.map(({ updatedAt, ...scene }) => scene),
				settings: record.data.settings,
			};
		});
	const seek = async () => {
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:00:03:24");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await hostPage.keyboard.press("Escape");
	};
	await seek();
	let baseline,
		previous,
		streak = 0;
	await expect
		.poll(
			async () => {
				baseline = await compositionPreview(page);
				streak = baseline.hash === previous ? streak + 1 : 1;
				previous = baseline.hash;
				return streak >= 3;
			},
			{ timeout: 20000 },
		)
		.toBe(true);
	assert(
		baseline.cyan.length > 25 && baseline.magenta.length > 25,
		"the existing project must display both languages before fault injection",
	);
	const before = await state();
	assert(
		before.sequences.length >= 2,
		"requires the existing multilingual fixture",
	);
	let blocked = true,
		failures = 0,
		recovered = 0,
		downloads = 0;
	const route = async (request) => {
		if (blocked) {
			failures++;
			await request.fulfill({
				status: 503,
				contentType: "text/plain",
				body: "E2E temporary font unavailability",
			});
		} else {
			recovered++;
			await request.continue();
		}
	};
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	const onDownload = () => downloads++;
	cdp.on("Browser.downloadWillBegin", onDownload);
	await hostPage.route(font, route);
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		onPhase("same-project font unavailable after true document reload");
		await reloadEditorFrame(page);
		await seek();
		await expect.poll(() => failures, { timeout: 20000 }).toBeGreaterThan(0);
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
		assert.equal(downloads, 0, "failed export cannot download fallback glyphs");
		assert.deepEqual(
			await state(),
			before,
			"failed export cannot alter existing edits or media references",
		);
		evidence.checks.push({
			name: "same-project missing font exposes actionable Retry and refuses fallback export without losing edits",
			pass: true,
			failures,
			error,
		});
		onPhase("same-project restore font and click Retry without another reload");
		blocked = false;
		const output = await downloadUiExport(cdp, dialog, work, "Retry");
		assert(
			recovered > 0,
			"Retry must refetch the font, not reuse rejected cache",
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
		const { greenMask, ...media } = await verifyLinkedRangeMedia({
			page: hostPage,
			output,
			ranged: false,
		});
		// Do not seek here: retry/export itself must restore the paused compositor.
		await expect
			.poll(
				async () => {
					try {
						assertCompositionPixels(await compositionPreview(page), baseline);
						return null;
					} catch (error) {
						return error.message;
					}
				},
				{ timeout: 20000 },
			)
			.toBe(null);
		assert.deepEqual(await state(), before);
		evidence.checks.push({
			name: "same-project Retry restores exact multilingual paused composition and full audiovisual export without reload or edits",
			pass: true,
			recovered,
			...media,
		});
	} finally {
		await hostPage.unroute(font, route);
		cdp.off("Browser.downloadWillBegin", onDownload);
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
	return page;
}
