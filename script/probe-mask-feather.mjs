import { join } from "node:path";
import { expect } from "@playwright/test";
import { createUiMaskFixture } from "./probe-mask-fixture.mjs";
import { readShapePreview } from "./probe-mask-spatial.mjs";
import {
	featherSamples,
	checkFeatherExport,
} from "./probe-mask-feather-media.mjs";
import { verifyMaskExport } from "./probe-mask-media.mjs";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";

export async function probeMaskFeather({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	onPhase("feather masks actual import");
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
	const set = async (name, value, key, expected) => {
		const input = page.getByRole("textbox", {
			name: "Mask " + name,
			exact: true,
		});
		await input.fill(String(value));
		await input.press("Enter");
		await expect
			.poll(async () => (await readClip()).masks[0].params[key])
			.toBe(expected);
	};
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		for (const shape of ["Split", "Rectangle"]) {
			await page
				.getByRole("button", { name: "Add mask", exact: true })
				.first()
				.click();
			await page.getByRole("menuitem", { name: shape, exact: true }).click();
			await expect
				.poll(async () => (await readClip()).masks?.[0]?.type)
				.toBe(shape.toLowerCase());
			if (shape === "Rectangle") {
				await set("Width", 50, "width", 0.5);
				await set("Height", 50, "height", 0.5);
			}
			await set(
				"Feather",
				// UI percentage maps 0..100 to the stored 0..1000px range.
				shape === "Split" ? 40 : 20,
				"feather",
				shape === "Split" ? 400 : 200,
			);
			for (const rotation of shape === "Split" ? [0, 90] : [0]) {
				await set("Rotation", rotation, "rotation", rotation);
				for (const inverted of [false, true]) {
					onPhase(
						shape + " feather rotation=" + rotation + " inverted=" + inverted,
					);
					if ((await readClip()).masks[0].params.inverted !== inverted)
						await page
							.getByLabel("Toggle " + shape + " mask inversion", {
								exact: true,
							})
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
									preview = featherSamples({
										pixels: await readShapePreview(page),
										channels: 4,
										shape,
										rotation,
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
						path: join(
							work,
							shape.toLowerCase() +
								"-feather-" +
								rotation +
								"-" +
								inverted +
								".png",
						),
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
					const area = shape === "Split" ? 0.5 : 0.25;
					evidence.checks.push({
						name:
							shape +
							" feather gradient survives reload and actual export rotation=" +
							rotation +
							" inverted=" +
							inverted,
						pass: true,
						preview,
						...verifyMaskExport(output, inverted ? 1 - area : area),
						gradients: checkFeatherExport({
							file: output.path,
							shape,
							rotation,
							inverted,
							preview,
						}),
					});
				}
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
