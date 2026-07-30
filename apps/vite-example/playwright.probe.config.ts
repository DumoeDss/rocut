import { defineConfig } from "@playwright/test";
import parityConfig from "./playwright.config";

/**
 * Runner for the seeded-legacy-project migration probe.
 *
 * It **spreads `playwright.config.ts`** rather than restating it, so the launch
 * arguments the editor requires to boot at all — `--use-angle=swiftshader
 * --enable-unsafe-swiftshader` — come from the same source as the parity
 * scenario's. Without a GPU or SwiftShader the editor does not degrade, it
 * crashes to a blank page in both hosts, so a copied config that drifted would
 * read as "migration is broken".
 *
 * Only the test directory and the artefact locations differ. Keeping the probe
 * out of `tests/parity/` is deliberate: the parity config's `testMatch` claims
 * every `*.pw.ts` under that directory, so a probe living there would be pulled
 * into every parity run, whose scenario already takes minutes per host. This is
 * the shape OQ2 recommends — a separate spec with its own runner, so the
 * migration path can be checked without the full parity scenario.
 */
export default defineConfig({
	...parityConfig,
	testDir: "./tests/probe",
	testMatch: /\.pw\.ts$/,
	// Playwright empties `outputDir` at the start of a run; keeping it distinct
	// from the parity run's means neither deletes the other's evidence.
	outputDir: "./tests/.pw-output-probe",
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile: `tests/probe-artifacts/results-${
					process.env.PARITY_HOST === "next" ? "next" : "vite"
				}.json`,
			},
		],
	],
});
