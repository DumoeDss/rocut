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
	const editorUrl = page.url();
	const projectId = new URL(editorUrl).searchParams.get("project");
	assert.ok(projectId, "New project navigation did not expose its id");
	await page.getByRole("button", { name: "Motion text" }).click();
	const source = page.getByLabel("Lines");
	await source.fill("一/二/三\n灯火醒来\n沿着节拍向前");
	await source.press("Control+Enter");
	await page
		.getByRole("heading", { name: "Sequence defaults" })
		.waitFor({ timeout: 15_000 });
	await page.getByText("r0", { exact: true }).waitFor();
	const timelineTitle = page
		.locator("span.truncate.text-xs.text-white")
		.filter({ hasText: /^Clean caption/u });
	await timelineTitle.first().waitFor({ timeout: 15_000 });

	const cueRows = () =>
		page.locator(
			'section[aria-labelledby="motion-text-cues-heading"] > div > button',
		);
	const selectFirstCue = async () => {
		await cueRows().first().click();
		await page.getByRole("heading", { name: "Locks & inheritance" }).waitFor();
	};
	const lockSection = () =>
		page
			.getByRole("heading", { name: "Locks & inheritance" })
			.locator("xpath=ancestor::section[1]");
	const layoutLock = () =>
		lockSection().getByRole("button", { name: "Layout", exact: true });
	const cueEditor = () =>
		page
			.getByLabel("Lyric text")
			.locator(
				"xpath=ancestor::div[.//button[normalize-space()='Apply changes']][1]",
			);
	const projectLockSnapshot = async () =>
		page.evaluate(async (id) => {
			const { BrowserProjectStore } =
				await import("/@id/@opencut/editor-classic/storage");
			const record = await new BrowserProjectStore().load({ id });
			const sequence = record?.data.motionTextSequences?.[0];
			const cue = sequence?.cues?.[0];
			if (!sequence?.resolvedPlan || !cue) {
				throw new Error("The lock probe sequence is missing");
			}
			return {
				revision: sequence.revision,
				locks: cue.locks,
				layouts: sequence.resolvedPlan.cuts
					.filter((cut) => cut.cueId === cue.id)
					.map((cut) => cut.preset.layout),
			};
		}, projectId);

	await selectFirstCue();
	await layoutLock().click();
	await page.getByText("r1", { exact: true }).waitFor();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");
	assert.equal(await page.getByLabel("Lyric text").isEnabled(), true);
	assert.equal(await page.getByLabel("Start (sec)").isEnabled(), true);
	assert.equal(
		await cueEditor().getByRole("combobox").first().isDisabled(),
		true,
	);
	assert.deepEqual((await projectLockSnapshot()).locks, [
		{ scope: "preset-group", key: "layout" },
	]);

	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r0", { exact: true }).waitFor();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "false");
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+Shift+z");
	await page.getByText("r1", { exact: true }).waitFor();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");

	await page.getByRole("button", { name: "Edit font and colors" }).click();
	const defaultsEditor = page
		.getByText("Default font", { exact: true })
		.locator(
			"xpath=ancestor::div[.//button[normalize-space()='Apply changes']][1]",
		);
	assert.equal(
		await defaultsEditor.getByRole("button", { name: "Customize" }).isEnabled(),
		true,
	);
	await defaultsEditor.getByRole("button", { name: "Cancel" }).click();

	const layoutsBeforeVariation = (await projectLockSnapshot()).layouts;
	const variationSection = page
		.getByRole("heading", { name: "Variation" })
		.last()
		.locator("xpath=ancestor::section[1]");
	await variationSection
		.getByRole("button", { name: "Generate variation" })
		.click();
	await variationSection
		.getByRole("button", { name: "Apply variation" })
		.click();
	await page.getByText("r2", { exact: true }).waitFor();
	const variedSnapshot = await projectLockSnapshot();
	assert.deepEqual(variedSnapshot.layouts, layoutsBeforeVariation);
	assert.deepEqual(variedSnapshot.locks, [
		{ scope: "preset-group", key: "layout" },
	]);

	await page.reload({ waitUntil: "domcontentloaded" });
	await timelineTitle.first().waitFor({ timeout: 15_000 });
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.getByText("r2", { exact: true }).waitFor();
	await selectFirstCue();
	assert.equal(await layoutLock().getAttribute("aria-pressed"), "true");

	await lockSection().getByRole("button", { name: "Lock cue" }).click();
	await page.getByText("r3", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Lyric text").isDisabled(), true);
	assert.equal(await page.getByLabel("Start (sec)").isDisabled(), true);
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r2", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Lyric text").isEnabled(), true);

	const firstCutLock = lockSection()
		.getByText("Resolved cuts", { exact: true })
		.locator("xpath=following-sibling::div[1]//button")
		.first();
	await firstCutLock.click();
	await page.getByText("r3", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Lyric text").isDisabled(), true);
	assert.equal(await page.getByLabel("Start (sec)").isEnabled(), true);
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r2", { exact: true }).waitFor();

	const parameterLock = lockSection().getByRole("button", {
		name: "rocut.starterPreset",
		exact: true,
	});
	await parameterLock.click();
	await page.getByText("r3", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Lyric text").isEnabled(), true);
	assert.equal(await parameterLock.getAttribute("aria-pressed"), "true");
	await timelineTitle.first().locator("xpath=ancestor::button[1]").click();
	await page.keyboard.press("Control+z");
	await page.getByText("r2", { exact: true }).waitFor();
	assert.equal(await parameterLock.getAttribute("aria-pressed"), "false");
	assert.deepEqual(pageErrors, []);

	console.log(
		JSON.stringify(
			{
				checks: {
					canonicalWasmUiBoot: true,
					lockMutationIsSingleTransaction: true,
					lockUndoRedo: true,
					lockPersistsAfterReload: true,
					variationPreservesLockedGroup: true,
					fullCueFieldGate: true,
					cutFieldGate: true,
					parameterLockEditing: true,
				},
				revision: (await projectLockSnapshot()).revision,
			},
			null,
			2,
		),
	);
} finally {
	await browser?.close();
	await server.close();
}
