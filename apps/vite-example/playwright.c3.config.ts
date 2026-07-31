import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"]
	.filter(Boolean)
	.join(",");

const backend = process.env.C3_BROWSER_BACKEND;
if (backend !== "webgl" && backend !== "webgpu") {
	throw new Error("C3_BROWSER_BACKEND must be exactly webgl or webgpu.");
}
const port = Number(process.env.C3_PREVIEW_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
	throw new Error("C3_PREVIEW_PORT must be an explicit unprivileged port.");
}
const buildCommit = process.env.C3_BUILD_COMMIT;
if (!buildCommit)
	throw new Error("C3_BUILD_COMMIT must identify the served build.");

const installedChrome = process.env.C3_WEBGPU_EXECUTABLE;
const expectedChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (backend === "webgpu") {
	if (installedChrome?.replaceAll("\\", "/") !== expectedChrome) {
		throw new Error(
			`C3_WEBGPU_EXECUTABLE must be exactly ${expectedChrome}; fallback is forbidden.`,
		);
	}
	if (!existsSync(installedChrome)) {
		throw new Error(`Installed Chrome does not exist at ${installedChrome}.`);
	}
}

const baseURL = `http://127.0.0.1:${port}`;
const launchOptions =
	backend === "webgpu"
		? {
				executablePath: installedChrome,
				args: [
					"--enable-unsafe-webgpu",
					"--use-angle=d3d11",
					"--no-proxy-server",
				],
			}
		: {
				args: [
					"--use-angle=swiftshader",
					"--enable-unsafe-swiftshader",
					"--no-proxy-server",
				],
			};

export default defineConfig({
	testDir: "./tests/c3",
	testMatch: /session-capacity\.pw\.ts$/,
	outputDir: "./tests/.pw-output-c3",
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 60_000 },
	reporter: [["list"]],
	use: {
		baseURL,
		viewport: { width: 1200, height: 800 },
		actionTimeout: 30_000,
		navigationTimeout: 60_000,
		trace: "off",
		video: "off",
		screenshot: "off",
		browserName: "chromium",
		headless: true,
		launchOptions,
	},
	webServer: {
		command: `bun run preview --port ${port} --strictPort --host 127.0.0.1`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
