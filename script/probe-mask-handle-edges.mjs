import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function probeMaskHandleEdges({
	page,
	hostPage,
	evidence,
	onPhase,
	readClip,
	pointer,
	click,
	closed,
}) {
	onPhase("freeform deletion reopens an underspecified path");
	await click(0.25, 0.25);
	await hostPage.keyboard.press("Delete");
	await expect
		.poll(async () => (await readClip()).masks[0].params.path.length)
		.toBe(3);
	await expect
		.poll(async () => (await readClip()).masks[0].params.closed)
		.toBe(true);
	const triangle = await readClip();
	await click(0.75, 0.25);
	await hostPage.keyboard.press("Delete");
	await expect
		.poll(async () => (await readClip()).masks[0].params.path.length)
		.toBe(2);
	await expect
		.poll(async () => (await readClip()).masks[0].params.closed)
		.toBe(false);
	const opened = await readClip();
	await click(0.5, 0.25);
	await expect
		.poll(async () => (await readClip()).masks[0].params.path.length)
		.toBe(3);
	const appended = await readClip();
	await click(0.75, 0.75);
	await expect
		.poll(async () => (await readClip()).masks[0].params.closed)
		.toBe(true);
	for (const expected of [appended, opened, triangle, closed]) {
		await hostPage.keyboard.press("Control+z");
		await expect.poll(readClip).toEqual(expected);
	}
	evidence.checks.push({
		name: "deleting below three anchors reopens path, further drawing recloses it, four undos restore exact geometry",
		pass: true,
	});
	onPhase("text mask real-canvas measured snapping");
	await page.getByLabel("Remove Pen tool mask", { exact: true }).click();
	await page
		.getByRole("button", { name: "Add mask", exact: true })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Text", exact: true }).click();
	await expect
		.poll(async () => (await readClip()).masks?.[0]?.type)
		.toBe("text");
	for (const name of ["Mask X", "Mask Y"]) {
		await page.getByRole("textbox", { name, exact: true }).fill("1");
		await page.getByRole("textbox", { name, exact: true }).press("Enter");
	}
	await expect
		.poll(async () => (await readClip()).masks[0].params.centerX)
		.toBe(0.01);
	await expect
		.poll(async () => (await readClip()).masks[0].params.centerY)
		.toBe(0.01);
	const offset = await readClip();
	const from = await pointer(0.51, 0.51),
		to = await pointer(0.501, 0.501);
	await hostPage.mouse.move(from.x, from.y);
	await hostPage.mouse.down();
	let guides;
	try {
		await hostPage.mouse.move(to.x, to.y, { steps: 5 });
		const vertical = page.locator('[class~="bg-white/70"][class~="w-px"]');
		const horizontal = page.locator('[class~="bg-white/70"][class~="h-px"]');
		await expect(vertical).toHaveCount(1);
		await expect(horizontal).toHaveCount(1);
		const x = await vertical.boundingBox(),
			y = await horizontal.boundingBox();
		const center = await pointer(0.5, 0.5);
		assert(x && y);
		assert(
			Math.abs(x.x - center.x) < 1.5,
			"vertical snap guide must be on canvas center",
		);
		assert(
			Math.abs(y.y - center.y) < 1.5,
			"horizontal snap guide must be on canvas center",
		);
		guides = { verticalX: x.x, horizontalY: y.y, center };
	} finally {
		await hostPage.mouse.up();
	}
	await expect
		.poll(async () => (await readClip()).masks[0].params.centerX)
		.toBe(0);
	await expect
		.poll(async () => (await readClip()).masks[0].params.centerY)
		.toBe(0);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readClip).toEqual(offset);
	evidence.checks.push({
		name: "actual text mask movement measures browser font bounds and snaps to both center axes with undo",
		pass: true,
		guides,
	});
}
