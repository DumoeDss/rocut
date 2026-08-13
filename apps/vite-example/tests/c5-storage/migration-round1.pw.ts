import { expect, test } from "@playwright/test";

test("migration round 1 adversarial matrix survives Chromium reopen", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});

	await page.goto("/c5-migration.html");
	await expect(page.locator("#status")).not.toHaveText("running");
	const result = await page.evaluate(() => window.__c5MigrationResult);
	expect(result?.error).toBeUndefined();
	expect(result?.migration).toMatchObject({
		legacyPrivateFieldsReopened: true,
		cleanupJournalRetriedByNextSession: true,
		cleanupJournalRetriedAfterReload: true,
		cleanupWarningWasMechanismNeutral: true,
		oldEnvelopeMigrated: true,
		disposableExternalTargetRefused: true,
		postCommitCleanupDiagnosed: true,
		postCommitCleanupRetried: true,
		noUndefinedNames: true,
		afterDatabases: [],
	});
	expect(result?.ok).toBe(true);
	expect(pageErrors).toEqual([]);
	await expect(page.locator("#status")).toHaveText("passed");
});
