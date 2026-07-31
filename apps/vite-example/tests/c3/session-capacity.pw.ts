import { expect, test } from "@playwright/test";

const expectedBackend = process.env.C3_BROWSER_BACKEND;
const expectedCommit = process.env.C3_BUILD_COMMIT;

test("live backend enforces explicit session preview capacity", async ({
	page,
	browser,
}) => {
	await page.goto("/?c3-session-harness=1");
	const harness = page.getByTestId("c3-session-harness");
	await expect(harness).toHaveAttribute("data-status", "ready");
	await expect(harness).toHaveAttribute("data-backend", expectedBackend!);
	await expect(harness).toHaveAttribute("data-build-commit", expectedCommit!);
	const userAgent = await page.evaluate(() => navigator.userAgent);
	if (expectedBackend === "webgpu") {
		expect(userAgent).toContain("Chrome/");
		expect(browser.browserType().name()).toBe("chromium");
	}

	const first = page.getByTestId("c3-session-a");
	const firstCanvas = first.locator("canvas");
	await expect(firstCanvas).toBeVisible();
	const firstHandle = Number(await first.getAttribute("data-handle"));
	expect(firstHandle).toBeGreaterThan(0);
	const firstFrame = await firstCanvas.screenshot();
	const firstHook = page.getByTestId("c3-hook-a");
	await expect(firstHook).toHaveAttribute("data-instance-stable", "true");
	const firstRenderCountBefore = Number(
		await firstHook.getAttribute("data-render-count"),
	);

	if (expectedBackend === "webgpu") {
		await expect(harness).toHaveAttribute("data-capacity", "2");
		const second = page.getByTestId("c3-session-b");
		const secondCanvas = second.locator("canvas");
		await expect(secondCanvas).toBeVisible();
		const secondHandle = Number(await second.getAttribute("data-handle"));
		expect(secondHandle).toBeGreaterThan(0);
		expect(secondHandle).not.toBe(firstHandle);
		const handles = (await harness.getAttribute("data-handles"))!
			.split(",")
			.map(Number);
		expect(handles).toEqual([firstHandle, secondHandle]);

		const secondFrameBefore = await secondCanvas.screenshot();
		const secondHook = page.getByTestId("c3-hook-b");
		await expect(secondHook).toHaveAttribute("data-instance-stable", "true");
		const secondRenderCountBefore = Number(
			await secondHook.getAttribute("data-render-count"),
		);
		expect(Buffer.compare(firstFrame, secondFrameBefore)).not.toBe(0);
		expect(await first.getAttribute("data-project")).not.toBe(
			await second.getAttribute("data-project"),
		);
		expect(await first.getAttribute("data-selection")).not.toBe(
			await second.getAttribute("data-selection"),
		);
		expect(await first.getAttribute("data-playhead")).not.toBe(
			await second.getAttribute("data-playhead"),
		);

		await page.getByTestId("c3-mutate-a").click();
		await expect(harness).toHaveAttribute("data-revision", "1");
		await expect(first).toHaveAttribute(
			"data-project-name",
			"c3-project-green",
		);
		await expect(first).toHaveAttribute("data-selection", "green-title");
		await expect(first).toHaveAttribute("data-playhead", "7200");
		await expect(second).toHaveAttribute(
			"data-project-name",
			"c3-project-blue",
		);
		await expect(second).toHaveAttribute("data-selection", "blue-title");
		await expect(second).toHaveAttribute("data-playhead", "4800");
		await expect(firstHook).toHaveAttribute("data-project", "c3-project-green");
		await expect(firstHook).toHaveAttribute("data-selection", "green-title");
		await expect(firstHook).toHaveAttribute("data-playhead", "7200");
		expect(
			Number(await firstHook.getAttribute("data-render-count")),
		).toBeGreaterThan(firstRenderCountBefore);
		expect(Number(await secondHook.getAttribute("data-render-count"))).toBe(
			secondRenderCountBefore,
		);

		await page.getByTestId("c3-migrate-a").click();
		await expect(firstHook).toHaveAttribute("data-migrating", "true");
		await expect(secondHook).toHaveAttribute("data-migrating", "false");
		await expect(page.getByRole("dialog")).toHaveCount(1);
		await expect(page.getByRole("dialog")).toContainText("C3 legacy project");
		await expect(firstHook).toHaveAttribute("data-migrating", "false", {
			timeout: 10_000,
		});
		await expect(page.getByRole("dialog")).toHaveCount(0);
		const firstFrameAfter = await firstCanvas.screenshot();
		const secondFrameAfter = await secondCanvas.screenshot();
		expect(Buffer.compare(firstFrame, firstFrameAfter)).not.toBe(0);
		expect(Buffer.compare(secondFrameBefore, secondFrameAfter)).toBe(0);
	} else {
		await expect(harness).toHaveAttribute("data-capacity", "1");
		await expect(page.getByTestId("c3-session-b")).toHaveCount(0);
		await page.getByTestId("c3-request-second").click();
		await expect(page.getByTestId("c3-capacity-rejection")).toContainText(
			"over-capacity",
		);
		await expect(harness).toHaveAttribute("data-handles", String(firstHandle));
		await expect(firstCanvas).toBeVisible();
		const firstFrameAfter = await firstCanvas.screenshot();
		expect(Buffer.compare(firstFrame, firstFrameAfter)).toBe(0);
	}
});
