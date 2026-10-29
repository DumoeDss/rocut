import { expect, test } from "@playwright/test";

test("visible unimported videos acquire covers automatically and the detail view reuses them", async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1&poster-fixture=1");
	await page.getByTestId("assets-tab-project-assets").click();
	await expect(page.getByTestId("creator-asset-poster")).toHaveCount(2);
	const before = await page.evaluate(() => window.__creatorWorkspaceFixture.getNativeScenes());
	await page.getByTestId("creator-asset-card").filter({ hasText: "Video 0" }).click();
	await expect(page.getByTestId("creator-asset-detail").locator("video")).toHaveAttribute("poster", /data:image/);
	const commands = await page.evaluate(() => window.__creatorWorkspaceFixture.getCommands());
	expect(commands).toEqual([0, 1].map((index) => ({ type: "asset.ensure-poster", projectId: "A", assetId: `poster-video-${index}`, versionId: "video-v1", sha256: "a".repeat(64) })));
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getNativeScenes())).toBe(before);
});

test("a failed automatic cover remains retryable from the detail view", async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1&poster-fixture=1&poster-failure=1");
	await page.getByTestId("assets-tab-project-assets").click();
	const card = page.getByTestId("creator-asset-card").filter({ hasText: "Video 0" });
	await expect(card).toContainText("视频封面暂不可用");
	await card.click();
	await expect(page.getByTestId("creator-poster-retry")).toBeVisible();
	await page.evaluate(() => (window.__creatorWorkspaceFixture as unknown as { setPosterFailure(value: boolean): void }).setPosterFailure(false));
	await page.getByTestId("creator-poster-retry").click();
	await expect(page.getByTestId("creator-asset-detail").locator("video")).toHaveAttribute("poster", /data:image/);
	await expect(card.getByTestId("creator-asset-poster")).toHaveCount(1);
	const commands = await page.evaluate(() => window.__creatorWorkspaceFixture.getCommands());
	expect(commands.filter((command) => (command as { assetId: string }).assetId === "poster-video-0")).toHaveLength(2);
	expect(commands.every((command) => (command as { type: string }).type === "asset.ensure-poster")).toBe(true);
});
