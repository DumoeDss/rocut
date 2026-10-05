import { expect } from "@playwright/test";

export async function probeMaskProperties({
	page,
	hostPage,
	evidence,
	onPhase,
	readClip,
}) {
	onPhase("mask stroke color and alignment editing");
	const before = await readClip();
	const color = page.getByRole("textbox", {
		name: "Mask stroke color",
		exact: true,
	});
	await color.fill("00FF00");
	await color.press("Enter");
	await expect
		.poll(async () =>
			(await readClip()).masks[0].params.strokeColor.toUpperCase(),
		)
		.toBe("#00FF00");
	await page.getByLabel("Masks", { exact: true }).click();
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(before);
	await hostPage.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () =>
			(await readClip()).masks[0].params.strokeColor.toUpperCase(),
		)
		.toBe("#00FF00");
	await page
		.getByRole("combobox", { name: "Mask stroke alignment", exact: true })
		.click();
	await page.getByRole("option", { name: "Outside", exact: true }).click();
	await expect
		.poll(async () => (await readClip()).masks[0].params.strokeAlign)
		.toBe("outside");
	const stroke = await readClip();
	await page.reload();
	await expect.poll(readClip).toEqual(stroke);
	await page.getByTestId("timeline-clip").click();
	await page.getByLabel("Masks", { exact: true }).click();
	await expect(color).toHaveValue("00FF00");
	await expect(
		page.getByRole("combobox", { name: "Mask stroke alignment", exact: true }),
	).toHaveText("Outside");
	await page
		.getByRole("button", { name: "Choose Mask stroke color", exact: true })
		.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await hostPage.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Choose Mask stroke color", exact: true }),
	).toBeFocused();
	evidence.checks.push({
		name: "mask color commits once with history and survives reload with alignment; chooser restores keyboard focus",
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
