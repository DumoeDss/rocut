import { defineConfig } from "@playwright/test";

process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"]
	.filter(Boolean)
	.join(",");

const baseURL = process.env.C5_STORAGE_BASE_URL ?? "http://127.0.0.1:4175";

export default defineConfig({
	testDir: "./tests/c5-storage",
	testMatch: /\.pw\.ts$/,
	outputDir: "./tests/.pw-output-c5-storage",
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 90_000 },
	reporter: "list",
	use: {
		baseURL,
		trace: "off",
		video: "off",
		screenshot: "off",
	},
	projects: [
		{
			name: "chromium",
			use: {
				browserName: "chromium",
				channel: process.env.PARITY_BROWSER_CHANNEL ?? "chromium",
				headless: true,
				launchOptions: { args: ["--no-proxy-server"] },
			},
		},
	],
	webServer: {
		command: "bun run dev --port 4175 --strictPort --host 127.0.0.1",
		url: `${baseURL}/c5-storage.html`,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
