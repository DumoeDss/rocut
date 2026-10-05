import { join } from "node:path";
import { expect } from "@playwright/test";
import { createUiMaskFixture } from "./probe-mask-fixture.mjs";
import { readShapePreview } from "./probe-mask-spatial.mjs";
import {
	verifyStrokePixels,
	verifyStrokeExport,
	strokeRedArea,
} from "./probe-mask-stroke-media.mjs";
import { verifyMaskExport } from "./probe-mask-media.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

export async function probeMaskStroke({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	onPhase("stroke mask actual import");
	await createUiMaskFixture({ page, work });
	const readClip = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return record.data.scenes[0].tracks.main.elements[0];
		});
	const select = async () => {
		await page.getByTestId("timeline-clip").click();
		await page.getByLabel("Masks", { exact: true }).click();
	};
	await page
		.getByRole("button", { name: "Add mask", exact: true })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Rectangle", exact: true }).click();
	for (const [name, value, key, expected] of [
		["Width", "50", "width", 0.5],
		["Height", "50", "height", 0.5],
		["Stroke width", "100", "strokeWidth", 100],
		["stroke color", "00FF00", "strokeColor", "#00FF00"],
	]) {
		const input = page.getByRole("textbox", {
			name: "Mask " + name,
			exact: true,
		});
		await input.fill(value);
		await input.press("Enter");
		await expect
			.poll(async () => {
				const val = (await readClip()).masks[0].params[key];
				return typeof val === "string" ? val.toUpperCase() : val;
			})
			.toBe(expected);
	}
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		for (const align of ["inside", "center", "outside"]) {
			await page
				.getByRole("combobox", { name: "Mask stroke alignment", exact: true })
				.click();
			await page
				.getByRole("option", {
					name: align[0].toUpperCase() + align.slice(1),
					exact: true,
				})
				.click();
			await expect
				.poll(async () => (await readClip()).masks[0].params.strokeAlign)
				.toBe(align);
			for (const inverted of [false, true]) {
				onPhase("rectangle stroke " + align + " inverted=" + inverted);
				if ((await readClip()).masks[0].params.inverted !== inverted)
					await page
						.getByLabel("Toggle Rectangle mask inversion", { exact: true })
						.click();
				await expect
					.poll(async () => (await readClip()).masks[0].params.inverted)
					.toBe(inverted);
				const saved = await readClip();
				await page.reload();
				await expect.poll(readClip).toEqual(saved);
				await select();
				await hostPage.keyboard.press("Escape");
				let preview;
				await expect
					.poll(
						async () => {
							try {
								preview = verifyStrokePixels({
									pixels: await readShapePreview(page),
									channels: 4,
									align,
									inverted,
								});
								return null;
							} catch (error) {
								return error.message;
							}
						},
						{ timeout: 15000 },
					)
					.toBeNull();
				await hostPage.screenshot({
					path: join(work, "stroke-" + align + "-" + inverted + ".png"),
				});
				await select();
				await page.getByTestId("editor-menu-trigger").click();
				await page
					.getByRole("menuitem", { name: "Export project", exact: true })
					.click();
				const output = await downloadUiExport(
					cdp,
					page.getByRole("dialog", { name: "Export project", exact: true }),
					work,
				);
				evidence.checks.push({
					name:
						"rectangle stroke " +
						align +
						" persists and renders accurately inverted=" +
						inverted,
					pass: true,
					preview,
					...verifyMaskExport(output, strokeRedArea({ align, inverted })),
					spatial: verifyStrokeExport({ file: output.path, align, inverted }),
				});
			}
		}
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
