import assert from "node:assert/strict";
import console from "node:console";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { chromium, expect } from "@playwright/test";

const work = await mkdtemp(join(tmpdir(), "rocut-sounds-ui-"));
const fixture = fileURLToPath(
	new URL(
		"../packages/editor-classic/src/sounds/__tests__/browser.html",
		import.meta.url,
	),
).replaceAll("\\", "/");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
const evidence = {
	kind: "sound-search-component-regression",
	installedAcceptance: false,
	checks: [],
	errors: [],
	requests: [],
};
page.on("pageerror", (error) => evidence.errors.push(error.message));
let failNext = false;
const check = (name) => evidence.checks.push({ name, pass: true });
try {
	await page.route("**/fixture-sounds?**", async (route) => {
		const params = Object.fromEntries(
			new URL(route.request().url()).searchParams,
		);
		evidence.requests.push(params);
		if (failNext) {
			failNext = false;
			await route.fulfill({
				status: 503,
				json: { error: "Fixture unavailable" },
			});
			return;
		}
		const name = `${params.q ?? "popular"}:${params.commercial_only}:${params.page}`;
		await route.fulfill({
			json: {
				results:
					params.q === "none"
						? []
						: [
								{
									id: Number(params.page),
									name,
									username: "Fixture",
									duration: 1,
									tags: [],
									license: "fixture",
								},
							],
				count: params.q === "none" ? 0 : 2,
				next: params.q === "none" || params.page === "2" ? null : "next",
			},
		});
	});
	await page.goto(`http://127.0.0.1:4196/@fs/${fixture}`);
	const result = () =>
		page.getByTestId("result").textContent().then(JSON.parse);
	await expect
		.poll(async () => (await result()).names)
		.toEqual(["rain:true:1"]);
	await page.getByRole("button", { name: "Probe more twice" }).click();
	await expect
		.poll(async () => (await result()).names)
		.toEqual(["rain:true:1", "rain:true:2"]);
	assert.equal(evidence.requests.filter((x) => x.page === "2").length, 1);
	check("real hook first-page filter and single-flight page append");
	await page.getByRole("button", { name: "Probe filter", exact: true }).click();
	await expect
		.poll(async () => (await result()).names)
		.toEqual(["rain:false:1"]);
	check("same-query filter change replaces cached rows");
	await page.getByLabel("Probe query").fill("none");
	await expect.poll(async () => (await result()).loading).toBe(false);
	await expect.poll(async () => (await result()).names).toEqual([]);
	const emptyCalls = evidence.requests.length;
	await page.waitForTimeout(700);
	assert.equal(evidence.requests.length, emptyCalls);
	check("empty search terminates without a fetch loop");
	await page.getByRole("button", { name: "Toggle endpoint" }).click();
	await expect
		.poll(async () => (await result()).error)
		.toContain("not configured");
	const unavailableCalls = evidence.requests.length;
	await page.getByRole("button", { name: "Probe retry" }).click();
	assert.equal(evidence.requests.length, unavailableCalls);
	check("missing endpoint never fetches an SPA fallback");
	await page.getByRole("button", { name: "Toggle mount" }).click();
	await page.getByRole("button", { name: "Toggle panel" }).click();
	await page.getByRole("button", { name: "Toggle endpoint" }).click();
	failNext = true;
	await page.getByRole("button", { name: "Toggle mount" }).click();
	await expect(page.getByRole("alert")).toContainText("503");
	await expect(
		page.getByText("No sounds available", { exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Retry sounds" }).click();
	await expect(page.getByText("popular:true:1", { exact: true })).toBeVisible();
	check("real Sounds panel exposes request failure and successful Retry");
	await page.getByRole("button", { name: "Filter sounds" }).click();
	await page
		.getByRole("menuitemcheckbox", { name: "Show only commercially licensed" })
		.click();
	await expect(
		page.getByText("popular:false:1", { exact: true }),
	).toBeVisible();
	check("real popular-list commercial filter refetches");
	await page.keyboard.press("Escape");
	await page.getByPlaceholder("Search sound effects").fill("bell");
	await expect(page.getByPlaceholder("Search sound effects")).toHaveValue(
		"bell",
	);
	await expect(page.getByText("bell:false:1", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Toggle endpoint" }).click();
	await expect(
		page.locator('[data-editor-surface="true"]').getByRole("status"),
	).toContainText("import audio from Media");
	await expect(page.getByText("bell:false:1", { exact: true })).toHaveCount(0);
	check("endpoint removal clears stale rows and offers usable alternatives");
	await page.screenshot({ path: join(work, "unavailable.png") });
	assert.deepEqual(evidence.errors, []);
	evidence.passed = true;
} catch (error) {
	evidence.passed = false;
	evidence.failure = String(error.stack);
	await page.screenshot({ path: join(work, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	await browser.close();
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed,
			checks: evidence.checks.length,
			errors: evidence.errors,
			failure: evidence.failure,
		}),
	);
}
