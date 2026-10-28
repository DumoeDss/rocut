import { expect, test } from "@playwright/test";

test("compact resizing reopens without overwriting wide preferences", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewportSize({ width: 900, height: 768 });
	await page.goto("/?creator-workspace-harness=1");
	await page.getByRole("button", { name: "展开属性", exact: true }).click();
	const panels = page.getByTestId("editor-main-panels");
	const assets = page.locator('[data-panel-id="editor-assets"]');
	const assetWidth = () =>
		assets.evaluate((node) => node.getBoundingClientRect().width);
	const persisted = () =>
		page.evaluate(() => localStorage.getItem("panel-sizes"));
	await expect(panels).toHaveAttribute("data-layout", "compact");
	const before = await assetWidth();
	await page.getByTestId("editor-resize-assets").press("ArrowRight");
	await expect.poll(assetWidth).toBeGreaterThan(before + 5);
	await expect.poll(persisted).toContain('"compactLayout":[');
	const compactWidth = await assetWidth();
	const preference = await persisted();

	await page.setViewportSize({ width: 1366, height: 768 });
	await expect(panels).toHaveAttribute("data-layout", "wide");
	await expect.poll(persisted).toBe(preference);
	await page.setViewportSize({ width: 900, height: 768 });
	await expect(panels).toHaveAttribute("data-layout", "compact");
	await expect
		.poll(async () => Math.abs((await assetWidth()) - compactWidth))
		.toBeLessThan(1);
	await page.reload();
	await expect(panels).toHaveAttribute("data-layout", "compact");
	await expect
		.poll(async () => Math.abs((await assetWidth()) - compactWidth))
		.toBeLessThan(1);
	await expect.poll(persisted).toBe(preference);

	await page.getByTestId("editor-layout-preview-first").click();
	await expect.poll(persisted).toContain('"compactLayout":[20,60,20]');
	const presetWidth = await assetWidth();
	await page.reload();
	await expect(panels).toHaveAttribute("data-layout", "compact");
	await expect
		.poll(async () => Math.abs((await assetWidth()) - presetWidth))
		.toBeLessThan(1);
	await page.getByTestId("editor-layout-reset").click();
	await page.getByRole("button", { name: "展开属性", exact: true }).click();
	await expect.poll(persisted).toContain('"compactLayout":null');
	await page.reload();
	await expect(panels).toHaveAttribute("data-layout", "compact");
	await expect
		.poll(async () => Math.abs((await assetWidth()) - before))
		.toBeLessThan(1);
	expect(errors).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("compact-reset.png") });
});
