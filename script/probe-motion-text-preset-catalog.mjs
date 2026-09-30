#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ROOT = join(ROOT, "apps", "vite-example");

const server = await createServer({
	root: VITE_ROOT,
	configFile: join(VITE_ROOT, "vite.config.ts"),
	logLevel: "error",
	resolve: {
		alias: {
			"opencut-wasm": join(ROOT, "rust", "wasm", "pkg", "opencut_wasm.js"),
		},
	},
	server: { host: "127.0.0.1", port: 0, strictPort: false },
});

let browser;
try {
	await server.listen();
	const address = server.httpServer?.address();
	if (
		address === null ||
		typeof address === "string" ||
		address === undefined
	) {
		throw new Error("Vite did not expose a local port");
	}

	browser = await chromium.launch({
		headless: true,
		args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	});
	const page = await browser.newPage({
		viewport: { width: 1280, height: 900 },
	});
	await page.addInitScript(() => {
		const originalRequest = window.requestAnimationFrame.bind(window);
		const originalCancel = window.cancelAnimationFrame.bind(window);
		const counters = { requestCalls: 0, cancelCalls: 0 };
		window.__motionTextPresetRafProbe = counters;
		window.requestAnimationFrame = (callback) => {
			counters.requestCalls += 1;
			return originalRequest(callback);
		};
		window.cancelAnimationFrame = (handle) => {
			counters.cancelCalls += 1;
			originalCancel(handle);
		};
	});
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});

	await page.goto(`http://127.0.0.1:${address.port}/`, {
		waitUntil: "domcontentloaded",
	});
	await page.getByRole("button", { name: "New project" }).click();
	await page
		.getByRole("button", { name: "Motion text" })
		.waitFor({ timeout: 15_000 });
	const firstProjectId = new URL(page.url()).searchParams.get("project");
	assert.ok(firstProjectId, "First project id is missing");
	await page.getByRole("button", { name: "Motion text" }).click();

	const catalog = page.locator('[data-motion-text-preset-count="889"]');
	await catalog.waitFor({ timeout: 15_000 });
	await catalog.scrollIntoViewIfNeeded();
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-motion-text-preset-count="889"]')
				?.getAttribute("data-motion-text-catalog-visible") === "true",
	);
	const previewCanvases = page.locator(
		'canvas[data-motion-text-preview-active="true"]',
	);
	await previewCanvases.first().waitFor({ timeout: 15_000 });
	assert.equal(await previewCanvases.count(), 4);
	assert.equal(
		await catalog.getAttribute("data-motion-text-project-id"),
		firstProjectId,
	);

	const cards = catalog.locator("[data-motion-text-preset-card]");
	const initialCardCount = await cards.count();
	assert.ok(initialCardCount > 0 && initialCardCount <= 14);
	const initialKeys = await cards.evaluateAll((elements) =>
		elements.map((element) =>
			element.getAttribute("data-motion-text-preset-card"),
		),
	);
	const cancelBeforeScroll = await page.evaluate(
		() => window.__motionTextPresetRafProbe.cancelCalls,
	);
	await catalog
		.locator('[data-motion-text-preset-viewport="true"]')
		.evaluate((element) => {
			element.scrollTop = 13_200;
			element.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
	await page.waitForFunction(
		(firstKey) =>
			document
				.querySelector("[data-motion-text-preset-card]")
				?.getAttribute("data-motion-text-preset-card") !== firstKey,
		initialKeys[0],
	);
	const scrolledKeys = await cards.evaluateAll((elements) =>
		elements.map((element) =>
			element.getAttribute("data-motion-text-preset-card"),
		),
	);
	assert.notDeepEqual(scrolledKeys, initialKeys);
	assert.ok((await cards.count()) <= 14);
	assert.equal(await previewCanvases.count(), 4);
	const cancelAfterScroll = await page.evaluate(
		() => window.__motionTextPresetRafProbe.cancelCalls,
	);
	assert.ok(cancelAfterScroll - cancelBeforeScroll >= 4);

	const cancelBeforeTab = cancelAfterScroll;
	await page.getByRole("button", { name: "Media" }).click();
	await catalog.waitFor({ state: "detached" });
	assert.equal(await previewCanvases.count(), 0);
	const cancelAfterTab = await page.evaluate(
		() => window.__motionTextPresetRafProbe.cancelCalls,
	);
	assert.ok(cancelAfterTab - cancelBeforeTab >= 4);

	await page.getByRole("button", { name: "Motion text" }).click();
	await page.getByLabel("Lines").fill("中文字体覆盖测试");
	await page.getByRole("button", { name: "Add at playhead" }).click();
	await page
		.getByRole("heading", { name: "Sequence defaults" })
		.waitFor({ timeout: 15_000 });
	await page.getByRole("button", { name: "Edit font and colors" }).click();
	const fontLanguageStatus = page.locator(
		'[data-motion-text-font-language-status="unsupported"]',
	);
	await fontLanguageStatus.waitFor();
	assert.match(
		await fontLanguageStatus.innerText(),
		/No declared zh coverage/iu,
	);

	await page
		.getByAltText("Project thumbnail")
		.locator("xpath=ancestor::button[1]")
		.click();
	await page.getByText("Exit project", { exact: true }).click();
	await page.getByRole("button", { name: "New project" }).waitFor();
	await page.getByRole("button", { name: "New project" }).click();
	await page
		.getByRole("button", { name: "Motion text" })
		.waitFor({ timeout: 15_000 });
	await page.getByRole("button", { name: "Motion text" }).click();
	const secondCatalog = page.locator('[data-motion-text-preset-count="889"]');
	await secondCatalog.waitFor({ timeout: 15_000 });
	const secondProjectId = await secondCatalog.getAttribute(
		"data-motion-text-project-id",
	);
	assert.ok(secondProjectId, "Second project id is missing");
	assert.notEqual(secondProjectId, firstProjectId);
	assert.equal(
		await secondCatalog.getAttribute("data-motion-text-project-id"),
		secondProjectId,
	);
	assert.equal(
		await page
			.locator(`[data-motion-text-project-id="${firstProjectId}"]`)
			.count(),
		0,
	);
	assert.deepEqual(pageErrors, []);

	console.log(
		JSON.stringify(
			{
				status: "PASS",
				catalogCount: 889,
				initialMountedCards: initialCardCount,
				maxActiveCanvases: 4,
				scrollChangedMountedCards: true,
				tabCleanupCancelCalls: cancelAfterTab - cancelBeforeTab,
				fontLanguageGapShown: true,
				projectReplacementReleasedOldCatalog: true,
				canonicalWasm: true,
			},
			null,
			2,
		),
	);
} finally {
	await browser?.close();
	await server.close();
}
