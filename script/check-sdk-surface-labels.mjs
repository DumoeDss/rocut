#!/usr/bin/env node
/**
 * SDK surface-label check (S05 P5, design.md E3 / spec `sdk-versioning-and-labeling`).
 *
 * Every publishable package carries a shipped `surface.json` that classifies each
 * export-map entry (except the mechanical `./package.json`) as `frozen`, `provider` or
 * `experimental`, and every non-frozen entry's source file carries an `@opencutSurface`
 * marker. This check makes an unlabeled export FAIL — classification at birth, the
 * labeling twin of the boundary checker's attribution rule.
 *
 * Three rules:
 *
 *   1. completeness       every export entry of every package appears in that
 *                         package's surface.json with a known class and a non-empty
 *                         reason, and every surface.json row names a real declared
 *                         entry (fail-closed in BOTH directions: an unclassified
 *                         entry and an undeclared row are both violations).
 *   2. marker-agreement   every provider/experimental row's target file carries an
 *                         `@opencutSurface <class>` marker whose class matches the
 *                         manifest; a frozen row's target file carries NO marker at
 *                         all — frozen classification lives in the manifest alone,
 *                         which is what keeps labeling from ever editing a frozen
 *                         file (the S03+S04 freeze stays byte-identical). A declared
 *                         target that does not exist FAILS for provider/experimental
 *                         and is reported as a dangling-export-entry finding for
 *                         frozen (repairing or removing a declared entry is
 *                         contract adjudication, not a labeling patch).
 *   3. override-validity  every symbol-level override names a symbol the entry
 *                         actually exports, resolved by the same source-scan
 *                         extraction idiom the boundary checker uses (export
 *                         statements + transitive re-export resolution — no TS
 *                         parser, no execution).
 *
 * Census lines print every run: per-package entry counts, per-class counts, and a
 * dangling-export-entries count (declared targets absent from disk). The numbers
 * are regression tests (P1's lesson: a collapsed census is a failure at `PASS`).
 * An empty scan — no packages, or no entries anywhere — refuses to pass (exit 2),
 * the house empty-scan idiom.
 *
 * Marker position is authoring discipline, not a rule: the design places the marker
 * as the entry file's first doc-comment line, but this check enforces presence and
 * class agreement only, so a later header reshuffle cannot fake a failure or hide
 * one. Prose that merely MENTIONS a class name cannot fire anything: only a literal
 * `@opencutSurface <class>` line in an entry's target file is read.
 *
 * Controls (the family idiom — the same pure `scan()` against in-memory fixtures,
 * never edits to the real tree):
 *
 *   --negative-control   an unlabeled experimental export (entry + manifest row
 *                        whose target file carries no marker), an export entry
 *                        with no manifest row at all, an unknown-class row, a
 *                        dangling symbol override, and a non-frozen row whose
 *                        declared target is absent — each must fire, named, or
 *                        the control exits non-zero. The unlabeled-export pair is
 *                        the spec's own named evidence ("an unlabeled experimental
 *                        export fails").
 *   --converse-control   correctly labeled rows, frozen rows WITHOUT markers (the
 *                        designed state), a resolving symbol override, prose that
 *                        mentions a class name, and a frozen row whose declared
 *                        target is absent — all must stay silent (the absent
 *                        frozen target reported as exactly one dangling finding),
 *                        or the control exits non-zero.
 *
 *   node script/check-sdk-surface-labels.mjs
 *   node script/check-sdk-surface-labels.mjs --negative-control
 *   node script/check-sdk-surface-labels.mjs --converse-control
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// OPENCUT_LABELS_ROOT points the scan at another packages-root (absolute or
// cwd-relative) so the empty-scan refusals can be evidenced against fixture
// worlds — and so CI can drive the check over its own geography (P3's seam
// precedent) — without touching the real packages/ directory.
const PACKAGES_ROOT = process.env.OPENCUT_LABELS_ROOT
	? resolve(process.env.OPENCUT_LABELS_ROOT)
	: join(REPO_ROOT, "packages");
const MECHANICAL_ENTRIES = new Set(["./package.json"]);
const CLASS_VOCABULARY = new Set(["frozen", "provider", "experimental"]);
const MARKER_PATTERN = /@opencutSurface\s+(frozen|provider|experimental)\b/g;

const RULES = [
	{
		id: "completeness",
		description:
			"every export entry is classified in surface.json with a known class and a non-empty reason, and every row names a declared entry",
		why: "fail-closed in both directions: an entry added to an export map without a classification fails (classification at birth), and a row naming an undeclared entry fails (no zombie classifications).",
	},
	{
		id: "marker-agreement",
		description:
			"provider/experimental rows carry a matching @opencutSurface marker in their entry file; frozen rows carry none",
		why: "the manifest is the classification's source of truth and the marker is its in-source twin for the two classes where a reader of the code most needs the warning in place; frozen files are never edited to carry markers — that is what keeps the S03+S04 freeze byte-identical.",
	},
	{
		id: "override-validity",
		description: "every symbol-level override names a symbol the entry actually exports",
		why: "a dangling override is a classification of something that does not exist; overrides resolve against real exports every run, so barrels that grow rot the override into a failure instead of silently widening it.",
	},
];

// ---------------------------------------------------------------------------
// Source-scan symbol extraction (the boundary checker's idiom: regex over
// export statements + relative resolution, no parser, no execution)
// ---------------------------------------------------------------------------

const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];

/** Every plausible file a relative specifier could mean, nearest first. */
function candidatePaths(fromDir, spec) {
	const base = resolve(fromDir, spec);
	return RESOLUTION_SUFFIXES.map((suffix) => `${base}${suffix}`);
}

/** `export { a, b as c }` clause -> exported names ["a", "c"] (the alias wins). */
function exportClauseNames(clause) {
	const names = [];
	for (const part of clause.split(",")) {
		const piece = part.trim();
		if (!piece) continue;
		const asMatch = piece.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
		if (asMatch) {
			names.push(asMatch[1]);
			continue;
		}
		const bare = piece.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)$/);
		if (bare) names.push(bare[1]);
	}
	return names;
}

/**
 * The symbols a module exports, following `export ... from` re-exports
 * transitively. `textOf(absPath)` returns file text or null (unresolvable
 * specifiers contribute nothing — extraction under-approximates by design and
 * never invents a name, which is the safe direction for override validity).
 */
function exportedSymbols(filePath, textOf, seen = new Set()) {
	const normalized = filePath.replaceAll("\\", "/");
	if (seen.has(normalized)) return new Set();
	seen.add(normalized);
	const text = textOf(filePath);
	if (text === null) return new Set();
	const symbols = new Set();

	// export { a, b as c } from "./x"   /   export { a } (local export list)
	const clauseRe = /export\s*\{([^}]*)\}(\s*from\s*["']([^"']+)["'])?/g;
	for (const match of text.matchAll(clauseRe)) {
		for (const name of exportClauseNames(match[1])) symbols.add(name);
		if (match[3]) {
			for (const target of resolveExportSource(filePath, match[3], textOf)) {
				for (const name of exportedSymbols(target, textOf, seen)) symbols.add(name);
			}
		}
	}
	// export * from "./x"
	for (const match of text.matchAll(/export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*["']([^"']+)["']/g)) {
		if (match[1]) {
			symbols.add(match[1]);
			continue;
		}
		for (const target of resolveExportSource(filePath, match[2], textOf)) {
			for (const name of exportedSymbols(target, textOf, seen)) symbols.add(name);
		}
	}
	// export default ...
	if (/export\s+default\b/.test(text)) symbols.add("default");
	// export const/let/var/function/class/type/interface/enum/abstract class NAME
	for (const match of text.matchAll(
		/export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
	)) {
		symbols.add(match[1]);
	}
	return symbols;
}

/** Every candidate target of a relative re-export specifier that exists. */
function resolveExportSource(fromFile, spec, textOf) {
	if (!spec.startsWith(".")) return [];
	const fromDir = dirname(fromFile);
	return candidatePaths(fromDir, spec).filter((candidate) => textOf(candidate) !== null);
}

// ---------------------------------------------------------------------------
// The pure scan — the live run and both controls call exactly this
// ---------------------------------------------------------------------------

/**
 * packages: [{ dir, name, exports, surface, textOf }]
 *   - exports: the manifest's parsed `exports` object
 *   - surface: the parsed surface.json ({ entries: { [entry]: row } }), or null
 *     when the file is missing/unparseable (reported as a violation)
 *   - textOf(absPath) -> file text | null
 */
function scan({ packages }) {
	const violations = [];
	const census = [];
	const dangling = [];
	let totalEntries = 0;

	for (const pkg of packages) {
		const declaredEntries = Object.keys(pkg.exports ?? {})
			.filter((entry) => !MECHANICAL_ENTRIES.has(entry))
			.sort();

		if (pkg.surface === null || typeof pkg.surface !== "object" || pkg.surface === undefined) {
			violations.push({
				rule: "completeness",
				detail: `${pkg.name}: surface.json is missing or unparseable — no classification source for ${declaredEntries.length} export entries`,
			});
		}

		const rows = pkg.surface && typeof pkg.surface === "object" && pkg.surface.entries && typeof pkg.surface.entries === "object" ? pkg.surface.entries : {};
		const rowEntries = Object.keys(rows);

		// Rule 1 — completeness, both directions + vocabulary + reason.
		for (const entry of declaredEntries) {
			const row = rows[entry];
			if (!row) {
				violations.push({
					rule: "completeness",
					detail: `${pkg.name}: export entry "${entry}" has no surface.json classification — classify it at birth (spec: the failure names the unclassified entry)`,
				});
				continue;
			}
			if (!CLASS_VOCABULARY.has(row.class)) {
				violations.push({
					rule: "completeness",
					detail: `${pkg.name}: entry "${entry}" carries unknown class "${String(row.class)}" — the vocabulary is exactly ${[...CLASS_VOCABULARY].join(" | ")}`,
				});
			}
			if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
				violations.push({
					rule: "completeness",
					detail: `${pkg.name}: entry "${entry}" carries an empty reason — every classification states one`,
				});
			}
		}
		for (const entry of rowEntries) {
			if (!declaredEntries.includes(entry)) {
				violations.push({
					rule: "completeness",
					detail: `${pkg.name}: surface.json row "${entry}" names an entry the export map does not declare`,
				});
			}
		}

		// Rules 2 + 3 need the row to be well-formed enough to compare.
		for (const entry of declaredEntries) {
			const row = rows[entry];
			if (!row || !CLASS_VOCABULARY.has(row.class)) continue;
			const target = pkg.exports[entry];
			if (typeof target !== "string") continue;
			const targetAbs = resolve(pkg.dir, target);
			const text = pkg.textOf(targetAbs);

			// Rule 2 — marker agreement. A declared target that does not exist is
			// recorded as a dangling-export-entry finding: FAIL for provider/
			// experimental (their marker cannot live in a missing file), reported
			// without failing for frozen — repairing or removing a declared entry
			// is contract adjudication, not a labeling patch.
			const markerClasses = text === null ? [] : [...text.matchAll(MARKER_PATTERN)].map((m) => m[1]);
			if (text === null) {
				dangling.push({ name: pkg.name, entry, target, cls: row.class });
			}
			if (row.class === "frozen") {
				if (markerClasses.length > 0) {
					violations.push({
						rule: "marker-agreement",
						detail: `${pkg.name}: frozen entry "${entry}" target carries an @opencutSurface marker (${markerClasses.join(", ")}) — frozen classification lives in surface.json alone; editing a frozen file for labeling is contract pressure, never a patch`,
					});
				}
			} else if (text === null) {
				violations.push({
					rule: "marker-agreement",
					detail: `${pkg.name}: ${row.class} entry "${entry}" target ${target} does not exist — its @opencutSurface ${row.class} marker cannot live in a missing file (dangling export entry)`,
				});
			} else if (!markerClasses.includes(row.class)) {
				violations.push({
					rule: "marker-agreement",
					detail: `${pkg.name}: ${row.class} entry "${entry}" target carries no @opencutSurface ${row.class} marker${markerClasses.length > 0 ? ` (found ${markerClasses.join(", ")})` : ""} — the in-source label must agree with the manifest`,
				});
			}

			// Rule 3 — override validity (only rows that carry overrides).
			const overrides = Array.isArray(row.symbols) ? row.symbols : [];
			if (overrides.length > 0) {
				if (text === null) {
					violations.push({
						rule: "override-validity",
						detail: `${pkg.name}: entry "${entry}" carries symbol overrides but its target ${target} cannot be read`,
					});
					continue;
				}
				const exported = exportedSymbols(targetAbs, pkg.textOf);
				for (const override of overrides) {
					if (!exported.has(override.symbol)) {
						violations.push({
							rule: "override-validity",
							detail: `${pkg.name}: entry "${entry}" overrides symbol "${String(override.symbol)}" which the entry does not export (extracted exports: ${[...exported].sort().join(", ") || "none"})`,
						});
					}
					if (!CLASS_VOCABULARY.has(override.class) || typeof override.reason !== "string" || override.reason.trim().length === 0) {
						violations.push({
							rule: "override-validity",
							detail: `${pkg.name}: entry "${entry}" override "${String(override.symbol)}" needs a known class and a non-empty reason`,
						});
					}
				}
			}
		}

		const byClass = { frozen: 0, provider: 0, experimental: 0 };
		for (const entry of declaredEntries) {
			const row = rows[entry];
			if (row && CLASS_VOCABULARY.has(row.class)) byClass[row.class] += 1;
		}
		census.push({ name: pkg.name, entries: declaredEntries.length, byClass });
		totalEntries += declaredEntries.length;
	}

	return { violations, census, dangling, totalEntries };
}

// ---------------------------------------------------------------------------
// Live repo I/O
// ---------------------------------------------------------------------------

function discoverPackageDirs() {
	return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => existsSync(join(PACKAGES_ROOT, name, "package.json")))
		.sort();
}

const liveTextOf = (absPath) => {
	try {
		return readFileSync(absPath, "utf8");
	} catch {
		return null;
	}
};

function loadLivePackages() {
	return discoverPackageDirs().map((dirName) => {
		const dir = join(PACKAGES_ROOT, dirName);
		const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		let surface = null;
		try {
			surface = JSON.parse(readFileSync(join(dir, "surface.json"), "utf8"));
		} catch {
			surface = null; // scan() reports the missing source per package
		}
		return { dir, name: manifest.name, exports: manifest.exports ?? {}, surface, textOf: liveTextOf };
	});
}

function renderCensus(census, totalEntries) {
	const lines = census.map(
		(c) =>
			`  census  ${c.name}: ${c.entries} export entries — frozen ${c.byClass.frozen}, provider ${c.byClass.provider}, experimental ${c.byClass.experimental}`,
	);
	const totals = census.reduce(
		(acc, c) => ({
			frozen: acc.frozen + c.byClass.frozen,
			provider: acc.provider + c.byClass.provider,
			experimental: acc.experimental + c.byClass.experimental,
		}),
		{ frozen: 0, provider: 0, experimental: 0 },
	);
	lines.push(
		`  census  total: ${totalEntries} export entries across ${census.length} package(s) — frozen ${totals.frozen}, provider ${totals.provider}, experimental ${totals.experimental}`,
	);
	return lines;
}

function runCheck() {
	const packages = loadLivePackages();
	if (packages.length === 0) {
		console.error(`check-sdk-surface-labels: no packages discovered under ${PACKAGES_ROOT} — refusing to pass over an empty scan`);
		process.exit(2);
	}
	const { violations, census, dangling, totalEntries } = scan({ packages });
	if (totalEntries === 0) {
		console.error("check-sdk-surface-labels: zero export entries scanned — refusing to pass over an empty scan");
		process.exit(2);
	}
	console.log(`check-sdk-surface-labels: scanned ${packages.length} package(s), ${totalEntries} export entries`);
	for (const line of renderCensus(census, totalEntries)) console.log(line);
	console.log(`  census  dangling-export-entries: ${dangling.length}`);
	for (const d of dangling) {
		console.log(
			`    finding ${d.name} ${d.entry} -> ${d.target} (${d.cls}) — declared but absent; repairing or removing an entry is contract adjudication, not a labeling patch`,
		);
	}
	const failed = new Set(violations.map((v) => v.rule));
	for (const rule of RULES) {
		const state = failed.has(rule.id) ? "FAIL" : "PASS";
		console.log(`  ${state}  ${rule.id}: ${rule.description}`);
	}
	for (const violation of violations) {
		console.log(`    FAIL ${violation.rule}: ${violation.detail}`);
	}
	if (violations.length > 0) {
		console.log(`check-sdk-surface-labels: ${violations.length} violation(s)`);
		process.exit(1);
	}
	console.log("clean — run with --negative-control / --converse-control to see each rule proven able to fire, and proven not to misfire.");
}

// ---------------------------------------------------------------------------
// Controls — the same pure scan() against in-memory fixtures
// ---------------------------------------------------------------------------

function fixtureTextOf(files) {
	// Fixtures key files POSIX-absolute ("/pkg/a/src/x.ts"); on win32 `resolve`
	// answers with a drive letter ("E:/pkg/a/src/x.ts"). Normalize the query the
	// same way both worlds normalize (backslashes -> forward) and strip any
	// leading drive so fixture keys match regardless of platform.
	return (absPath) => {
		const normalized = absPath.replaceAll("\\", "/").replace(/^[A-Za-z]:/, "");
		return Object.prototype.hasOwnProperty.call(files, normalized) ? files[normalized] : null;
	};
}

/** The shared correctly-labeled world both controls start from. */
function baseFixture() {
	const files = {
		"/pkg/a/src/index.ts": "/**\n * @opencutSurface provider — convenience barrel\n */\nexport * from \"./core\";\nexport const helper = 1;\n",
		"/pkg/a/src/core.ts": "export class Widget {}\nexport const CORE_VERSION = 1;\n",
		"/pkg/a/src/frozen-entry.ts": "export interface Contract {}\n",
		"/pkg/a/src/unstable.ts": "/**\n * @opencutSurface experimental — narrow fixture\n */\nexport function probe() {}\n",
		"/pkg/a/README.md": "# pkg-a\n\nThe README mentions provider conveniences and experimental surface in prose.\n",
	};
	const base = {
		files,
		packages: [
			{
				dir: "/pkg/a",
				name: "@fixture/pkg-a",
				exports: {
					".": "./src/index.ts",
					"./contract": "./src/frozen-entry.ts",
					"./probe": "./src/unstable.ts",
					"./package.json": "./package.json",
				},
				surface: {
					entries: {
						".": { class: "provider", reason: "convenience barrel" },
						"./contract": { class: "frozen", reason: "the contract" },
						"./probe": { class: "experimental", reason: "narrow fixture" },
					},
				},
				textOf: fixtureTextOf(files),
			},
		],
	};
	return base;
}

function runNegativeControl() {
	const worlds = [];

	// (1) The spec's named evidence: an unlabeled EXPERIMENTAL export — the
	// manifest row exists, the entry file carries no marker.
	{
		const world = baseFixture();
		world.packages[0].files = { ...world.files, "/pkg/a/src/unstable.ts": "export function probe() {}\n" };
		world.packages[0].textOf = fixtureTextOf(world.packages[0].files);
		worlds.push({ label: "unlabeled experimental export (row without marker)", world });
	}
	// (2) An export entry with no manifest row at all.
	{
		const world = baseFixture();
		world.packages[0].exports = { ...world.packages[0].exports, "./orphan": "./src/core.ts" };
		worlds.push({ label: "unclassified export entry (no row)", world });
	}
	// (3) An unknown class.
	{
		const world = baseFixture();
		world.packages[0].surface = {
			entries: { ...world.packages[0].surface.entries, ".": { class: "beta", reason: "not a class" } },
		};
		worlds.push({ label: "unknown class vocabulary", world });
	}
	// (4) A dangling symbol override.
	{
		const world = baseFixture();
		world.packages[0].surface = {
			entries: {
				...world.packages[0].surface.entries,
				".": { class: "provider", reason: "convenience barrel", symbols: [{ symbol: "doesNotExist", class: "frozen", reason: "dangling" }] },
			},
		};
		worlds.push({ label: "dangling symbol override", world });
	}
	// (5) A frozen row whose file carries a marker (the forbidden edit).
	{
		const world = baseFixture();
		world.packages[0].files = {
			...world.files,
			"/pkg/a/src/frozen-entry.ts": "/**\n * @opencutSurface frozen — misplaced marker\n */\nexport interface Contract {}\n",
		};
		world.packages[0].textOf = fixtureTextOf(world.packages[0].files);
		worlds.push({ label: "marker on a frozen-classified file", world });
	}
	// (6) A manifest row naming an undeclared entry.
	{
		const world = baseFixture();
		world.packages[0].surface = {
			entries: { ...world.packages[0].surface.entries, "./ghost": { class: "provider", reason: "zombie row" } },
		};
		worlds.push({ label: "row naming an undeclared entry", world });
	}
	// (7) A non-frozen row whose declared target does not exist — the marker
	// cannot live in a missing file (the live tree's dangling-entry class pair).
	{
		const world = baseFixture();
		world.packages[0].exports = { ...world.packages[0].exports, "./void": "./src/not-there.ts" };
		world.packages[0].surface = {
			entries: { ...world.packages[0].surface.entries, "./void": { class: "provider", reason: "points nowhere" } },
		};
		worlds.push({ label: "non-frozen entry with an absent target", world });
	}

	const ruleToLabel = new Map([
		["unlabeled experimental export (row without marker)", "marker-agreement"],
		["unclassified export entry (no row)", "completeness"],
		["unknown class vocabulary", "completeness"],
		["dangling symbol override", "override-validity"],
		["marker on a frozen-classified file", "marker-agreement"],
		["row naming an undeclared entry", "completeness"],
		["non-frozen entry with an absent target", "marker-agreement"],
	]);

	let missed = 0;
	for (const { label, world } of worlds) {
		const { violations } = scan({ packages: world.packages });
		const expectedRule = ruleToLabel.get(label);
		const fired = violations.filter((v) => v.rule === expectedRule);
		if (fired.length === 0) {
			missed += 1;
			console.log(`  MISSED  ${label}: expected a ${expectedRule} violation, none fired`);
		} else {
			console.log(`  FIRED   ${label}: ${fired.length} ${expectedRule} violation(s), e.g. ${fired[0].detail}`);
		}
	}
	if (missed > 0) {
		console.log(`negative control FAILED: ${missed} planted violation(s) went unreported`);
		process.exit(1);
	}
	console.log("negative control: every planted violation fired under its rule (the unlabeled experimental export FAILS — the spec's named evidence).");
}

function runConverseControl() {
	const world = baseFixture();

	// Add a RESOLVING symbol override (Widget is really exported through the barrel),
	// and a frozen row whose declared target is absent — reported as the single
	// dangling finding, never a violation.
	world.packages[0].exports = { ...world.packages[0].exports, "./void-frozen": "./src/not-there.ts" };
	world.packages[0].surface = {
		entries: {
			...world.packages[0].surface.entries,
			".": {
				class: "provider",
				reason: "convenience barrel",
				symbols: [{ symbol: "Widget", class: "provider", reason: "the barrel's own class atom" }],
			},
			"./void-frozen": { class: "frozen", reason: "declared but never authored" },
		},
	};

	const { violations, census, dangling, totalEntries } = scan({ packages: world.packages });
	for (const line of renderCensus(census, totalEntries)) console.log(line);
	console.log(`  census  dangling-export-entries: ${dangling.length}`);
	if (violations.length > 0) {
		console.log("converse control FAILED: correctly labeled surface produced violation(s):");
		for (const violation of violations) console.log(`    ${violation.rule}: ${violation.detail}`);
		process.exit(1);
	}
	if (dangling.length !== 1 || dangling[0].entry !== "./void-frozen" || dangling[0].cls !== "frozen") {
		console.log("converse control FAILED: the absent frozen target was not reported as exactly one frozen dangling finding");
		process.exit(1);
	}
	console.log(
		"converse control: silence over correctly labeled rows, frozen rows without markers (the designed state), a resolving override, prose that merely mentions a class name, and an absent frozen target reported as a finding rather than a violation.",
	);
}

const mode = process.argv[2] ?? "";
if (mode === "--negative-control") runNegativeControl();
else if (mode === "--converse-control") runConverseControl();
else runCheck();
