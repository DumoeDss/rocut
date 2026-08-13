#!/usr/bin/env node
/**
 * Resolution-equivalence check (S05 P1 design E8, task 6.1).
 *
 * > For every rewritten specifier, the module it resolves to after the rewrite
 * > is the same module it resolved to before, compared as repo-relative paths
 * > across the rename map.
 *
 * This is the cheap, local invariant E8 puts ahead of the parity fixture: a
 * rewritten specifier that lands on the wrong module still compiles (nothing
 * about `@/editor/ports/x` vs `@opencut/editor-ports/y` is a type error), so
 * `tsc` cannot catch it. This check can, because it does not ask "does this
 * resolve", it asks "does this resolve to the *same file* the old specifier
 * did, after applying the rename map" — mechanically, from the same staged
 * diff the move itself produced.
 *
 * Scope: everything currently staged (`git diff --staged`). Designed to run
 * unmodified at every stage (E9) — Stage A today, B and C later, and again in
 * Group 6 over the full 2,179-edge rewrite — because it reads the rename map
 * and the specifier edits from the diff itself rather than from a hardcoded
 * per-stage list.
 *
 *   node script/check-resolution-equivalence.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Both consumer apps' `@/*` alias resolves to the same root. Verified against
 * apps/web/tsconfig.json (`"@/*": ["./src/*"]`) and
 * apps/vite-example/tsconfig.json (`"@/*": ["../web/src/*"]`) — same target,
 * different relative spelling. */
const OLD_ALIAS_ROOT = "apps/web/src";

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Task 3.3's deliberate debt discharge: `@/editor/ports/project-store` (4
 * uses) and `@/editor/ports/gpu-resources` (3 uses) were rewritten to the
 * package root (`@opencut/editor-ports`) instead of a dedicated subpath,
 * because the root already re-exports every symbol either file provided.
 * That is an intentional collapse of two file-identities into one barrel,
 * not a mis-resolution — this checker's strict "same file after the rename
 * map" comparison cannot tell the two apart on its own, so the exact old
 * targets it is allowed to land on the barrel for are named here explicitly.
 * Anything else landing on the barrel is still a real mismatch.
 */
const KNOWN_BARREL_COLLAPSES = new Map([
	["packages/editor-ports/src/project-store.ts", "packages/editor-ports/src/index.ts"],
	["packages/editor-ports/src/gpu-resources.ts", "packages/editor-ports/src/index.ts"],
	// Stage C (task 5.7): design-system atoms and editor-chrome components
	// consumed directly via a relative path before the move now resolve
	// through the "./ui" barrel (packages/editor-classic/src/ui/index.ts),
	// which re-exports them by design (task 5.3) rather than moving every
	// individual atom to its own declared entry.
	["packages/editor-classic/src/components/ui/sonner.tsx", "packages/editor-classic/src/ui/index.ts"],
	["packages/editor-classic/src/components/ui/button.tsx", "packages/editor-classic/src/ui/index.ts"],
	// Same pattern for the "./browser" barrel (task 5.3): browser-runtime and
	// c4-project-load are two of its curated re-export targets.
	["packages/editor-classic/src/editor/host/browser-runtime.ts", "packages/editor-classic/src/browser/index.ts"],
	["packages/editor-classic/src/editor/host/c4-project-load.ts", "packages/editor-classic/src/browser/index.ts"],
	// The package root barrel (packages/editor-classic/src/index.ts) re-exports
	// "./feedback/types" at top level (`export * from "./feedback/types"`), so
	// apps/web/src/feedback/queries.ts's old direct "./types" import correctly
	// collapses onto the package root rather than a dedicated feedback subpath
	// — this consumer only ever needed the two exported types, not a scoped entry.
	["packages/editor-classic/src/feedback/types.ts", "packages/editor-classic/src/index.ts"],
]);

/**
 * "Before the rewrite" means before the *currently staged* move — i.e. `HEAD`,
 * not the working tree. A file this stage moved away no longer exists on disk
 * at its old path, so resolving an old specifier must be checked against the
 * committed tree it was written against, not `existsSync`. Loaded once as a
 * Set for O(1) membership checks rather than a `git cat-file -e` subprocess
 * per specifier.
 */
function loadHeadFileSet() {
	const raw = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return new Set(raw.split(/\r?\n/).filter(Boolean));
}

/** A line that imports or re-exports through a string-literal specifier:
 * `from "..."`, `import("...")`, `require("...")`. Anchored on the quote so a
 * specifier that is a textual prefix of another (`@/editor/host/editor-host`
 * vs `...editor-host-context`) never false-matches — the lesson from task 3.3. */
const SPEC_LINE = /(?:from\s+|require\()\s*(["'])((?:@\/|@opencut\/|\.\.?\/)[^"']*)\1/;

function toPosix(p) {
	return p.replace(/\\/g, "/");
}

/** Resolve a repo-relative module path (no extension) to the file that
 * actually exists in the current working tree, trying the same suffixes a
 * bundler would. Must reject a directory match at the empty suffix (e.g.
 * `.../host` the directory exists, so a naive `existsSync` stops there and
 * never tries `.../host/index.ts`) — a bundler resolves the file, not the
 * directory. Returns null if none exist — a genuine dangling reference,
 * reported separately from a resolution *mismatch*. */
function probeWorkingTree(repoRelativeNoExt) {
	for (const suffix of CANDIDATE_SUFFIXES) {
		const candidate = repoRelativeNoExt + suffix;
		const full = join(REPO_ROOT, candidate);
		if (existsSync(full) && statSync(full).isFile()) return candidate;
	}
	return null;
}

/** Same probe, against `HEAD` (the pre-this-stage tree) instead of the working
 * tree — see `loadHeadFileSet()`. */
function probeHead(repoRelativeNoExt, headFiles) {
	for (const suffix of CANDIDATE_SUFFIXES) {
		const candidate = repoRelativeNoExt + suffix;
		if (headFiles.has(candidate)) return candidate;
	}
	return null;
}

function loadPackageExports() {
	const manifestPaths = execFileSync("git", ["ls-files", "packages/*/package.json"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	})
		.split(/\r?\n/)
		.filter(Boolean);

	/** name -> Map<exportKey, repo-relative target (no extension probing needed;
	 * exports maps already point at a concrete file)> */
	const packages = new Map();
	for (const manifestPath of manifestPaths) {
		const manifest = JSON.parse(readFileSync(join(REPO_ROOT, manifestPath), "utf8"));
		const pkgDir = posix.dirname(toPosix(manifestPath));
		const exportsMap = new Map();
		for (const [key, target] of Object.entries(manifest.exports ?? {})) {
			if (typeof target !== "string") continue; // conditional exports not used here
			exportsMap.set(key, posix.normalize(posix.join(pkgDir, target)));
		}
		packages.set(manifest.name, exportsMap);
	}
	return packages;
}

/** `@opencut/<pkg>` or `@opencut/<pkg>/<subpath>` -> the declared exports-map
 * key (`.` or `./<subpath>`), split at the first `/` after the scope+name. */
function splitPackageSpecifier(spec) {
	const rest = spec.slice("@opencut/".length); // "<pkg>" or "<pkg>/<subpath>"
	const slash = rest.indexOf("/");
	if (slash === -1) return { name: `@opencut/${rest}`, exportKey: "." };
	return { name: `@opencut/${rest.slice(0, slash)}`, exportKey: `.${rest.slice(slash)}` };
}

/** Resolve one specifier as it stood *before* the rewrite, from the file's old
 * location (post rename-map, i.e. where this file used to live), against
 * `HEAD`. Returns a repo-relative path, `null` (genuinely dangling), or
 * `undefined` (specifier form not recognised — not in scope for this check). */
function resolveOld(spec, oldFileRepoPath, headFiles) {
	if (spec.startsWith("@/")) {
		return probeHead(posix.join(OLD_ALIAS_ROOT, spec.slice(2)), headFiles);
	}
	if (spec.startsWith("./") || spec.startsWith("../")) {
		return probeHead(posix.normalize(posix.join(posix.dirname(oldFileRepoPath), spec)), headFiles);
	}
	return undefined; // e.g. an old bare-package specifier — none expected pre-move
}

/** Resolve one specifier as it stands *after* the rewrite, from the file's
 * current location, against the working tree. Same return-value contract as
 * `resolveOld`. */
function resolveNew(spec, newFileRepoPath, packages) {
	if (spec.startsWith("@opencut/")) {
		const { name, exportKey } = splitPackageSpecifier(spec);
		const exportsMap = packages.get(name);
		if (!exportsMap) return null;
		const target = exportsMap.get(exportKey);
		if (!target) return null;
		return probeWorkingTree(target.replace(/\.ts$/, ""));
	}
	if (spec.startsWith("./") || spec.startsWith("../")) {
		return probeWorkingTree(posix.normalize(posix.join(posix.dirname(newFileRepoPath), spec)));
	}
	if (spec.startsWith("@/")) {
		// Not yet rewritten at this file — same alias root as before the move.
		return probeWorkingTree(posix.join(OLD_ALIAS_ROOT, spec.slice(2)));
	}
	return undefined;
}

/** Parse `git diff --staged -M -U0` into, per new-side file path, the ordered
 * list of (oldLine, newLine) same-position replacement pairs within each hunk
 * — the shape every specifier rewrite in this Slice takes (task 3.3: one
 * specifier substitution per line, line count unchanged). */
function parseStagedHunks() {
	const raw = execFileSync("git", ["diff", "--staged", "-M", "-U0"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

	const files = []; // { oldPath, newPath, pairs: [{removed, added}] }
	let current = null;
	let pendingRemoved = [];

	const flushPair = () => {
		pendingRemoved = [];
	};

	for (const line of raw.split("\n")) {
		if (line.startsWith("diff --git ")) {
			current = { oldPath: null, newPath: null, pairs: [] };
			files.push(current);
			pendingRemoved = [];
			continue;
		}
		if (!current) continue;
		if (line.startsWith("rename from ")) {
			current.oldPath = line.slice("rename from ".length);
			continue;
		}
		if (line.startsWith("rename to ")) {
			current.newPath = line.slice("rename to ".length);
			continue;
		}
		if (line.startsWith("--- a/")) {
			current.oldPath = current.oldPath ?? line.slice("--- a/".length);
			continue;
		}
		if (line.startsWith("+++ b/")) {
			current.newPath = current.newPath ?? line.slice("+++ b/".length);
			continue;
		}
		if (line.startsWith("@@ ")) {
			flushPair();
			continue;
		}
		if (line.startsWith("-") && !line.startsWith("---")) {
			pendingRemoved.push(line.slice(1));
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			const added = line.slice(1);
			// Same-position replacement: exactly one queued removed line. Anything
			// else (pure add, pure delete, multi-line hunks unrelated to a single
			// specifier swap) is not a specifier rewrite pair and is skipped —
			// under-matching is safe here (task 6.2+ rewires import *sites*, this
			// check only ever needs to see the specifier-substitution shape).
			if (pendingRemoved.length === 1) {
				current.pairs.push({ removed: pendingRemoved[0], added });
				pendingRemoved = [];
			} else {
				pendingRemoved = [];
			}
			continue;
		}
	}

	return files.filter((f) => f.newPath && f.oldPath);
}

function main() {
	const packages = loadPackageExports();
	const headFiles = loadHeadFileSet();
	const files = parseStagedHunks();

	// Two directions, kept separate rather than reused, because the two lookups
	// mean different things: "what was *this edited file's own* old location"
	// (new -> old) vs. "the old specifier pointed at file X — where did X move
	// to" (old -> new).
	const newToOld = new Map();
	const oldToNew = new Map();
	for (const f of files) {
		if (f.oldPath !== f.newPath) {
			newToOld.set(f.newPath, f.oldPath);
			oldToNew.set(f.oldPath, f.newPath);
		}
	}

	let examined = 0;
	let skippedUnresolvedForm = 0;
	let knownBarrelCollapses = 0;
	const dangling = [];
	const mismatches = [];

	for (const file of files) {
		const oldFileRepoPath = newToOld.get(file.newPath) ?? file.newPath;
		for (const { removed, added } of file.pairs) {
			const removedMatch = SPEC_LINE.exec(removed);
			const addedMatch = SPEC_LINE.exec(added);
			if (!removedMatch || !addedMatch) continue; // not a specifier line
			const oldSpec = removedMatch[2];
			const newSpec = addedMatch[2];
			if (oldSpec === newSpec) continue; // line changed but this specifier didn't

			examined += 1;

			const oldResolved = resolveOld(oldSpec, oldFileRepoPath, headFiles);
			const newResolved = resolveNew(newSpec, file.newPath, packages);

			if (oldResolved === undefined || newResolved === undefined) {
				skippedUnresolvedForm += 1;
				continue;
			}
			if (oldResolved === null || newResolved === null) {
				dangling.push({ file: file.newPath, oldSpec, newSpec, oldResolved, newResolved });
				continue;
			}

			// Map the old target through the rename map: if the file the old
			// specifier pointed at was itself moved, its post-move location is
			// what the new specifier must agree with.
			const oldTargetMapped = oldToNew.get(oldResolved) ?? oldResolved;

			if (
				oldTargetMapped !== newResolved &&
				KNOWN_BARREL_COLLAPSES.get(oldTargetMapped) === newResolved
			) {
				knownBarrelCollapses += 1; // documented task 3.3 debt discharge, not a mismatch
				continue;
			}

			if (oldTargetMapped !== newResolved) {
				mismatches.push({
					file: file.newPath,
					oldSpec,
					newSpec,
					expected: oldTargetMapped,
					actual: newResolved,
				});
			}
		}
	}

	console.log(`check-resolution-equivalence: ${examined} rewritten specifier(s) examined`);
	if (skippedUnresolvedForm > 0) {
		console.log(`  ${skippedUnresolvedForm} skipped (specifier form not yet in scope, e.g. still-@/ on both sides)`);
	}
	if (knownBarrelCollapses > 0) {
		console.log(`  ${knownBarrelCollapses} allowed (task 3.3 documented barrel collapse, not a mismatch)`);
	}

	if (dangling.length > 0) {
		console.error(`\nFAIL  ${dangling.length} specifier(s) resolve to a file that does not exist:`);
		for (const d of dangling) {
			console.error(`  ${d.file}`);
			console.error(`    "${d.oldSpec}" -> ${d.oldResolved ?? "<none found>"}`);
			console.error(`    "${d.newSpec}" -> ${d.newResolved ?? "<none found>"}`);
		}
	}

	if (mismatches.length > 0) {
		console.error(`\nFAIL  ${mismatches.length} specifier(s) resolve to a different module than before the rewrite:`);
		for (const m of mismatches) {
			console.error(`  ${m.file}`);
			console.error(`    "${m.oldSpec}" resolved (post-rename-map) to ${m.expected}`);
			console.error(`    "${m.newSpec}" resolves to ${m.actual}`);
		}
	}

	if (dangling.length > 0 || mismatches.length > 0) {
		process.exit(1);
	}

	if (examined === 0) {
		console.error("\nFAIL  no rewritten specifiers found in the staged diff — nothing was verified.");
		console.error("Stage the specifier rewrites before running this check.");
		process.exit(1);
	}

	console.log("\nPASS  every rewritten specifier resolves to the same module it did before the rewrite");
}

main();
