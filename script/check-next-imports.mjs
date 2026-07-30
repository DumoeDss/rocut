#!/usr/bin/env node
/**
 * Source-level Next-import allowlist (S01 task 6.3, design D5 check 1).
 *
 * Asserts that every file importing `next/*` lives in the product shell — the
 * Next app router and the marketing-site components — and that no file in the
 * editor graph does.
 *
 * This is the fast check. It needs no build, so it catches a reintroduced Next
 * import at edit time rather than at bundle time. It is **not** the
 * authoritative one: a source scan cannot see Next-build-time virtual modules
 * such as `content-collections`, which reach the graph without any `next/`
 * import appearing anywhere. That is what `check-distributable-boundary.mjs`
 * is for. Run both.
 *
 * **Scope is deliberately `apps/web/src` only, not `apps/vite-example`.** The
 * two checks divide the work rather than overlapping it: this one guards the
 * shared editor source, where a Next import would be a real regression, while
 * the example host is covered by `check-distributable-boundary.mjs`, which
 * asserts over the built Rollup module set and would catch a Next import from
 * the example whether it came from source or from a dependency. Widening this
 * scan would duplicate that coverage at source level while still missing what
 * only the bundle-level check can see.
 *
 * Exits non-zero with a per-violation report.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "apps/web/src/";

/**
 * Where a Next import is legitimate: the app router and the marketing-site
 * components. Each of these is excluded from the distributable graph by the
 * bundle-level boundary check, so an import here cannot reach the editor.
 */
const SHELL_ALLOWLIST = [
	{ prefix: "apps/web/src/app/", why: "the Next app router itself — routes, layouts, metadata and API handlers" },
	{ prefix: "apps/web/src/changelog/components/", why: "changelog UI, rendered only by the Next shell (see P-010)" },
	{ prefix: "apps/web/src/components/landing/", why: "marketing landing page" },
	{ path: "apps/web/src/components/header.tsx", why: "site header, not the editor header" },
	{ path: "apps/web/src/components/footer.tsx", why: "site footer" },
	{ path: "apps/web/src/components/gitHub-contribute-section.tsx", why: "marketing section on the landing page" },
];

/**
 * Editor-owned source roots. Nothing here may import `next/*`, and — the point
 * of stating them separately — none of them may ever be added to the allowlist
 * above. Without this, a future failure could be "fixed" by widening the
 * allowlist, which would turn the check into a no-op while still reporting
 * green.
 */
const EDITOR_ROOTS = [
	"actions/", "animation/", "background/", "canvas/", "clipboard/", "commands/",
	"components/editor/", "components/icons/", "components/providers/", "components/ui/",
	"core/", "data/", "diagnostics/", "editor/", "effects/", "export/", "feedback/",
	"fonts/", "fps/", "gradients/", "graphics/", "guides/", "hooks/", "masks/",
	"media/", "panels/", "params/", "preview/", "project/", "rendering/", "retime/",
	"ripple/", "selection/", "services/", "sounds/", "speed/", "stickers/",
	"subtitles/", "text/", "timeline/", "transcription/", "types/", "utils/", "wasm/",
].map((suffix) => SRC + suffix);

const IMPORT_PATTERNS = [
	/^\s*import\s[^;]*?from\s+["']next(\/[^"']*)?["']/m,
	/^\s*import\s+["']next(\/[^"']*)?["']/m,
	/\bfrom\s+["']next(\/[^"']*)?["']/,
	/\brequire\(\s*["']next(\/[^"']*)?["']\s*\)/,
	/\bimport\(\s*["']next(\/[^"']*)?["']\s*\)/,
];

// `--others --exclude-standard` alongside `--cached` because this change is
// reviewed before it is committed: a check that only sees tracked files would
// silently skip every file the change adds and still report a pass.
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps/web/src"], {
	cwd: REPO_ROOT,
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024,
})
	.split("\0")
	.filter(Boolean)
	.filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path));

// Guard the allowlist against itself before using it.
const overlaps = SHELL_ALLOWLIST.filter((entry) =>
	EDITOR_ROOTS.some((root) => (entry.prefix ?? entry.path).startsWith(root)),
);
if (overlaps.length > 0) {
	console.error("check-next-imports: the shell allowlist covers editor source, which would void this check:");
	for (const entry of overlaps) console.error(`  ${entry.prefix ?? entry.path}`);
	process.exit(2);
}

function allowedBy(path) {
	return SHELL_ALLOWLIST.find((entry) =>
		entry.prefix ? path.startsWith(entry.prefix) : path === entry.path,
	);
}

const importers = [];
for (const path of files) {
	let text;
	try {
		text = readFileSync(join(REPO_ROOT, path), "utf8");
	} catch {
		continue; // tracked but absent from the working tree
	}

	const lines = text.split(/\r?\n/);
	const hits = [];
	lines.forEach((line, index) => {
		if (IMPORT_PATTERNS.some((pattern) => pattern.test(line))) {
			hits.push({ line: index + 1, text: line.trim().slice(0, 140) });
		}
	});

	if (hits.length > 0) importers.push({ path, hits });
}

const violations = importers.filter((importer) => !allowedBy(importer.path));
const inEditor = violations.filter((violation) => EDITOR_ROOTS.some((root) => violation.path.startsWith(root)));

console.log(`check-next-imports: scanned ${files.length} source files (tracked + uncommitted) under ${SRC}`);
console.log(`  ${importers.length} file(s) import next/*, ${importers.length - violations.length} of them inside the allowlisted product shell`);
console.log(`  ${violations.length === 0 ? "PASS" : "FAIL"}  every next/* importer is product-shell code`);
console.log(`  ${inEditor.length === 0 ? "PASS" : "FAIL"}  no editor-graph file imports next/*`);

if (violations.length > 0) {
	console.error("\nViolations:");
	for (const violation of violations) {
		for (const hit of violation.hits) {
			console.error(`  ${violation.path}:${hit.line}: ${hit.text}`);
		}
	}
	console.error(
		"\nA next/* import outside the product shell must be replaced by a host seam, not allowlisted.\n" +
			"See apps/web/src/editor/host/editor-host.ts and PATCHES.md P-007..P-010.",
	);
	process.exit(1);
}

console.log("\nAllowlisted shell importers:");
for (const importer of importers) {
	console.log(`  ${importer.path} — ${allowedBy(importer.path).why}`);
}
console.log("\nclean");
