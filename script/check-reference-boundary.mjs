#!/usr/bin/env node
/**
 * Reference-source boundary check (S01 task 2.8, design D12).
 *
 * OpenChatCut (0xsline/OpenChatCut@85ee5dfa) is an AGPL clean-room *design*
 * reference. Nothing derived from it — source, test, prompt, style, asset, or
 * Remotion-based implementation — may enter this repository. This check is the
 * mechanical half of that promise; see REFERENCE_SOURCES.md for the policy.
 *
 * Exits non-zero with a per-violation report.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Files whose *purpose* is to name the reference source. Excluded from the
 * scan; if the allowlist itself grew a copied implementation, the AGPL-header
 * and remotion rules below still apply to it.
 */
const POLICY_DOCS = new Set([
	"REFERENCE_SOURCES.md",
	"UPSTREAM.md",
	"PATCHES.md",
	"SBOM.md",
	"SOURCE_INVENTORY.md",
	"SOURCE_INVENTORY.json",
	"script/check-reference-boundary.mjs",
]);

/** Change artifacts are review material, not distributable code. */
const EXCLUDED_PREFIXES = ["rasen/"];

const TEXT_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss",
	".html", ".md", ".mdx", ".rs", ".toml", ".yml", ".yaml", ".txt", ".sh",
	".ps1", ".jsonc",
]);

const SOURCE_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".html",
	".rs", ".toml",
]);

const RULES = [
	{
		id: "no-openchatcut-reference",
		description: "no path or identifier referencing an OpenChatCut checkout",
		pattern: /openchatcut/i,
		applies: (path) => TEXT_EXTENSIONS.has(extname(path)),
	},
	{
		id: "no-remotion-dependency",
		description: "no `remotion` package in any manifest or lockfile",
		pattern: /(^|[^a-z-])remotion([^a-z-]|$)/i,
		applies: (path) =>
			path === "bun.lock" ||
			path.endsWith("package.json") ||
			path.endsWith("package-lock.json"),
	},
	{
		id: "no-agpl-header",
		description: "no AGPL / Affero license header in any source file",
		pattern: /affero|\bAGPL\b/i,
		applies: (path) => SOURCE_EXTENSIONS.has(extname(path)),
	},
];

// `--others --exclude-standard` alongside `--cached` because this change is
// reviewed before it is committed: a check that only sees tracked files would
// silently skip every file the change adds and still report a pass.
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
	cwd: REPO_ROOT,
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024,
})
	.split("\0")
	.filter(Boolean)
	.filter((p) => !POLICY_DOCS.has(p))
	.filter((p) => !EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix)));

const violations = [];
let scanned = 0;

for (const path of tracked) {
	const applicable = RULES.filter((r) => r.applies(path));
	if (applicable.length === 0) continue;

	const abs = join(REPO_ROOT, path);
	let stat;
	try {
		stat = statSync(abs);
	} catch {
		continue; // tracked but absent from the working tree
	}
	if (stat.size > 8 * 1024 * 1024) continue;

	const text = readFileSync(abs, "utf8");
	scanned += 1;

	for (const rule of applicable) {
		const lines = text.split(/\r?\n/);
		lines.forEach((line, i) => {
			if (rule.pattern.test(line)) {
				violations.push({ rule: rule.id, path, line: i + 1, text: line.trim().slice(0, 160) });
			}
		});
	}
}

console.log(`check-reference-boundary: scanned ${scanned} of ${tracked.length} files (tracked + uncommitted)`);
for (const rule of RULES) {
	const hits = violations.filter((v) => v.rule === rule.id).length;
	console.log(`  ${hits === 0 ? "PASS" : "FAIL"}  ${rule.id} — ${rule.description}${hits ? ` (${hits} hit(s))` : ""}`);
}

if (violations.length > 0) {
	console.error("\nViolations:");
	for (const v of violations) {
		console.error(`  [${v.rule}] ${v.path}:${v.line}: ${v.text}`);
	}
	process.exit(1);
}

console.log("clean");
