#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_BACKEND = process.env.WASM_EXPECT_BACKEND;
if (
	EXPECTED_BACKEND !== undefined &&
	EXPECTED_BACKEND !== "webgpu" &&
	EXPECTED_BACKEND !== "webgl"
) {
	throw new Error("WASM_EXPECT_BACKEND must be webgpu or webgl");
}
const BROWSER_ARGS = JSON.parse(
	process.env.WASM_RUNTIME_BROWSER_ARGS_JSON ?? "[]",
);
if (
	!Array.isArray(BROWSER_ARGS) ||
	BROWSER_ARGS.some((argument) => typeof argument !== "string")
) {
	throw new Error("WASM_RUNTIME_BROWSER_ARGS_JSON must be a JSON string array");
}
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
	browser = await chromium.launch({ args: BROWSER_ARGS });
	const page = await browser.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/wasm-runtime-probe.html`,
	);
	await page.waitForFunction(() => "__wasmRuntimeProbe" in globalThis);
	const result = await page.evaluate(() => globalThis.__wasmRuntimeProbe);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	if (EXPECTED_BACKEND !== undefined && result.backend !== EXPECTED_BACKEND) {
		throw new Error(
			`expected ${EXPECTED_BACKEND}, runtime selected ${result.backend}`,
		);
	}
	console.log(
		`test-wasm-runtime-api: ${result.backend}, capacity ${result.capacity}, handles ${result.handles.join(", ")}, cancellation ${result.cancellationModes.join("+")} PASS`,
	);
	await browser.close();
	browser = await chromium.launch({
		args: [
			...BROWSER_ARGS,
			"--disable-webgpu",
			"--disable-webgl",
			"--disable-software-rasterizer",
		],
	});
	const failurePage = await browser.newPage();
	const failurePageErrors = [];
	failurePage.on("pageerror", (error) => failurePageErrors.push(error.message));
	await failurePage.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/wasm-runtime-failure-probe.html`,
	);
	await failurePage.waitForFunction(
		() => "__wasmRuntimeFailureProbe" in globalThis,
	);
	const failureResult = await failurePage.evaluate(
		() => globalThis.__wasmRuntimeFailureProbe,
	);
	if (failurePageErrors.length > 0) {
		throw new Error(failurePageErrors.join("\n"));
	}
	console.log(
		`test-wasm-runtime-api: concurrent failure coalesced (${failureResult.reasons[0]}) PASS`,
	);
} finally {
	await browser?.close();
	await server.close();
}
