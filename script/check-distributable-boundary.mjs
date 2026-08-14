#!/usr/bin/env node
/**
 * Distributable-boundary assertion (S01 task 6.2, design D5 check 2).
 *
 * This is the authoritative measure of what §3.2 asks for: the production
 * editor bundle contains no Next.js runtime and no product-shell code. It reads
 * `dist/module-graph.json`, written by `apps/vite-example/build/module-graph.ts`
 * from Rollup's own module-id set, and fails if any forbidden module got in.
 *
 * It asserts over module ids rather than over emitted text on purpose. Grepping
 * the bundle for `next/image` returns two hits that are not Next at all — the
 * substring straddles `conv` + `next/image` inside `@huggingface/transformers`'
 * `convnext/image_processing_convnext.js` — and minification renames identifiers,
 * so a text scan is unsound in both directions.
 *
 *   node script/check-distributable-boundary.mjs [path/to/module-graph.json]
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_GRAPH = join(REPO_ROOT, "apps", "vite-example", "dist", "module-graph.json");

/**
 * Each rule names what must not be in the bundle and why it would matter.
 * `test` runs against a repo-relative POSIX module id, or the raw id for
 * virtual modules.
 */
const RULES = [
	{
		id: "no-next-runtime",
		description: "no Next.js runtime module",
		why: "§3.2 — the distributable editor must run with no Next.js runtime.",
		test: (id) => /(^|\/)node_modules\/next\//.test(id) || /(^|\/)node_modules\/next$/.test(id),
	},
	{
		id: "no-app-router",
		description: "no Next app-router source",
		why: "The app router is the Next host. Its presence would mean the editor still owns the page.",
		test: (id) => id.startsWith("apps/web/src/app/"),
	},
	{
		id: "no-site-code",
		description: "no marketing-site source",
		why: "§3.2 — product-shell code must be absent from the distributable graph. The editor's three former `@/site/*` constants are supplied through `EditorHost` (ruling R3, patches P-007/P-009/P-010/P-014).",
		test: (id) => id.startsWith("apps/web/src/site/"),
	},
	{
		id: "no-blog",
		description: "no blog source",
		why: "Product-shell content.",
		test: (id) => id.startsWith("apps/web/src/blog/"),
	},
	{
		id: "no-database",
		description: "no database source",
		why: "§3.2 — no cloud or persistence-service code in the editor graph.",
		test: (id) => id.startsWith("apps/web/src/db/"),
	},
	{
		id: "no-auth",
		description: "no authentication source",
		why: "§3.2 — no auth code in the editor graph.",
		test: (id) => id.startsWith("apps/web/src/auth/"),
	},
	{
		id: "no-landing",
		description: "no landing-page components",
		why: "Marketing surface, not editor behaviour.",
		test: (id) => id.startsWith("apps/web/src/components/landing/"),
	},
	{
		id: "no-changelog-notification",
		description: "no changelog notification component",
		why: "It transitively imports `content-collections`. Excluded from `EditorRoot` and kept in the Next host (P-010).",
		test: (id) => id.includes("changelog-notification"),
	},
	{
		id: "no-content-collections",
		description: "no content-collections virtual module",
		why: "A Next-build-time generated module with no equivalent outside Next. Reaching it would mean the graph cannot build without Next at all — the failure a source-level import scan cannot see.",
		test: (id) => id.includes("content-collections"),
	},
	{
		id: "no-desktop-app",
		description: "no apps/desktop source",
		why: "The GPUI experiment is explicitly excluded and is not a second Host.",
		test: (id) => id.startsWith("apps/desktop/"),
	},
];

const graphPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_GRAPH;

if (!existsSync(graphPath)) {
	console.error(`check-distributable-boundary: no module graph at ${graphPath}`);
	console.error("Produce one with a production build: cd apps/vite-example && bun run build");
	process.exit(2);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const modules = graph.modules ?? [];

if (modules.length === 0) {
	console.error("check-distributable-boundary: the module graph is empty — refusing to report a pass.");
	process.exit(2);
}

const violations = [];
for (const rule of RULES) {
	for (const id of modules) {
		if (rule.test(id)) violations.push({ rule, id });
	}
}

console.log(`check-distributable-boundary: ${modules.length} module(s) in ${relative(REPO_ROOT, graphPath).split("\\").join("/")}`);
for (const rule of RULES) {
	const hits = violations.filter((violation) => violation.rule.id === rule.id).length;
	console.log(`  ${hits === 0 ? "PASS" : "FAIL"}  ${rule.id} — ${rule.description}${hits ? ` (${hits} module(s))` : ""}`);
}

// A quick shape report, so a passing run still shows what the bundle is made of
// rather than only what it lacks.
const editorModules = modules.filter(
	(id) =>
		id.startsWith("apps/web/src/") ||
		id.startsWith("packages/editor-classic/src/") ||
		id.startsWith("packages/editor-contracts/src/") ||
		id.startsWith("packages/editor-ports/src/"),
).length;
const exampleModules = modules.filter((id) => id.startsWith("apps/vite-example/")).length;
const dependencyModules = modules.filter((id) => id.includes("node_modules/")).length;
console.log(
	`\nComposition: ${editorModules} from the editor packages, ${exampleModules} from the example host, ` +
		`${dependencyModules} from dependencies, ${modules.length - editorModules - exampleModules - dependencyModules} other.`,
);

if (violations.length > 0) {
	console.error("\nViolations:");
	for (const violation of violations) {
		console.error(`  [${violation.rule.id}] ${violation.id}`);
		console.error(`    ${violation.rule.why}`);
	}
	console.error(
		"\nExclude the component that reaches the forbidden module rather than aliasing a stub.\n" +
			"A stub hides exactly the coupling this Slice exists to measure.",
	);
	process.exit(1);
}

console.log("\nclean");
