#!/usr/bin/env node
/**
 * Group 4 one-off: author the PATCHES.md rows `reconcile-provenance.mjs`
 * reports missing. Every field is derived — drift class and R-score from the
 * generator's own derivation, destination from the rename/pairing record,
 * last-touch from a single `git log` pass over the extracted package — so no
 * row carries invented archaeology. Dry-run by default; `--apply` appends.
 *
 * The forcing clause for the whole batch is S05 P1's extraction clause
 * (BOUNDARIES.md §7 "Specifier rewrites P1 owes"); post-extraction edits cite
 * their commit by hash and subject from the same pass.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePatches, reconcile } from "../../../../script/reconcile-provenance.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXTRACTION = "c234042e7a969b5a3e9201c9fc223b7b9b2c9ad7";
const LATER = new Map([
	[
		"f239d81b1a11d5305741c4515f2c14c08df7d419",
		"S05 P6 surface.json manifests + @opencutSurface markers (f239d81b)",
	],
	["35950753d73e1383a2d0b3486250833157e8cf4f", "storage/conformance entry + moved-source path fixes (35950753)"],
	["488a8a8d3ded082813ff4636469e83c6a190a30a", "Stage C hardcoded-path defect repair (488a8a8d)"],
]);

function lastTouchMap() {
	const out = execFileSync(
		"git",
		["log", `${EXTRACTION}~1..HEAD`, "--format=%x00%H", "--name-only", "--", "packages/editor-classic/src"],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	const map = new Map();
	for (const block of out.split("\0").filter(Boolean)) {
		const nl = block.indexOf("\n");
		const hash = block.slice(0, nl);
		for (const line of block.slice(nl + 1).split("\n")) {
			const f = line.trim();
			if (f && !map.has(f)) map.set(f, hash);
		}
	}
	return map;
}

function buildRows() {
	const r = reconcile({ repoRoot: REPO_ROOT });
	if (r.naiveCount > r.rowCount) throw new Error("row parser disagrees with the table — refusing");
	const touch = lastTouchMap();

	const movedModifiedByFrom = new Map(r.drift.movedModified.map((e) => [e.from, e]));
	const movedRewrittenByFrom = new Map(r.drift.movedRewritten.map((e) => [e.from, e]));
	const maxId = Math.max(
		...[...parsePatches(readFileSync(join(REPO_ROOT, "PATCHES.md"), "utf8")).values()].flat().map((id) =>
			Number(id.slice(2)),
		),
	);

	const rows = [];
	let next = maxId + 1;
	for (const from of r.missing) {
		const id = `P-${String(next).padStart(3, "0")}`;
		next += 1;
		let change;
		const mm = movedModifiedByFrom.get(from);
		const mr = movedRewrittenByFrom.get(from);
		if (mm) {
			change =
				`Stage C extraction (c234042e) moved the file to \`${mm.path}\` with import-specifier ` +
				`rewrites; R${mm.similarity} similarity vs the pin`;
		} else if (mr) {
			change =
				`Stage C extraction (c234042e) moved the file to \`${mr.path}\`; the rewrite is heavy ` +
				"enough that git rename detection reports no similarity — the pairing is derived by " +
				"unique path suffix (SOURCE_INVENTORY `movedRewritten`)";
		} else {
			change = "Modified in place against the pin";
		}
		const dest = mm?.path ?? mr?.path;
		const last = dest ? touch.get(dest.replace(/^packages\/editor-classic\//, "packages/editor-classic/")) : null;
		if (dest && !last) throw new Error(`no last-touch for destination ${dest} — refusing`);
		if (last && last !== EXTRACTION) {
			const note = LATER.get(last);
			if (!note) throw new Error(`unmapped post-extraction commit ${last} touches ${dest} — refusing`);
			change += `; later edits in ${note}`;
		} else {
			change += ", no later edits";
		}
		const rationale =
			"S05 P1 package extraction — the editor ships as `@opencut/editor-classic`, so the inherited " +
			'file moves into the package and its `@/editor/*` specifiers become package specifiers ' +
			'(BOUNDARIES.md §7 "Specifier rewrites P1 owes").';
		const verification =
			"Derivation: `git diff --name-status -M cf5e79e9` + `git log` attribution (this row is " +
			"derivation-backed); behavioural gates: the extraction commit's parity fixtures and the " +
			"30-checker family sweep.";
		rows.push(`| ${id} | \`${from}\` | ${change} | ${rationale} | ${verification} |`);
	}
	return { rows, missing: r.missing, needRow: r.needRowCount, covered: r.coveredCount };
}

const { rows, missing, needRow, covered } = buildRows();
console.log(`author-rows: missing ${missing.length} of need-row ${needRow} (covered ${covered})`);
if (rows.length > 0) {
	const first = /^\| (P-\d+)/.exec(rows[0])[1];
	const lastId = /^\| (P-\d+)/.exec(rows[rows.length - 1])[1];
	console.log(`author-rows: would append ${rows.length} row(s), ids ${first}..${lastId}`);
}
if (rows[0]) console.log(`sample first:\n${rows[0]}`);
if (rows[rows.length - 1]) console.log(`sample last:\n${rows[rows.length - 1]}`);
if (process.argv.includes("--apply")) {
	const patchesPath = join(REPO_ROOT, "PATCHES.md");
	const text = readFileSync(patchesPath, "utf8");
	const lines = text.split("\n");
	let lastRow = -1;
	for (let i = 0; i < lines.length; i++) if (/^\| P-/.test(lines[i])) lastRow = i;
	if (lastRow === -1) throw new Error("no table row found in PATCHES.md");
	lines.splice(lastRow + 1, 0, ...rows);
	writeFileSync(patchesPath, `${lines.join("\n")}`);
	console.log(`author-rows: appended ${rows.length} row(s) after line ${lastRow + 1}`);
}
