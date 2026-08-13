#!/usr/bin/env node
/**
 * SDK package-boundary check (S05 child P0, design.md this change ships with).
 *
 * `packages/` declares three publishable packages — `@opencut/editor-ports` (layer 0,
 * no dependencies), `@opencut/editor-contracts` (layer 1, depends on 0) and
 * `@opencut/editor-classic` (layer 2, depends on 0 and 1) — but holds no source yet.
 * `packages/boundary.json` assigns every module still living under `apps/web/src` to
 * exactly one package or to a consumer application. This check proves the CURRENT
 * source graph already obeys that declared shape, before P1 moves a single file.
 *
 * Five rules:
 *
 *   1. acyclic-direction    every edge crossing a package boundary points to a
 *                           strictly lower declared layer (design D2: 8 production
 *                           edges run contracts→ports, 0 the other way — ports sits
 *                           at the BOTTOM, the reverse of the intuitive reading).
 *   2. public-entry-only    a specifier reaching into a package resolves only to a
 *                           subpath its manifest's `exports` map declares.
 *   3. no-internal-reexport no package's declared entry re-exports a module owned by
 *                           another package's undeclared internals.
 *   4. no-elftia-import     no package, Host or example imports an Elftia package,
 *                           protocol identifier or runtime object, and no Elftia
 *                           package appears in any manifest or lockfile (decision B3).
 *                           There is no exception for `adapter-elftia` — it does not
 *                           exist in this repository and never will.
 *   5. react-free-base      `@opencut/editor-ports` and `@opencut/editor-contracts`
 *                           import no React, no DOM global, and no module owned by
 *                           `@opencut/editor-classic` (spec §3.5, mechanically).
 *
 * Rules 1, 4 and 5 are LIVE today, over `apps/web/src` and `apps/vite-example` via
 * `boundary.json`. Rules 2 and 3 are asserted over `packages/**\/src`, which holds no
 * source at this commit — they report `0 files scanned` honestly rather than a
 * `PASS` that inspected nothing (design D6). All five are still fully control-tested
 * today: both `--negative-control` and `--converse-control` run the same pure
 * `scan()` against in-memory fixtures, so a dormant rule's ability to fire is proven
 * before it ever sees real source.
 *
 * **The Elftia rule matches specifiers, dependency names and identifiers — never raw
 * file text (design D7).** A substring scan is wrong in both directions here: the
 * checkout sits under a path containing "elftia", but the house scan idiom
 * (`git ls-files --cached --others --exclude-standard`) already excludes every
 * gitignored build artifact where that would matter. The real trap is tracked
 * PROSE — eight tracked files explain *why the ports are Elftia-neutral*, and a
 * substring rule would flag the documents that record the boundary. This rule scans
 * only `.ts/.tsx/.js/.jsx/.mjs/.cjs` source (never `.md`) and skips comment lines,
 * so prose is out of scope by construction, not by exemption.
 *
 * **The DOM check is identifier-level, not a `document.` text scan.** `document` is
 * a domain term throughout `editor/contracts` — not just a local variable in
 * `draft` and `engine`, but a parameter name across `vectors/**` and the family
 * literal `"document" | "scenario"` in `vectors/schema.ts` — the exact package
 * this rule protects. A file that visibly declares `document` as a local name
 * (parameter, destructured binding, `const`/`let`) has its bare `document`
 * references treated as that local; `document` inside a quoted string is never
 * an identifier at all, so it never counts, declared or not. `window.document`
 * still fires regardless, since `window` alone triggers the DOM-global match.
 *
 *   node script/check-package-boundary.mjs
 *   node script/check-package-boundary.mjs --negative-control
 *   node script/check-package-boundary.mjs --converse-control
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOUNDARY_PATH = join(REPO_ROOT, "packages", "boundary.json");
const PACKAGE_DIRS = ["editor-ports", "editor-contracts", "editor-classic"];

const RULES = [
	{
		id: "acyclic-direction",
		description: "every cross-package edge points to a strictly lower declared layer",
		why: "ports sits below contracts sits below classic (design D2, measured 8/0 contracts→ports edges); an upward edge would make the freeze a fiction the moment P1 built against it.",
	},
	{
		id: "public-entry-only",
		description: "a specifier crossing into a package resolves only to a declared exports subpath",
		why: "the exports map is itself the enforcement Node and every bundler already give an installed consumer (design D5); this rule is the source-level pre-image of that guarantee.",
	},
	{
		id: "no-internal-reexport",
		description: "no package's declared entry re-exports a module owned by another package's undeclared internals",
		why: "a declared entry that quietly re-exports another package's internals would let a deep import through the front door.",
	},
	{
		id: "no-elftia-import",
		description: "no package, Host or example imports an Elftia package, protocol identifier or runtime object",
		why: "decision B3 — the portable SDK does not depend on its largest consumer. Matches specifiers, dependency names and identifiers, never raw file text (design D7); there is no exception for adapter-elftia.",
	},
	{
		id: "react-free-base",
		description: "editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module",
		why: "spec §3.5 — a third-party adapter author must implement ports and run conformance without pulling React or the editor UI.",
	},
];
const LIVE_RULE_IDS = ["acyclic-direction", "no-elftia-import", "react-free-base"];
const DORMANT_RULE_IDS = ["public-entry-only", "no-internal-reexport"];

/**
 * `document` is a domain term throughout `editor/contracts` — not just in
 * `draft` and `engine` (a local variable, the draft document) but also across
 * `vectors/**` (`function seedOperations(document: VectorSeedDocument)`, a
 * `"document" | "scenario"` family-name string literal in schema.ts, and the
 * same parameter name in drivers/loader/runner and their tests). A hardcoded
 * directory list undercounts this; a raw `\bdocument\b` scan overcounts by
 * matching the family literal `"document"` too. So this is genuinely
 * identifier-level in two ways: (1) a file that visibly DECLARES `document` as
 * a local name — a typed/untyped parameter, a destructured binding, or a
 * `const`/`let` — has every bare `document` in that file treated as that local,
 * not the DOM global; (2) `document` inside a quoted string is never an
 * identifier reference at all, so it is excluded everywhere, declaration or
 * not. `window.document` still fires regardless of either, since it is
 * `window` — never exempted — doing the matching.
 */
const DOCUMENT_DECLARATION_PATTERN =
	/\bdocument\s*\??\s*:\s*[A-Za-z_$]|\{\s*document\s*[,}:]|\(\s*document\s*[,):]|\b(?:const|let)\s+document\b/;

function hasLocalDocumentBinding(text) {
	return DOCUMENT_DECLARATION_PATTERN.test(text);
}

/**
 * Removes quoted-string contents before either DOM pattern is tested, so a
 * filename or family literal like `"document-vectors.json"` or `"document"`
 * never reads as the identifier `document` — only real code does. Import
 * specifiers are extracted from the ORIGINAL line before this runs; this is
 * only for the DOM-global test. Does not attempt template-literal
 * interpolation (`${...}` survives inside a stripped template), which is an
 * accepted, narrow gap — nothing in the current scan set exercises it.
 */
function stripStringLiterals(line) {
	return line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "");
}

// `globalThis` is deliberately absent: it is the standard cross-runtime global
// (Node included, ES2020) that `editor/contracts/draft/manager.ts` uses for
// `globalThis.crypto.getRandomValues` — a Web Crypto call, not a DOM access.
// Flagging it would make every isomorphic API reach for a runtime primitive
// look like a browser dependency.
const DOM_GLOBAL_PATTERN =
	/\bwindow\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\b|\bHTMLElement\b|\bHTMLCanvasElement\b|\bCustomEvent\b|\bMutationObserver\b|\bResizeObserver\b|\bIntersectionObserver\b/;
// Excludes `xxx.document` (a property literally named `document` on some other
// object, e.g. `context.document` in editor/contracts/engine/conformance) —
// only a bare reference or `document.xxx` member access can be the DOM global.
// A `window.document` access is still caught, just via the `window` hit above.
const DOCUMENT_PATTERN = /(?<!\.)\bdocument\b/;

const ELFTIA_PROTOCOL_PATTERN = /["'`](?:plugin|elftia):\/\//;
const ELFTIA_RUNTIME_PATTERN =
	/\bwindow\.elftia\b|\bglobalThis\.elftia\b|\bwindow\.native\b|\bwindow\.api\b|\bCapabilityBroker\b|\bArtifactRuntime\b|\bArtifactRef\b/;

const IMPORT_SPECIFIER_PATTERNS = [
	// `import ... from "x"` and `export ... from "x"` — also the line that carries
	// the specifier in a multi-line import/export statement, which is why this is
	// a bare `from` pattern rather than one anchored on a same-line `import`/`export`.
	/\bfrom\s+["']([^"']+)["']/,
	// side-effect import: `import "x";`
	/^\s*import\s+["']([^"']+)["']\s*;?\s*$/,
	/\brequire\(\s*["']([^"']+)["']\s*\)/,
	/\bimport\(\s*["']([^"']+)["']\s*\)/,
];

/** A comment naming a rule is not a violation of it. */
function isComment(line) {
	return /^\s*(?:\/\/|\*|\/\*)/.test(line);
}

function extractSpecifier(line) {
	for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
		const match = pattern.exec(line);
		if (match) return match[1];
	}
	return null;
}

/**
 * Turn an import specifier into a repo-relative module path. Relative specifiers
 * are resolved against the **importing file's directory**, not string-rewritten.
 * `@/` is the one alias both consumers share (`apps/web`'s own convention, and
 * `apps/vite-example`'s tsconfig/vite alias `@` → `../web/src`). Returns `null` for
 * a bare package specifier, which acyclic-direction and react-free-base do not
 * judge (no-elftia-import judges bare specifiers separately, on its own terms).
 */
function resolveSpecifier({ spec, fromFile }) {
	if (spec.startsWith("@/")) return `apps/web/src/${spec.slice(2)}`;
	if (!spec.startsWith(".")) return null;
	const parts = fromFile.split("/").slice(0, -1);
	for (const segment of spec.split("/")) {
		if (segment === "." || segment === "") continue;
		if (segment === "..") parts.pop();
		else parts.push(segment);
	}
	return parts.join("/");
}

function candidatePaths(base) {
	return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
}

/**
 * Longest-prefix-wins ownership resolution over `boundary.json`'s `ownership`
 * array, with file-level entries (a `.ts`/`.tsx`/`.css` path) matched against a
 * small set of extension candidates so an extension-less import specifier still
 * resolves against an exact-file override (design D4).
 */
function resolveOwner(resolvedPath, boundary) {
	if (resolvedPath === null) return null;
	let best = null;
	for (const entry of boundary.ownership) {
		const isFileEntry = /\.(?:ts|tsx|css)$/.test(entry.path);
		const matched = isFileEntry
			? candidatePaths(resolvedPath).includes(entry.path)
			: resolvedPath === entry.path || resolvedPath.startsWith(`${entry.path}/`);
		if (matched && (best === null || entry.path.length > best.path.length)) best = entry;
	}
	return best ? best.owner : null;
}

/** `apps/vite-example` files are consumer-owned by construction; `apps/web/src`
 * files resolve through `boundary.json`. Anything else is out of scope. */
function ownerOfPath(path, boundary) {
	if (path.startsWith("apps/vite-example/")) return "apps/vite-example";
	if (path.startsWith("apps/web/src/")) return resolveOwner(path, boundary);
	return null;
}

/** Consumers sit above every declared layer (design D2's numeric-order diagram). */
function layerIndex(owner, boundary) {
	const idx = boundary.layers.indexOf(owner);
	if (idx !== -1) return idx;
	if (boundary.consumers.includes(owner)) return boundary.layers.length;
	return null;
}

function isElftiaSpecifier(spec) {
	return (
		spec === "elftia" ||
		spec.startsWith("elftia/") ||
		spec.startsWith("@elftia/") ||
		/^elftia-plugin-/.test(spec)
	);
}

// ---------------------------------------------------------------------------
// Rule 1 — acyclic-direction
// ---------------------------------------------------------------------------

/**
 * Excludes consumer↔consumer edges (`apps/web` ↔ `apps/vite-example`) entirely —
 * not just "same layer passes" but skipped outright — because
 * `check-host-composition.mjs` already owns that seam (design D2): "App↔app edges
 * are out of this checker's scope."
 */
function acyclicDirectionRule({ files, boundary }) {
	const violations = [];
	const scope = files.filter(
		(f) => f.path.startsWith("apps/web/src/") || f.path.startsWith("apps/vite-example/"),
	);
	let edgesExamined = 0;
	for (const file of scope) {
		const sourceOwner = ownerOfPath(file.path, boundary);
		if (sourceOwner === null) continue; // unowned files are refused earlier by the self-guard
		const lines = file.text.split(/\r?\n/);
		lines.forEach((line, index) => {
			if (isComment(line)) return;
			const spec = extractSpecifier(line);
			if (!spec) return;
			const resolved = resolveSpecifier({ spec, fromFile: file.path });
			if (resolved === null) return;
			if (!resolved.startsWith("apps/web/src/") && !resolved.startsWith("apps/vite-example/")) return;
			const targetOwner = ownerOfPath(resolved, boundary);
			if (targetOwner === null) return;
			if (sourceOwner === targetOwner) return; // internal edge
			if (boundary.consumers.includes(sourceOwner) && boundary.consumers.includes(targetOwner)) return;
			edgesExamined += 1;
			const sourceLayer = layerIndex(sourceOwner, boundary);
			const targetLayer = layerIndex(targetOwner, boundary);
			if (!(targetLayer < sourceLayer)) {
				violations.push({
					rule: "acyclic-direction",
					path: file.path,
					line: index + 1,
					detail: `${sourceOwner} (layer ${sourceLayer}) imports ${targetOwner} (layer ${targetLayer}) via "${spec}"`,
				});
			}
		});
	}
	return { violations, filesScanned: scope.length, edgesExamined };
}

// ---------------------------------------------------------------------------
// Rule 4 — no-elftia-import (numbered to match RULES order at report time)
// ---------------------------------------------------------------------------

function scanBunLockForElftia(text) {
	const hits = [];
	text.split(/\r?\n/).forEach((line, index) => {
		const match = /^\s*"((?:@[^"@]+\/)?[^"@]+)":\s*\[/.exec(line);
		if (match && isElftiaSpecifier(match[1])) {
			hits.push({ line: index + 1, name: match[1] });
		}
	});
	return hits;
}

function scanPackageJsonForElftia(text) {
	const hits = [];
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return hits;
	}
	for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
		const deps = data[field];
		if (!deps) continue;
		for (const name of Object.keys(deps)) {
			if (isElftiaSpecifier(name)) hits.push({ field, name });
		}
	}
	return hits;
}

/**
 * Repo-wide, per spec §3.4 ("no package, Host or example"). Only `.ts/.tsx/.js/
 * .jsx/.mjs/.cjs`, `package.json` and `bun.lock` are inspected — `.md` files are
 * never scanned, so prose in Markdown is out of scope by extension alone, and
 * comment lines in source are skipped so prose in code comments is out of scope
 * too (design D7 — eight tracked files mention "elftia" and all eight are prose).
 */
function noElftiaImportRule({ files }) {
	const violations = [];
	let scanned = 0;
	for (const file of files) {
		if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) {
			scanned += 1;
			file.text.split(/\r?\n/).forEach((line, index) => {
				if (isComment(line)) return;
				const spec = extractSpecifier(line);
				if (spec && isElftiaSpecifier(spec)) {
					violations.push({
						rule: "no-elftia-import",
						path: file.path,
						line: index + 1,
						detail: `Elftia import specifier "${spec}"`,
					});
					return;
				}
				if (ELFTIA_PROTOCOL_PATTERN.test(line)) {
					violations.push({
						rule: "no-elftia-import",
						path: file.path,
						line: index + 1,
						detail: "Elftia protocol literal (plugin:// or elftia://)",
					});
					return;
				}
				if (ELFTIA_RUNTIME_PATTERN.test(line)) {
					violations.push({
						rule: "no-elftia-import",
						path: file.path,
						line: index + 1,
						detail: "Elftia runtime identifier",
					});
				}
			});
		} else if (/(?:^|\/)package\.json$/.test(file.path)) {
			scanned += 1;
			for (const hit of scanPackageJsonForElftia(file.text)) {
				violations.push({
					rule: "no-elftia-import",
					path: file.path,
					line: 0,
					detail: `Elftia dependency name "${hit.name}" in ${hit.field}`,
				});
			}
		} else if (/(?:^|\/)bun\.lock$/.test(file.path)) {
			scanned += 1;
			for (const hit of scanBunLockForElftia(file.text)) {
				violations.push({
					rule: "no-elftia-import",
					path: file.path,
					line: hit.line,
					detail: `Elftia package identifier "${hit.name}" in bun.lock`,
				});
			}
		}
	}
	return { violations, scanned };
}

// ---------------------------------------------------------------------------
// Rule 5 — react-free-base
// ---------------------------------------------------------------------------

function checkManifestReactFree(file, violations) {
	let data;
	try {
		data = JSON.parse(file.text);
	} catch {
		return;
	}
	const forbidden = new Set(["react", "react-dom", "@opencut/editor-classic"]);
	for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
		const deps = data[field];
		if (!deps) continue;
		for (const name of Object.keys(deps)) {
			if (forbidden.has(name)) {
				violations.push({
					rule: "react-free-base",
					path: file.path,
					line: 0,
					detail: `manifest declares forbidden dependency "${name}" in ${field}`,
				});
			}
		}
	}
}

function reactFreeBaseRule({ files, boundary }) {
	const violations = [];
	let scanned = 0;
	for (const file of files) {
		if (file.path === "packages/editor-ports/package.json" || file.path === "packages/editor-contracts/package.json") {
			checkManifestReactFree(file, violations);
			continue;
		}
		if (!file.path.startsWith("apps/web/src/")) continue;
		const owner = ownerOfPath(file.path, boundary);
		if (owner !== boundary.layers[0] && owner !== boundary.layers[1]) continue;
		scanned += 1;
		const documentExempt = hasLocalDocumentBinding(file.text);
		file.text.split(/\r?\n/).forEach((line, index) => {
			if (isComment(line)) return;
			const spec = extractSpecifier(line);
			if (spec === "react" || spec === "react-dom" || spec?.startsWith("react/") || spec?.startsWith("react-dom/")) {
				violations.push({
					rule: "react-free-base",
					path: file.path,
					line: index + 1,
					detail: `imports "${spec}"`,
				});
				return;
			}
			const codeOnly = stripStringLiterals(line);
			const documentHit = !documentExempt && DOCUMENT_PATTERN.test(codeOnly);
			if (DOM_GLOBAL_PATTERN.test(codeOnly) || documentHit) {
				violations.push({
					rule: "react-free-base",
					path: file.path,
					line: index + 1,
					detail: "references a DOM global",
				});
				return;
			}
			if (spec) {
				const resolved = resolveSpecifier({ spec, fromFile: file.path });
				if (resolved && resolved.startsWith("apps/web/src/") && ownerOfPath(resolved, boundary) === boundary.layers[2]) {
					violations.push({
						rule: "react-free-base",
						path: file.path,
						line: index + 1,
						detail: `imports a module owned by ${boundary.layers[2]} via "${spec}"`,
					});
				}
			}
		});
	}
	return { violations, scanned };
}

// ---------------------------------------------------------------------------
// Rules 2 & 3 — public-entry-only, no-internal-reexport (dormant: packages/ has
// no source at this commit; both report 0 files scanned honestly, per D6).
// ---------------------------------------------------------------------------

const PACKAGE_SPECIFIER_PATTERN = /^(@opencut\/(?:editor-ports|editor-contracts|editor-classic))(\/.*)?$/;

function packagesSourceFiles(files) {
	return files.filter((f) => /^packages\/[^/]+\/src\//.test(f.path));
}

function manifestEntrySets(manifests) {
	return new Map(manifests.map((m) => [m.name, new Set(Object.keys(m.exports ?? {}))]));
}

function manifestEntryFileSet(manifests) {
	const set = new Set();
	for (const m of manifests) {
		for (const target of Object.values(m.exports ?? {})) {
			set.add(`packages/${m.dir}/${target.replace(/^\.\//, "")}`);
		}
	}
	return set;
}

function subpathOf(match) {
	return match[2] ? `.${match[2]}` : ".";
}

function publicEntryOnlyRule({ files, manifests }) {
	const violations = [];
	const scope = packagesSourceFiles(files);
	const entriesByPackage = manifestEntrySets(manifests);
	const dirToName = new Map(manifests.map((m) => [m.dir, m.name]));
	for (const file of scope) {
		const selfDir = /^packages\/([^/]+)\//.exec(file.path)[1];
		const selfName = dirToName.get(selfDir);
		file.text.split(/\r?\n/).forEach((line, index) => {
			if (isComment(line)) return;
			const spec = extractSpecifier(line);
			if (!spec) return;
			const match = PACKAGE_SPECIFIER_PATTERN.exec(spec);
			if (!match) return;
			const targetName = match[1];
			if (targetName === selfName) return; // a package importing its own other internals is not a deep import
			const declared = entriesByPackage.get(targetName);
			const subpath = subpathOf(match);
			if (!declared || !declared.has(subpath)) {
				violations.push({
					rule: "public-entry-only",
					path: file.path,
					line: index + 1,
					detail: `imports undeclared subpath "${spec}" of ${targetName}`,
				});
			}
		});
	}
	return { violations, scanned: scope.length };
}

function noInternalReexportRule({ files, manifests }) {
	const violations = [];
	const scope = packagesSourceFiles(files);
	const entriesByPackage = manifestEntrySets(manifests);
	const entryFiles = manifestEntryFileSet(manifests);
	for (const file of scope) {
		if (!entryFiles.has(file.path)) continue; // only declared entry files are asserted
		file.text.split(/\r?\n/).forEach((line, index) => {
			if (isComment(line)) return;
			if (!/\bexport\s[^;]*\bfrom\s+["']/.test(line)) return;
			const spec = extractSpecifier(line);
			if (!spec) return;
			const match = PACKAGE_SPECIFIER_PATTERN.exec(spec);
			if (!match) return; // a relative re-export within the same package is not this rule's concern
			const targetName = match[1];
			const declared = entriesByPackage.get(targetName);
			const subpath = subpathOf(match);
			if (declared && !declared.has(subpath)) {
				violations.push({
					rule: "no-internal-reexport",
					path: file.path,
					line: index + 1,
					detail: `re-exports undeclared internal "${spec}" of ${targetName}`,
				});
			}
		});
	}
	return { violations, scanned: scope.length };
}

// ---------------------------------------------------------------------------
// Orchestration — one pure scan(), used by the live run and both controls.
// ---------------------------------------------------------------------------

function scan({ files, boundary, manifests }) {
	const acyclic = acyclicDirectionRule({ files, boundary });
	const elftia = noElftiaImportRule({ files });
	const reactFree = reactFreeBaseRule({ files, boundary });
	const publicEntry = publicEntryOnlyRule({ files, manifests });
	const reexport = noInternalReexportRule({ files, manifests });
	return {
		violations: [
			...acyclic.violations,
			...elftia.violations,
			...reactFree.violations,
			...publicEntry.violations,
			...reexport.violations,
		],
		census: {
			"acyclic-direction": { filesScanned: acyclic.filesScanned, edgesExamined: acyclic.edgesExamined },
			"no-elftia-import": { filesScanned: elftia.scanned },
			"react-free-base": { filesScanned: reactFree.scanned },
			"public-entry-only": { filesScanned: publicEntry.scanned },
			"no-internal-reexport": { filesScanned: reexport.scanned },
		},
	};
}

// ---------------------------------------------------------------------------
// Live repo I/O
// ---------------------------------------------------------------------------

function loadBoundary() {
	return JSON.parse(readFileSync(BOUNDARY_PATH, "utf8"));
}

function loadManifests() {
	return PACKAGE_DIRS.map((dir) => {
		const data = JSON.parse(readFileSync(join(REPO_ROOT, "packages", dir, "package.json"), "utf8"));
		return { dir, name: data.name, exports: data.exports ?? {} };
	});
}

function gitLsFiles() {
	// Whole repo, tracked + `--others --exclude-standard`: a check reviewed before
	// the commit must see the files the change adds, or it reports a pass on an
	// empty set. no-elftia-import is repo-wide by spec §3.4; acyclic-direction and
	// react-free-base filter down to their own scope internally.
	return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
		.split("\0")
		.filter(Boolean)
		.map((p) => p.replaceAll("\\", "/"));
}

// This checker's own negative-control fixtures embed a synthetic "@elftia/shared"
// specifier as in-memory test data (see NEGATIVE_FIXTURES below) — never read from
// the repo scan, so no-elftia-import cannot fire on this file, but it would
// otherwise be flagged by the very rule it exists to prove. Self-excluded, the
// same way check-next-imports.mjs guards its own SHELL_ALLOWLIST against itself.
const SELF_PATH = "script/check-package-boundary.mjs";

function collectRepoFiles() {
	const relevant = gitLsFiles()
		.filter((p) => p !== SELF_PATH)
		.filter(
			(p) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(p) || /(?:^|\/)package\.json$/.test(p) || /(?:^|\/)bun\.lock$/.test(p),
		);
	const out = [];
	for (const path of relevant) {
		let text;
		try {
			text = readFileSync(join(REPO_ROOT, path), "utf8");
		} catch {
			continue; // tracked but absent from the working tree
		}
		out.push({ path, text });
	}
	return out;
}

/** Refuses a `boundary.json` in which a declared shell path resolves to anything
 * other than a consumer — the same self-guard `check-next-imports.mjs` applies to
 * its own allowlist, and the exact scenario spec's "Declared source ownership"
 * requirement names: "the Host shell cannot be claimed by a package." */
function guardSelfConsistency(boundary) {
	const problems = [];
	for (const shellPath of boundary.shellPaths) {
		const owner = resolveOwner(shellPath, boundary);
		if (owner === null || !boundary.consumers.includes(owner)) {
			problems.push(`shell path "${shellPath}" resolves to owner "${owner ?? "none"}", not a declared consumer`);
		}
	}
	if (problems.length > 0) {
		console.error("check-package-boundary: boundary.json is self-inconsistent, refusing to scan:");
		for (const p of problems) console.error(`  ${p}`);
		process.exit(2);
	}
}

/** "An unowned file causes the check to fail rather than to be skipped" (spec). */
function guardUnownedFiles(files, boundary) {
	const webFiles = files.filter((f) => f.path.startsWith("apps/web/src/") && /\.(?:ts|tsx)$/.test(f.path));
	const unowned = webFiles.filter((f) => resolveOwner(f.path, boundary) === null);
	if (unowned.length > 0) {
		console.error(`check-package-boundary: ${unowned.length} file(s) under apps/web/src resolve to no owner, refusing to scan:`);
		for (const f of unowned.slice(0, 20)) console.error(`  ${f.path}`);
		if (unowned.length > 20) console.error(`  ... and ${unowned.length - 20} more`);
		process.exit(2);
	}
}

function runCheck() {
	const boundary = loadBoundary();
	guardSelfConsistency(boundary);
	const files = collectRepoFiles();
	guardUnownedFiles(files, boundary);
	const manifests = loadManifests();
	const { violations, census } = scan({ files, boundary, manifests });

	console.log(`check-package-boundary: scanned ${files.length} repo file(s) (tracked + uncommitted)`);

	const emptyLive = LIVE_RULE_IDS.filter((id) => census[id].filesScanned === 0);
	if (emptyLive.length > 0) {
		for (const id of emptyLive) {
			console.error(`  FAIL  ${id}: scanned 0 files — refusing to report a pass on an empty scan`);
		}
		process.exit(2);
	}

	for (const rule of RULES) {
		const hits = violations.filter((v) => v.rule === rule.id);
		const c = census[rule.id];
		if (DORMANT_RULE_IDS.includes(rule.id) && c.filesScanned === 0) {
			console.log(`  ....  ${rule.id}: 0 files scanned — packages/ holds no source yet (${rule.description})`);
			continue;
		}
		const extra = rule.id === "acyclic-direction" ? `, ${c.edgesExamined} cross-package edge(s) examined` : "";
		console.log(`  ${hits.length === 0 ? "PASS" : "FAIL"}  ${rule.id}: ${rule.description} (${c.filesScanned} file(s) scanned${extra})`);
	}

	if (violations.length > 0) {
		console.error("\nPackage-boundary violations:");
		for (const v of violations) {
			const rule = RULES.find((r) => r.id === v.rule);
			console.error(`  [${v.rule}] ${v.path}${v.line ? `:${v.line}` : ""}: ${v.detail}`);
			console.error(`      why: ${rule.why}`);
		}
		process.exit(1);
	}

	console.log(
		"\nclean — run with --negative-control / --converse-control to see each rule proven able to fire, and proven not to misfire.",
	);
}

// ---------------------------------------------------------------------------
// Controls — the same pure scan(), in-memory fixtures, no repo I/O.
// ---------------------------------------------------------------------------

const FIXTURE_BOUNDARY = {
	layers: ["@opencut/editor-ports", "@opencut/editor-contracts", "@opencut/editor-classic"],
	consumers: ["apps/web", "apps/vite-example"],
	shellPaths: ["apps/web/src/app"],
	ownership: [
		{ path: "apps/web/src/app", owner: "apps/web", why: "fixture shell root" },
		{ path: "apps/web/src/editor/ports", owner: "@opencut/editor-ports", why: "fixture" },
		{ path: "apps/web/src/editor/contracts", owner: "@opencut/editor-contracts", why: "fixture" },
		{ path: "apps/web/src", owner: "@opencut/editor-classic", why: "fixture catch-all" },
	],
};

const FIXTURE_MANIFESTS = [
	{ dir: "editor-ports", name: "@opencut/editor-ports", exports: { ".": "./src/index.ts", "./host": "./src/host/index.ts" } },
	{ dir: "editor-contracts", name: "@opencut/editor-contracts", exports: { ".": "./src/index.ts" } },
	{ dir: "editor-classic", name: "@opencut/editor-classic", exports: { ".": "./src/index.ts" } },
];

function fixtureScan(fileList) {
	return scan({ files: fileList, boundary: FIXTURE_BOUNDARY, manifests: FIXTURE_MANIFESTS });
}

const NEGATIVE_FIXTURES = [
	{
		rule: "acyclic-direction",
		note: "layer-1 (contracts) importing a layer-2 (classic) module is an upward edge",
		files: [
			{
				path: "apps/web/src/editor/contracts/violation.ts",
				text: 'import { Foo } from "../surface/foo";\nexport const x = Foo;\n',
			},
		],
	},
	{
		rule: "no-elftia-import",
		note: "a bare @elftia/* import specifier",
		files: [
			{
				path: "apps/web/src/editor/ports/violation.ts",
				text: 'import { CHANNELS } from "@elftia/shared";\nexport const c = CHANNELS;\n',
			},
		],
	},
	{
		rule: "react-free-base",
		note: "editor-ports importing react",
		files: [
			{
				path: "apps/web/src/editor/ports/violation2.ts",
				text: 'import { useState } from "react";\nexport const s = useState;\n',
			},
		],
	},
	{
		rule: "public-entry-only",
		note: "a package source file deep-importing an undeclared subpath of another package",
		files: [
			{
				path: "packages/editor-classic/src/index.ts",
				text: 'import { Internal } from "@opencut/editor-ports/internal/secret";\nexport const i = Internal;\n',
			},
		],
	},
	{
		rule: "no-internal-reexport",
		note: "a declared entry re-exporting an undeclared subpath of another package",
		files: [
			{
				path: "packages/editor-contracts/src/index.ts",
				text: 'export { Internal } from "@opencut/editor-ports/internal/secret";\n',
			},
		],
	},
];

const CONVERSE_FIXTURES = [
	{
		rule: "acyclic-direction",
		label: "a legal downward edge (classic importing ports)",
		files: [
			{
				path: "apps/web/src/editor/surface/foo.ts",
				text: 'import type { EditorHostPorts } from "../ports";\nexport type X = EditorHostPorts;\n',
			},
		],
	},
	{
		rule: "public-entry-only",
		label: "an import of a declared entry",
		files: [
			{
				path: "packages/editor-classic/src/index.ts",
				text: 'import { Host } from "@opencut/editor-ports/host";\nexport const h = Host;\n',
			},
		],
	},
	{
		rule: "no-elftia-import",
		label: "an Elftia mention in prose (a comment)",
		files: [
			{
				path: "apps/web/src/editor/ports/notes.ts",
				text: "// This module is deliberately Elftia-neutral.\nexport const x = 1;\n",
			},
		],
	},
	{
		rule: "react-free-base",
		label: "a React import inside @opencut/editor-classic",
		files: [
			{
				path: "apps/web/src/editor/surface/component.tsx",
				text: 'import { useState } from "react";\nexport const s = useState;\n',
			},
		],
	},
];

function runNegativeControl() {
	console.log("check-package-boundary: negative control");
	let clean = true;
	for (const fixture of NEGATIVE_FIXTURES) {
		const { violations } = fixtureScan(fixture.files);
		const caught = violations.some((v) => v.rule === fixture.rule);
		if (!caught) clean = false;
		console.log(`  ${caught ? "PASS" : "FAIL"}  ${fixture.rule} — ${caught ? "caught" : "NOT caught"} [${fixture.note}]`);
	}
	if (!clean) process.exit(1);
	console.log("\nnegative control clean — every rule is proven able to fail.");
}

function runConverseControl() {
	console.log("check-package-boundary: converse control");
	let clean = true;
	for (const fixture of CONVERSE_FIXTURES) {
		const { violations } = fixtureScan(fixture.files);
		const silent = !violations.some((v) => v.rule === fixture.rule);
		if (!silent) clean = false;
		console.log(`  ${silent ? "PASS" : "FAIL"}  ${fixture.rule} — ${silent ? "silent" : "FALSE POSITIVE"} [${fixture.label}]`);
	}
	if (!clean) process.exit(1);
	console.log("\nconverse control clean — no rule fires on a legal case.");
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else if (process.argv.includes("--converse-control")) runConverseControl();
else runCheck();
