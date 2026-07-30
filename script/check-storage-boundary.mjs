#!/usr/bin/env node
/**
 * Browser-persistence boundary scan (S01 task 8.2, design D6).
 *
 * Asserts that direct browser-storage APIs — IndexedDB, OPFS, the StorageManager
 * quota API — are called only from `apps/web/src/services/storage/`, and that
 * host code (the Vite example) reaches persistence exclusively through
 * `BrowserHostAdapter`.
 *
 * The boundary this enforces is **provisional**. §3.5 asks S01 to establish a
 * single owner for browser persistence and to say plainly that no stable
 * contract is published yet; designing the real Host port is S02 work and an
 * explicit §5 exclusion. So this check guards the seam's location, not its
 * shape.
 *
 * Exits non-zero with a per-violation report.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The one area allowed to speak to the browser's storage APIs directly. */
const STORAGE_AREA = "apps/web/src/services/storage/";

/** Host code, which must go through `BrowserHostAdapter` instead. */
const HOST_AREA = "apps/vite-example/src/";

const STORAGE_APIS = [
	{ id: "indexeddb", pattern: /\b(?:window\.)?indexedDB\b/, description: "IndexedDB" },
	{ id: "opfs", pattern: /navigator\.storage\.getDirectory\b/, description: "OPFS root handle" },
	{ id: "quota", pattern: /navigator\.storage\.(?:estimate|persist|persisted)\b/, description: "StorageManager quota API" },
	{ id: "idb-factory", pattern: /\bIDBFactory\b|\bIDBDatabase\b|\bIDBObjectStore\b/, description: "IndexedDB type/constructor" },
];

/**
 * Files whose subject is the boundary itself. They name the APIs in prose and
 * would otherwise trip the scan on their own documentation.
 */
const POLICY_FILES = new Set([
	"script/check-storage-boundary.mjs",
	"apps/web/src/services/storage/browser-host-adapter.ts",
]);

/**
 * Verification code that reads persisted records **directly, on purpose**.
 *
 * The parity snapshot is required (task 9.5) to read the persisted project
 * through the storage service's own database and store names rather than through
 * any export path built for the comparison. Going through `BrowserHostAdapter`
 * here would test the adapter instead of testing what was actually persisted,
 * which is the one thing the snapshot exists to establish.
 *
 * This is not a widening of the boundary: it is test code, it never runs in a
 * host, and it is named individually rather than by directory so a second file
 * cannot quietly inherit the exemption. Each entry is printed by the check, so
 * the exemption cannot hide in the source.
 */
const VERIFICATION_FILES = new Map([
	[
		"apps/vite-example/tests/parity/snapshot.ts",
		"parity snapshot — reads persisted records directly, by design (task 9.5)",
	],
	[
		"apps/vite-example/tests/probe/seed.ts",
		"seeded-legacy-project probe — WRITES legacy records directly, by design: it stands in for an older build of the app, and no adapter can produce a v1-shaped record",
	],
	[
		"apps/vite-example/tests/probe/legacy-migration.pw.ts",
		"seeded-legacy-project probe — reads the migrated record and enumerates indexedDB.databases() directly, by design: the claim under test is what the migration runner wrote, so reading through BrowserHostAdapter would test the adapter instead",
	],
]);

// `--others --exclude-standard` alongside `--cached` because this change is
// reviewed before it is committed: a check that only sees tracked files would
// silently skip every file the change adds and still report a pass.
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps", "script"], {
	cwd: REPO_ROOT,
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024,
})
	.split("\0")
	.filter(Boolean)
	.filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path))
	.filter((path) => !POLICY_FILES.has(path))
	.filter((path) => !VERIFICATION_FILES.has(path))
	.filter((path) => !path.includes("__tests__/"));

const directUse = [];
const hostDirectUse = [];

for (const path of files) {
	let text;
	try {
		text = readFileSync(join(REPO_ROOT, path), "utf8");
	} catch {
		continue;
	}

	const lines = text.split(/\r?\n/);
	lines.forEach((line, index) => {
		// Comments describing the boundary are not calls across it.
		if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;

		for (const api of STORAGE_APIS) {
			if (!api.pattern.test(line)) continue;
			const hit = { path, line: index + 1, api: api.id, text: line.trim().slice(0, 140) };
			if (!path.startsWith(STORAGE_AREA)) directUse.push(hit);
			if (path.startsWith(HOST_AREA)) hostDirectUse.push(hit);
		}
	});
}

// The example must reach persistence through the adapter, and must be seen to.
const hostFiles = files.filter((path) => path.startsWith(HOST_AREA));
const adapterUsers = hostFiles.filter((path) =>
	/browser-host-adapter/.test(readFileSync(join(REPO_ROOT, path), "utf8")),
);

console.log(`check-storage-boundary: scanned ${files.length} source files (tracked + uncommitted)`);
for (const [path, why] of VERIFICATION_FILES) {
	console.log(`  EXEMPT  ${path} — ${why}`);
}
console.log(`  ${directUse.length === 0 ? "PASS" : "FAIL"}  browser storage APIs are called only inside ${STORAGE_AREA}`);
console.log(`  ${hostDirectUse.length === 0 ? "PASS" : "FAIL"}  host code makes no direct browser-storage call`);
console.log(
	`  ${adapterUsers.length > 0 ? "PASS" : "FAIL"}  host code reaches persistence through BrowserHostAdapter ` +
		`(${adapterUsers.length} file(s): ${adapterUsers.join(", ") || "none"})`,
);

if (directUse.length > 0) {
	console.error("\nDirect browser-storage use outside the storage area:");
	for (const hit of directUse) console.error(`  [${hit.api}] ${hit.path}:${hit.line}: ${hit.text}`);
}

if (adapterUsers.length === 0) {
	console.error(
		`\nNo file under ${HOST_AREA} imports BrowserHostAdapter. The boundary is only meaningful\n` +
			"if host code actually goes through it; an unused adapter is documentation, not a seam.",
	);
}

if (directUse.length > 0 || adapterUsers.length === 0) process.exit(1);

console.log("\nclean — note that this boundary is PROVISIONAL and publishes no stable contract (spec §3.5, §5).");
