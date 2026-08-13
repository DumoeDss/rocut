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
 * Rules 1, 2, 4 and 5 are LIVE today. Rule 3 (`no-internal-reexport`) is asserted
 * only over `packages/**\/src`, which holds no source at this commit — it reports
 * `0 files scanned` honestly rather than a `PASS` that inspected nothing (design
 * D6). Rule 2 (`public-entry-only`) was scoped to `packages/**\/src` only through
 * the first commit; review round 1 (BLOCKER-1) found that left every consumer
 * invisible to it even after `packages/` gains source — a consumer deep-import
 * is exactly the scenario spec §3.1 names, and it survives dormancy. The fix
 * widens rule 2's scope to every file outside a package's own `src/`: both
 * declared consumers and the not-yet-moved `apps/web/src` source that will
 * become `@opencut/editor-classic`. That makes it genuinely live today —
 * nothing currently imports a bare `@opencut/*` specifier, so it passes, but it
 * is now actually looking. All five rules are still fully control-tested: both
 * `--negative-control` and `--converse-control` run the same pure `scan()`
 * against in-memory fixtures, so a dormant rule's ability to fire is proven
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
 * **The DOM check matches `document` only through its own member accesses, not
 * as a bare identifier.** `document` is a domain term throughout
 * `editor/contracts` — not just a local variable in `draft` and `engine`, but a
 * parameter name across `vectors/**` and the family literal
 * `"document" | "scenario"` in `vectors/schema.ts` — the exact package this
 * rule protects. An earlier version of this check exempted a whole file the
 * moment ANY line declared a local `document`, which review round 1 (MAJOR-1)
 * found let a real `document.createElement(...)` elsewhere in that same file
 * pass silently — 15 of 69 layer-0/1 files, including all nine
 * `contracts/engine/*` files, were already exempt this way. The fix drops
 * bare-identifier matching (and the whole-file exemption it required)
 * entirely: only `document.<domMember>` against a fixed list of names no
 * domain "document" value in this codebase has (`createElement`,
 * `querySelector`, `body`, `head`, …) counts, so no scope tracking is needed —
 * a local `document` parameter never collides with a DOM member name. `window.
 * document` and `globalThis.document` both still fire — the latter via an
 * explicit pattern added alongside this fix (MAJOR-2) — except
 * `typeof globalThis.document`, the one carved-out exception:
 * `vectors/__tests__/agent-drivers.test.ts` uses exactly that shape to PROVE a
 * driver ran DOM-free, which is this rule's own claim checked experimentally.
 *
 * **Review round 2 (the delta after `bea59790`) closed five further findings, plus one
 * more the same audit turned up.** D-1: the `@opencut/*` specifier pattern gating
 * `public-entry-only` and `no-internal-reexport` was itself a SECOND hardcoded
 * three-name triple — BLOCKER-2 fixed `PACKAGE_DIRS`, but a fourth package legally
 * admitted through `boundary.json.layers` was still invisible to specifier matching,
 * because the pattern that recognises an `@opencut/*` specifier as ours to judge never
 * looked at the manifest list BLOCKER-2 already made dynamic. Now built from that same
 * discovered, validated manifest list at load time (`packageSpecifierPattern`). The
 * audit this finding demanded ("assume a third hardcoded triple until you have looked")
 * found exactly one more: `react-free-base`'s manifest-level forbidden-dependency check
 * gated on two literal `packages/editor-ports/package.json` /
 * `packages/editor-contracts/package.json` paths and a literal `"@opencut/editor-classic"`
 * forbidden name — the identical failure shape, one layer up (a base-layer package
 * whose directory doesn't literally read "editor-ports"/"editor-contracts" was
 * invisible to it). Both derived from `boundary.layers[0]`/`[1]`/`[2]` and the manifest
 * list now, the same way. D-2: `DOM_DOCUMENT_MEMBER_PATTERN`'s alternation was widened
 * from 18 members to 50 (32 added — `addEventListener`, `cookie`, `fonts`, `location`,
 * `getSelection`, … — see the pattern's own doc comment for the exact list), closing
 * every gap the reviewer's reproduction table named. The one deliberately UNCLOSED gap
 * is computed member access (`document["createElement"]`), a known, accepted trade-off
 * of matching member access instead of a bare identifier (MAJOR-1), recorded rather
 * than silently fixed or silently left to be rediscovered. D-3: `public-entry-only`
 * now reports `N @opencut/* specifier(s) examined` alongside its file count, the same
 * transparency `acyclic-direction` already gives its edge count — a `PASS` because
 * nothing was found and a `PASS` because nothing was there to find are no longer the
 * same line of output. D-4: `typeof window.<member>` and `typeof globalThis.<member>`
 * now strip as a single guard phrase for ANY one member, not only `.document`, so
 * `typeof window.localStorage` reads as the same class of environment-detection guard
 * as the already-exempt `typeof window.document` — but only one level deep: a chained
 * `typeof window.document.createElement` still strips only `typeof window`, leaving the
 * real access exposed, exactly as MAJOR-2's own abuse probe (D-M2d) requires. D-5:
 * BLOCKER-2's fail-closed `loadManifests` guard is now independently proven in
 * `evidence/load-time-guard-proof.md`, not only by inspection.
 *
 * **Review round 3 (the delta after `95779c07`) closed one Blocker, one further
 * finding of the same class as D-1, one structural-list finding, and two trivials.**
 * BLOCKER (D-8): `evidence/load-time-guard-proof.md` had claimed `--negative-control`
 * and `--converse-control` also hit the `loadManifests` guard, citing a `main()`
 * function this file has never had — `loadManifests` runs only inside `runCheck()`;
 * the two control modes never call it and never touch `packages/` at all. The false
 * claim and its fabricated transcripts are gone; the file now says only what the code
 * can actually do. D-6: the SAME "assume a hardcoded triple until you have looked"
 * pattern D-1 closed for NAMES turned out to still hold one layer deeper, for ARITY —
 * `checkManifestReactFree`'s forbidden-dependency set and `reactFreeBaseRule`'s
 * resolved-owner check both hardcoded the single index `boundary.layers[2]`, so a
 * legally-declared FOURTH layer's upward import from a manifest-clean base file went
 * uncaught. Now `boundary.layers.slice(2)` throughout (every layer above the two base
 * layers, not only index 2), and `RULES[4].description` is a `(boundary) => string`
 * function (`reactFreeBaseDescription`) rather than a string hardcoding the three
 * layer names, so a renamed or added layer shows up in the printed line too. D-7:
 * `DOM_DOCUMENT_MEMBER_PATTERN` was still a DENYLIST after D-2's 50-member widening —
 * the reviewer reproduced 13+ further real DOM members it missed and judged a
 * denylist here structurally uncompletable (the real DOM surface only grows). Inverted
 * to an ALLOWLIST of the seven domain `document` member names actually read across all
 * 68 layer-0/1 files today (`DOMAIN_DOCUMENT_MEMBERS`, see that pattern's own doc
 * comment) — `document.<member>` is now flagged whenever `<member>` is not on that
 * short list, DOM or not, trading a small, known, self-correcting false-positive
 * surface (a future real domain member needs a one-line addition) for closing an
 * open-ended false-negative one. D-9: `packageSpecifierPattern([])` degenerated to
 * `^()(\/.*)?$` (matches almost any absolute-looking specifier) on an empty manifest
 * list — unreachable in practice today, but now fails closed with a `throw` (not
 * `process.exit`, since this function is shared with the pure fixture-scan path) rather
 * than silently building a near-universal pattern. D-10: a second, separate instance of
 * the stale "24-name alternation" figure (D-2's JSDoc already carried the correct "18"
 * before this round; a `NEGATIVE_FIXTURES` entry's own `note` field, printed on every
 * `--negative-control` run, still read "24") is now also "18".
 *
 * **D-12 (review round 4, the last item before ship): the shared violation message
 * for this rule's DOM block still read "references a DOM global" for all three
 * matcher arms.** That stayed true for `DOM_GLOBAL_PATTERN` and
 * `GLOBALTHIS_DOM_PATTERN` — both only ever match an actual DOM global name — but
 * D-7's allowlist inversion means `DOM_DOCUMENT_MEMBER_PATTERN` now fires on ANY
 * `document.<member>` outside `DOMAIN_DOCUMENT_MEMBERS`, DOM or not, and an ordinary
 * eighth domain member is the likelier real-world trigger than an actual browser
 * dependency. `DOM_DOCUMENT_MEMBER_PATTERN` now gets its own detail message, naming
 * `DOMAIN_DOCUMENT_MEMBERS` and stating the fix may be adding the member there —
 * `DOM_GLOBAL_PATTERN`/`GLOBALTHIS_DOM_PATTERN` keep the original wording, since it
 * remains accurate for them. Message text only; the set of flagged lines is
 * unchanged (still the same three-arm OR, just evaluated as two sequential checks
 * instead of one combined condition).
 *
 *   node script/check-package-boundary.mjs
 *   node script/check-package-boundary.mjs --negative-control
 *   node script/check-package-boundary.mjs --converse-control
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOUNDARY_PATH = join(REPO_ROOT, "packages", "boundary.json");

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
		// D-6 (review round 3): was a static string hardcoding the three layer
		// names; now derived from `boundary.layers` so a renamed or added layer
		// is reflected in the printed description automatically. See
		// `layerShortName`/`reactFreeBaseDescription` below and the two render
		// sites in runCheck() that resolve a function-typed description.
		description: reactFreeBaseDescription,
		why: "spec §3.5 — a third-party adapter author must implement ports and run conformance without pulling React or the editor UI.",
	},
];

/**
 * D-6 (review round 3): short display name for a layer, stripping the npm
 * scope so printed text reads "editor-ports" rather than "@opencut/editor-ports",
 * matching the pre-fix literal's style without hardcoding it.
 */
function layerShortName(name) {
	return name.split("/").pop();
}

function reactFreeBaseDescription(boundary) {
	const [base0, base1] = boundary.layers.slice(0, 2).map(layerShortName);
	const forbiddenNames = boundary.layers.slice(2).map(layerShortName);
	const forbiddenText = forbiddenNames.length > 0 ? forbiddenNames.join("/") : "any higher-layer";
	return `${base0} and ${base1} import no React, no DOM global, and no ${forbiddenText} module`;
}
// public-entry-only joined the live set in review round 1 (BLOCKER-1): its
// scope now reaches every file outside a package's own src/, and that set is
// never empty while apps/web/src has any tracked source at all.
const LIVE_RULE_IDS = ["acyclic-direction", "no-elftia-import", "react-free-base", "public-entry-only"];
const DORMANT_RULE_IDS = ["no-internal-reexport"];

/**
 * Removes quoted-string contents before any DOM pattern is tested, so a
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

/**
 * `typeof globalThis.document === "undefined"` is an environment-detection
 * guard, not DOM consumption — `editor/contracts/vectors/__tests__/
 * agent-drivers.test.ts` uses exactly this shape
 * (`expect(typeof globalThis.document).toBe("undefined")`) to PROVE a driver
 * ran without a DOM present at all, which is this rule's own claim checked
 * experimentally rather than asserted. Stripped before any DOM pattern is
 * tested, the same way stripStringLiterals removes quoted text — a narrower
 * instance of the reasoning behind excluding bare `globalThis` below,
 * extended to member access on `globalThis`/`window`.
 *
 * D-4 (review round 2): the guard strips `typeof (globalThis|window)`
 * followed by AT MOST ONE member (`.document`, `.window`, `.localStorage`,
 * …), not only the literal `.document` case. The round-1 shape fired on
 * `typeof window.localStorage` — the same class of feature-detection guard
 * as the exempted `typeof window.document` — only because `.localStorage`
 * happened to survive the strip and still match `DOM_GLOBAL_PATTERN`'s bare
 * token. The negative lookahead `(?!\s*\.)` after the member is what keeps
 * this narrow: it only strips a SINGLE member, so a chained
 * `typeof window.document.createElement` strips only `typeof window`,
 * leaving `.document.createElement` intact for `DOM_DOCUMENT_MEMBER_PATTERN`
 * to catch — the exact abuse MAJOR-2's own probe (D-M2d) already asserts
 * must keep firing. One level of member access is "is this API present";
 * two or more is a real, chained property read, and the strip does not
 * reach past the first dot.
 */
const TYPEOF_GUARD_PATTERN = /\btypeof\s+(?:globalThis|window)\b(?:\s*\.\s*\w+\b(?!\s*\.))?/g;

function stripTypeofGuards(line) {
	return line.replace(TYPEOF_GUARD_PATTERN, "");
}

// `globalThis` is deliberately absent as a BARE token: it is the standard
// cross-runtime global (Node included, ES2020) that
// `editor/contracts/draft/manager.ts` uses for
// `globalThis.crypto.getRandomValues` — a Web Crypto call, not a DOM access.
// Flagging it bare would make every isomorphic API reach for a runtime
// primitive look like a browser dependency. Reaching a DOM global THROUGH
// `globalThis` is still exactly the DOM dependency this rule exists to catch
// (see GLOBALTHIS_DOM_PATTERN below).
const DOM_GLOBAL_PATTERN =
	/\bwindow\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\b|\bHTMLElement\b|\bHTMLCanvasElement\b|\bCustomEvent\b|\bMutationObserver\b|\bResizeObserver\b|\bIntersectionObserver\b/;

/**
 * `document` matches ONLY as a member access, never as a bare identifier.
 * Review round 1 (MAJOR-1) found the previous bare-identifier match, combined
 * with a whole-file "does this file declare a local `document`" exemption,
 * let a single unrelated parameter blind detection of a real
 * `document.createElement(...)` call anywhere else in that file. Matching the
 * member access instead removes the need for scope tracking entirely.
 * `xxx.document` (a property literally named `document` on some other
 * object, e.g. `context.document` in editor/contracts/engine/conformance)
 * still never matches, because the member checked is on `document` itself,
 * not on whatever precedes it.
 *
 * D-2 (review round 2, superseded by D-7 below): widened the original
 * 18-name DOM-member denylist to 50 after the reviewer reproduced 17 real
 * DOM accesses (most commonly `document.addEventListener`) silently missed
 * by it, plus 15 further members of the same class prescribed but not
 * individually reproduced.
 *
 * D-7 (review round 3): the round-2 denylist was still a fixed, finite list
 * matched against the infinite, ever-growing real DOM `document` surface —
 * the reviewer reproduced 13 MORE real members it missed (`hasFocus`,
 * `caretRangeFromPoint`, `caretPositionFromPoint`, `getAnimations`,
 * `timeline`, `scrollingElement`, `onkeydown`, `startViewTransition`,
 * `getElementsByName`, `open`, `close`, `URL`, `referrer`, `baseURI`,
 * `fullscreenEnabled`, `pictureInPictureElement`, `replaceChildren` — 16
 * names, the reviewer's finding rounds this to "13+"), and concluded a
 * denylist here is structurally uncompletable: there will always be a next
 * DOM member nobody enumerated yet. A local `document` VALUE (the draft
 * document, `VectorSeedDocument`, …), by contrast, is a small, closed,
 * enumerable surface — this codebase only ever reads a handful of its own
 * property names off one. So the check is inverted to an ALLOWLIST of those
 * domain member names (`DOMAIN_DOCUMENT_MEMBERS` below): `document.<member>`
 * is now flagged whenever `<member>` is NOT on that short list, DOM or not.
 * This flips which failure is silent. Before: an unenumerated real DOM
 * member (e.g. `hasFocus`) passed silently — the exact hole this review
 * round found. After: an unenumerated real DOMAIN member (e.g. a future
 * `document.duration`) is flagged and needs a one-line addition to
 * `DOMAIN_DOCUMENT_MEMBERS` to go silent again — loud and self-correcting,
 * not silent and permanent, which is the direction a boundary-freeze checker
 * should err in.
 *
 * `DOMAIN_DOCUMENT_MEMBERS` was built by enumerating every real
 * `document.<member>` access across all 68 files `react-free-base` scans
 * today (`apps/web/src/editor/ports/**`, `apps/web/src/editor/host/
 * editor-host.ts`, `apps/web/src/editor/contracts/**` minus the one file
 * `boundary.json` reassigns to editor-classic) — seven names, every one a
 * read on a local "document" value, never `globalThis.document`:
 * `revision`, `tracks`, `clips`, `assets`, `markers`, `idempotency`,
 * `project`. `editor/ports` and `editor-host.ts` contain zero `document.*`
 * accesses of either kind (`react-free-base` still passes with 68 files
 * scanned, matching every prior round's count). MAJOR-1's own converse
 * fixture (`document: { tracks: unknown[] }`) already exercises `tracks`
 * from this exact list, so review round 3 changed no fixture expectation to
 * keep it silent.
 *
 * **Known, accepted regression, recorded rather than silently absorbed:**
 * matching member access instead of a bare identifier (MAJOR-1) means
 * `document["createElement"]` (computed member access) no longer matches —
 * unchanged by D-7, still nothing in the current scan set uses computed
 * access on `document`, and adding `document\s*\[` back is a straightforward
 * follow-up if that ever changes.
 */
const DOMAIN_DOCUMENT_MEMBERS = ["revision", "tracks", "clips", "assets", "markers", "idempotency", "project"];

const DOM_DOCUMENT_MEMBER_PATTERN = new RegExp(`\\bdocument\\s*\\.\\s*(?!(?:${DOMAIN_DOCUMENT_MEMBERS.join("|")})\\b)\\w+`);

/**
 * MAJOR-2 (review round 1): `globalThis.localStorage` and
 * `globalThis.navigator` already fired via DOM_GLOBAL_PATTERN (no lookbehind
 * ever guarded those tokens); `globalThis.document` and `globalThis.window`
 * were the one path the bare-`globalThis` exclusion above left open. Two
 * explicit tokens, no loss of the `crypto` exemption.
 */
const GLOBALTHIS_DOM_PATTERN = /\bglobalThis\s*\.\s*(?:document|window)\b/;

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

/**
 * Bonus fix from the D-1 hardcoded-triple audit (review round 2): the
 * forbidden-name literal `"@opencut/editor-classic"` became `boundary.layers[2]`
 * — see the caller for the matching manifest-gate fix. D-6 (review round 3)
 * found that fix carried the identical failure shape one arity notch further
 * in: a single index literal still assumed exactly three layers, so a
 * legally-declared fourth layer's dependency on it went uncaught. Now
 * `boundary.layers.slice(2)` — every layer above the two base layers,
 * structurally, for any layer count ≥ 2.
 */
function checkManifestReactFree(file, violations, boundary) {
	let data;
	try {
		data = JSON.parse(file.text);
	} catch {
		return;
	}
	const forbidden = new Set(["react", "react-dom", ...boundary.layers.slice(2)]);
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

/**
 * D-1 audit bonus (review round 2): the two literal manifest paths this used
 * to gate on (`packages/editor-ports/package.json`,
 * `packages/editor-contracts/package.json`) were themselves a hardcoded
 * pair tied to specific directory names — the same failure shape D-1 fixed
 * for `PACKAGE_SPECIFIER_PATTERN`, one layer up. A base-layer package whose
 * directory doesn't literally read "editor-ports"/"editor-contracts" (a
 * rename, or a second Host's own base package under a different name) was
 * invisible to the manifest-level forbidden-dependency check. D-6 (review
 * round 3): the original fix derived this from `boundary.layers[0]`/`[1]`
 * as two positional literals — now `boundary.layers.slice(0, 2)`, "the two
 * base layers" as a structural slice rather than two index literals that
 * happen to total two.
 */
function baseLayerManifestPaths(boundary, manifests) {
	const baseLayerNames = new Set(boundary.layers.slice(0, 2));
	return new Set(
		manifests.filter((m) => baseLayerNames.has(m.name)).map((m) => `packages/${m.dir}/package.json`),
	);
}

function reactFreeBaseRule({ files, boundary, manifests }) {
	const violations = [];
	let scanned = 0;
	const baseManifestPaths = baseLayerManifestPaths(boundary, manifests);
	// D-6 (review round 3): base/forbidden layer sets, computed once per run
	// from `boundary.layers` rather than as index literals at each use site.
	const baseLayerNames = new Set(boundary.layers.slice(0, 2));
	const forbiddenLayerNames = new Set(boundary.layers.slice(2));
	for (const file of files) {
		if (baseManifestPaths.has(file.path)) {
			checkManifestReactFree(file, violations, boundary);
			continue;
		}
		if (!file.path.startsWith("apps/web/src/")) continue;
		const owner = ownerOfPath(file.path, boundary);
		if (!baseLayerNames.has(owner)) continue;
		scanned += 1;
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
			const codeOnly = stripTypeofGuards(stripStringLiterals(line));
			// D-12 (review round 3): DOM_DOCUMENT_MEMBER_PATTERN's match gets its own
			// detail message, distinct from DOM_GLOBAL_PATTERN's and
			// GLOBALTHIS_DOM_PATTERN's. Those two only ever match a name that IS a DOM
			// global (`window`, `navigator`, `globalThis.document`, …), so "references
			// a DOM global" stays accurate for them. But since D-7's allowlist
			// inversion, DOM_DOCUMENT_MEMBER_PATTERN fires on ANY `document.<member>`
			// not in `DOMAIN_DOCUMENT_MEMBERS` — the reviewer found the single shared
			// message misleads on the MOST LIKELY trigger: an ordinary eighth domain
			// member (e.g. `document.title`), not a browser dependency at all. This
			// branch is checked first but does not change which lines violate —
			// DOM_DOCUMENT_MEMBER_PATTERN is still one arm of the same OR the pre-D-12
			// code tested, so the set of flagged lines is unchanged; only which detail
			// string a flagged line gets can differ.
			if (DOM_DOCUMENT_MEMBER_PATTERN.test(codeOnly)) {
				violations.push({
					rule: "react-free-base",
					path: file.path,
					line: index + 1,
					detail: `document.<member> not in the domain allowlist (DOMAIN_DOCUMENT_MEMBERS: ${DOMAIN_DOCUMENT_MEMBERS.join(", ")}) — either a real DOM access, or an ordinary domain member that just needs adding there`,
				});
				return;
			}
			if (DOM_GLOBAL_PATTERN.test(codeOnly) || GLOBALTHIS_DOM_PATTERN.test(codeOnly)) {
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
				if (resolved && resolved.startsWith("apps/web/src/")) {
					// D-6 (review round 3): was `=== boundary.layers[2]`, a single
					// index literal that missed a legally-declared fourth layer's
					// upward import from a manifest-clean base file. Now membership
					// in the same `forbiddenLayerNames` set `checkManifestReactFree`
					// uses, and the detail message names the actual resolved owner
					// instead of repeating the `boundary.layers[2]` literal.
					const resolvedOwner = ownerOfPath(resolved, boundary);
					if (forbiddenLayerNames.has(resolvedOwner)) {
						violations.push({
							rule: "react-free-base",
							path: file.path,
							line: index + 1,
							detail: `imports a module owned by ${resolvedOwner} via "${spec}"`,
						});
					}
				}
			}
		});
	}
	return { violations, scanned };
}

// ---------------------------------------------------------------------------
// Rules 2 & 3 — public-entry-only, no-internal-reexport. Rule 3 is dormant
// (packages/ has no source at this commit; reports 0 files scanned honestly,
// per D6). Rule 2 is live — its scope was widened in review round 1
// (BLOCKER-1) to cover every file outside a package's own src/, not only
// packages/**\/src, so a consumer or pre-move deep import is caught even
// while packages/ itself is empty.
// ---------------------------------------------------------------------------

/**
 * D-1 (review round 2): built from the discovered, boundary-validated
 * manifest list (`manifests`), never a hardcoded name literal. The prior
 * shape — a literal three-name alternation — was a SECOND hardcoded
 * package-name triple that survived BLOCKER-2's fix to `PACKAGE_DIRS`:
 * `manifestEntrySets` already builds its lookup table from discovered
 * manifests, so a legally-added fourth package's declared entries WERE in
 * that table, but this pattern rejected its specifiers before the table was
 * ever consulted — `public-entry-only` printed `PASS` while blind to every
 * deep import into the new package's internals. Mirrors the same
 * discover-don't-hardcode move `discoverPackageDirs` already made. Package
 * names are npm identifiers (`@scope/name`); none of their characters are
 * regex metacharacters requiring escape, but names are escaped anyway so a
 * future manifest name cannot corrupt the alternation.
 */
function packageSpecifierPattern(manifests) {
	// D-9 (review round 3): an empty manifest list degenerates the
	// alternation to `^()(/.*)?$`, which matches any specifier beginning
	// with "/" against a blank captured package name — reproduced: a file
	// importing `"/abs/path"` would be flagged as an undeclared subpath
	// "of " with no owner named. Nothing else in this file guards against
	// zero manifests reaching here, so fail closed here directly with a
	// comprehensible message instead of building a near-universal pattern.
	if (manifests.length === 0) {
		throw new Error(
			"check-package-boundary: packageSpecifierPattern requires at least one manifest — refusing to build a pattern that would match almost any specifier",
		);
	}
	const names = manifests.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^(${names.join("|")})(/.*)?$`);
}

function packagesSourceFiles(files) {
	return files.filter((f) => /^packages\/[^/]+\/src\//.test(f.path));
}

/**
 * Every file that could reach INTO a package from outside that package's own
 * `src/`: the three packages' own source (self-imports are exempted below by
 * name) plus every file under either consumer root, `apps/web/src/**` and
 * `apps/vite-example/**`. BLOCKER-1 (review round 1): the previous scope
 * (`packages/*\/src/**` only) could never see a consumer's deep import, which
 * is precisely the scenario spec.md:108-111 names ("WHEN a consumer imports a
 * subpath ... THEN the check reports it"). This deliberately covers ALL of
 * `apps/web/src`, not only the Next-shell paths `boundary.json` assigns to
 * the `apps/web` consumer itself — a not-yet-moved `editor/surface/**` file
 * (destined for `@opencut/editor-classic`) is ALREADY reaching into another
 * package the same way it will post-move, and the reviewer's own
 * reproduction used exactly such a file.
 */
function packageAndConsumerSourceFiles(files) {
	return files.filter(
		(f) =>
			/^packages\/[^/]+\/src\//.test(f.path) ||
			f.path.startsWith("apps/web/src/") ||
			f.path.startsWith("apps/vite-example/"),
	);
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
	const scope = packageAndConsumerSourceFiles(files);
	const entriesByPackage = manifestEntrySets(manifests);
	const dirToName = new Map(manifests.map((m) => [m.dir, m.name]));
	const specifierPattern = packageSpecifierPattern(manifests);
	// D-3 (review round 2): counts every specifier this rule actually looked at
	// (matched an @opencut/* package name), regardless of self-exemption or
	// pass/fail outcome — the same "examined" transparency acyclicDirectionRule
	// already gives its edge count. Without it, "949 files scanned, PASS" cannot
	// be told apart from "looked at 0 candidates, PASS by default".
	let specifiersExamined = 0;
	for (const file of scope) {
		// Only a file INSIDE a package's own src/ has a "self" to exempt; a
		// consumer or pre-move apps/web/src file never does, so every
		// @opencut/* deep import from there is judged, full stop.
		const packageMatch = /^packages\/([^/]+)\//.exec(file.path);
		const selfName = packageMatch ? dirToName.get(packageMatch[1]) : undefined;
		file.text.split(/\r?\n/).forEach((line, index) => {
			if (isComment(line)) return;
			const spec = extractSpecifier(line);
			if (!spec) return;
			const match = specifierPattern.exec(spec);
			if (!match) return;
			specifiersExamined += 1;
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
	return { violations, scanned: scope.length, specifiersExamined };
}

function noInternalReexportRule({ files, manifests }) {
	const violations = [];
	const scope = packagesSourceFiles(files);
	const entriesByPackage = manifestEntrySets(manifests);
	const entryFiles = manifestEntryFileSet(manifests);
	const specifierPattern = packageSpecifierPattern(manifests);
	for (const file of scope) {
		if (!entryFiles.has(file.path)) continue; // only declared entry files are asserted
		file.text.split(/\r?\n/).forEach((line, index) => {
			if (isComment(line)) return;
			if (!/\bexport\s[^;]*\bfrom\s+["']/.test(line)) return;
			const spec = extractSpecifier(line);
			if (!spec) return;
			const match = specifierPattern.exec(spec);
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
	const reactFree = reactFreeBaseRule({ files, boundary, manifests });
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
			"public-entry-only": { filesScanned: publicEntry.scanned, specifiersExamined: publicEntry.specifiersExamined },
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

/**
 * Enumerate every `packages/*` directory that carries a `package.json`, rather
 * than trusting a hardcoded list. BLOCKER-2 (review round 1): a hardcoded
 * triple made spec.md:35-39's "a [fourth] package is not silently introduced"
 * scenario unimplemented — a fourth `packages/*\/package.json` was invisible
 * to the whole checker.
 */
function discoverPackageDirs() {
	return readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => {
			try {
				readFileSync(join(REPO_ROOT, "packages", name, "package.json"), "utf8");
				return true;
			} catch {
				return false;
			}
		})
		.sort();
}

/** Exits `2`, the same fail-closed idiom `guardSelfConsistency` already uses,
 * on any discovered manifest whose `name` is absent from `boundary.json`'s
 * declared layer order — a package that exists on disk but has no declared
 * layer is refused outright, never silently skipped. */
function loadManifests(boundary) {
	const manifests = discoverPackageDirs().map((dir) => {
		const data = JSON.parse(readFileSync(join(REPO_ROOT, "packages", dir, "package.json"), "utf8"));
		return { dir, name: data.name, exports: data.exports ?? {} };
	});
	const undeclared = manifests.filter((m) => !boundary.layers.includes(m.name));
	if (undeclared.length > 0) {
		console.error(
			"check-package-boundary: packages/ contains a manifest not declared in boundary.json's layer order, refusing to scan:",
		);
		for (const m of undeclared) {
			console.error(`  packages/${m.dir}/package.json declares "${m.name}", which boundary.json.layers does not include`);
		}
		process.exit(2);
	}
	return manifests;
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
	const manifests = loadManifests(boundary);
	const files = collectRepoFiles();
	guardUnownedFiles(files, boundary);
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
		// D-6 (review round 3): description may be a string or a
		// `(boundary) => string` function (react-free-base's is now derived).
		const description = typeof rule.description === "function" ? rule.description(boundary) : rule.description;
		if (DORMANT_RULE_IDS.includes(rule.id) && c.filesScanned === 0) {
			console.log(`  ....  ${rule.id}: 0 files scanned — packages/ holds no source yet (${description})`);
			continue;
		}
		const extra =
			rule.id === "acyclic-direction"
				? `, ${c.edgesExamined} cross-package edge(s) examined`
				: rule.id === "public-entry-only"
					? `, ${c.specifiersExamined} @opencut/* specifier(s) examined`
					: "";
		console.log(`  ${hits.length === 0 ? "PASS" : "FAIL"}  ${rule.id}: ${description} (${c.filesScanned} file(s) scanned${extra})`);
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

function fixtureScan(fileList, boundary = FIXTURE_BOUNDARY, manifests = FIXTURE_MANIFESTS) {
	return scan({ files: fileList, boundary, manifests });
}

/**
 * D-1 regression fixture (review round 2): a legally-declared FOURTH
 * package — declared in `layers`, with its own manifest, the exact shape
 * BLOCKER-2's `loadManifests` guard requires before it admits one. A
 * dedicated boundary/manifest pair, not a mutation of
 * FIXTURE_BOUNDARY/FIXTURE_MANIFESTS, so the other fixtures keep asserting
 * against the unmodified three-package shape.
 */
const FOURTH_PACKAGE_BOUNDARY = { ...FIXTURE_BOUNDARY, layers: [...FIXTURE_BOUNDARY.layers, "@opencut/editor-extra"] };
const FOURTH_PACKAGE_MANIFESTS = [
	...FIXTURE_MANIFESTS,
	{ dir: "editor-extra", name: "@opencut/editor-extra", exports: { ".": "./src/index.ts" } },
];

/**
 * D-1 audit-bonus fixture (review round 2): a base-layer package whose
 * directory name does not literally read "editor-ports" — proves
 * `react-free-base`'s manifest gate now matches on the manifest's declared
 * `name` against `boundary.layers.slice(0, 2)` (D-6, review round 3 —
 * originally `boundary.layers[0]`/`[1]`), not a hardcoded directory path.
 * Also renames the layer-2 package so its forbidden-dependency name must
 * come from `boundary.layers.slice(2)` (D-6; originally the single literal
 * `boundary.layers[2]`), not the literal string `"@opencut/editor-classic"`.
 */
const RENAMED_DIR_BOUNDARY = { ...FIXTURE_BOUNDARY, layers: ["@opencut/editor-ports", "@opencut/editor-contracts", "@opencut/editor-classic-v2"] };
const RENAMED_DIR_MANIFESTS = [
	{ dir: "host-ports", name: "@opencut/editor-ports", exports: { ".": "./src/index.ts" } },
	FIXTURE_MANIFESTS[1],
	{ dir: "editor-classic", name: "@opencut/editor-classic-v2", exports: { ".": "./src/index.ts" } },
];

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
	{
		rule: "public-entry-only",
		note: "BLOCKER-1 regression: a consumer-side file outside packages/ deep-importing an undeclared subpath — invisible to the pre-fix packages/**/src-only scan set (the reviewer's own P-E reproduction used exactly this shape)",
		files: [
			{
				path: "apps/web/src/editor/surface/violation5.ts",
				text: 'import { Internal } from "@opencut/editor-ports/internal/secret";\nexport const i = Internal;\n',
			},
		],
	},
	{
		rule: "react-free-base",
		note: "MAJOR-1 regression: a document-named parameter used only as a domain value no longer blinds detection of a real document.createElement(...) call elsewhere in the same file",
		files: [
			{
				path: "apps/web/src/editor/ports/violation3.ts",
				text:
					"export function bind(document: { title: string }): string {\n" +
					"  return document.title;\n" +
					"}\n" +
					"export function mount(): unknown {\n" +
					'  return document.createElement("div");\n' +
					"}\n",
			},
		],
	},
	{
		rule: "react-free-base",
		note: "MAJOR-2 regression: globalThis.document reaching a DOM member is caught, closing the globalThis-prefixed hole the bare-globalThis exemption previously left open",
		files: [
			{
				path: "apps/web/src/editor/ports/violation4.ts",
				text: 'export function mount(): unknown {\n  return globalThis.document.createElement("div");\n}\n',
			},
		],
	},
	{
		rule: "public-entry-only",
		note: "D-1: a fourth package declared in boundary.json.layers (the legal way BLOCKER-2's guard admits one) must still be caught deep-importing its undeclared internals — PACKAGE_SPECIFIER_PATTERN must not stay hardcoded to the original three names (the reviewer's own D-B2b reproduction)",
		boundary: FOURTH_PACKAGE_BOUNDARY,
		manifests: FOURTH_PACKAGE_MANIFESTS,
		files: [
			{
				path: "apps/web/src/editor/surface/violation6.ts",
				text: 'import { Internal } from "@opencut/editor-extra/internal/secret";\nexport const i = Internal;\n',
			},
		],
	},
	{
		rule: "react-free-base",
		note: 'D-1 audit bonus: a base-layer package manifest is still checked for a forbidden dependency even when its directory name doesn\'t literally read "editor-ports", and the forbidden layer-2 name is read from boundary.layers.slice(2) (D-6, review round 3) rather than the literal string "@opencut/editor-classic"',
		boundary: RENAMED_DIR_BOUNDARY,
		manifests: RENAMED_DIR_MANIFESTS,
		files: [
			{
				path: "packages/host-ports/package.json",
				text: JSON.stringify({ name: "@opencut/editor-ports", dependencies: { "@opencut/editor-classic-v2": "workspace:*" } }),
			},
		],
	},
	{
		rule: "react-free-base",
		note: "D-6: a base-layer manifest depending on a legally-declared FOURTH layer (index 3, above the old boundary.layers[2] literal's reach) is caught — the forbidden set must be every layer above the two base layers, not only index 2",
		boundary: FOURTH_PACKAGE_BOUNDARY,
		manifests: FOURTH_PACKAGE_MANIFESTS,
		files: [
			{
				path: "packages/editor-ports/package.json",
				text: JSON.stringify({ name: "@opencut/editor-ports", dependencies: { "@opencut/editor-extra": "workspace:*" } }),
			},
		],
	},
	{
		rule: "react-free-base",
		note: "D-2: document.addEventListener — the single most common DOM idiom in editor code per the reviewer's own probe — is now caught; it was silently missed by the pre-fix 18-name alternation",
		files: [
			{
				path: "apps/web/src/editor/ports/violation8.ts",
				text: 'export function mount(): void {\n  document.addEventListener("resize", () => {});\n}\n',
			},
		],
	},
	{
		rule: "react-free-base",
		note: "D-4 regression guard: the generalized typeof strip only removes ONE member, so a chained typeof window.document.createElement stays caught exactly like the pre-existing D-M2d probe — it must not swallow a real access just because it starts with a typeof-guarded prefix",
		files: [
			{
				path: "apps/web/src/editor/ports/violation9.ts",
				text: 'export function check(): boolean {\n  return typeof window.document.createElement === "function";\n}\n',
			},
		],
	},
	{
		rule: "react-free-base",
		note: "D-7: document.hasFocus() — one of the 13+ real DOM members the round-2 denylist still missed (reviewer's finding) — is caught under the round-3 allowlist inversion without needing its own name added anywhere, because 'hasFocus' was never going to be on DOMAIN_DOCUMENT_MEMBERS in the first place",
		files: [
			{
				path: "apps/web/src/editor/ports/violation10.ts",
				text: "export function isFocused(): boolean {\n  return document.hasFocus();\n}\n",
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
	{
		rule: "public-entry-only",
		label: "a consumer-side (non-packages/) import of a declared entry — the widened BLOCKER-1 scope must not misfire on a legal import",
		files: [
			{
				path: "apps/web/src/editor/surface/consumer-ok.ts",
				text: 'import { Host } from "@opencut/editor-ports/host";\nexport const h = Host;\n',
			},
		],
	},
	{
		rule: "no-internal-reexport",
		label: "a declared entry re-exporting a DECLARED subpath of another package (not an undeclared internal)",
		files: [
			{
				path: "packages/editor-contracts/src/index.ts",
				text: 'export { Host } from "@opencut/editor-ports/host";\n',
			},
		],
	},
	{
		rule: "react-free-base",
		label: "a local document parameter used only as a domain value (no DOM member access) — the MAJOR-1 fix must not misclassify a domain document",
		files: [
			{
				path: "apps/web/src/editor/ports/document-param.ts",
				text: "export function trackCount(document: { tracks: unknown[] }): number {\n  return document.tracks.length;\n}\n",
			},
		],
	},
	{
		rule: "react-free-base",
		label: "a typeof globalThis.document environment-detection guard (agent-drivers.test.ts's own idiom) — not DOM consumption",
		files: [
			{
				path: "apps/web/src/editor/ports/env-guard.ts",
				text: 'export function isNode(): boolean {\n  return typeof globalThis.document === "undefined";\n}\n',
			},
		],
	},
	{
		rule: "public-entry-only",
		label: "D-1: a fourth declared package's own declared entry import stays silent — the fixed specifier pattern must recognize a legally-added package, not merely tolerate it",
		boundary: FOURTH_PACKAGE_BOUNDARY,
		manifests: FOURTH_PACKAGE_MANIFESTS,
		files: [
			{
				path: "apps/web/src/editor/surface/legal-fourth.ts",
				text: 'import { Internal } from "@opencut/editor-extra";\nexport const i = Internal;\n',
			},
		],
	},
	{
		rule: "react-free-base",
		label: "D-1 audit bonus: a renamed base-layer manifest with a legal (non-forbidden) dependency stays silent — the manifest gate must key off the declared name, not a hardcoded literal path or directory string",
		boundary: RENAMED_DIR_BOUNDARY,
		manifests: RENAMED_DIR_MANIFESTS,
		files: [
			{
				path: "packages/host-ports/package.json",
				text: JSON.stringify({ name: "@opencut/editor-ports", dependencies: { "@opencut/editor-contracts": "workspace:*" } }),
			},
		],
	},
	{
		rule: "react-free-base",
		label: "D-6: a base-layer manifest's dependency on the OTHER base layer (contracts→ports, the real declared relationship) stays silent in a legally-declared four-layer boundary — the widened forbidden set (boundary.layers.slice(2)) must not swallow the base layers themselves",
		boundary: FOURTH_PACKAGE_BOUNDARY,
		manifests: FOURTH_PACKAGE_MANIFESTS,
		files: [
			{
				path: "packages/editor-contracts/package.json",
				text: JSON.stringify({ name: "@opencut/editor-contracts", dependencies: { "@opencut/editor-ports": "workspace:*" } }),
			},
		],
	},
	{
		rule: "react-free-base",
		label: "D-4: typeof window.localStorage stays silent — the generalized single-member typeof strip must not regress into treating every window-prefixed environment guard as a DOM access",
		files: [
			{
				path: "apps/web/src/editor/ports/env-guard-storage.ts",
				text: 'export function hasStorage(): boolean {\n  return typeof window.localStorage !== "undefined";\n}\n',
			},
		],
	},
];

function runNegativeControl() {
	console.log("check-package-boundary: negative control");
	let clean = true;
	for (const fixture of NEGATIVE_FIXTURES) {
		const { violations } = fixtureScan(fixture.files, fixture.boundary, fixture.manifests);
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
		const { violations } = fixtureScan(fixture.files, fixture.boundary, fixture.manifests);
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
