import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { downloadUiExport } from "./probe-ui-export-fixture.mjs";
import { verifyMaskExport, verifyMaskPreview } from "./probe-mask-media.mjs";

export async function probeMaskControls({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	onPhase("mask controls real media import");
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
	await page.getByTestId("timeline-clip").click();
	await page.getByLabel("Masks", { exact: true }).click();
	await page
		.getByRole("button", { name: "Add mask", exact: true })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Rectangle", exact: true }).click();
	const readClip = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return record.data.scenes[0].tracks.main.elements[0];
		});
	await expect
		.poll(async () => (await readClip()).masks?.[0]?.type)
		.toBe("rectangle");
	onPhase("mask controls keyboard-accessible parameters");
	evidence.maskInputs = await page
		.locator("input:visible")
		.evaluateAll((elements) =>
			elements.map((el) => ({
				type: el.type,
				value: el.value,
				label: el.getAttribute("aria-label"),
				id: el.id,
			})),
		);
	for (const name of [
		"Mask X",
		"Mask Y",
		"Mask Width",
		"Mask Height",
		"Mask Rotation",
		"Mask Feather",
		"Mask Stroke width",
		"Mask stroke color",
	])
		await expect(page.getByRole("textbox", { name, exact: true })).toHaveCount(
			1,
		);
	const width = page.getByRole("textbox", { name: "Mask Width", exact: true });
	await width.fill("50");
	await width.press("Enter");
	await expect
		.poll(async () => (await readClip()).masks[0].params.width)
		.toBe(0.5);
	const height = page.getByRole("textbox", {
		name: "Mask Height",
		exact: true,
	});
	await height.fill("50");
	await height.press("Enter");
	await expect
		.poll(async () => (await readClip()).masks[0].params.height)
		.toBe(0.5);
	evidence.maskNormalArea = await verifyMaskPreview(page, 0.25);
	const before = await readClip();
	await page
		.getByLabel("Toggle Rectangle mask inversion", { exact: true })
		.click();
	await expect
		.poll(async () => (await readClip()).masks[0].params.inverted)
		.toBe(true);
	evidence.maskInvertedArea = await verifyMaskPreview(page, 0.75);
	await hostPage.keyboard.press("Control+z");
	await expect
		.poll(async () => (await readClip()).masks[0].params.inverted)
		.toBe(false);
	assert.deepEqual(await readClip(), before);
	evidence.checks.push({
		name: "mask parameters are labelled, commit numeric edits, and inversion supports undo",
		pass: true,
	});
	onPhase("mask export and reopened persistence");
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
		for (const inverted of [false, true]) {
			if (inverted)
				await page
					.getByLabel("Toggle Rectangle mask inversion", { exact: true })
					.click();
			await trigger.click();
			await page
				.getByRole("menuitem", { name: "Export project", exact: true })
				.click();
			const output = await downloadUiExport(cdp, dialog, work);
			await expect(dialog).toHaveCount(0);
			evidence.checks.push({
				name: "actual rectangle mask UI export inverted=" + inverted,
				pass: true,
				...verifyMaskExport(output, inverted ? 0.75 : 0.25),
			});
		}
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
	const inverted = await readClip();
	await page.reload();
	await expect.poll(readClip).toEqual(inverted);
	await verifyMaskPreview(page, 0.75);
	await page.getByTestId("timeline-clip").click();
	await page.getByLabel("Masks", { exact: true }).click();
	await page.getByLabel("Remove Rectangle mask", { exact: true }).click();
	await expect.poll(async () => (await readClip()).masks?.length ?? 0).toBe(0);
	await verifyMaskPreview(page, 1);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(inverted);
	await verifyMaskPreview(page, 0.75);
	await hostPage.screenshot({ path: join(work, "mask-inverted-restored.png") });
	evidence.checks.push({
		name: "masked preview and data survive reload; remove and undo restore the same mask",
		pass: true,
	});
	onPhase("text mask content editing");
	await page.getByLabel("Remove Rectangle mask", { exact: true }).click();
	await page
		.getByRole("button", { name: "Add mask", exact: true })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Text", exact: true }).click();
	await expect
		.poll(async () => (await readClip()).masks?.[0]?.type)
		.toBe("text");
	const textBefore = await readClip();
	await page
		.getByRole("textbox", { name: "Mask content", exact: true })
		.fill("UI MASK");
	await page
		.getByRole("textbox", { name: "Mask content", exact: true })
		.press("Tab");
	await expect
		.poll(async () => (await readClip()).masks[0].params.content)
		.toBe("UI MASK");
	await page.getByLabel("Masks", { exact: true }).click();
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(textBefore);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await readClip()).masks[0].params.content)
		.toBe("UI MASK");
	evidence.checks.push({
		name: "text mask content is labelled and supports durable edit undo redo",
		pass: true,
	});
}
