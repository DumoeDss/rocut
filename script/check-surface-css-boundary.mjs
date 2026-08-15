#!/usr/bin/env node
/** Fail-closed source and emitted CSS ownership check for the distributable Surface. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "packages/editor-classic/src/surface/surface.css";
const DIST = "apps/vite-example/dist-surface-css";

function trackedAndUncommittedCss() {
	return execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard", SOURCE],
		{
			cwd: ROOT,
			encoding: "utf8",
		},
	)
		.split("\0")
		.filter(Boolean)
		.map((path) => path.replaceAll("\\", "/"));
}

function emittedCss() {
	const distRoot = join(ROOT, DIST);
	if (!existsSync(distRoot)) return [];
	return readdirSync(distRoot, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
		.map((entry) =>
			relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
		)
		.sort();
}

function violations(path, css) {
	const hits = [];
	if (/(^|[},])\s*:root\b/m.test(css)) hits.push("editor-root-selector");
	if (path.startsWith(`${DIST}/`)) {
		for (const marker of [".size-full", ".bg-background", ".flex{"]) {
			if (!css.includes(marker)) hits.push(`missing-emitted-utility:${marker}`);
		}
	}
	if (/(^|[},])\s*(?:html|body)(?:\b|[.:#\[])/m.test(css))
		hits.push("editor-host-selector");
	if (!css.includes("[data-editor-surface]")) hits.push("missing-namespace");
	if (!/contain\s*:\s*layout\s+style\s+paint/.test(css))
		hits.push("missing-containment");
	if (!/isolation\s*:\s*isolate/.test(css)) hits.push("missing-isolation");
	return hits.map((rule) => ({ path, rule }));
}

function runControls() {
	const negative = violations(
		SOURCE,
		":root { --background: red } body { margin: 0 } [data-editor-surface] { color:red }",
	);
	const converse = violations(
		"apps/vite-example/src/styles.css",
		"body { margin: 0 }",
	);
	const sameOwnedRoot = violations(
		SOURCE,
		":where([data-editor-surface]) { contain: layout style paint; isolation: isolate; --background:white }",
	);
	const pass =
		negative.some((hit) => hit.rule === "editor-root-selector") &&
		negative.some((hit) => hit.rule === "editor-host-selector") &&
		converse.length > 0 &&
		sameOwnedRoot.length === 0;
	console.log(
		`  ${negative.length >= 2 ? "PASS" : "FAIL"} negative — root/body violations are caught`,
	);
	console.log(
		`  ${converse.length > 0 ? "PASS" : "FAIL"} converse — Host CSS is outside the distributable scan`,
	);
	console.log(
		`  ${sameOwnedRoot.length === 0 ? "PASS" : "FAIL"} converse — owned selectors and containment pass`,
	);
	if (!pass) process.exit(1);
}

if (
	process.argv.includes("--negative-control") ||
	process.argv.includes("--converse-control")
) {
	runControls();
} else {
	const source = trackedAndUncommittedCss();
	const emitted = emittedCss();
	if (source.length === 0 || emitted.length === 0) {
		console.error(
			`check-surface-css-boundary: refusing empty scan (source=${source.length}, emitted=${emitted.length})`,
		);
		process.exit(2);
	}
	const files = [...source, ...emitted];
	const hits = files.flatMap((path) =>
		violations(path, readFileSync(join(ROOT, path), "utf8")),
	);
	console.log(
		`check-surface-css-boundary: scanned ${source.length} source and ${emitted.length} emitted CSS file(s)`,
	);
	for (const hit of hits) console.error(`  FAIL [${hit.rule}] ${hit.path}`);
	if (hits.length) process.exit(1);
	console.log("clean");
}
