import { expect, test } from "@playwright/test";

declare global {
	interface Window {
		__creatorWorkspaceFixture: {
			getPlayhead(): number;
			getIsPlaying(): boolean;
			seekPlayhead(): void;
			setDocumentConflict(value: boolean): void;
			updateDocumentFromOutside(content: string, revision: string): void;
			setSaveFailure(value: boolean): void;
			getNativeScenes(): string;
			getSnapshot(): { assets: { selectedVersionId?: string; usages?: { versionId: string }[] }[] };
			changeBridge(): void;
			markDirty(): void;
			getTimelineView(): { zoomLevel: number; scrollLeft: number } | undefined;
			getCommands(): unknown[];
			setCatalogFailure(value: boolean): void;
			setAudioFailure(value: boolean): void;
			setGenerationFailure(value: boolean): void;
			setGenerationAvailable(value: boolean): void;
			loadNativeFixtures(): Promise<void>;
			sampleNativeFrames(): Promise<string[]>;
			previewFailureThenRecover(): Promise<{ failed: string; recovered: string }>;
			broadcastSnapshot(revision: string, title: string, projectId?: string): void;
			insertNativeVideo(): Promise<void>;
			reverseSupport(): boolean;
			reverseFrameProbe(): Promise<{ sourceTime: number; freezeTime: number; expected: number }>;
		};
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1");
	await expect(page.getByRole("button", { name: "A 制作计划" })).toBeVisible();
});

test("document conflict preserves the draft and a successful retry updates the reader", async ({ page }) => {
	await page.getByRole("button", { name: "A 制作计划" }).click();
	await page.getByRole("button", { name: "编辑文档", exact: true }).click();
	await page.getByRole("textbox", { name: "文档内容" }).fill("保存前仍保留的草稿");
	await page.evaluate(() => window.__creatorWorkspaceFixture.setDocumentConflict(true));
	await page.getByRole("button", { name: "保存文档", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("文档已被更新");
	await expect(page.getByRole("textbox", { name: "文档内容" })).toHaveValue("保存前仍保留的草稿");
	await expect(page.locator("[data-panel-id='editor-preview']")).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.setDocumentConflict(false));
	await page.getByRole("button", { name: "保存文档", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "文档内容" })).toHaveCount(0);
	await expect(page.locator(".creator-document")).toContainText("保存前仍保留的草稿");
	await expect(page.getByTestId("timeline-toolbar")).toBeVisible();
	await page.screenshot({ path: "tests/.workspace-output/document.png" });
});

test("an external document update cannot move the revision of an existing draft", async ({ page }) => {
	await page.getByRole("button", { name: "A 制作计划" }).click();
	await page.getByRole("button", { name: "编辑文档", exact: true }).click();
	await page.getByRole("textbox", { name: "文档内容" }).fill("我仍在编辑的本地草稿");
	await page.evaluate(() => window.__creatorWorkspaceFixture.updateDocumentFromOutside("其他视图保存的新正文", "2:external-hash"));
	await expect(page.getByTestId("creator-document-updated")).toBeVisible();
	await page.getByTestId("creator-document-save").click();
	await expect(page.getByRole("alert")).toContainText("文档已被更新");
	await expect(page.getByRole("textbox", { name: "文档内容" })).toHaveValue("我仍在编辑的本地草稿");
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getCommands())).toContainEqual({ type: "document.save", documentId: "plan", content: "我仍在编辑的本地草稿", revision: "1:hash" });
	await page.getByRole("button", { name: "取消", exact: true }).click();
	await expect(page.getByTestId("creator-document-view")).toContainText("其他视图保存的新正文");
	await page.getByRole("button", { name: "编辑文档", exact: true }).click();
	await page.getByRole("textbox", { name: "文档内容" }).fill("基于最新正文继续编辑");
	await page.getByTestId("creator-document-save").click();
	await expect(page.getByRole("textbox", { name: "文档内容" })).toHaveCount(0);
	await expect(page.getByTestId("creator-document-view")).toContainText("基于最新正文继续编辑");
});

test("preview and selecting a candidate keep native clips and their pinned version", async ({ page }) => {
	const nativeBefore = await page.evaluate(() => window.__creatorWorkspaceFixture.getNativeScenes());
	await page.locator(".creator-project-card").filter({ hasText: "角色设定" }).click();
	await page.getByRole("button", { name: "V2", exact: true }).click();
	await expect(page.getByRole("button", { name: "选用此版本" })).toBeEnabled();
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getSnapshot().assets[0].selectedVersionId)).toBe("v1");
	await page.getByRole("button", { name: "选用此版本" }).click();
	await expect(page.getByTestId("creator-operation-status")).toContainText("操作已完成");
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getSnapshot().assets[0].selectedVersionId)).toBe("v2");
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getSnapshot().assets[0].usages?.[0].versionId)).toBe("v1");
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getNativeScenes())).toBe(nativeBefore);
	await page.screenshot({ path: "tests/.workspace-output/asset.png" });
});

test("a replaced bridge ignores late project data", async ({ page }) => {
	await page.evaluate(() => window.__creatorWorkspaceFixture.changeBridge());
	await expect(page.getByRole("button", { name: "B 制作计划" })).toBeVisible();
	await page.waitForTimeout(350);
	await expect(page.getByRole("button", { name: "Late A 制作计划" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "B 制作计划" })).toBeVisible();
});

test("older broadcasts cannot regress a current project snapshot", async ({ page }) => {
	await page.evaluate(() => window.__creatorWorkspaceFixture.broadcastSnapshot("5", "最新计划"));
	await expect(page.getByRole("button", { name: "最新计划", exact: true })).toBeVisible();
	await page.evaluate(() => { window.__creatorWorkspaceFixture.broadcastSnapshot("3", "旧计划"); window.__creatorWorkspaceFixture.broadcastSnapshot("6", "其他项目", "other"); });
	await expect(page.getByRole("button", { name: "最新计划", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "旧计划", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "其他项目", exact: true })).toHaveCount(0);
});

test("new view fits initially and layout presets change the editing space", async ({ page }) => {
	await expect.poll(() => page.evaluate(() => window.__creatorWorkspaceFixture.getTimelineView()?.zoomLevel ?? 0)).toBeGreaterThan(0);
	await page.getByRole("button", { name: "预览优先", exact: true }).click();
	const previewHeight = await page.getByTestId("timeline-toolbar").evaluate((node) => node.parentElement!.getBoundingClientRect().height);
	await page.getByRole("button", { name: "剪辑优先", exact: true }).click();
	await expect.poll(() => page.getByTestId("timeline-toolbar").evaluate((node) => node.parentElement!.getBoundingClientRect().height)).toBeGreaterThan(previewHeight + 50);
	await page.getByRole("button", { name: "恢复布局", exact: true }).click();
	await expect(page.getByRole("button", { name: "收起属性", exact: true })).toBeVisible();
	await page.screenshot({ path: "tests/.workspace-output/layout-current.png" });
});

test("text input owns deletion and cut keys instead of the selected clip", async ({ page }) => {
	await page.evaluate(async () => { await window.__creatorWorkspaceFixture.loadNativeFixtures(); await window.__creatorWorkspaceFixture.insertNativeVideo(); });
	const scenes = await page.evaluate(() => window.__creatorWorkspaceFixture.getNativeScenes());
	await page.getByRole("button", { name: "A 制作计划", exact: true }).click();
	await page.getByRole("button", { name: "编辑文档", exact: true }).click();
	const content = page.getByRole("textbox", { name: "文档内容" });
	await content.fill("abcdef"); await content.press("Backspace"); await content.press("Delete"); await content.press("Control+x");
	const search = page.getByRole("searchbox", { name: "搜索项目素材" });
	await search.fill("abcdef"); await search.press("Backspace"); await search.press("Delete"); await search.press("Control+x");
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.getNativeScenes())).toBe(scenes);
});

test("automatic save failure remains visible and timeline fit persists view state", async ({ page }) => {
	await page.evaluate(() => { window.__creatorWorkspaceFixture.setSaveFailure(true); window.__creatorWorkspaceFixture.markDirty(); });
	await expect(page.getByTestId("project-save")).toHaveAttribute("data-save-state", "failed");
	await expect(page.getByTestId("project-operation-error")).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.setSaveFailure(false));
	await page.getByTestId("project-save").click();
	await expect(page.getByTestId("project-save")).toHaveAttribute("data-save-state", "saved");
	await expect(page.getByTestId("timeline-fit-selection")).toBeDisabled();
	await page.getByTestId("timeline-fit-project").click();
	await expect.poll(() => page.evaluate(() => window.__creatorWorkspaceFixture.getTimelineView()?.zoomLevel ?? 0)).toBeGreaterThan(0);
});

test("host catalog and bounded audio summary drive real controls", async ({ page }) => {
	await expect(page.getByRole("img", { name: "音频波形" })).toBeVisible();
	await page.locator(".creator-project-card").filter({ hasText: "角色设定" }).click();
	await page.getByRole("button", { name: "重新生成", exact: true }).click();
	await page.getByRole("combobox", { name: "生成服务", exact: true }).selectOption("fixture-provider");
	await page.getByRole("combobox", { name: "生成模型", exact: true }).selectOption("fixture-model");
	await page.getByRole("checkbox", { name: "重新指定参考素材（留空将清除原参考）" }).check();
	await page.getByRole("listbox", { name: "参考图像", exact: true }).selectOption(JSON.stringify({ assetId: "character", versionId: "v2" }));
	await page.getByRole("button", { name: "提交生成任务" }).click();
	await expect.poll(() => page.evaluate(() => window.__creatorWorkspaceFixture.getCommands())).toContainEqual({ type: "asset.regenerate", assetId: "character", versionId: "v1", prompt: "角色参考图", providerId: "fixture-provider", modelId: "fixture-model", references: { referenceImages: [{ assetId: "character", versionId: "v2" }] } });
});

test("catalog failure retries and scoped replacement removes old controls", async ({ page }) => {
	await page.evaluate(() => window.__creatorWorkspaceFixture.setCatalogFailure(true));
	await page.locator(".creator-project-card").filter({ hasText: "角色设定" }).click();
	await page.getByRole("button", { name: "重新生成", exact: true }).click();
	await expect(page.getByRole("button", { name: "重试读取模型" })).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.setCatalogFailure(false));
	await page.getByRole("button", { name: "重试读取模型" }).click();
	await expect(page.getByRole("combobox", { name: "生成服务", exact: true })).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.changeBridge());
	await expect(page.getByRole("button", { name: "B 制作计划" })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "生成服务", exact: true })).toHaveCount(0);
});

test("audio derivative failure can retry without downloading source media", async ({ page }) => {
	await page.getByRole("combobox", { name: "素材类型", exact: true }).selectOption("image");
	await page.evaluate(() => window.__creatorWorkspaceFixture.setAudioFailure(true));
	await page.evaluate(() => window.__creatorWorkspaceFixture.changeBridge());
	await expect(page.getByRole("button", { name: "B 制作计划" })).toBeVisible();
	await page.getByRole("combobox", { name: "素材类型", exact: true }).selectOption("audio");
	await expect(page.getByText("音频摘要暂不可用", { exact: true })).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.setAudioFailure(false));
	await page.getByRole("button", { name: "重试素材预览" }).click();
	await expect(page.getByRole("img", { name: "音频波形" })).toBeVisible();
});

test("native short media derives a real poster, distinct samples and waveform", async ({ page }) => {
	await page.evaluate(() => window.__creatorWorkspaceFixture.loadNativeFixtures());
	await page.locator(".creator-native-library summary").click();
	const video = page.getByTestId("native-media-card").filter({ hasText: "short-motion.mp4" });
	await expect(video.locator("img")).toBeVisible();
	await expect.poll(() => video.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
	const audio = page.getByTestId("native-media-card").filter({ hasText: "tone.wav" });
	await expect.poll(() => audio.locator("svg[role='img'] path").count()).toBeGreaterThan(1);
	await video.click();
	await expect(page.getByTestId("native-asset-viewer")).toHaveCount(0);
	await video.dblclick();
	await expect(page.getByTestId("native-asset-viewer")).toBeVisible();
	const samples = await page.evaluate(() => window.__creatorWorkspaceFixture.sampleNativeFrames());
	expect(samples).toHaveLength(2); expect(samples[0]).not.toBe(samples[1]); expect(samples.every((sample) => sample.length > 30)).toBe(true);
	expect(await page.evaluate(() => window.__creatorWorkspaceFixture.previewFailureThenRecover())).toEqual({ failed: "failed", recovered: "ready" });
	await page.screenshot({ path: "tests/.workspace-output/native-current.png" });
});

test("filters, saved collapse, reset, narrow focus and save retry remain usable", async ({ page }) => {
	await page.getByRole("searchbox", { name: "搜索项目素材" }).fill("角色");
	await expect(page.locator(".creator-project-card")).toHaveCount(1);
	await page.getByRole("searchbox", { name: "搜索项目素材" }).fill("");
	await page.getByRole("combobox", { name: "素材类型", exact: true }).selectOption("audio");
	await expect(page.locator(".creator-project-card")).toHaveCount(1);
	await page.getByRole("checkbox", { name: "已使用", exact: true }).check();
	await expect(page.locator(".creator-project-card")).toHaveCount(0);
	await page.getByRole("button", { name: "收起属性", exact: true }).click();
	await expect(page.getByRole("button", { name: "展开属性", exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("button", { name: "展开属性", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "恢复布局", exact: true }).click();
	await expect(page.getByRole("button", { name: "收起属性", exact: true })).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.setSaveFailure(true));
	await page.getByTestId("project-save").click();
	await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
	await page.evaluate(() => window.__creatorWorkspaceFixture.setSaveFailure(false));
	await page.getByRole("button", { name: "重试保存", exact: true }).click();
	await expect(page.getByRole("button", { name: "已保存", exact: true })).toBeVisible();
	await page.setViewportSize({ width: 540, height: 768 });
	await expect(page.locator("[data-testid='editor-main-panels']")).toHaveAttribute("data-layout", "focus");
	await expect(page.locator("#focus-tab-preview")).toBeVisible();
	await page.locator("#focus-tab-assets").click();
	await expect(page.getByRole("searchbox", { name: "搜索项目素材" })).toBeVisible();
	await page.locator("#focus-tab-preview").click();
	await expect(page.locator("[data-panel-id='editor-preview']")).toBeVisible();
	await page.screenshot({ path: "tests/.workspace-output/narrow.png" });
});
