import { expect, test } from "@playwright/test";

async function configure(page: import("@playwright/test").Page, mode: string) {
	await page.evaluate((value) => (window as unknown as {
		__creatorWorkspaceFixture: { configureFixedReference(mode: string): void };
	}).__creatorWorkspaceFixture.configureFixedReference(value), mode);
}

test.beforeEach(async ({ page }) => {
	await page.goto("/?creator-workspace-harness=1&fixed-reference-fixture=1");
	await expect(page.getByTestId("creator-asset-card").first()).toBeVisible();
});

test("clicking a fixed clip opens its exact version and never substitutes a newer selection", async ({ page }) => {
	const clip = page.locator('[data-testid="timeline-clip"][data-element-id="existing-clip"]');
	await configure(page, "dual");
	await clip.click();
	await expect(page.locator('[data-version-id="v1"]')).toHaveAttribute("aria-pressed", "true");
	await page.locator('[data-testid="timeline-clip"][data-element-id="second-fixed-clip"]').click();
	await expect(page.locator('[data-version-id="v2"]')).toHaveAttribute("aria-pressed", "true");
	await clip.click();
	await expect(page.locator('[data-version-id="v1"]')).toHaveAttribute("aria-pressed", "true");
	for (const mode of ["v1", "v2", "v1", "duplicate"]) {
		await configure(page, mode);
		await clip.click();
		await expect(page.locator(`[data-testid="creator-version"][data-version-id="${mode === "duplicate" ? "v1" : mode}"]`)).toHaveAttribute("aria-pressed", "true");
	}
	await configure(page, "missing-version");
	await clip.click();
	await expect(page.getByTestId("creator-asset-detail")).toHaveCount(0);
	await expect(page.getByTestId("creator-content-unavailable")).toBeVisible();
	await configure(page, "v1");
	await expect(page.getByTestId("creator-version").filter({ hasText: "V1" })).toHaveAttribute("aria-pressed", "true");
});

test("missing asset, mismatched hash, and legacy missing version clear previous details", async ({ page }) => {
	for (const mode of ["missing-asset", "hash-mismatch", "legacy", "ambiguous", "mixed-status", "missing", "needs-reconciliation"]) {
		await configure(page, "v1");
		await page.locator('[data-element-id="existing-clip"]').click();
		await expect(page.getByTestId("creator-asset-detail")).toBeVisible();
		await configure(page, mode);
		await page.locator('[data-element-id="existing-clip"]').click();
		await expect(page.getByTestId("creator-content-unavailable")).toBeVisible();
		await expect(page.getByTestId("creator-asset-detail")).toHaveCount(0);
	}
});

test("unrelated scene and unknown native clips preserve manual document reading", async ({ page }) => {
	for (const mode of ["unknown", "foreign", "foreign-project"]) {
		await configure(page, mode);
		await page.locator(".creator-document-row").first().click();
		await page.locator('[data-element-id="existing-clip"]').click();
		await expect(page.getByTestId("creator-document-view")).toBeVisible();
		await expect(page.getByTestId("creator-content-unavailable")).toHaveCount(0);
		await expect(page.getByTestId("creator-asset-detail")).toHaveCount(0);
	}
});

test("an offline retained version keeps its version details", async ({ page }) => {
	await configure(page, "offline");
	await page.locator('[data-element-id="existing-clip"]').click();
	await expect(page.getByTestId("creator-asset-detail")).toBeVisible();
	await expect(page.locator('[data-version-id="v1"]')).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("creator-content-unavailable")).toHaveCount(0);
});

test("a linked clip with a known different native media ID cannot open the stored pin", async ({ page }) => {
	const clipId = await page.evaluate(async () => {
		const fixture = (window as unknown as { __creatorWorkspaceFixture: {
			loadNativeFixtures(): Promise<void>; insertNativeVideo(): Promise<void>;
			pinNativeVideoWithDifferentMedia(): string;
		} }).__creatorWorkspaceFixture;
		await fixture.loadNativeFixtures();
		await fixture.insertNativeVideo();
		return fixture.pinNativeVideoWithDifferentMedia();
	});
	await page.locator(`[data-testid="timeline-clip"][data-element-id="${clipId}"]`).click();
	await expect(page.getByTestId("creator-content-unavailable")).toBeVisible();
	await expect(page.getByTestId("creator-asset-detail")).toHaveCount(0);
});
