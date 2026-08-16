/**
 * The three forms of `check-wasm-source.mjs`'s "is this gate wired into CI, after `bun install`?"
 * assertion, run against the real workflow and eight doctored variants.
 *
 * Rewriting an existing assertion is exactly where a change can quietly widen, so this measures
 * rather than argues. The case set is the independent reviewer's, kept as authored — cases 5-8 are
 * the ones this change's FIRST rewrite got wrong, and they are why the shipped form looks the way
 * it does.
 *
 *   node rasen/changes/wasm-determinism-init/evidence/gate-form-compare.mjs
 *
 * `want` records the answer a correct check must give, so a row is judged rather than just diffed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "bun-ci.yml"), "utf8");
const gate = "script/check-wasm-api-surface.mjs";
const esc = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
const installAt = (w) => w.search(/run:\s*bun install/);

/** The pre-change form: any mention of the path, first occurrence. */
const OLD = (w) => [w.indexOf(gate)].filter((at) => at !== -1);
/** This change's first rewrite: the first EXACT inline `run:` command. */
const FIRST = (w) => {
	const at = w.search(new RegExp(`run:\\s*node ${esc(gate)}\\s*$`, "m"));
	return at === -1 ? [] : [at];
};
/** Shipped: every exact invocation line, inline / `- run:` / inside a `run: |` block. */
const SHIPPED = (w) =>
	[...w.matchAll(new RegExp(`^[ \\t]*(?:- )?(?:run:[ \\t]*)?node ${esc(gate)}[ \\t]*$`, "gm"))].map(
		(m) => m.index,
	);

const verdict = (w, positions) => {
	const i = installAt(w);
	if (positions.length === 0) return "catches(no step running it)";
	if (i === -1) return "catches(no bun install)";
	if (!positions.some((at) => at > i)) return "catches(runs before bun install)";
	return "pass";
};

const REAL =
	"      - name: Verify the exact additive wasm API surface\n        run: node script/check-wasm-api-surface.mjs\n";
if (!wf.includes(REAL)) {
	console.error("gate-form-compare: anchor step not found — the workflow moved; update the anchor");
	process.exit(2);
}
const INSTALL_STEP =
	"      - name: Install dependencies\n        working-directory: apps/web\n        run: bun install\n";
const insertBeforeInstall = (source, line) => {
	const i = source.indexOf(INSTALL_STEP);
	if (i === -1) throw new Error("install anchor not found");
	return `${source.slice(0, i)}      - name: Early\n        run: ${line}\n${source.slice(i)}`;
};

const cases = [
	["0 baseline (unchanged)", wf, "pass"],
	[
		"1 step deleted, a comment still names the gate",
		wf.replace(REAL, "      # node script/check-wasm-api-surface.mjs used to run here\n"),
		"catches",
	],
	["2 step deleted and every mention scrubbed", wf.replaceAll(gate, "script/nothing.mjs"), "catches"],
	[
		"3 a flag appended to the only invocation",
		wf.replace(REAL, REAL.replace(".mjs\n", ".mjs --negative-control\n")),
		"catches",
	],
	[
		"4 the only invocation moved before `bun install`",
		insertBeforeInstall(wf.replace(REAL, ""), `node ${gate}`),
		"catches",
	],
	[
		"5 EXTRA early invocation with a flag; exact step still after install",
		insertBeforeInstall(wf, `node ${gate} --negative-control`),
		"pass",
	],
	[
		"6 EXTRA early invocation soft-failed; exact step still after install",
		insertBeforeInstall(wf, `node ${gate} || true`),
		"pass",
	],
	[
		"7 real step moved early WITH a flag, exact-form step appended at EOF",
		`${insertBeforeInstall(wf.replace(REAL, ""), `node ${gate} --negative-control`)}\n      - run: node ${gate}\n`,
		"pass",
	],
	[
		"8 invocation moved into a `run: |` block after install",
		wf.replace(REAL, `      - name: Verify\n        run: |\n          node ${gate}\n`),
		"pass",
	],
];

let wrong = { OLD: 0, FIRST: 0, SHIPPED: 0 };
for (const [name, w, want] of cases) {
	const row = { OLD: verdict(w, OLD(w)), FIRST: verdict(w, FIRST(w)), SHIPPED: verdict(w, SHIPPED(w)) };
	console.log(`${name}   [correct answer: ${want}]`);
	for (const form of ["OLD", "FIRST", "SHIPPED"]) {
		const ok = row[form].startsWith(want);
		if (!ok) wrong[form] += 1;
		console.log(`   ${form.padEnd(8)}: ${ok ? "  ok " : "WRONG"}  ${row[form]}`);
	}
}
console.log(
	`\nwrong answers over ${cases.length} cases — OLD: ${wrong.OLD}, FIRST(this change's first attempt): ${wrong.FIRST}, SHIPPED: ${wrong.SHIPPED}`,
);
process.exit(wrong.SHIPPED === 0 ? 0 : 1);
