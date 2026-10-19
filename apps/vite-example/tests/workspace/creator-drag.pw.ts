import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1");
	await expect(page.getByTestId("assets-tab-project-assets")).toBeVisible();
	await page.getByTestId("assets-tab-project-assets").click();
	await expect(page.getByTestId("creator-asset-card").first()).toBeVisible();
});

test("one action clears query, media type and used filters", async ({
	page,
}) => {
	await page.getByRole("searchbox", { name: "搜索项目素材" }).fill("角色");
	await page
		.getByRole("combobox", { name: "素材类型", exact: true })
		.selectOption("audio");
	await page.getByRole("checkbox", { name: "已使用", exact: true }).check();
	await expect(page.getByTestId("creator-asset-card")).toHaveCount(0);
	await page.getByTestId("creator-clear-filters").click();
	await expect(
		page.getByRole("searchbox", { name: "搜索项目素材" }),
	).toHaveValue("");
	await expect(
		page.getByRole("combobox", { name: "素材类型", exact: true }),
	).toHaveValue("all");
	await expect(
		page.getByRole("checkbox", { name: "已使用", exact: true }),
	).not.toBeChecked();
	await expect(page.getByTestId("creator-asset-card")).toHaveCount(2);
});

for (const stale of [false, true]) {
	test(
		stale
			? "changed source hash rejects the drop"
			: "card drop sends the pinned version through formal placement",
		async ({ page }) => {
			await page.evaluate(() =>
				(
					window as unknown as {
						__creatorWorkspaceFixture: { enablePlacement(): void };
					}
				).__creatorWorkspaceFixture.enablePlacement(),
			);
			const card = page
				.getByTestId("creator-asset-card")
				.filter({ hasText: "角色设定" });
			await expect(card).toHaveAttribute("draggable", "true");
			const before = await page.evaluate(() =>
				window.__creatorWorkspaceFixture.getNativeScenes(),
			);
			const transfer = await page.evaluateHandle(() => new DataTransfer());
			await card.dispatchEvent("dragstart", { dataTransfer: transfer });
			await page.evaluate(
				(changeHash) =>
					(
						window as unknown as {
							__creatorWorkspaceFixture: {
								changeDraggedVersion(value: boolean): void;
							};
						}
					).__creatorWorkspaceFixture.changeDraggedVersion(changeHash),
				stale,
			);
			const timeline = page.getByTestId("timeline-toolbar").locator("..");
			const box = await timeline.boundingBox();
			if (!box) throw new Error("Timeline unavailable");
			const position = {
				clientX: box.x + 360,
				clientY: box.y + box.height - 15,
				dataTransfer: transfer,
			};
			await timeline.dispatchEvent("dragenter", position);
			await timeline.dispatchEvent("dragover", position);
			await timeline.dispatchEvent("drop", position);
			await card.dispatchEvent("dragend", { dataTransfer: transfer });
			if (stale) {
				await expect(
					page.getByText("拖动素材已失效或项目已切换，请重新拖动"),
				).toBeVisible();
				expect(
					await page.evaluate(() =>
						window.__creatorWorkspaceFixture
							.getCommands()
							.filter(
								(command) =>
									(command as { type?: string }).type === "asset.place-version",
							),
					),
				).toHaveLength(0);
			} else {
				await expect
					.poll(() =>
						page.evaluate(() =>
							window.__creatorWorkspaceFixture
								.getCommands()
								.filter(
									(command) =>
										(command as { type?: string }).type ===
										"asset.place-version",
								),
						),
					)
					.toEqual([
						expect.objectContaining({
							type: "asset.place-version",
							assetId: "character",
							versionId: "v1",
							expectedSha256: "a".repeat(64),
							native: expect.objectContaining({
								projectId: "workspace-fixture",
								placement: expect.objectContaining({
									startTime: expect.any(Number),
									newTrack: { type: "video", index: expect.any(Number) },
								}),
							}),
						}),
					]);
			}
			expect(
				await page.evaluate(() =>
					window.__creatorWorkspaceFixture.getNativeScenes(),
				),
			).toBe(before);
		},
	);
}

