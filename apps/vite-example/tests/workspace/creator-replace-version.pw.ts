import { expect, test, type Page } from "@playwright/test";

async function openProjectLibrary(page: Page) {
	await page.getByTestId("assets-tab-project-assets").click();
}

test.beforeEach(async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1");
	await expect(page.getByTestId("assets-tab-project-assets")).toBeVisible();
	await openProjectLibrary(page);
	await expect(page.getByTestId("creator-asset-card").first()).toBeVisible();
});

test("replace-version prepares a plan and confirms through the native dialog contract", async ({
	page,
}) => {
	await page.getByTestId("creator-asset-card").first().click();
	await expect(page.getByTestId("creator-asset-detail")).toBeVisible();
	await page.getByRole("button", { name: /替换已保存片段/ }).click();
	await page.getByLabel(/已注册目标/).fill("t-01");
	await page.getByLabel(/当前原生修订|回读中的当前原生修订/).fill("3");
	await page
		.getByTestId("creator-replace-prepare")
		.fill("existing-clip");
	await page.getByTestId("creator-replace-submit").click();
	await expect(
		page.getByRole("button", { name: "请求原生确认并替换" }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "请求原生确认并替换" })
		.click();
	await expect(page.getByTestId("creator-operation-status")).toContainText(
		/完成|替换/,
	);
	const commands = await page.evaluate(
		() =>
			(
				window as unknown as {
					__creatorWorkspaceFixture: { getCommands(): unknown[] };
				}
			).__creatorWorkspaceFixture.getCommands(),
	);
	expect(commands).toContainEqual(
		expect.objectContaining({ type: "asset.replace-version.prepare" }),
	);
	expect(commands).toContainEqual(
		expect.objectContaining({
			type: "asset.replace-version.confirm",
			planId: "fixture-replace-plan",
		}),
	);
	const prepare = commands.find(
		(command) =>
			(command as { type?: string }).type ===
			"asset.replace-version.prepare",
	) as { clipIds?: string[] };
	expect(prepare.clipIds).toContain("existing-clip");
});

test("locate-in-canvas sends the locate command when the host advertises it", async ({
	page,
}) => {
	await page.evaluate(() => {
		(
			window as unknown as {
				__creatorWorkspaceFixture: { enableLocateInCanvas(): void };
			}
		).__creatorWorkspaceFixture.enableLocateInCanvas();
	});
	await page.getByTestId("creator-asset-card").first().click();
	await expect(page.getByTestId("creator-locate-canvas")).toBeVisible();
	await page.getByTestId("creator-locate-canvas").click();
	await expect(page.getByTestId("creator-operation-status")).toContainText(
		"已在画布中定位",
	);
	const commands = await page.evaluate(
		() =>
			(
				window as unknown as {
					__creatorWorkspaceFixture: { getCommands(): unknown[] };
				}
			).__creatorWorkspaceFixture.getCommands(),
	);
	expect(commands).toContainEqual(
		expect.objectContaining({
			type: "context.locate-canvas",
			assetId: "character",
			versionId: "v1",
		}),
	);
});
