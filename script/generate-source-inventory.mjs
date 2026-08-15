#!/usr/bin/env node
/**
 * Source inventory for upstream provenance (S01 task 2.4; areas derived since
 * S05 P7 task 4.1).
 *
 * Hashes the *pinned upstream* content rather than the working tree, so the
 * inventory stays a stable fingerprint of what was forked even as this branch
 * patches files. Working-tree drift against the pin is reported separately.
 *
 * Usage: node script/generate-source-inventory.mjs [ref]
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The pinned upstream commit every provenance derivation compares against. */
export const PIN = "cf5e79e919144200294fb9fed22a222592a0aeea";
/**
 * CLI-only ref override (the documented `[ref]` usage). Flags are never refs —
 * and imported `computeDrift`/`deriveAreas` must not inherit an importer's
 * argv, so they default to `PIN` instead of reading this.
 */
const REF = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : PIN;

/**
 * The inventoried areas, DERIVED (S05 P7 task 4.1) rather than a hand-list:
 * the editor packages expand from the root manifest's `packages/*` workspace
 * glob; the consumers come from the boundary map — a consumer carrying an
 * ownership map contributes its mapped tree plus its app's `public` assets
 * (the inherited web tree), a consumer whose root is a `src` tree contributes
 * its whole app, any other contributes its root. `script` (the tooling
 * estate) and `rust` (the inherited crate tree) are the two survivors the
 * design names. Areas that do not exist are dropped, loudly by absence.
 */
export function deriveAreas(repoRoot = REPO_ROOT) {
	const areas = new Set();
	const workspaces =
		JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).workspaces ?? [];
	if (workspaces.includes("packages/*")) {
		for (const name of readdirSync(join(repoRoot, "packages")).sort()) {
			if (existsSync(join(repoRoot, "packages", name, "package.json"))) {
				areas.add(`packages/${name}`);
			}
		}
	}
	const boundary = JSON.parse(readFileSync(join(repoRoot, "packages/boundary.json"), "utf8"));
	for (const consumer of boundary.consumers ?? []) {
		const root = consumer.root;
		if (consumer.ownership) {
			areas.add(root);
			areas.add(`${dirname(root)}/public`);
		} else if (root.endsWith("/src")) {
			areas.add(dirname(root));
		} else {
			areas.add(root);
		}
	}
	areas.add("script");
	areas.add("rust");
	return [...areas]
		.filter((area) => existsSync(join(repoRoot, area)))
		.sort();
}

function git(args) {
	return execFileSync("git", args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
}

function listTree(ref, area) {
	const out = git(["ls-tree", "-r", "-z", ref, "--", area]);
	return out
		.split("\0")
		.filter(Boolean)
		.map((entry) => {
			const [meta, path] = entry.split("\t");
			const [, type, sha] = meta.split(/\s+/);
			return { type, sha, path, area };
		})
		.filter((e) => e.type === "blob");
}

/**
 * Hash every blob through a single `git cat-file --batch` process. One spawn per
 * file would take ~a minute on Windows for ~1k files.
 */
function hashBlobs(entries) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["cat-file", "--batch"], { cwd: REPO_ROOT });
		const results = new Map();
		let buf = Buffer.alloc(0);
		let pending = null;

		child.stdout.on("data", (chunk) => {
			buf = Buffer.concat([buf, chunk]);
			for (;;) {
				if (pending === null) {
					const nl = buf.indexOf(0x0a);
					if (nl === -1) return;
					const header = buf.subarray(0, nl).toString("utf8");
					buf = buf.subarray(nl + 1);
					const [sha, type, size] = header.split(" ");
					if (type === "missing") {
						reject(new Error(`missing object: ${header}`));
						return;
					}
					pending = { sha, size: Number(size) };
				}
				// content + trailing newline
				if (buf.length < pending.size + 1) return;
				const content = buf.subarray(0, pending.size);
				buf = buf.subarray(pending.size + 1);
				results.set(pending.sha, {
					sha256: createHash("sha256").update(content).digest("hex"),
					bytes: pending.size,
				});
				pending = null;
			}
		});
		child.on("error", reject);
		child.on("close", () => resolve(results));

		for (const e of entries) child.stdin.write(`${e.sha}\n`);
		child.stdin.end();
	});
}

/**
 * Working-tree drift against the pin, classified honestly (S05 P7 task 4.1):
 * a moved file whose bytes still match the pin is a RESTATEMENT (the P1
 * extraction), while a moved file whose bytes differ is DRIFT — the same
 * class as an in-place modification, and expected to carry a `PATCHES.md`
 * row keyed by its upstream path. `--name-status -M` with explicit `-M`
 * (never the diff.renames config's say-so); rename scores ride the status
 * field (`R087`), and the upstream path is the middle field. The
 * heavy-rewrite tail whose move git's similarity threshold missed is
 * recovered by unique-suffix pairing (see below) as `movedRewritten` —
 * drift, never a silent deletion.
 */
export function computeDrift(areas, ref = PIN) {
	const entries = git(["diff", "--name-status", "-M", ref, "--", ...areas])
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const fields = line.split("\t");
			return {
				kind: fields[0][0],
				score: fields[0].slice(1),
				from: fields.length === 3 ? fields[1] : null,
				path: fields[fields.length - 1],
			};
		});
	const of = (kind) => entries.filter((e) => e.kind === kind);
	const added = of("A").map((e) => e.path);
	// The extraction's heavy-rewrite tail: a pin path git reported deleted
	// pairs with the UNIQUE added path carrying the same path suffix — that
	// pair is drift (`movedRewritten`), not a deletion; no unique pair stays
	// `deleted`. Test-fixture trees (`script/fixtures/**`) replicate the
	// upstream layout verbatim, so a tail match there is a copy, never the
	// extraction destination — fixtures stay fork-added.
	const movedRewritten = [];
	const deleted = [];
	for (const from of of("D").map((e) => e.path)) {
		const suffix = from.replace(/^apps\/web\/src\//, "");
		const hits = added.filter(
			(p) => p.endsWith(suffix) && p !== from && !p.startsWith("script/fixtures/"),
		);
		if (hits.length === 1) {
			movedRewritten.push({ from, path: hits[0] });
			added.splice(added.indexOf(hits[0]), 1);
		} else {
			deleted.push(from);
		}
	}
	return {
		modified: of("M").map((e) => e.path),
		movedModified: of("R")
			.filter((e) => e.score !== "100")
			.map((e) => ({ from: e.from, path: e.path, similarity: e.score })),
		movedUnmodified: of("R")
			.filter((e) => e.score === "100")
			.map((e) => ({ from: e.from, path: e.path })),
		movedRewritten,
		added,
		deleted,
		copied: of("C").map((e) => ({ from: e.from, path: e.path })),
	};
}

async function main() {
	const areas = deriveAreas();
	const entries = areas.flatMap((area) => listTree(REF, area));
	const hashes = await hashBlobs(entries);

	const files = entries
		.map((e) => ({
			path: e.path,
			area: e.area,
			sha256: hashes.get(e.sha).sha256,
			bytes: hashes.get(e.sha).bytes,
		}))
		.sort((a, b) => a.path.localeCompare(b.path));

	const rollup = createHash("sha256");
	for (const f of files) rollup.update(`${f.sha256}  ${f.path}\n`);

	const byArea = areas.map((area) => {
		const list = files.filter((f) => f.area === area);
		const areaHash = createHash("sha256");
		for (const f of list) areaHash.update(`${f.sha256}  ${f.path}\n`);
		return {
			area,
			files: list.length,
			bytes: list.reduce((n, f) => n + f.bytes, 0),
			sha256: areaHash.digest("hex"),
		};
	});

	const drift = computeDrift(areas);

	const inventory = {
		ref: git(["rev-parse", REF]).trim(),
		generatedBy: "script/generate-source-inventory.mjs",
		hashAlgorithm: "sha256 over raw blob bytes; rollup = sha256 over sorted `<sha256>  <path>` lines",
		areas: byArea,
		totals: {
			files: files.length,
			bytes: files.reduce((n, f) => n + f.bytes, 0),
			sha256: rollup.digest("hex"),
		},
		workingTreeDriftAgainstPin: {
			...drift,
			classification:
				"modified, movedModified and movedRewritten are drift (a moved file with changed bytes is drift, not an addition) and are expected to carry a PATCHES.md row keyed by the upstream path; movedUnmodified files are byte-identical to the pin (the P1 extraction restated them) and carry no row; added files are fork additions, never patches; deleted paths have no working-tree counterpart under the inventoried areas",
		},
		files,
	};

	writeFileSync(
		join(REPO_ROOT, "SOURCE_INVENTORY.json"),
		`${JSON.stringify(inventory, null, 2)}\n`,
	);

	const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
	const md = `# Source inventory

Generated by \`script/generate-source-inventory.mjs\`. Regenerate with:

\`\`\`
node script/generate-source-inventory.mjs
\`\`\`

Hashes cover the **pinned upstream content** at \`${inventory.ref}\`, not the working
tree, so this fingerprint stays stable while this fork patches files.
Per-file hashes live in \`SOURCE_INVENTORY.json\`; this file is the summary.

| Area | Files | Size | Area digest (sha256) |
| --- | ---: | ---: | --- |
${byArea.map((a) => `| \`${a.area}\` | ${a.files} | ${mb(a.bytes)} | \`${a.sha256}\` |`).join("\n")}
| **Total** | **${inventory.totals.files}** | **${mb(inventory.totals.bytes)}** | \`${inventory.totals.sha256}\` |

Digest definition: \`sha256\` over the concatenation of \`<file sha256>  <path>\\n\` lines,
sorted by path. Per-file hash: \`sha256\` over raw file bytes.

## Working-tree drift against the pin

${
	drift.modified.length +
		drift.movedModified.length +
		drift.movedRewritten.length +
		drift.movedUnmodified.length +
		drift.added.length +
		drift.deleted.length +
		drift.copied.length ===
	0
		? "None — the inventoried areas are byte-identical to the pin."
		: [
				drift.modified.length === 0
					? "No inherited file in the inventoried areas is modified in place."
					: `**${drift.modified.length} inherited file(s) modified in place.** Each is expected to carry a \`PATCHES.md\` row.\n\n${drift.modified.map((p) => `- \`${p}\``).join("\n")}`,
				drift.movedModified.length === 0
					? null
					: `**${drift.movedModified.length} inherited file(s) moved WITH changes against the pin** (the P1 extraction, plus accumulated edits — similarity \`R<100\`). A moved file with changed bytes is drift, not an addition: each is expected to carry a \`PATCHES.md\` row keyed by its upstream path.\n\n${drift.movedModified.map((e) => `- \`${e.from}\` → \`${e.path}\` (R${e.similarity})`).join("\n")}`,
				drift.movedUnmodified.length === 0
					? null
					: `**${drift.movedUnmodified.length} inherited file(s) moved byte-unmodified (R100)** — the P1 extraction restated them; the content is identical to the pin, so no \`PATCHES.md\` row applies.\n\n${drift.movedUnmodified.map((e) => `- \`${e.from}\` → \`${e.path}\``).join("\n")}`,
				drift.movedRewritten.length === 0
					? null
					: `**${drift.movedRewritten.length} inherited file(s) moved with a full rewrite** — the extraction's heavy-rewrite tail: git's similarity pairing missed the move, so the pin path read as deleted; the unique-suffix derivation pairs each with its destination. Drift, not a deletion: expected to carry a \`PATCHES.md\` row keyed by the upstream path.\n\n${drift.movedRewritten.map((e) => `- \`${e.from}\` → \`${e.path}\``).join("\n")}`,
				drift.added.length === 0
					? null
					: `**${drift.added.length} file(s) added by this fork.** These are **not** patches and must **not** appear in \`PATCHES.md\`, which logs modifications to inherited files only.\n\n${drift.added.map((p) => `- \`${p}\``).join("\n")}`,
				drift.deleted.length === 0
					? null
					: `**${drift.deleted.length} inherited file(s) deleted** — no working-tree counterpart under the inventoried areas; a deliberate removal or an unpaired rewrite the derivation above refused to guess at.\n\n${drift.deleted.map((p) => `- \`${p}\``).join("\n")}`,
				drift.copied.length === 0
					? null
					: `**${drift.copied.length} file(s) copied** — a judgement call about which of the rules above applies.\n\n${drift.copied.map((e) => `- \`${e.from}\` → \`${e.path}\``).join("\n")}`,
			]
				.filter(Boolean)
				.join("\n\n")
}
`;

	writeFileSync(join(REPO_ROOT, "SOURCE_INVENTORY.md"), md);

	console.log(
		`inventory: ${inventory.totals.files} files, ${mb(inventory.totals.bytes)}, rollup ${inventory.totals.sha256}`,
	);
	console.log(
		`drift vs pin: ${drift.modified.length} modified, ${drift.movedModified.length} moved-modified (drift), ${drift.movedRewritten.length} moved-rewritten (drift), ${drift.movedUnmodified.length} moved-unmodified (restatement), ${drift.added.length} added, ${drift.deleted.length} deleted`,
	);
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	await main();
}
