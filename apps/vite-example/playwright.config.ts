import { defineConfig } from "@playwright/test";

/**
 * Parity-scenario runner.
 *
 * The same spec drives two hosts. `PARITY_HOST=vite` (default) runs it against
 * the **production** Vite build served by `vite preview`; `PARITY_HOST=next`
 * runs the identical scenario against a production `next build` + `next start`
 * of `apps/web`. Nothing in the spec is host-specific except reaching the
 * editor, which lives in `tests/parity/host-profile.ts`.
 *
 * Chromium only, and deliberately `channel: "chromium"` rather than Playwright's
 * default headless shell: the editor bootstraps WebGPU, and without a real
 * Chromium build plus SwiftShader it does not merely degrade — it crashes to a
 * blank page (see BOUNDARIES.md §5). The GPU flags below are not optional.
 */
// A system `HTTP_PROXY` makes Playwright's own "is the server already up?"
// probe fail against loopback, so it decides the preview server is down, starts
// a second one and dies on `EADDRINUSE`. Bypassing loopback here keeps the
// documented commands working on a machine with a proxy configured.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost", "::1"]
	.filter(Boolean)
	.join(",");

const HOST = process.env.PARITY_HOST === "next" ? "next" : "vite";
const BASE_URL =
	process.env.PARITY_BASE_URL ??
	(HOST === "next" ? "http://127.0.0.1:3000" : "http://127.0.0.1:4173");

export default defineConfig({
	testDir: "./tests/parity",
	// `.pw.ts`, deliberately not Playwright's usual `.spec.ts`. The repository's
	// declared test command is `bun test`, and bun's own default glob claims
	// `*.spec.ts`; it would collect this file and throw on the
	// `test.describe.configure()` below, because a Playwright spec cannot be
	// loaded by bun's runner. Naming the file outside bun's glob keeps the two
	// runners disjoint without a repo-wide bun config that could silently
	// exclude a future unit test from the gate.
	testMatch: /\.pw\.ts$/,
	// Deliberately NOT the directory the scenario writes its snapshots and
	// screenshots into: Playwright empties `outputDir` at the start of every run,
	// so parking evidence there means the second host's run deletes the first
	// host's snapshot and there is nothing left to diff.
	outputDir: "./tests/.pw-output",
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	retries: 0,
	// GPU init, four media imports and a video decode all happen inside one test.
	// Generous on purpose: a timeout here reads as a parity failure, which would
	// be a false finding.
	timeout: 15 * 60 * 1000,
	expect: { timeout: 60_000 },
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile: `tests/parity-artifacts/results-${HOST}.json`,
			},
		],
	],
	use: {
		baseURL: BASE_URL,
		viewport: { width: 1600, height: 1000 },
		actionTimeout: 60_000,
		navigationTimeout: 120_000,
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
				headless: process.env.PARITY_HEADED !== "1",
				launchOptions: {
					args: [
						"--use-angle=swiftshader",
						"--enable-unsafe-swiftshader",
						"--no-proxy-server",
					],
				},
			},
		},
	],
	// Only the Vite host's server is owned by this package. The Next baseline is
	// started from `apps/web` (see README) because building it needs the CI
	// placeholder env, which does not belong in this config.
	webServer:
		HOST === "vite" && process.env.PARITY_NO_WEBSERVER !== "1"
			? {
					command: "bun run preview --port 4173 --strictPort --host 127.0.0.1",
					url: BASE_URL,
					reuseExistingServer: true,
					timeout: 120_000,
				}
			: undefined,
});
