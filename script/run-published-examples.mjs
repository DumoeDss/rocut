#!/usr/bin/env node
/**
 * The published-examples runner (S05 P6, design E3/E4).
 *
 * Executes the copyable examples under `examples/` exactly the way an adopter
 * would: each one materialized as an independent project, its `@opencut/*`
 * dependencies resolved to freshly packed tarballs through the overrides
 * mechanism (the example's committed manifest declares plain exact versions —
 * the adopter-facing registry shape; this runner is what swaps them for local
 * tarballs), installed with npm, held to the no-linking controls, and run
 * through its own execution steps with self-logged exit codes.
 *
 * The scratch lifecycle, the no-linking controls and the react control all
 * come from `script/scratch-install-harness.mjs` (P6 task 2.1's extraction of
 * P3's inline machinery) — imported, never re-implemented. Packing comes from
 * `packSdkTarballs` through the harness's staging step. The consumer view
 * (P6 task 2.2's standing tooling) runs every full invocation against the
 * STAGED tarballs — the exact artifacts every example installs from.
 *
 * Per-example execution contract (read from the example's committed manifest):
 *   - `scripts.typecheck` / `scripts.build` / `scripts.smoke`, when present,
 *     run via `npm run <key>` in that fixed order — the example's own
 *     toolchain (its own typescript, vite, playwright) does the work;
 *   - `opencutExample.bunEntry`, when present, runs under the configured bun
 *     invocation afterwards (the bun-shaped examples' runtime step).
 *   An example declaring none of these has no execution and fails the run.
 *
 * Modes:
 *   node script/run-published-examples.mjs                     # full run
 *   node script/run-published-examples.mjs --consumer-view-only
 *
 * The consumer-view-only mode is the cheap daily gate (design E4): verify the
 * packed surface — nothing materialized, nothing installed. It consumes
 * `OPENCUT_PREPACKED_DIR` when set and packs fresh otherwise, exactly like
 * `script/check-sdk-consumer-view.mjs`'s own CLI.
 *
 * Environment (besides the harness's inherited seams):
 *   OPENCUT_EXAMPLES_ROOT   where examples are materialized (default: under
 *                           the scratch root; asserted outside the repo tree
 *                           and outside every Temp path like the scratch root)
 *   OPENCUT_EXAMPLES        comma-separated subset of example names to run
 *                           (default: every directory under examples/ with a
 *                           package.json) — a developer iterates on one, CI
 *                           runs all four
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { createScratchHarness } from "./scratch-install-harness.mjs";
import { runConsumerView } from "./check-sdk-consumer-view.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
const EXAMPLES_SOURCE_DIR = join(REPO_ROOT, "examples");
const IS_WINDOWS = process.platform === "win32";

const harness = createScratchHarness({
	label: "run-published-examples",
	repoRoot: REPO_ROOT,
	defaultScratchName: "opencut-scratch-p6-examples",
	scratchProjectName: "opencut-published-examples",
	markerCreatedBy: "script/run-published-examples.mjs",
});
const { fail, isInside, resolveScratchRoot, freshLifecycle, stageTarballs, install, controlCopiesNotLinks, controlReact } =
	harness;

const consumerViewOnly = process.argv.includes("--consumer-view-only");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const head = spawnSync("git rev-parse --short HEAD", {
	shell: true,
	encoding: "utf8",
	cwd: REPO_ROOT,
}).stdout?.trim();
console.log(`run-published-examples: running at ${head || "(unknown head)"}${consumerViewOnly ? " (consumer-view-only)" : ""}`);

/** Run one example step under a shell, echo its output, self-log the exit. */
function runStep(example, step, command, cwd) {
	const result = spawnSync(command, {
		shell: true,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		cwd,
	});
	const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
	if (output) console.log(output);
	const code = result.status ?? -1;
	console.log(`EXIT[example/${example}/${step}]:${code}`);
	if (code !== 0) fail(`example/${example}/${step}`, "step failed — see output above");
	return { code, output };
}

// ---------------------------------------------------------------------------
// The consumer view (design E4): the daily gate, and the first stage of a
// full run — verified against the staged tarballs so what the view checks is
// byte-for-byte what every example installs from.
// ---------------------------------------------------------------------------

function runTheConsumerView() {
	const result = runConsumerView({ repoRoot: REPO_ROOT, log: (line) => console.log(line) });
	if (result.failures > 0) {
		fail("consumer-view", `${result.failures} clause failure(s) — see the report above`);
	}
	console.log(
		`consumer-view: PASS (${result.packages.length} package(s) verified, 0 failures, ${result.dangling} dangling)`,
	);
}

if (consumerViewOnly) {
	runTheConsumerView();
	console.log("REAL_EXIT_CODE[examples-run]:0");
	process.exit(0);
}

// ---------------------------------------------------------------------------
// Full run: lifecycle, staging, consumer view, then every selected example
// ---------------------------------------------------------------------------

const root = resolveScratchRoot();
freshLifecycle(root);
const staged = stageTarballs(root);
const stagedFiles = staged.map((entry) => entry.file ?? entry.spec.replace(/^file:tarballs\//, ""));
const stagedByName = new Map(staged.map((entry) => [entry.name, entry.spec]));

// The consumer view verifies the staged tarballs — the exact artifacts the
// examples below install from, not a second packing of the same tree.
process.env.OPENCUT_PREPACKED_DIR = join(root, "tarballs");
runTheConsumerView();

const examplesRoot = resolve(process.env.OPENCUT_EXAMPLES_ROOT ?? join(root, "examples"));
console.log(
	`examples root: ${examplesRoot}${process.env.OPENCUT_EXAMPLES_ROOT ? " (OPENCUT_EXAMPLES_ROOT)" : " (under the scratch root)"}`,
);
if (isInside(examplesRoot, REPO_ROOT)) {
	fail("examples-root", `examples root is inside the repo tree (${REPO_ROOT}) — materialized installs would pollute it; refusing`);
}
const temps = [process.env.TEMP, process.env.TMP, process.env.TMPDIR, tmpdir()].filter(Boolean).map((t) => resolve(t));
const examplesUnderTemp = temps.filter((t) => isInside(examplesRoot, t));
if (examplesUnderTemp.length > 0) {
	fail("examples-root", `examples root sits under a Temp path (${examplesUnderTemp[0]}) — the measured AV hazard; refusing`);
}
mkdirSync(examplesRoot, { recursive: true });

if (!existsSync(EXAMPLES_SOURCE_DIR)) {
	fail("examples", `no examples directory at ${EXAMPLES_SOURCE_DIR}`);
}
const available = readdirSync(EXAMPLES_SOURCE_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES_SOURCE_DIR, entry.name, "package.json")))
	.map((entry) => entry.name)
	.sort();
if (available.length === 0) {
	fail("examples", `no example projects under ${EXAMPLES_SOURCE_DIR} (a directory with a package.json)`);
}
const requested = process.env.OPENCUT_EXAMPLES
	? process.env.OPENCUT_EXAMPLES.split(",")
			.map((name) => name.trim())
			.filter(Boolean)
	: available;
for (const name of requested) {
	if (!available.includes(name)) {
		fail("examples", `unknown example '${name}' (available: ${available.join(", ")})`);
	}
}
console.log(
	`examples: running ${requested.length} of ${available.length} (${requested.join(", ")})${process.env.OPENCUT_EXAMPLES ? " (OPENCUT_EXAMPLES)" : ""}`,
);

// ---------------------------------------------------------------------------
// Materialize: the committed manifest's @opencut/* exact pins resolve to the
// staged tarballs (dependencies AND matching overrides — npm requires a
// direct dependency's spec to equal its override). The committed file keeps
// the adopter-facing registry shape; only the materialized copy carries
// file:tarballs/* specs.
// ---------------------------------------------------------------------------

const EXACT_PIN = /^\d+\.\d+\.\d+$/;

function materialize(name) {
	const source = join(EXAMPLES_SOURCE_DIR, name);
	const target = join(examplesRoot, name);
	rmSync(target, { recursive: true, force: true });
	cpSync(source, target, { recursive: true });

	const committed = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	if (committed.overrides) {
		fail(
			"materialize",
			`${name}: the committed manifest carries its own overrides — examples don't; the runner injects the tarball resolution`,
		);
	}
	const dependencies = { ...(committed.dependencies ?? {}) };
	if (Object.keys(committed.devDependencies ?? {}).some((key) => key.startsWith("@opencut/"))) {
		fail(
			"materialize",
			`${name}: @opencut/* in devDependencies — the SDK belongs in dependencies (the consumed surface, not the toolchain)`,
		);
	}

	const rewritten = [];
	for (const key of Object.keys(dependencies)) {
		if (!key.startsWith("@opencut/")) continue;
		const pinned = dependencies[key];
		if (!EXACT_PIN.test(pinned)) {
			fail(
				"materialize",
				`${name}: ${key} spec '${pinned}' is not an exact pin — examples declare exact versions and the runner resolves them to tarballs`,
			);
		}
		const spec = stagedByName.get(key);
		if (!spec) {
			fail("materialize", `${name}: no staged tarball for ${key}`);
		}
		const packedVersion = spec.match(/-(\d+\.\d+\.\d+(?:-[\w.-]+)?)\.tgz$/)?.[1];
		if (pinned !== packedVersion) {
			fail(
				"materialize",
				`${name}: ${key} pinned ${pinned} but the packed tarball is ${packedVersion} — the example manifest is stale; update it to the packed version`,
			);
		}
		dependencies[key] = spec;
		rewritten.push(key);
	}
	if (rewritten.length === 0) {
		fail("materialize", `${name}: no @opencut/* dependencies — not an SDK example`);
	}

	const overrides = Object.fromEntries(rewritten.map((key) => [key, stagedByName.get(key)]));
	let wasmOverride = false;
	if (dependencies["@opencut/editor-classic"]) {
		// The fourth-tarball ruling (2026-08-15): classic's declared opencut-wasm
		// dependency rides a dead `file:../../rust/wasm/pkg` spec inside the
		// packed manifest — the override makes it resolve to the staged tarball.
		const wasmSpec = stagedByName.get("opencut-wasm");
		if (!wasmSpec) {
			fail("materialize", `${name}: depends on @opencut/editor-classic but no opencut-wasm tarball is staged`);
		}
		overrides["opencut-wasm"] = wasmSpec;
		wasmOverride = true;
	}

	const materialized = { ...committed, dependencies };
	if (Object.keys(overrides).length > 0) {
		materialized.overrides = overrides;
	}
	writeFileSync(join(target, "package.json"), `${JSON.stringify(materialized, null, 2)}\n`);
	console.log(
		`materialize: ${name} — ${rewritten.length} @opencut/* spec(s) resolved to staged tarballs${wasmOverride ? " (+ the opencut-wasm override)" : ""}`,
	);

	// Stage the tarballs beside the materialized project so its
	// file:tarballs/* specs resolve exactly as P3's scratch project's did.
	const targetTarballs = join(target, "tarballs");
	mkdirSync(targetTarballs, { recursive: true });
	for (const file of stagedFiles) {
		cpSync(join(root, "tarballs", file), join(targetTarballs, file));
	}
	return { committed, target };
}

// ---------------------------------------------------------------------------
// The per-example run: install, controls, execution steps
// ---------------------------------------------------------------------------

const NPM = IS_WINDOWS ? "npm.cmd" : "npm";

function runExample(name) {
	console.log(`\n=== example ${name} ===`);
	const { committed, target } = materialize(name);

	install(target, `npm-install/${name}`);

	// Control 2 over exactly what this example declared (plus opencut-wasm
	// when the override wired it): every installed SDK package a real
	// directory copy with a file: tarball resolution.
	const controlNames = Object.keys(committed.dependencies ?? {}).filter((key) => key.startsWith("@opencut/"));
	if (controlNames.includes("@opencut/editor-classic")) controlNames.push("opencut-wasm");
	controlCopiesNotLinks(target, controlNames);

	// The react control, derived from the example's own manifest: absent for
	// the React-free examples (classic's peer deliberately unsatisfied — the
	// CONTROL-react-free pattern), present when the example itself supplies
	// react (the peer-dep contract working as designed).
	const reactDeclared = Boolean(
		committed.dependencies?.react ?? committed.devDependencies?.react ?? committed.peerDependencies?.react,
	);
	controlReact(target, reactDeclared ? "present" : "absent");

	const scripts = committed.scripts ?? {};
	for (const step of ["typecheck", "build", "smoke"]) {
		if (scripts[step]) {
			runStep(name, step, `${NPM} run ${step}`, target);
		}
	}
	const bunEntry = committed.opencutExample?.bunEntry;
	if (bunEntry) {
		if (!existsSync(join(target, bunEntry))) {
			fail(`example/${name}`, `opencutExample.bunEntry '${bunEntry}' does not exist in the materialized example`);
		}
		const bun = process.env.OPENCUT_BUN ?? "npx --yes bun@1.2.18";
		runStep(name, "execute", `${bun} ${bunEntry}`, target);
	}
	if (!scripts.typecheck && !scripts.build && !scripts.smoke && !bunEntry) {
		fail(`example/${name}`, "no execution declared (no typecheck/build/smoke script, no opencutExample.bunEntry)");
	}
}

for (const name of requested) {
	runExample(name);
}

console.log(`\nexamples: ${requested.length} example(s) executed green — ${requested.join(", ")}`);
console.log("REAL_EXIT_CODE[examples-run]:0");
