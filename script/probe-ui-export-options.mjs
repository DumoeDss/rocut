import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	createUiExportFixture,
	downloadUiExport,
} from "./probe-ui-export-fixture.mjs";
import { verifyUiExportOptions } from "./probe-ui-export-options-media.mjs";
import { probeUiExportAccessibility } from "./probe-ui-export-accessibility.mjs";

export async function probeUiExportOptions({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	onPhase("export options actual UI fixture");
	await createUiExportFixture({ page, work });
	await probeUiExportAccessibility({ page, hostPage, work, evidence, onPhase });
	const readRecord = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	const initial = (await readRecord()).data;
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
		for (const format of ["webm", "mp4"])
			for (const [quality, label] of [
				["low", "Low - Smallest file size"],
				["medium", "Medium - Balanced"],
				["high", "High - Recommended"],
				["very_high", "Very high - Largest file size"],
			])
				for (const includeAudio of [true, false]) {
					const id =
						format + "-" + quality + "-" + (includeAudio ? "audio" : "silent");
					onPhase("actual UI export options " + id);
					await trigger.click();
					await page
						.getByRole("menuitem", { name: "Export project", exact: true })
						.click();
					await expect(dialog).toBeVisible();
					await dialog
						.getByRole("button", { name: "Format", exact: true })
						.click();
					await dialog
						.getByRole("radio", {
							name:
								format === "webm"
									? "WebM (VP9) - Smaller file size"
									: "MP4 (H.264) - Better compatibility",
							exact: true,
						})
						.check();
					await dialog
						.getByRole("button", { name: "Quality", exact: true })
						.click();
					await dialog.getByRole("radio", { name: label, exact: true }).check();
					await dialog
						.getByRole("button", { name: "Audio", exact: true })
						.click();
					await dialog
						.getByRole("checkbox", {
							name: "Include audio in export",
							exact: true,
						})
						.setChecked(includeAudio);
					if (quality === "high" && includeAudio)
						await hostPage.screenshot({
							path: join(work, id + "-options.png"),
						});
					const output = await downloadUiExport(cdp, dialog, work);
					await expect(dialog).toHaveCount(0);
					await expect(trigger).toBeFocused();
					evidence.checks.push({
						name: "actual format/quality/audio UI export " + id,
						pass: true,
						...verifyUiExportOptions(output, { format, includeAudio }),
					});
					const current = (await readRecord()).data;
					assert.deepEqual(
						current.settings,
						initial.settings,
						"export options must not change project settings",
					);
					assert.deepEqual(
						current.scenes,
						initial.scenes,
						"export options must not edit timeline contents",
					);
				}
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
