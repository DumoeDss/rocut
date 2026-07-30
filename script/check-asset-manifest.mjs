#!/usr/bin/env node
/**
 * Runtime asset manifest verification (S01 tasks 7.2 / 7.7, design D7).
 *
 * Fetches every entry in `dist/asset-manifest.json` from a running preview
 * server and asserts each one is really served, with the recorded byte length.
 *
 * **Status alone is not a valid test here.** A static SPA host answers any
 * unknown path with `index.html` at HTTP 200, so a missing asset looks
 * identical to a present one if you only check the status code — the same trap
 * that makes a failed `/api/...` call surface as a JSON parse error rather than
 * a 404. Verified on this build: `/shapes/circle.svg`, `/platform-guides/x.png`
 * and `/open-graph/default.jpg` all return **200 `text/html`** despite being
 * deliberately excluded from the copy allowlist. So this check discriminates on
 * `content-type` and byte length, and separately asserts that the excluded
 * paths *do* fall through to the HTML fallback.
 *
 *   cd apps/vite-example && bun run preview --strictPort --port 4173 --host 127.0.0.1
 *   node script/check-asset-manifest.mjs [baseUrl]
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO_ROOT, "apps", "vite-example", "dist", "asset-manifest.json");
const BASE = (process.argv[2] ?? "http://127.0.0.1:4173").replace(/\/$/, "");

if (!existsSync(MANIFEST)) {
	console.error(`check-asset-manifest: no manifest at ${MANIFEST}`);
	console.error("Produce one with: cd apps/vite-example && bun run build");
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

async function head(path) {
	// GET rather than HEAD: some static servers answer HEAD without the body
	// headers this check depends on.
	const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
	const buffer = Buffer.from(await res.arrayBuffer());
	return {
		status: res.status,
		contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim(),
		bytes: buffer.byteLength,
	};
}

try {
	const probe = await fetch(`${BASE}/`, { redirect: "manual" });
	if (!probe.ok) throw new Error(`status ${probe.status}`);
} catch (error) {
	console.error(`check-asset-manifest: no preview server at ${BASE} — ${error.message}`);
	console.error("Start one with: cd apps/vite-example && bun run preview --strictPort --port 4173 --host 127.0.0.1");
	process.exit(2);
}

const failures = [];
let checked = 0;

for (const file of manifest.files) {
	const result = await head(file.path);
	checked += 1;

	if (result.status !== 200) {
		failures.push({ path: file.path, why: `status ${result.status}` });
	} else if (result.contentType === "text/html" && !file.path.endsWith(".html")) {
		// The SPA fallback answered instead of the asset.
		failures.push({ path: file.path, why: "served the HTML fallback — the file is not in dist/" });
	} else if (result.bytes !== file.bytes) {
		failures.push({ path: file.path, why: `expected ${file.bytes} bytes, served ${result.bytes}` });
	}
}

// The exclusions must genuinely not be there. If one started resolving, the
// allowlist quietly grew and the manifest stopped describing the distributable.
const leaked = [];
const EXCLUSION_PROBES = [
	"/shapes/circle.svg",
	"/platform-guides/x.png",
	"/open-graph/default.jpg",
	"/landing-page-dark.png",
	"/manifest.json",
];
for (const path of EXCLUSION_PROBES) {
	const result = await head(path);
	const present = result.status === 200 && result.contentType !== "text/html";
	if (present) leaked.push({ path, contentType: result.contentType, bytes: result.bytes });
}

console.log(`check-asset-manifest: ${checked} manifest entr(ies) against ${BASE}`);
console.log(`  ${failures.length === 0 ? "PASS" : "FAIL"}  every manifest entry is served with its recorded byte length`);
console.log(`  ${leaked.length === 0 ? "PASS" : "FAIL"}  no excluded public path is reachable`);
console.log(
	`\nRecorded totals: ${manifest.fileCount} copied files, ${(manifest.totalBytes / 1048576).toFixed(2)} MB` +
		(manifest.emitted ? `; ${manifest.emitted.fileCount} bundler-emitted files, ${(manifest.emitted.totalBytes / 1048576).toFixed(2)} MB` : ""),
);
console.log("(Sizes are measurements. This Slice makes no claim that any of them is adequate — spec §5.)");

if (failures.length > 0) {
	console.error("\nMissing or wrong:");
	for (const failure of failures) console.error(`  ${failure.path} — ${failure.why}`);
}
if (leaked.length > 0) {
	console.error("\nExcluded but reachable:");
	for (const leak of leaked) console.error(`  ${leak.path} — ${leak.contentType}, ${leak.bytes} bytes`);
}

if (failures.length > 0 || leaked.length > 0) process.exit(1);
console.log("\nclean");
