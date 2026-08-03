import { expect, test } from "@playwright/test";

test("C4 forced-none harness still seeds and exits through session persistence", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await page.goto("/?c4-forced-none-harness=1&forceRendererBackend=none");
	const harness = page.getByTestId("c4-forced-none-harness");
	await expect(harness).toHaveAttribute("data-status", "ready");
	await expect(harness).toHaveAttribute("data-assertion-failures", "");
	await expect(harness).toHaveAttribute("data-page-errors", "0");
	await expect(harness).toHaveAttribute("data-unhandled-rejections", "0");

	const reportText = await page
		.getByTestId("c4-forced-none-report")
		.innerText();
	const report: unknown = JSON.parse(reportText);
	expect(report).toMatchObject({
		report: {
			source: "host-forced",
			backend: null,
			livePreviewLimit: 0,
		},
		sessionLive: true,
		thumbnailAbsentAfterExit: true,
		graphicsQueryCalls: [],
	});
	expect(pageErrors).toEqual([]);
});
