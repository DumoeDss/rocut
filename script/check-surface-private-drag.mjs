#!/usr/bin/env node
/** Fail-closed checker for provider-private document drag ownership. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COORDINATOR = "packages/editor-classic/src/editor/surface/embedding/surface-drag-coordinator.tsx";
const PUBLIC = new Set([
	"packages/editor-classic/src/editor/surface/embedding/index.ts",
	"packages/editor-classic/src/editor/surface/embedding/types.ts",
]);
const EVENTS = ["mousemove", "mouseup", "pointermove", "pointerup", "pointercancel", "dragover", "dragend", "drop"];
/**
 * Files that keep a global listener pair as an explicit fallback for callers
 * rendering them OUTSIDE a Surface. Each resolves the coordinator through
 * `useOptionalSurfaceDragCoordinator()` and prefers it whenever one exists, so
 * inside a Surface the continuation is still owner-bounded. Listed by exact path
 * so a new ungoverned global listener anywhere else still fails.
 */
const FALLBACK_ALLOWED = new Set([
	"packages/editor-classic/src/components/ui/number-field.tsx",
	"packages/editor-classic/src/selection/hooks/use-box-select.ts",
]);
/**
 * Host and product-shell surfaces, which are outside the editor claim entirely —
 * the same category the portal checker leaves to the Host. A marketing landing
 * page owning its own drag listeners is not an editor drag continuation.
 */
const HOST_OWNED_PREFIXES = [
	"apps/web/src/app/",
	"apps/web/src/components/landing/",
	"apps/web/src/components/site/",
	"apps/web/src/components/blog/",
	"apps/web/src/components/changelog/",
];

function files() {
	return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps/web/src", "packages/editor-classic/src"], {
		cwd: ROOT,
		encoding: "utf8",
	}).split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
}

function scan(path, source) {
	const hits = [];
	if (PUBLIC.has(path) && /SurfaceDrag|surface-drag-coordinator/.test(source)) hits.push("public-private-leak");
	// `window` as well as `document`: a `window.addEventListener("mousemove", …)`
	// continues a drag exactly as a document one does, and scanning only
	// `document` let two real editor drags (timeline scrub, box select) keep
	// ungoverned global listeners through the whole of R2.
	const globalAdds = [...source.matchAll(/(?:document|window)\.addEventListener\("([^"]+)"/g)].map((match) => match[1]).filter((event) => EVENTS.includes(event));
	// The fallback allowance is CONDITIONAL, not a path exemption: the file must
	// actually resolve the optional coordinator and register with it. A blanket
	// path skip would let a later edit delete the coordinator branch and keep only
	// the global pair — the same evasion a whole-file exemption allowed elsewhere.
	const prefersCoordinator =
		source.includes("useOptionalSurfaceDragCoordinator") &&
		/dragCoordinator\.start\(/.test(source);
	if (path !== COORDINATOR && globalAdds.length && !(FALLBACK_ALLOWED.has(path) && prefersCoordinator)) hits.push("outside-coordinator-listener");
	if (path === COORDINATOR) {
		for (const event of EVENTS) {
			const adds = source.match(new RegExp(`document\\.addEventListener\\("${event}"`, "g"))?.length ?? 0;
			const removes = source.match(new RegExp(`document\\.removeEventListener\\("${event}"`, "g"))?.length ?? 0;
			if (adds !== 1 || removes !== 1) hits.push(`unpaired-${event}`);
		}
		if (!source.includes('owner = Symbol("surface-drag-owner")') || !source.includes("active.owner !== this.owner")) hits.push("missing-owner-discrimination");
		if (!source.includes("active.pointerId !== event.pointerId")) hits.push("missing-pointer-discrimination");
		if (!source.includes("this.active = null;") || !/this\.active = null;\s*this\.removeListeners\(active\)/.test(source)) hits.push("non-synchronous-cleanup");
	}
	return hits.map((rule) => ({ path, rule }));
}

function controls() {
	const persistent = scan("apps/web/src/editor/surface/embedding/other.ts", 'document.addEventListener("pointermove", move)');
	const unpaired = scan(COORDINATOR, 'private owner = Symbol("surface-drag-owner"); document.addEventListener("pointermove", move)');
	const leak = scan([...PUBLIC][0], 'export { SurfaceDragProvider } from "./surface-drag-coordinator"');
	const root = scan("apps/web/src/editor/surface/embedding/surface-focus.ts", 'root.addEventListener("pointermove", move)');
	// A FALLBACK_ALLOWED file that has dropped its coordinator branch must fail.
	const staleFallback = scan([...FALLBACK_ALLOWED][0], 'document.addEventListener("pointermove", move)');
	const honestFallback = scan([...FALLBACK_ALLOWED][0], 'const c = useOptionalSurfaceDragCoordinator(); if (c) return dragCoordinator.start({}); document.addEventListener("pointermove", move)');
	// The `window`-scoped case specifically: scanning only `document` is what let
	// the timeline scrub and box-select keep ungoverned continuations.
	const windowScoped = scan("apps/web/src/timeline/controllers/other-controller.ts", 'window.addEventListener("mousemove", move)');
	const outsideEmbedding = scan("apps/web/src/timeline/hooks/other-hook.ts", 'document.addEventListener("mouseup", up)');
	const pass = persistent.length > 0 && unpaired.length > 0 && leak.length > 0 && root.length === 0 && windowScoped.length > 0 && outsideEmbedding.length > 0 && staleFallback.length > 0 && honestFallback.length === 0;
	console.log(`  ${staleFallback.length ? "PASS" : "FAIL"} negative — a fallback file that dropped its coordinator branch is caught`);
	console.log(`  ${honestFallback.length === 0 ? "PASS" : "FAIL"} converse — a coordinator-preferring fallback is allowed`);
	console.log(`  ${windowScoped.length ? "PASS" : "FAIL"} negative — window-scoped global drag is caught`);
	console.log(`  ${outsideEmbedding.length ? "PASS" : "FAIL"} negative — a drag outside surface/embedding/ is caught`);
	console.log(`  ${persistent.length ? "PASS" : "FAIL"} negative — outside global drag is caught`);
	console.log(`  ${unpaired.length ? "PASS" : "FAIL"} negative — missing cleanup/owner is caught`);
	console.log(`  ${leak.length ? "PASS" : "FAIL"} negative — public leakage is caught`);
	console.log(`  ${root.length === 0 ? "PASS" : "FAIL"} converse — root listener is allowed`);
	if (!pass) process.exit(1);
}

if (process.argv.includes("--negative-control") || process.argv.includes("--converse-control")) {
	controls();
} else {
	// Scan the whole editor source tree, not just `surface/embedding/`. The
	// narrow scope was the reason two genuine editor drag continuations were never
	// seen by this checker; drag sites live in `timeline/`, `selection/` and
	// `components/ui/` far more often than in the embedding directory.
	const selected = files().filter(
		(path) =>
			/\.(?:ts|tsx)$/.test(path) &&
			!path.includes("/__tests__/") &&
			!HOST_OWNED_PREFIXES.some((prefix) => path.startsWith(prefix)),
	);
	if (!selected.includes(COORDINATOR) || selected.length < 200) {
		console.error("check-surface-private-drag: refusing empty/incomplete scan");
		process.exit(2);
	}
	const hits = selected.flatMap((path) => scan(path, readFileSync(join(ROOT, path), "utf8")));
	console.log(`check-surface-private-drag: scanned ${selected.length} tracked + uncommitted file(s)`);
	for (const hit of hits) console.error(`  FAIL [${hit.rule}] ${hit.path}`);
	if (hits.length) process.exit(1);
	console.log("clean");
}
