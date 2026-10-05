import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";
import { verifyLinkedRangeMedia } from "./probe-linked-range-media.mjs";
import { languageOverlap } from "./probe-multilingual-media.mjs";

export async function probeLinkedRange({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	onPhase("select the original third cue as the final project export range");
	const read = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	const before = await read(),
		sequence = before.data.motionTextSequences[0];
	const tracks = before.data.scenes[0].tracks;
	const clip = [tracks.main, ...tracks.overlay]
		.flatMap((t) => t.elements)
		.filter((c) => c.sequenceId === sequence.id)
		.sort((a, b) => b.startTime - a.startTime)[0];
	assert.equal(sequence.cues.length, 3);
	const offset = clip.startTime - clip.trimStart;
	const startTicks = offset + 480000,
		endTicks = offset + 720000,
		startSeconds = startTicks / 120000;
	assert(startSeconds >= 4.9 && startSeconds <= 5.1);
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="' + clip.id + '"]')
		.click();
	await page
		.getByLabel("Transform", { exact: true })
		.locator("..")
		.getByLabel("Motion text", { exact: true })
		.click();
	const cue = page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.nth(2);
	if ((await cue.getAttribute("aria-expanded")) !== "true") await cue.click();
	const range = page.locator('[data-motion-text-cue-range="true"]');
	await expect(range).toHaveAttribute("data-range-start", String(startTicks));
	await expect(range).toHaveAttribute("data-range-end", String(endTicks));
	const clear = range.getByRole("button", {
		name: "Clear export range",
		exact: true,
	});
	if (await clear.isVisible()) await clear.click();
	await range
		.getByRole("button", { name: "Use cue as export range", exact: true })
		.click();
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		let rangedMask;
		for (const ranged of [true, false]) {
			onPhase(
				ranged
					? "same-project selected third-cue export with independently proven audio offset"
					: "same-project final multilingual full export",
			);
			await page.getByTestId("editor-menu-trigger").click();
			await page
				.getByRole("menuitem", { name: "Export project", exact: true })
				.click();
			const dialog = page.getByRole("dialog", {
				name: "Export project",
				exact: true,
			});
			if (ranged)
				await expect(
					dialog.getByText(
						startSeconds.toFixed(2) +
							"s – " +
							(endTicks / 120000).toFixed(2) +
							"s",
						{ exact: true },
					),
				).toBeVisible();
			else {
				await dialog
					.getByRole("button", { name: "Use full timeline", exact: true })
					.click();
				await expect(
					dialog.getByText("Full timeline", { exact: true }),
				).toBeVisible();
			}
			const output = await downloadUiExport(cdp, dialog, work);
			const { greenMask, ...verification } = await verifyLinkedRangeMedia({
				page: hostPage,
				output,
				ranged,
				startSeconds,
			});
			if (ranged) rangedMask = greenMask;
			else {
				verification.rangeFrameOverlap = languageOverlap({
					expected: greenMask,
					actual: rangedMask,
				});
				assert(
					verification.rangeFrameOverlap > 0.7,
					"range and full exports must show matching glyph geometry at the same source time",
				);
			}
			evidence.checks.push({
				name: ranged
					? "same-project cue range retains green lyrics, 60 frames, zero-based PTS and the late 880Hz audio source"
					: "final full project retains Chinese/English/approved green lyrics, 240 frames and both audio intervals",
				pass: true,
				...verification,
			});
		}
		const after = await read();
		assert.equal(after.id, before.id);
		for (const key of ["motionTextSequences", "scenes", "settings"])
			assert.deepEqual(after.data[key], before.data[key]);
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
	return page;
}
