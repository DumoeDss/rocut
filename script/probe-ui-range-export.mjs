import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	createUiExportFixture,
	downloadUiExport,
} from "./probe-ui-export-fixture.mjs";
import {
	createRangeSource,
	verifyRangeMedia,
} from "./probe-ui-range-media.mjs";

export async function probeUiRangeExport({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	onPhase("range export two-color two-tone actual UI fixture");
	const sourceVideo = join(work, "range-underlay.mp4");
	createRangeSource(sourceVideo);
	await createUiExportFixture({ page, work, sourceVideo });
	const readRecord = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record.data,
		);
	const initial = await readRecord();
	const tracks = initial.scenes[0].tracks;
	const motion = [tracks.main, ...tracks.overlay]
		.flatMap((t) => t.elements)
		.find((c) => c.type === "motion-text");
	assert(motion);
	await page
		.locator(`[data-testid="timeline-clip"][data-element-id="${motion.id}"]`)
		.click();
	const cue = page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.nth(1);
	await expect(cue).toBeVisible();
	if ((await cue.getAttribute("aria-expanded")) !== "true") await cue.click();
	const range = page.locator('[data-motion-text-cue-range="true"]');
	await expect(range).toHaveAttribute("data-range-start", "120000");
	await expect(range).toHaveAttribute("data-range-end", "240000");
	const trigger = page.getByTestId("editor-menu-trigger");
	const dialog = page.getByRole("dialog", {
		name: "Export project",
		exact: true,
	});
	const open = async (format) => {
		await trigger.click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Format", exact: true }).click();
		await dialog
			.getByRole("radio", {
				name:
					format === "webm"
						? "WebM (VP9) - Smaller file size"
						: "MP4 (H.264) - Better compatibility",
				exact: true,
			})
			.check();
	};
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		for (const format of ["mp4", "webm"]) {
			onPhase("actual UI selected-cue export " + format);
			await range
				.getByRole("button", { name: "Use cue as export range", exact: true })
				.click();
			await open(format);
			await expect(
				dialog.getByText("1.00s – 2.00s", { exact: true }),
			).toBeVisible();
			await hostPage.screenshot({
				path: join(work, format + "-selected-range.png"),
			});
			const ranged = await downloadUiExport(cdp, dialog, work);
			await expect(dialog).toHaveCount(0);
			await expect(trigger).toBeFocused();
			evidence.checks.push({
				name: "selected cue actual UI download " + format,
				pass: true,
				...verifyRangeMedia(ranged, { format, ranged: true }),
			});
			await expect(
				range.getByRole("button", { name: "Clear export range", exact: true }),
			).toBeVisible();
			onPhase("actual UI clear range and full export " + format);
			await open(format);
			await expect(
				dialog.getByText("1.00s – 2.00s", { exact: true }),
			).toBeVisible();
			await dialog
				.getByRole("button", { name: "Use full timeline", exact: true })
				.click();
			await expect(
				dialog.getByText("Full timeline", { exact: true }),
			).toBeVisible();
			const full = await downloadUiExport(cdp, dialog, work);
			await expect(dialog).toHaveCount(0);
			await expect(trigger).toBeFocused();
			evidence.checks.push({
				name: "cleared range actual full-timeline download " + format,
				pass: true,
				...verifyRangeMedia(full, { format, ranged: false }),
			});
			await expect(
				range.getByRole("button", {
					name: "Use cue as export range",
					exact: true,
				}),
			).toBeVisible();
			const current = await readRecord();
			for (const key of ["scenes", "settings", "motionTextSequences"])
				assert.deepEqual(
					current[key],
					initial[key],
					"range selection and export must not edit " + key,
				);
		}
		evidence.checks.push({
			name: "range state survives dialog reopening, clearing restores cue control, timeline/settings/lyrics unchanged",
			pass: true,
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
