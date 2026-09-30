#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ROOT = join(ROOT, "apps", "vite-example");
const FIXTURE = join(
	ROOT,
	"rust",
	"crates",
	"motion-text",
	"fixtures",
	"jizura-v1-project.json",
);
const CLIP_NAME = "城里的光 · JIZURA";

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
		viewport: { width: 1280, height: 800 },
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
	await page.getByRole("button", { name: "Motion text" }).click();
	await page.getByText("JIZURA project", { exact: true }).waitFor();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByRole("button", { name: "Import", exact: true }).click(),
	]);
	await chooser.setFiles(FIXTURE);
	await page
		.getByText("Imported 2 lyric lines with compatibility notes.", {
			exact: true,
		})
		.waitFor({ timeout: 15_000 });
	await page
		.locator("span.truncate.text-xs.text-white", { hasText: CLIP_NAME })
		.waitFor({ timeout: 15_000 });
	await page
		.getByRole("heading", { name: "Sequence defaults" })
		.waitFor({ timeout: 15_000 });
	await page.getByText("r0", { exact: true }).waitFor();
	await page.getByText("2 cues", { exact: true }).waitFor();
	await page.getByText(/audio bytes; relink the song/iu).waitFor();

	await page.reload({ waitUntil: "domcontentloaded" });
	assert.equal(page.url().startsWith(editorUrl), true);
	await page
		.locator("span.truncate.text-xs.text-white", { hasText: CLIP_NAME })
		.waitFor({ timeout: 15_000 });
	assert.deepEqual(pageErrors, []);

	console.log(
		JSON.stringify(
			{
				status: "PASS",
				canonicalWasm: true,
				fixture: "jizura-v1-project.json",
				clipName: CLIP_NAME,
				cueCount: 2,
				durableReload: true,
			},
			null,
			2,
		),
	);
} finally {
	await browser?.close();
	await server.close();
}
