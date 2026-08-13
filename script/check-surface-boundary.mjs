#!/usr/bin/env node
/**
 * R1 Surface embedding boundary check.
 *
 * Scans tracked and uncommitted Surface modules and rejects public type leaks,
 * Next/product-shell imports, viewport ownership, and Surface-owned global input
 * listeners. Run with `--negative-control` to prove every rule can fail and the
 * three deliberate converse cases remain allowed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SURFACE_ROOT = "apps/web/src/editor/surface/";
const PUBLIC_CONTRACT = new Set([
	`${SURFACE_ROOT}embedding/types.ts`,
	`${SURFACE_ROOT}embedding/index.ts`,
]);
const COORDINATOR_PATH = `${SURFACE_ROOT}embedding/surface-drag-coordinator.tsx`;
/**
 * The only global input events the private drag coordinator may own, and only
 * while a drag is live. `dragover`/`dragend`/`drop` are absent because the
 * `no-global-input-listener` pattern never matches them in the first place.
 */
const COORDINATOR_CONTINUATION_EVENTS = new Set([
	"mousemove",
	"mouseup",
	"pointermove",
	"pointerup",
	"pointercancel",
]);

function isRuntimeSurfacePath(path) {
	return (
		path.startsWith(SURFACE_ROOT) &&
		!path.includes("/__tests__/") &&
		!path.includes("/evidence/")
	);
}

function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const RULES = [
	{
		id: "no-public-provider-type-leak",
		description:
			"public Surface types remain opaque and do not expose T0/provider-private implementation types",
		test: ({ path, code }) =>
			PUBLIC_CONTRACT.has(path) &&
			/\b(?:TransactionApply|TransactionBatch|TransactionResult|EditorCore|SessionOpenCutTransactions|OpenCut|Zustand|IDB(?:Database|ObjectStore|Transaction)|IndexedDB|OPFS|[A-Za-z]+Command|[A-Za-z]+Store)\b/.test(
				code,
			),
	},
	{
		id: "no-next-or-product-shell-import",
		description:
			"Surface modules do not import Next, app-router, auth, changelog, site, or content-collections code",
		test: ({ code }) =>
			/from\s+["'](?:next(?:\/[^"']*)?|@\/(?:app|auth|changelog|site|blog|db)(?:\/[^"']*)?|content-collections)["']/.test(
				code,
			) ||
			/import\s*\(\s*["'](?:next(?:\/[^"']*)?|@\/(?:app|auth|changelog|site|blog|db)(?:\/[^"']*)?|content-collections)["']\s*\)/.test(
				code,
			),
	},
	{
		id: "no-viewport-ownership",
		description:
			"Surface modules fill their supplied container without viewport/body/html ownership",
		test: ({ code }) =>
			/\b(?:h-screen|w-screen|100vh|100vw|window\s*\.\s*innerWidth|window\s*\.\s*innerHeight)\b/.test(
				code,
			) ||
			/(?:document\s*\.\s*)?(?:body|documentElement)\s*\.\s*style\s*[.=]/.test(
				code,
			),
	},
	{
		id: "no-global-input-listener",
		description:
			"Surface modules add no keyboard, pointer, wheel, mouse, or touch listener to window/document",
		// The private drag coordinator is the one allowlisted owner of document-level
		// continuation listeners (design.md D7), but the allowance is scoped to the
		// exact events it installs. A whole-file exemption would also wave through a
		// `keydown`, `wheel`, `mousedown` or `touchstart` added to that file later,
		// which is precisely the global input ownership this rule exists to forbid.
		test: ({ path, code }) => {
			const matches = code.matchAll(
				/\b(window|document)\s*\.\s*addEventListener\s*\(\s*["'](key(?:down|up|press)|pointer(?:down|up|move|cancel)|wheel|mouse(?:down|up|move)|touch(?:start|end|move|cancel))["']/g,
			);
			for (const [, target, event] of matches) {
				if (
					path === COORDINATOR_PATH &&
					target === "document" &&
					COORDINATOR_CONTINUATION_EVENTS.has(event)
				) {
					continue;
				}
				return true;
			}
			return false;
		},
	},
];

function scan({ path, source }) {
	const code = stripComments(source);
	return RULES.filter((rule) => rule.test({ path, code })).map((rule) => ({
		rule: rule.id,
		path,
	}));
}

function surfaceFiles() {
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"apps/web/src/editor/surface",
		],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.map((path) => path.replaceAll("\\", "/"))
		.filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path))
		.filter(isRuntimeSurfacePath)
		.filter((path) => existsSync(join(REPO_ROOT, path)));
}

const NEGATIVE_FIXTURES = [
	{
		rule: "no-public-provider-type-leak",
		path: `${SURFACE_ROOT}embedding/types.ts`,
		source:
			'import type { EditorCore } from "@/core"; export interface EditorSurfaceProps { core: EditorCore }',
	},
	{
		rule: "no-next-or-product-shell-import",
		path: `${SURFACE_ROOT}embedding/editor-surface.tsx`,
		source: 'import { useRouter } from "next/navigation"; void useRouter;',
	},
	{
		rule: "no-viewport-ownership",
		path: `${SURFACE_ROOT}embedding/editor-surface.tsx`,
		source: 'export const className = "size-full h-screen";',
	},
	{
		rule: "no-global-input-listener",
		path: `${SURFACE_ROOT}embedding/surface-focus.ts`,
		source: 'document.addEventListener("keydown", handleKeyDown);',
	},
	{
		rule: "no-global-input-listener",
		path: COORDINATOR_PATH,
		source: 'document.addEventListener("keydown", handleKeyDown);',
		note: "the coordinator's allowance is per-event, so a non-drag listener in that same file still fails",
	},
	{
		rule: "no-global-input-listener",
		path: COORDINATOR_PATH,
		source: 'window.addEventListener("mousemove", handleMouseMove);',
		note: "…and window-scoped ownership is refused even for an allowed drag event",
	},
];

const CONVERSE_FIXTURES = [
	{
		path: `${SURFACE_ROOT}embedding/surface-transaction-binding.ts`,
		source:
			'import type { TransactionApply, TransactionBatch } from "@/editor/contracts"; export const adapt = (apply: TransactionApply, batch: TransactionBatch) => apply.apply(batch);',
		note: "private T0 adapter imports are allowed",
	},
	{
		path: `${SURFACE_ROOT}embedding/surface-focus.ts`,
		source: 'root.addEventListener("wheel", handleWheel, { passive: false });',
		note: "container listeners are allowed",
	},
	{
		path: "apps/web/src/app/editor/[project_id]/page.tsx",
		source: 'export const className = "h-screen w-screen";',
		note: "Host-owned viewport wrappers are outside the Surface scan",
	},
	{
		path: `${SURFACE_ROOT}evidence/surface-evidence-harness.tsx`,
		source: 'export const style = { minHeight: "100vh" };',
		note: "explicit evidence-only measurement harnesses are outside the runtime Surface scan",
	},
];

function runNegativeControl() {
	let clean = true;
	console.log("check-surface-boundary: negative and converse controls");
	for (const fixture of NEGATIVE_FIXTURES) {
		const caught = scan(fixture).some((hit) => hit.rule === fixture.rule);
		if (!caught) clean = false;
		console.log(
			`  ${caught ? "PASS" : "FAIL"}  ${fixture.rule} — deliberate violation ${caught ? "caught" : "missed"}`,
		);
	}
	for (const fixture of CONVERSE_FIXTURES) {
		const inScope = isRuntimeSurfacePath(fixture.path);
		const hits = inScope ? scan(fixture) : [];
		const allowed = hits.length === 0;
		if (!allowed) clean = false;
		console.log(`  ${allowed ? "PASS" : "FAIL"}  converse — ${fixture.note}`);
	}
	if (!clean) process.exit(1);
	console.log(
		"\nPASS  every rule can fail and all converse controls remain allowed",
	);
}

function runCheck() {
	const files = surfaceFiles();
	if (files.length === 0) {
		console.error(
			"check-surface-boundary: no Surface modules found; refusing an empty-scan pass",
		);
		process.exit(2);
	}
	const violations = files.flatMap((path) =>
		scan({ path, source: readFileSync(join(REPO_ROOT, path), "utf8") }),
	);
	console.log(
		`check-surface-boundary: scanned ${files.length} Surface module(s) (tracked + uncommitted)`,
	);
	for (const rule of RULES) {
		const count = violations.filter(
			(violation) => violation.rule === rule.id,
		).length;
		console.log(
			`  ${count === 0 ? "PASS" : "FAIL"}  ${rule.id}: ${rule.description}`,
		);
	}
	if (violations.length > 0) {
		console.error("\nSurface-boundary violations:");
		for (const violation of violations) {
			console.error(`  [${violation.rule}] ${violation.path}`);
		}
		process.exit(1);
	}
	console.log("\nclean — run with --negative-control to prove each rule");
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else runCheck();
