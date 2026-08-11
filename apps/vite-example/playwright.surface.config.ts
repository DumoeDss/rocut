import { defineConfig } from "@playwright/test";

import parityConfig from "./playwright.config";

const host = process.env.PARITY_HOST === "next" ? "next" : "vite";
const spec =
	process.env.PARITY_SPEC === "parity"
		? "parity"
		: process.env.PARITY_SPEC === "c4-next"
			? "c4-next"
			: "surface";
if (spec === "c4-next" && host !== "next") {
	throw new Error("The C4 Next runtime gate requires PARITY_HOST=next.");
}
const nextPort = 3017;
const nextBaseUrl = `http://127.0.0.1:${nextPort}`;
const nextPlaceholderEnvironment = {
	DATABASE_URL: "postgresql://opencut:opencut@localhost:5432/opencut",
	BETTER_AUTH_SECRET: "build-placeholder-secret-32-characters",
	NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
	NEXT_PUBLIC_MARBLE_API_URL: "https://placeholder.example.com",
	UPSTASH_REDIS_REST_URL: "https://placeholder.example.com",
	UPSTASH_REDIS_REST_TOKEN: "build-placeholder-token",
	MARBLE_WORKSPACE_KEY: "build-placeholder",
	FREESOUND_CLIENT_ID: "build-placeholder",
	FREESOUND_API_KEY: "build-placeholder",
	NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
	...parityConfig,
	testMatch:
		spec === "parity"
			? /parity\.pw\.ts$/
			: spec === "c4-next"
				? /c4-next\.runtime\.ts$/
				: /surface\.pw\.ts$/,
	use: {
		...parityConfig.use,
		baseURL: host === "next" ? nextBaseUrl : parityConfig.use?.baseURL,
	},
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile:
					spec === "surface" || spec === "c4-next"
						? `../../rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/browser-surface/results-${host}${spec === "c4-next" ? "-c4" : ""}.json`
						: `tests/parity-artifacts/results-${host}.json`,
			},
		],
	],
	webServer:
		host === "next"
			? {
					command: `bun run --cwd ../web start -- -H 127.0.0.1 -p ${nextPort}`,
					url: `${nextBaseUrl}/surface-evidence`,
					reuseExistingServer: false,
					timeout: 120_000,
					env: nextPlaceholderEnvironment,
				}
			: parityConfig.webServer,
});
