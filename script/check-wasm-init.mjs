#!/usr/bin/env node
/**
 * Runtime initialization gate for the redistributed wasm artifact.
 *
 * **The failure this exists to prevent from coming back.** Every other wasm gate is static: the
 * source gate compares bytes at the resolved path, the path gate scans the binary for build-machine
 * strings, the API-surface gate hashes the generated files and counts exports. All three passed
 * green for the entire S05 portfolio while the artifact **could not be initialized at all** by a
 * plain (non-bundler) consumer — `TypeError: wasm.__wbindgen_start is not a function`, the
 * Direction-level wasm-init finding. A static surface tells you the shape is right; only running it
 * tells you it starts.
 *
 * **What it runs.** The same probe under both runtimes that matter, plus the real 31-step classic
 * migration chain — the exact consumer S05 recorded as unloadable — with **no** `mock.module` and
 * no `@opencut/editor-classic/evidence/wasm-test-mock` anywhere in the process.
 *
 * **The negative control is the pre-fix world, not a synthetic mutation.** The last leg imports the
 * `--target bundler` entry directly under bun, which is precisely what a bare `opencut-wasm` import
 * resolved to before the `exports` conditions existed. It MUST still fail with
 * `__wbindgen_start` — bun resolves a `.wasm` import to an asset path string rather than instance
 * exports. If that leg ever passes, bun has implemented the WebAssembly/ESM integration and the
 * generated entry has become redundant rather than load-bearing: re-evaluate, do not delete the
 * control.
 *
 *   node script/check-wasm-init.mjs
 *
 * `OPENCUT_BUN` overrides the bun invocation (default `npx --yes bun@1.2.18`, same seam as
 * `script/run-published-examples.mjs`).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_PROBE = join(ROOT, "script", "fixtures", "wasm-init-probe.mjs");
const CHAIN_PROBE = join(
	ROOT,
	"script",
	"fixtures",
	"wasm-init-migrations-probe.ts",
);
const SYNC_ENTRY = "opencut_wasm_sync.js";
/** `rust/crates/time`'s tick lattice. A wrong value means the binary ran but is not this binary. */
const TICKS_PER_SECOND = 120_000;

const bunCommand = (process.env.OPENCUT_BUN ?? "npx --yes bun@1.2.18").split(
	/\s+/,
);

const failures = [];
const fail = (message) => failures.push(message);

/**
 * Quote only what needs it. Quoting the *command* token as well makes `cmd /s /c` strip the wrong
 * pair and resolve `npx` against the repo's own `node_modules/npm`, which fails with a missing
 * `npm-prefix.js` — measured, not theoretical.
 */
const quoteIfNeeded = (part) => (/\s/.test(part) ? `"${part}"` : part);

function runProbe({ label, command, args }) {
	const invocation = [...command, ...args];
	// `npx`/`bun` are `.cmd` shims on Windows and need a shell; passing one string rather than
	// command+args keeps node's DEP0190 warning out of every run.
	const result =
		process.platform === "win32"
			? spawnSync(invocation.map(quoteIfNeeded).join(" "), {
					cwd: ROOT,
					encoding: "utf8",
					shell: true,
				})
			: spawnSync(invocation[0], invocation.slice(1), {
					cwd: ROOT,
					encoding: "utf8",
				});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	// The probes print exactly one JSON line; npx and bun both prepend chatter, so take the last
	// line that parses rather than assuming position.
	const parsed = output
		.split(/\r?\n/)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.at(-1);
	if (!parsed) {
		fail(`${label}: probe printed no JSON report (exit ${result.status})`);
		console.log(`  FAIL  ${label} -> no JSON report`);
		for (const line of output.trim().split(/\r?\n/).slice(-4)) {
			console.log(`          ${line}`);
		}
		return null;
	}
	return parsed;
}

if (!existsSync(join(ROOT, "rust", "wasm", "pkg", SYNC_ENTRY))) {
	console.error(
		`check-wasm-init: rust/wasm/pkg/${SYNC_ENTRY} is absent; run bun run build:wasm`,
	);
	process.exit(2);
}
if (!existsSync(join(ROOT, "node_modules", "opencut-wasm"))) {
	console.error(
		"check-wasm-init: `opencut-wasm` is not installed; run bun install",
	);
	process.exit(2);
}

console.log("check-wasm-init: initializing the redistributed artifact for real");

// --- 1. the routed entries initialize --------------------------------------------
// Asserted per (runtime, specifier) pair, because the routing is deliberately narrow: `bun` is the
// only runtime condition declared, and every other runtime takes the explicit `/sync` subpath. A
// `node` condition would also be claimed by bundlers targeting node, which cannot serve this entry
// (BOUNDARIES §17), so it is absent by design and asserted absent by check-wasm-api-surface.
const entryReports = [];
for (const leg of [
	{
		label: "bun/bare",
		command: bunCommand,
		specifier: "opencut-wasm",
		mustResolveTo: SYNC_ENTRY,
	},
	{
		label: "node/sync",
		command: [process.execPath],
		specifier: "opencut-wasm/sync",
		mustResolveTo: SYNC_ENTRY,
	},
]) {
	const report = runProbe({
		label: leg.label,
		command: leg.command,
		args: [ENTRY_PROBE, `--specifier=${leg.specifier}`],
	});
	if (!report) continue;
	entryReports.push({ label: leg.label, report });
	const problems = [];
	if (report.error) problems.push(report.error);
	if (report.ticksPerSecond !== TICKS_PER_SECOND) {
		problems.push(
			`TICKS_PER_SECOND() = ${report.ticksPerSecond}, expected ${TICKS_PER_SECOND}`,
		);
	}
	if (report.exports === 0) problems.push("the entry exported nothing");
	if (!String(report.resolved).endsWith(leg.mustResolveTo)) {
		problems.push(
			`"${leg.specifier}" resolved to ${report.resolved}, not ${leg.mustResolveTo}`,
		);
	}
	console.log(
		`  ${problems.length === 0 ? "PASS" : "FAIL"}  ${report.runtime}: import "${leg.specifier}" -> ${report.exports} export(s), TICKS_PER_SECOND=${report.ticksPerSecond}`,
	);
	for (const problem of problems) console.log(`          ${problem}`);
	if (problems.length > 0) fail(`${leg.label}: ${problems.join("; ")}`);
}

// --- 1b. observation, not an assertion: node's bare specifier -------------------
// Node resolves the bare specifier to the `default` condition — the bundler entry — which works
// only on a node new enough to implement the WebAssembly/ESM integration. That is a property of
// the runtime, not of this artifact, so it is REPORTED with the version rather than asserted; a
// gate that failed here would be gating node's release schedule.
const nodeBare = runProbe({
	label: "node/bare",
	command: [process.execPath],
	args: [ENTRY_PROBE, "--specifier=opencut-wasm"],
});
if (nodeBare) {
	console.log(
		`  INFO  ${nodeBare.runtime}: the bare specifier resolves to the bundler entry and ${
			nodeBare.error
				? `does NOT initialize here (${nodeBare.error}) — such consumers import "opencut-wasm/sync"`
				: `initializes (${nodeBare.exports} exports) via this runtime's WebAssembly/ESM integration`
		}`,
	);
}

// --- 2. the two runtimes agree on what the binary computes ---------------------
// A binary that initializes but answers differently per runtime is a worse defect than one that
// refuses to start, and nothing else in the gate family would notice.
if (entryReports.length === 2) {
	const [a, b] = entryReports;
	const fields = [
		"exports",
		"ticksPerSecond",
		"mediaTimeFromSeconds2",
		"roundToFrame",
	];
	const disagreements = fields.filter(
		(field) => a.report[field] !== b.report[field],
	);
	console.log(
		`  ${disagreements.length === 0 ? "PASS" : "FAIL"}  ${a.report.runtime} and ${b.report.runtime} agree on all ${fields.length} probed values (mediaTimeFromSeconds(2)=${a.report.mediaTimeFromSeconds2}, roundToFrame=${a.report.roundToFrame})`,
	);
	for (const field of disagreements) {
		console.log(
			`          ${field}: ${JSON.stringify(a.report[field])} vs ${JSON.stringify(b.report[field])}`,
		);
	}
	if (disagreements.length > 0) {
		fail(`runtime disagreement on ${disagreements.join(", ")}`);
	}
}

// --- 3. the real migration chain loads, mock-free -------------------------------
const chain = runProbe({ label: "bun/migrations", command: bunCommand, args: [CHAIN_PROBE] });
if (chain) {
	const problems = [];
	if (chain.error) problems.push(chain.error);
	if (!chain.transformers) problems.push("the chain exposed no transformers");
	// The chain's own invariant: one transformer per version step. Asserting the relation rather
	// than the literal 31 keeps the gate honest when a migration is added.
	if (chain.transformers !== chain.currentProjectVersion) {
		problems.push(
			`migrations.length (${chain.transformers}) != CURRENT_PROJECT_VERSION (${chain.currentProjectVersion})`,
		);
	}
	console.log(
		`  ${problems.length === 0 ? "PASS" : "FAIL"}  ${chain.runtime}: @opencut/editor-classic/storage/migrations loads mock-free -> ${chain.transformers} transformer(s), CURRENT_PROJECT_VERSION=${chain.currentProjectVersion}, first=${chain.firstTransformer}`,
	);
	for (const problem of problems) console.log(`          ${problem}`);
	if (problems.length > 0) fail(`migration chain: ${problems.join("; ")}`);
}

// --- 4. negative control: the bundler entry still cannot start under bun --------
const control = runProbe({
	label: "bun/bundler-entry",
	command: bunCommand,
	args: [ENTRY_PROBE, "--specifier=opencut-wasm/opencut_wasm.js"],
});
if (control) {
	const fired =
		typeof control.error === "string" &&
		control.error.includes("__wbindgen_start");
	console.log(
		`  ${fired ? "PASS" : "FAIL"}  negative control: the --target bundler entry under ${control.runtime} still fails with __wbindgen_start`,
	);
	if (!fired) {
		console.log(
			`          observed instead: ${control.error ?? `initialized with ${control.exports} export(s)`}`,
		);
		fail(
			"negative control did not fire — the bundler entry now initializes under bun, so this gate is no longer proving what it claims",
		);
	}
}

if (failures.length > 0) {
	console.error("\ncheck-wasm-init FAILED:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(
	`\nclean — ${entryReports.length} runtime(s) initialized the artifact, the real migration chain loaded mock-free, and the pre-fix control still fires`,
);
