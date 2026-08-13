import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import parityConfig from "./playwright.config";
import { evidenceOutputFile } from "./tests/parity/evidence-path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const host = process.env.PARITY_HOST === "next" ? "next" : "vite";

const PARITY_SPECS = ["surface", "parity", "c4-next", "agent"] as const;
type ParitySpec = (typeof PARITY_SPECS)[number];

/**
 * Unset means the default Surface matrix; anything else must be a spelled
 * member. Falling back for an unrecognised value would run one slice's matrix
 * under another slice's name and overwrite its committed evidence — a typo'd
 * `PARITY_SPEC=agnet` would silently rewrite `browser-surface/`.
 */
function resolveSpec(value: string | undefined): ParitySpec {
	if (value === undefined || value === "") return "surface";
	for (const candidate of PARITY_SPECS) {
		if (candidate === value) return candidate;
	}
	throw new Error(
		`Unrecognised PARITY_SPEC="${value}". Expected one of: ${PARITY_SPECS.join(", ")}.`,
	);
}

const spec = resolveSpec(process.env.PARITY_SPEC);
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
	NEXT_PUBLIC_R2_BUILD_MARKER:
		process.env.NEXT_PUBLIC_R2_BUILD_MARKER ?? "missing-next-marker",
};

export default defineConfig({
	...parityConfig,
	testMatch:
		spec === "parity"
			? /parity\.pw\.ts$/
			: spec === "c4-next"
				? /c4-next\.runtime\.ts$/
				: spec === "agent"
					? /agent\.pw\.ts$/
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
				// Resolved, never frozen: once a change is archived its evidence
				// directory is gone, and writing to the old path would recreate the
				// shipped change as a live one. See tests/parity/evidence-path.ts.
				outputFile:
					spec === "agent"
						? evidenceOutputFile({
								repoRoot: REPO_ROOT,
								change: "s0304-agent-transaction-evidence",
								leaf: `browser-agent/${host}`,
								file: `results-${host}.json`,
							})
						: spec === "surface" || spec === "c4-next"
							? evidenceOutputFile({
									repoRoot: REPO_ROOT,
									change:
										spec === "c4-next"
											? "s0304-surface-mount-focus-lifecycle"
											: "s0304-surface-css-react-a11y",
									leaf: "browser-surface",
									file: `results-${host}${spec === "c4-next" ? "-c4" : ""}.json`,
								})
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
			: {
					command: "bun run preview --port 4173 --strictPort --host 127.0.0.1",
					url: "http://127.0.0.1:4173/surface-evidence.html",
					reuseExistingServer: false,
					timeout: 120_000,
					env: {
						VITE_R2_BUILD_MARKER:
							process.env.VITE_R2_BUILD_MARKER ?? "missing-vite-marker",
					},
				},
});
