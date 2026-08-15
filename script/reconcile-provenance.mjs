#!/usr/bin/env node
/**
 * PATCHES/UPSTREAM reconciliation against the derivation (S05 P7 task 4.2).
 *
 * Pairs every drift-classed inherited file — modified, movedModified and
 * movedRewritten, keyed by upstream path — with a `PATCHES.md` row, and every
 * fork-added path with a `UPSTREAM.md` listing, reporting both counts by
 * derivation (the drift classes come from `generate-source-inventory.mjs`,
 * never a hand-list). The patch log is the record: a drift-classed inherited
 * file with no row is a FAIL. An added path not listed in `UPSTREAM.md` is
 * reported every run but only FAILs under `--require-added` — task 6.3 owns
 * the added-file inventory, and Phase B's gates turn the requirement on once
 * it exists.
 *
 * The table pads its columns with spaces in its earlier rows, so rows are
 * parsed with a padding-aware regex; the count is cross-checked against the
 * naive `^| P-` line count and a shortfall refuses rather than under-reporting.
 *
 * Usage: node script/reconcile-provenance.mjs [--require-added]
 *        node script/reconcile-provenance.mjs --write-added-inventory
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeDrift, deriveAreas } from "./generate-source-inventory.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATCHES_PATH = join(REPO_ROOT, "PATCHES.md");
const UPSTREAM_PATH = join(REPO_ROOT, "UPSTREAM.md");
/** Padding-aware: the upstream path is the second column, space-padded. */
const ROW_RE = /^\| (P-\d+) \| `([^`]+)`\s*\|/;

export function parsePatches(text) {
	const rows = new Map();
	for (const line of text.split("\n")) {
		const m = ROW_RE.exec(line);
		if (m) {
			const list = rows.get(m[2]) ?? [];
			list.push(m[1]);
			rows.set(m[2], list);
		}
	}
	return rows;
}

export function reconcile({ repoRoot = REPO_ROOT } = {}) {
	const areas = deriveAreas(repoRoot);
	const drift = computeDrift(areas, undefined);
	const patchesText = readFileSync(PATCHES_PATH, "utf8");
	const rows = parsePatches(patchesText);

	const needRow = [
		...drift.modified,
		...drift.movedModified.map((e) => e.from),
		...drift.movedRewritten.map((e) => e.from),
	];
	const covered = needRow.filter((p) => rows.has(p));
	const missing = needRow.filter((p) => !rows.has(p)).sort();

	const restatedFroms = new Set(drift.movedUnmodified.map((e) => e.from));
	const orphanRows = [...rows.entries()]
		.filter(([p]) => !needRow.includes(p))
		.map(([p, ids]) => ({
			path: p,
			ids,
			overRestated: restatedFroms.has(p),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));

	// Sanity: the padding-aware parser must see at least as many rows as the
	// naive line count; fewer means the regex drifted off the table format.
	const naiveCount = (patchesText.match(/^\| P-/gm) ?? []).length;
	const parserSaw = [...rows.values()].reduce((n, ids) => n + ids.length, 0);

	const upstreamText = readFileSync(UPSTREAM_PATH, "utf8");
	const unlistedAdded = drift.added.filter((p) => !upstreamText.includes(p));
	const addedByArea = areas.map((area) => ({
		area,
		total: drift.added.filter((p) => p.startsWith(`${area}/`)).length,
		unlisted: unlistedAdded.filter((p) => p.startsWith(`${area}/`)).length,
	}));

	return {
		areas,
		drift,
		rows,
		rowCount: parserSaw,
		naiveCount,
		needRowCount: needRow.length,
		coveredCount: covered.length,
		missing,
		orphanRows,
		unlistedAdded,
		addedByArea,
	};
}

function logCensus(r) {
	console.log(`reconcile: areas ${r.areas.join(" ")}`);
	console.log(
		`reconcile: drift classes — ${r.drift.modified.length} modified, ` +
			`${r.drift.movedModified.length} moved-modified, ` +
			`${r.drift.movedRewritten.length} moved-rewritten, ` +
			`${r.drift.movedUnmodified.length} moved-unmodified, ` +
			`${r.drift.added.length} added, ${r.drift.deleted.length} deleted`,
	);
	console.log(
		`reconcile: PATCHES rows ${r.rowCount} across ${r.rows.size} unique upstream paths ` +
			`(naive ^| P- count ${r.naiveCount})`,
	);
	console.log(
		`reconcile: need-row ${r.needRowCount}, covered ${r.coveredCount}, MISSING ${r.missing.length}`,
	);
	console.log(
		`reconcile: rows without matching drift ${r.orphanRows.length} ` +
			`(${r.orphanRows.filter((o) => o.overRestated).length} over files now restated byte-identical)`,
	);
	for (const a of r.addedByArea) {
		console.log(
			`reconcile: added under ${a.area}: ${a.total} total, ${a.unlisted} unlisted in UPSTREAM.md`,
		);
	}
	if (r.naiveCount > r.rowCount) {
		console.log(
			`FAIL row-parse: the padding-aware parser saw ${r.rowCount} rows but the table has ` +
				`${r.naiveCount} \`| P-\` lines — the row regex has drifted off the table format`,
		);
	}
	if (r.missing.length > 0) {
		console.log(`FAIL missing-rows: ${r.missing.length} drift-classed inherited file(s) with no PATCHES.md row:`);
		for (const p of r.missing) console.log(`  - ${p}`);
	} else {
		console.log("reconcile: every drift-classed inherited file has a PATCHES.md row");
	}
	if (r.unlistedAdded.length > 0) {
		console.log(
			`reconcile: ${r.unlistedAdded.length} fork-added path(s) not listed in UPSTREAM.md ` +
				`(task 6.3 owns the inventory; a FAIL only under --require-added)`,
		);
	} else {
		console.log("reconcile: every fork-added path is listed in UPSTREAM.md");
	}
}

function writeAddedInventory(r) {
	const lines = [
		"## Added-file inventory (fork additions)",
		"",
		`Derived by \`script/reconcile-provenance.mjs --write-added-inventory\` from the same`,
		"drift derivation as `SOURCE_INVENTORY.json`. Fork-added files are not patches and never",
		"appear in `PATCHES.md`.",
		"",
	];
	for (const a of r.addedByArea) {
		const list = r.drift.added.filter((p) => p.startsWith(`${a.area}/`)).sort();
		if (list.length === 0) continue;
		lines.push(`### \`${a.area}\` (${list.length} file(s))`, "");
		for (const p of list) lines.push(`- \`${p}\``);
		lines.push("");
	}
	writeFileSync(join(REPO_ROOT, "UPSTREAM-ADDED-FILES.md"), `${lines.join("\n")}\n`);
	console.log(`reconcile: wrote UPSTREAM-ADDED-FILES.md (${r.drift.added.length} path(s))`);
}

function main() {
	const args = process.argv.slice(2);
	const r = reconcile();
	logCensus(r);
	if (args.includes("--write-added-inventory")) writeAddedInventory(r);
	const requireAdded = args.includes("--require-added");
	let code = 0;
	if (r.naiveCount > r.rowCount) code = 1;
	if (r.missing.length > 0) code = 1;
	if (requireAdded && r.unlistedAdded.length > 0) code = 1;
	console.log(`REAL_EXIT_CODE: ${code}`);
	return code;
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	process.exitCode = main();
}
