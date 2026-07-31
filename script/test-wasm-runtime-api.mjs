#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
	root: ROOT,
	logLevel: "error",
	plugins: [wasm(), topLevelAwait()],
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
	browser = await chromium.launch();
	const page = await browser.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/wasm-runtime-probe.html`,
	);
	await page.waitForFunction(() => "__wasmRuntimeProbe" in globalThis);
	const result = await page.evaluate(() => globalThis.__wasmRuntimeProbe);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	console.log(
		`test-wasm-runtime-api: ${result.backend}, capacity ${result.capacity}, handles ${result.handles.join(", ")} PASS`,
	);
} finally {
	await browser?.close();
	await server.close();
}
