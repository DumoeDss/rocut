#!/usr/bin/env node
/**
 * Type-regression check against the pinned baseline (S01 rulings R1/R2).
 *
 * Patch P-001 sets `typescript: { ignoreBuildErrors: true }` in
 * `apps/web/next.config.ts`, because the pinned baseline does not type-check and
 * repairing it would silently repair the very baseline this Slice compares
 * against. That patch also removes the type gate exactly where the host-seam
 * refactor most needs one: a type break introduced by S01 would be swallowed.
 *
 * This check restores the regression signal without repairing anything. It runs
 * `tsc --noEmit` over `apps/web` and diffs the diagnostics against a fixture
 * captured from the pin. An error present now but absent at the pin is an S01
 * regression and fails. Errors already in the baseline set are tolerated and
 * stay recorded.
 *
 *   node script/check-type-baseline.mjs              # compare against the fixture
 *   node script/check-type-baseline.mjs --regenerate # re-capture the fixture from the pin
 *
 * Regenerating never mutates the pinned repository. It expands `git archive` of
 * the pin into a temporary directory and links this worktree's `node_modules`
 * and build-generated directories into it, so the *only* difference between the
 * two runs is the content of `apps/web/src`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(REPO_ROOT, "script", "fixtures", "type-baseline.json");

/** The pin this Slice extracts from. The fixture is only meaningful against it. */
const PIN = "cf5e79e919144200294fb9fed22a222592a0aeea";

/**
 * `apps/web` declares TypeScript 5.8.3 and bun installs 5.9.3 for it; the repo
 * root has 6.0.3. The two versions do not produce the same diagnostics, so the
 * baseline is only comparable if both runs use the app's own compiler.
 */
const TSC = join(REPO_ROOT, "apps", "web", "node_modules", "typescript", "bin", "tsc");

/**
 * Linked rather than copied into the reconstructed pin. `node_modules` because
 * installing again would resolve differently; `.next` and `.content-collections`
 * because they are build-generated and absent from `git archive`, and tsconfig
 * includes both — leaving them out would manufacture differences that have
 * nothing to do with S01's edits.
 */
const LINKED = [
	"node_modules",
	"apps/web/node_modules",
	"apps/web/.next",
	"apps/web/.content-collections",
];

/**
 * Parse `tsc --pretty false` output into one record per diagnostic. Continuation
 * lines (the indented type-mismatch explanations) belong to the diagnostic above
 * them and are kept — they carry most of the signal for structural errors.
 */
function parseDiagnostics(output, roots) {
	const head = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
	const records = [];

	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+$/, "");
		if (!line) continue;

		const match = head.exec(line);
		if (match) {
			records.push({
				file: normalizePath(match[1], roots),
				line: Number(match[2]),
				severity: match[4],
				code: match[5],
				message: [match[6]],
			});
		} else if (records.length > 0 && /^\s/.test(rawLine)) {
			records[records.length - 1].message.push(normalizePath(line.trim(), roots));
		}
	}

	return records.map((r) => ({
		file: r.file,
		severity: r.severity,
		code: r.code,
		message: r.message.join(" ").replace(/\s+/g, " ").trim(),
		firstSeenLine: r.line,
	}));
}

/**
 * Absolute paths appear both as the diagnostic's own location and inside message
 * bodies (the dual-`next` identity clash prints four of them). They differ
 * between the worktree and the reconstructed pin, so they are collapsed to
 * `<repo>` — path normalization only, per R2. Nothing else about the diagnostic
 * is weakened.
 */
function normalizePath(text, roots) {
	let out = text.replace(/\\/g, "/");
	for (const root of roots) {
		const normalized = root.replace(/\\/g, "/");
		out = out.split(normalized).join("<repo>");
	}
	return out;
}

/**
 * The comparison key deliberately omits line and column. Any edit above an
 * existing error shifts its line — P-001 alone moved the `next.config.ts` error
 * from line 54 to 63 — and keying on position would report that as a regression.
 * File + code + full message text is specific enough that two distinct defects
 * collide only if they are the same defect; occurrences are counted, so a *new*
 * instance of an already-present error in the same file is still caught.
 *
 * The field separator is U+001F (unit separator), written as an escape rather
 * than as a literal byte so this file stays pure ASCII. It previously used
 * literal NUL bytes, which are legal in a JS string but make `grep`, `rg` and
 * other text tools classify the whole script as binary and report
 * "Binary file … matches" instead of the matching line. U+001F cannot appear in
 * a `tsc` diagnostic path or message either, so the key is just as collision-free.
 */
function keyOf(record) {
	return `${record.file}\u001f${record.severity}\u001f${record.code}\u001f${record.message}`;
}

function tally(records) {
	const counts = new Map();
	for (const record of records) {
		const key = keyOf(record);
		const existing = counts.get(key);
		if (existing) existing.count += 1;
		else counts.set(key, { record, count: 1 });
	}
	return counts;
}

function runTsc(appDir, roots) {
	if (!existsSync(TSC)) {
		console.error(`check-type-baseline: no compiler at ${TSC}`);
		console.error("Run `bun install` at the repo root first.");
		process.exit(2);
	}

	// `--incremental false` overrides tsconfig so the run leaves no .tsbuildinfo
	// behind; a stale one would make a later run silently skip files.
	const result = spawnSync(
		process.execPath,
		[TSC, "-p", "tsconfig.json", "--noEmit", "--incremental", "false", "--pretty", "false"],
		{ cwd: appDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);

	if (result.error) {
		console.error(`check-type-baseline: could not run tsc — ${result.error.message}`);
		process.exit(2);
	}

	return parseDiagnostics(`${result.stdout || ""}\n${result.stderr || ""}`, roots);
}

/** Expand the pin into a temp directory and link in what `git archive` omits. */
function reconstructPin() {
	const dir = mkdtempSync(join(tmpdir(), "rocut-pin-"));

	const archive = execFileSync("git", ["archive", PIN], {
		cwd: REPO_ROOT,
		maxBuffer: 512 * 1024 * 1024,
	});
	const tarPath = join(dir, "pin.tar");
	writeFileSync(tarPath, archive);
	// Extracted from `dir` with a relative name on purpose: GNU tar reads an
	// absolute Windows path as a `host:path` remote spec and tries to resolve the
	// drive letter as a hostname.
	execFileSync("tar", ["-xf", "pin.tar"], { cwd: dir });
	rmSync(tarPath);

	for (const relative of LINKED) {
		const target = join(REPO_ROOT, relative);
		if (!existsSync(target)) {
			console.error(`check-type-baseline: cannot reconstruct the pin — ${relative} does not exist.`);
			console.error("Run `bun install` and a production `next build` of apps/web first.");
			process.exit(2);
		}
		const link = join(dir, relative);
		mkdirSync(dirname(link), { recursive: true });
		// "junction" is the Windows form and is ignored on POSIX, where a
		// directory symlink is created instead.
		symlinkSync(target, link, "junction");
	}

	return dir;
}

const regenerate = process.argv.includes("--regenerate");

if (regenerate) {
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
	console.log(`check-type-baseline: reconstructing the pin ${PIN.slice(0, 8)} (HEAD is ${head.slice(0, 8)})`);

	const pinDir = reconstructPin();
	try {
		const records = runTsc(join(pinDir, "apps", "web"), [pinDir, REPO_ROOT]);
		const counts = tally(records);
		const entries = [...counts.values()]
			.map(({ record, count }) => ({
				file: record.file,
				severity: record.severity,
				code: record.code,
				message: record.message,
				count,
			}))
			.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

		mkdirSync(dirname(FIXTURE), { recursive: true });
		writeFileSync(
			FIXTURE,
			`${JSON.stringify(
				{
					pin: PIN,
					compiler: JSON.parse(
						readFileSync(join(REPO_ROOT, "apps", "web", "node_modules", "typescript", "package.json"), "utf8"),
					).version,
					capturedBy: "script/check-type-baseline.mjs --regenerate",
					note:
						"Diagnostics produced by `tsc --noEmit` over apps/web at the pin. These are " +
						"pre-existing upstream defects, recorded and tolerated — never repaired, because " +
						"repairing them would alter the baseline this Slice compares against (ruling R1). " +
						"Line and column are excluded from the comparison key; see the script header.",
					totalDiagnostics: records.length,
					diagnostics: entries,
				},
				null,
				2,
			)}\n`,
		);
		console.log(`wrote ${FIXTURE}`);
		console.log(`${records.length} diagnostic(s), ${entries.length} distinct`);
	} finally {
		rmSync(pinDir, { recursive: true, force: true, maxRetries: 3 });
	}
	process.exit(0);
}

if (!existsSync(FIXTURE)) {
	console.error(`check-type-baseline: no fixture at ${FIXTURE}`);
	console.error("Capture one with: node script/check-type-baseline.mjs --regenerate");
	process.exit(2);
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const baseline = new Map(fixture.diagnostics.map((d) => [keyOf(d), d.count]));
const current = tally(runTsc(join(REPO_ROOT, "apps", "web"), [REPO_ROOT]));

const regressions = [];
const resolved = [];
let stillPresent = 0;

for (const [key, { record, count }] of current) {
	const was = baseline.get(key) ?? 0;
	if (count > was) regressions.push({ record, was, now: count });
	if (was > 0) stillPresent += 1;
}

for (const diagnostic of fixture.diagnostics) {
	const now = current.get(keyOf(diagnostic))?.count ?? 0;
	if (now < diagnostic.count) resolved.push({ diagnostic, was: diagnostic.count, now });
}

const total = [...current.values()].reduce((sum, entry) => sum + entry.count, 0);
console.log(`check-type-baseline: ${total} diagnostic(s) now, ${fixture.totalDiagnostics} at the pin ${fixture.pin.slice(0, 8)}`);
console.log(`  compiler TypeScript ${fixture.compiler}, comparison key = file + code + message`);

if (resolved.length > 0) {
	console.log("\nPresent at the pin, absent or reduced now:");
	for (const { diagnostic, was, now } of resolved) {
		console.log(`  ${diagnostic.file} ${diagnostic.code} (${was} -> ${now})`);
	}
	console.log(
		"  Not a failure. Benign if a baseline defect was deliberately repaired; investigate if\n" +
			"  unexplained, because a shrunken type-check scope also looks like this.",
	);
}

// A baseline error set that has vanished entirely means the check no longer has
// a subject — tsconfig scope collapsed, or the compiler changed — and would
// otherwise report a clean pass while checking nothing.
if (fixture.diagnostics.length > 0 && stillPresent === 0) {
	console.error("\nFAIL  every baseline diagnostic disappeared at once.");
	console.error("The type-check almost certainly stopped covering apps/web/src rather than being fixed.");
	process.exit(1);
}

if (regressions.length > 0) {
	console.error(`\nFAIL  ${regressions.length} diagnostic(s) not present at the pin — S01 regressions:`);
	for (const { record, was, now } of regressions) {
		console.error(`  ${record.file}:${record.firstSeenLine} ${record.code} (pin ${was}, now ${now})`);
		console.error(`    ${record.message.slice(0, 240)}`);
	}
	process.exit(1);
}

console.log("\nPASS  no diagnostic outside the pinned baseline set");
