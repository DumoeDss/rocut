import { expect, test } from "@playwright/test";
import type {} from "./creator-workspace.pw";

declare global {
	interface Window {
		__creatorNavigationTimeline?: Element;
	}
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 540, height: 768 });
	await page.goto("/?creator-workspace-harness=1");
	await expect(page.getByTestId("editor-main-panels")).toHaveAttribute(
		"data-layout",
		"focus",
	);
});

test("focus tab navigation never moves the playhead", async ({ page }) => {
	await page.evaluate(() => window.__creatorWorkspaceFixture.seekPlayhead());
	const before = await page.evaluate(() =>
		window.__creatorWorkspaceFixture.getPlayhead(),
	);
	expect(before).toBeGreaterThan(0);
	await page.locator("#focus-tab-preview").focus();
	for (const [key, target] of [
		["End", "properties"],
		["Home", "assets"],
		["ArrowRight", "preview"],
		["ArrowLeft", "assets"],
		["Enter", "assets"],
		["Space", "assets"],
	]) {
		await page.keyboard.press(key);
		await expect(page.locator(`#focus-tab-${target}`)).toBeFocused();
		await expect(page.locator(`#focus-tab-${target}`)).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(
			await page.evaluate(() => window.__creatorWorkspaceFixture.getPlayhead()),
		).toBe(before);
		expect(
			await page.evaluate(() =>
				window.__creatorWorkspaceFixture.getIsPlaying(),
			),
		).toBe(false);
	}
});

test("explicit native preview reveals content while single selection stays in the library", async ({
	page,
}) => {
	await page.evaluate(() =>
		window.__creatorWorkspaceFixture.loadNativeFixtures(),
	);
	await page.locator("#focus-tab-assets").click();
	await page.getByTestId("assets-tab-media").click();
	const video = page
		.getByTestId("native-media-card")
		.filter({ hasText: "short-motion.mp4" });
	await video.click();
	await expect(page.locator("#focus-tab-assets")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByTestId("native-asset-viewer")).toHaveCount(0);
	await video.dblclick();
	await expect(page.locator("#focus-tab-preview")).toBeFocused();
	await expect(page.getByTestId("native-asset-viewer")).toBeVisible();
	await page.locator("#focus-tab-assets").click();
	await video.dblclick();
	await expect(page.locator("#focus-tab-preview")).toBeFocused();
	await expect(page.getByTestId("native-asset-viewer")).toBeVisible();
});

test("narrow document asset and generate activation reveal content with visible focus", async ({
	page,
}) => {
	const scenes = await page.evaluate(() =>
		window.__creatorWorkspaceFixture.getNativeScenes(),
	);
	const view = await page.evaluate(() =>
		window.__creatorWorkspaceFixture.getTimelineView(),
	);
	await page.getByTestId("timeline-toolbar").evaluate((node) => {
		window.__creatorNavigationTimeline = node;
	});
	for (const [tab, selector] of [
		["plans", ".creator-document-row"],
		["project-assets", ".creator-project-card"],
		["project-assets", "[data-testid='creator-generate-new']"],
	] as const) {
		await page.locator("#focus-tab-assets").click();
		await page.getByTestId(`assets-tab-${tab}`).click();
		await page.locator(selector).first().focus();
		await page.keyboard.press("Enter");
		await expect(page.locator("#focus-tab-preview")).toBeFocused();
		await expect(page.locator("#focus-tab-preview")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(page.getByTestId("creator-content-viewer")).toBeVisible();
		await expect(page.getByTestId("timeline-toolbar")).toBeVisible();
		expect(
			await page
				.getByTestId("timeline-toolbar")
				.evaluate((node) => node === window.__creatorNavigationTimeline),
		).toBe(true);
		expect(
			await page.evaluate(() =>
				window.__creatorWorkspaceFixture.getNativeScenes(),
			),
		).toBe(scenes);
		expect(
			await page.evaluate(() =>
				window.__creatorWorkspaceFixture.getTimelineView(),
			),
		).toEqual(view);
	}
	await page.setViewportSize({ width: 1366, height: 768 });
	await expect(page.getByTestId("editor-main-panels")).toHaveAttribute(
		"data-layout",
		"wide",
	);
	await page.getByTestId("assets-tab-plans").click();
	const document = page.locator(".creator-document-row").first();
	await document.focus();
	await page.keyboard.press("Enter");
	await expect(document).toBeFocused();
});
