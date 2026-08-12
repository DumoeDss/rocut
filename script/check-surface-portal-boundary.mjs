#!/usr/bin/env node
/** Fail-closed private Surface portal ownership check. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = [
	"apps/web/src/components/ui/alert-dialog.tsx",
	"apps/web/src/components/ui/context-menu.tsx",
	"apps/web/src/components/ui/dialog.tsx",
	"apps/web/src/components/ui/dropdown-menu.tsx",
	"apps/web/src/components/ui/menubar.tsx",
	"apps/web/src/components/ui/popover.tsx",
	"apps/web/src/components/ui/select.tsx",
	"apps/web/src/components/ui/sheet.tsx",
	"apps/web/src/components/ui/tooltip.tsx",
	"apps/web/src/components/editor/panels/assets/draggable-item.tsx",
	"apps/web/src/timeline/components/audio-volume-line.tsx",
];

function files() {
	return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps/web/src"], {
		cwd: ROOT,
		encoding: "utf8",
	}).split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
}

function scan(path, source) {
	const hits = [];
	const isRequired = REQUIRED.includes(path);
	if (isRequired && !/useSurfacePortal(?:Container|Owner)/.test(source)) hits.push("missing-private-owner");
	if (isRequired && /createPortal\s*\([^,]+,\s*document\.body/s.test(source)) hits.push("body-portal");
	if (/editor\/surface\/embedding\/(?:index|types)\.ts$/.test(path) && /surface-portal|SurfacePortal|HTMLElement|DocumentFragment/.test(source)) hits.push("public-owner-leak");
	return hits.map((rule) => ({ path, rule }));
}

function controls() {
	const missing = scan(REQUIRED[0], "export const Dialog = () => <Portal />");
	const body = scan(REQUIRED.at(-1), "useSurfacePortalOwner(); createPortal(node, document.body)");
	const host = scan("apps/web/src/components/toaster.tsx", "createPortal(node, document.body)");
	const owned = scan(REQUIRED[1], "const owner = useSurfacePortalContainer(); return <Portal container={owner} />");
	const pass = missing.some((x) => x.rule === "missing-private-owner") && body.some((x) => x.rule === "body-portal") && host.length === 0 && owned.length === 0;
	console.log(`  ${missing.length ? "PASS" : "FAIL"} negative — missing editor owner is caught`);
	console.log(`  ${body.length ? "PASS" : "FAIL"} negative — body escape is caught`);
	console.log(`  ${host.length === 0 ? "PASS" : "FAIL"} converse — Host portal remains outside scope`);
	console.log(`  ${owned.length === 0 ? "PASS" : "FAIL"} converse — private owned portal passes`);
	if (!pass) process.exit(1);
}

if (process.argv.includes("--negative-control") || process.argv.includes("--converse-control")) {
	controls();
} else {
	const all = files();
	const selected = all.filter((path) => REQUIRED.includes(path) || /editor\/surface\/embedding\/(?:index|types)\.ts$/.test(path));
	if (selected.length < REQUIRED.length + 2) {
		console.error(`check-surface-portal-boundary: refusing incomplete scan (${selected.length}/${REQUIRED.length + 2})`);
		process.exit(2);
	}
	const hits = selected.flatMap((path) => scan(path, readFileSync(join(ROOT, path), "utf8")));
	console.log(`check-surface-portal-boundary: scanned ${selected.length} tracked + uncommitted file(s)`);
	for (const hit of hits) console.error(`  FAIL [${hit.rule}] ${hit.path}`);
	if (hits.length) process.exit(1);
	console.log("clean");
}
