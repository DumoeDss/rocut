import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/workspace",
	testMatch: /\.pw\.ts$/,
	workers: 1,
	fullyParallel: false,
	timeout: 90000,
	expect: { timeout: 15000 },
	outputDir: "./tests/.workspace-output",
	reporter: "list",
	use: { baseURL: process.env.WORKSPACE_TEST_URL ?? "http://127.0.0.1:5198", viewport: { width: 1366, height: 768 }, headless: true, launchOptions: { args: ["--no-proxy-server", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
});
