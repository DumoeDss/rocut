import { join } from "node:path";
import { expect } from "@playwright/test";
import { createUiMaskFixture } from "./probe-mask-fixture.mjs";
import { verifyMaskExport } from "./probe-mask-media.mjs";
import {
	readShapePreview,
	verifyShapePixels,
	verifyShapeExport,
} from "./probe-mask-spatial.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

export async function probeMaskShapes({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	onPhase("shape masks real media import");
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
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		for (const [shape, area] of [
			["Rectangle", 0.16],
			["Ellipse", Math.PI * 0.04],
			["Diamond", 0.08],
		]) {
			onPhase(shape + " offset rotated mask authoring");
			await page
				.getByRole("button", { name: "Add mask", exact: true })
				.first()
				.click();
			await page.getByRole("menuitem", { name: shape, exact: true }).click();
			await expect
				.poll(async () => (await readClip()).masks?.[0]?.type)
				.toBe(shape.toLowerCase());
			for (const [name, value, key, expected] of [
				["Width", "40", "width", 0.4],
				["Height", "40", "height", 0.4],
				["X", "8", "centerX", 0.08],
				["Y", "-4", "centerY", -0.04],
				["Rotation", "35", "rotation", 35],
			]) {
				const input = page.getByRole("textbox", {
					name: "Mask " + name,
					exact: true,
				});
				await input.fill(value);
				await input.press("Enter");
				await expect
					.poll(async () => (await readClip()).masks[0].params[key])
					.toBe(expected);
			}
			const normal = await readClip();
			for (const inverted of [false, true]) {
				onPhase(shape + " spatial preview/export inverted=" + inverted);
				if (inverted)
					await page
						.getByLabel("Toggle " + shape + " mask inversion", { exact: true })
						.click();
				await expect
					.poll(async () => (await readClip()).masks[0].params.inverted)
					.toBe(inverted);
				const saved = await readClip();
				if (inverted) {
					// Command history is session-local; exercise it before reload.
					await hostPage.keyboard.press("Control+z");
					await expect.poll(readClip).toEqual(normal);
					await hostPage.keyboard.press("Control+Shift+z");
					await expect.poll(readClip).toEqual(saved);
				}
				await page.reload();
				await expect.poll(readClip).toEqual(saved);
				await select();
				await hostPage.keyboard.press("Escape");
				let preview;
				await expect
					.poll(
						async () => {
							try {
								preview = verifyShapePixels({
									pixels: await readShapePreview(page),
									channels: 4,
									shape,
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
					path: join(work, shape.toLowerCase() + "-" + inverted + ".png"),
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
						shape +
						" authored transform survives reload, preview and decoded UI export inverted=" +
						inverted,
					pass: true,
					preview,
					...verifyMaskExport(output, inverted ? 1 - area : area),
					spatial: verifyShapeExport({ file: output.path, shape, inverted }),
				});
			}
			await page
				.getByLabel("Remove " + shape + " mask", { exact: true })
				.click();
			await expect
				.poll(async () => (await readClip()).masks?.length ?? 0)
				.toBe(0);
		}
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
