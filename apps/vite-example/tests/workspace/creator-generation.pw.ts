import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1");
	await page.getByTestId("assets-tab-project-assets").click();
	await expect(page.getByTestId("creator-generate-new")).toBeEnabled();
	await page.getByTestId("creator-generate-new").click();
	await expect(page.getByTestId("creator-new-asset-view")).toBeVisible();
});

test("new image generation sends fixed references without changing existing clips", async ({
	page,
}) => {
	const scenes = await page.evaluate(() =>
		window.__creatorWorkspaceFixture.getNativeScenes(),
	);
	const form = page.getByTestId("creator-new-asset-view");
	await expect(page.getByTestId("creator-new-asset-submit")).toBeDisabled();
	await form
		.getByRole("combobox", { name: "生成服务", exact: true })
		.selectOption("fixture-provider");
	await expect(
		form.getByRole("combobox", { name: "生成模型", exact: true }),
	).toHaveValue("fixture-model");
	await form.getByRole("checkbox", { name: "添加固定参考素材" }).check();
	await form
		.getByRole("listbox", { name: "参考图像", exact: true })
		.selectOption(JSON.stringify({ assetId: "character", versionId: "v2" }));
	await form
		.getByRole("textbox", { name: "生成提示词" })
		.fill("夜晚列车中的人物，近景构图");
	await page.getByTestId("creator-new-asset-submit").click();
	await expect(page.getByTestId("creator-operation-status")).toContainText(
		"生成任务已提交",
	);
	expect(
		await page.evaluate(() => window.__creatorWorkspaceFixture.getCommands()),
	).toContainEqual({
		type: "asset.generate",
		mediaType: "image",
		providerId: "fixture-provider",
		modelId: "fixture-model",
		prompt: "夜晚列车中的人物，近景构图",
		references: {
			referenceImages: [{ assetId: "character", versionId: "v2" }],
		},
	});
	await expect(form.getByRole("textbox", { name: "生成提示词" })).toHaveValue(
		"",
	);
	expect(
		await page.evaluate(() =>
			window.__creatorWorkspaceFixture.getNativeScenes(),
		),
	).toBe(scenes);
	expect(
		await page.evaluate(
			() =>
				window.__creatorWorkspaceFixture.getSnapshot().assets[0]
					.selectedVersionId,
		),
	).toBe("v1");
	await expect(page.getByTestId("timeline-toolbar")).toBeVisible();
	await page.screenshot({
		path: "tests/.workspace-output/generate-current.png",
	});
});

test("generation failure keeps the prompt and retry clears it only after acceptance", async ({
	page,
}) => {
	const form = page.getByTestId("creator-new-asset-view");
	await form
		.getByRole("combobox", { name: "生成服务", exact: true })
		.selectOption("fixture-provider");
	await form
		.getByRole("textbox", { name: "生成提示词" })
		.fill("保留这个生成草稿");
	await page.evaluate(() =>
		window.__creatorWorkspaceFixture.setGenerationFailure(true),
	);
	await page.getByTestId("creator-new-asset-submit").click();
	await expect(page.getByRole("alert")).toContainText("生成任务暂不可提交");
	await expect(form.getByRole("textbox", { name: "生成提示词" })).toHaveValue(
		"保留这个生成草稿",
	);
	await page.evaluate(() =>
		window.__creatorWorkspaceFixture.setGenerationFailure(false),
	);
	await page.getByTestId("creator-new-asset-submit").click();
	await expect(page.getByTestId("creator-operation-status")).toContainText(
		"生成任务已提交",
	);
	await expect(form.getByRole("textbox", { name: "生成提示词" })).toHaveValue(
		"",
	);
});

test("changing image to video resets model and references before submitting", async ({
	page,
}) => {
	const form = page.getByTestId("creator-new-asset-view");
	await form
		.getByRole("combobox", { name: "生成服务", exact: true })
		.selectOption("fixture-provider");
	await form.getByRole("checkbox", { name: "添加固定参考素材" }).check();
	await form
		.getByRole("textbox", { name: "生成提示词" })
		.fill("列车向前行驶，镜头缓慢推进");
	await form
		.getByRole("combobox", { name: "素材类型", exact: true })
		.selectOption("video");
	await expect(page.getByTestId("creator-new-asset-submit")).toBeDisabled();
	await expect(
		form.getByRole("checkbox", { name: "添加固定参考素材" }),
	).not.toBeChecked();
	await form
		.getByRole("combobox", { name: "生成服务", exact: true })
		.selectOption("fixture-provider");
	await page.getByTestId("creator-new-asset-submit").click();
	await expect(page.getByTestId("creator-operation-status")).toContainText(
		"生成任务已提交",
	);
	expect(
		await page.evaluate(() => window.__creatorWorkspaceFixture.getCommands()),
	).toContainEqual({
		type: "asset.generate",
		mediaType: "video",
		providerId: "fixture-provider",
		modelId: "fixture-model",
		prompt: "列车向前行驶，镜头缓慢推进",
	});
});

test("an older host disables creation and a failed catalog can be retried", async ({
	page,
}) => {
	const form = page.getByTestId("creator-new-asset-view");
	await page.evaluate(() =>
		window.__creatorWorkspaceFixture.setGenerationAvailable(false),
	);
	await expect(form.getByRole("status")).toContainText(
		"尚未提供新素材生成能力",
	);
	await expect(page.getByTestId("creator-new-asset-submit")).toBeDisabled();
	await expect(
		form.getByRole("textbox", { name: "生成提示词" }),
	).toBeDisabled();
	expect(
		await page.evaluate(() =>
			window.__creatorWorkspaceFixture
				.getCommands()
				.filter(
					(value) => (value as { type?: string }).type === "asset.generate",
				),
		),
	).toHaveLength(0);
	await page.evaluate(() => {
		window.__creatorWorkspaceFixture.setGenerationAvailable(true);
		window.__creatorWorkspaceFixture.setCatalogFailure(true);
	});
	await form
		.getByRole("combobox", { name: "素材类型", exact: true })
		.selectOption("video");
	await expect(
		form.getByRole("button", { name: "重试读取模型" }),
	).toBeVisible();
	await expect(page.getByTestId("creator-new-asset-submit")).toBeDisabled();
	await page.evaluate(() =>
		window.__creatorWorkspaceFixture.setCatalogFailure(false),
	);
	await form.getByRole("button", { name: "重试读取模型" }).click();
	await expect(
		form.getByRole("combobox", { name: "生成服务", exact: true }),
	).toBeVisible();
});
