import { expect, test } from "@playwright/test";

test("reverse capability gates the control and reverses real filmstrip samples", async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1");
	await page.getByTestId("assets-tab-plans").click();
	await expect(page.getByRole("button", { name: "A 制作计划" })).toBeVisible();
	await page.evaluate(async () => { await window.__creatorWorkspaceFixture.loadNativeFixtures(); await window.__creatorWorkspaceFixture.insertNativeVideo(); });
	await page.getByRole("button", { name: "速度", exact: true }).click();
	const control = page.getByTestId("video-reverse");
	if (!await page.evaluate(() => window.__creatorWorkspaceFixture.reverseSupport())) {
		await expect(control).toBeDisabled();
		await expect(page.getByText("当前媒体引擎不支持倒放，请升级编辑器媒体引擎后重试。", { exact: true })).toBeVisible();
		return;
	}
	for (let index = 0; index < 8; index++) await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
	const frames = page.getByTestId("video-filmstrip-frame");
	await expect.poll(() => frames.count()).toBeGreaterThan(1);
	const before = await frames.evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.sourceTime)));
	expect(before[0]).toBeLessThan(before.at(-1)!);
	await control.click();
	await expect.poll(() => frames.first().getAttribute("data-source-time")).not.toBe(String(before[0]));
	const after = await frames.evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.sourceTime)));
	expect(after[0]).toBeGreaterThan(after.at(-1)!);
	await expect.poll(() => frames.locator("img").count()).toBe(after.length);
	const mapped = await page.evaluate(() => window.__creatorWorkspaceFixture.reverseFrameProbe());
	expect(mapped.sourceTime).toBe(mapped.expected - 1);
	expect(mapped.freezeTime).toBe(mapped.sourceTime);
	await page.screenshot({ path: "tests/.workspace-output/reverse-current.png" });
});
