#!/usr/bin/env node
/**
 * The scratch-conformance runner (S05 P3, design E1/E2/E4).
 *
 * Owns the whole scratch-project lifecycle in one foreground process — through
 * the shared scratch-install harness (S05 P6 task 2.1 extracted the lifecycle
 * and no-linking controls into `script/scratch-install-harness.mjs`; this
 * runner's behaviour, CLI and env seams are unchanged by that extraction, and
 * its re-run over the extracted code is the extraction's acceptance): resolve
 * the scratch root, assert it is outside the repo tree and outside any Temp
 * path (control 1), wipe-and-recreate it fresh per run with a marker file,
 * pack the SDK tarballs through the pack module, install them via gate-1's
 * proven mechanism (npm `file:` deps + `overrides`), assert every installed
 * `@opencut/*` is a real directory copy and the lockfile records `file:`
 * resolutions (control 2), materialize the committed adapter template, run
 * the suites under bun, and capture every step's self-logged exit code.
 *
 * Modes:
 *   node script/run-scratch-conformance.mjs                     # full run
 *   node script/run-scratch-conformance.mjs --control-removal   # control 3
 *   node script/run-scratch-conformance.mjs --variant-nonconforming
 *
 * Control 3 (E4.3) deletes the installed `@opencut/editor-ports` copy and
 * re-runs the consumer's import step: it MUST fail to resolve. A run that
 * still succeeded would be reaching into the monorepo — the exact hole this
 * control exists to close. The failure text is recorded in the log.
 *
 * Environment:
 *   OPENCUT_SCRATCH_ROOT    override the scratch root (E2; CI never inherits
 *                           this machine's E:-drive geography)
 *   OPENCUT_BUN             the bun invocation (default: npx --yes bun@1.2.18)
 *   OPENCUT_PREPACKED_DIR   skip packing; copy tarballs from this directory
 *   OPENCUT_TARBALL_OUT_DIR where packing writes tarballs when not prepacked
 *                           (default: the gitignored <repo>/dist-sdk-tarballs)
 *   OPENCUT_ADAPTER_TEMPLATE  the adapter template to materialize (default:
 *                           script/fixtures/third-party-adapter)
 *   OPENCUT_VARIANT_TEMPLATE the nonconforming-variant template (default:
 *                           script/fixtures/third-party-adapter-variant-nonconforming)
 */
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createScratchHarness } from "./scratch-install-harness.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
// Adapter/variant template locations are env seams (review round 1, F3): the
// spec's CI-readiness clause — "root, tarball output and adapter location all
// env-configurable" — must be implemented, so CI (P6's leg) can point the
// harness at its own geography and its own example fixture without forking
// the runner.
const ADAPTER_TEMPLATE = resolve(
	process.env.OPENCUT_ADAPTER_TEMPLATE ??
		join(REPO_ROOT, "script", "fixtures", "third-party-adapter"),
);
const VARIANT_TEMPLATE = resolve(
	process.env.OPENCUT_VARIANT_TEMPLATE ??
		join(
			REPO_ROOT,
			"script",
			"fixtures",
			"third-party-adapter-variant-nonconforming",
		),
);

const harness = createScratchHarness({
	label: "run-scratch-conformance",
	repoRoot: REPO_ROOT,
	defaultScratchName: "opencut-scratch-p3",
	scratchProjectName: "opencut-scratch-conformance",
	markerCreatedBy: "script/run-scratch-conformance.mjs",
});
const { fail, isInside, resolveScratchRoot, freshLifecycle, stageTarballs, writeScratchManifest, install, controlCopiesNotLinks, controlReact, runUnderBun } =
	harness;

// ---------------------------------------------------------------------------
// Materialize the consumer, run it under bun
// ---------------------------------------------------------------------------

const SMOKE_CONSUMER = `// Built-in smoke consumer — the runner's fallback when no adapter template
// is present at the configured location (default: the committed fixture; see
// OPENCUT_ADAPTER_TEMPLATE). Imports resolve ONLY from the installed tarball
// copies.
import { createInMemoryPorts, createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import { runPortConformance } from "@opencut/editor-ports/conformance";
import { formatConformanceFailures } from "@opencut/editor-ports/conformance/requirements";
import { createInMemoryTransactionStore } from "@opencut/editor-contracts";
import { runTransactionConformance } from "@opencut/editor-contracts/conformance";
import { requirementOf } from "@opencut/editor-contracts/conformance/requirements";

const fixture = createInMemoryProjectStoreFixture();
const ports = await runPortConformance({
	ports: createInMemoryPorts({ store: fixture.store }),
	storeFixture: fixture,
	label: "scratch smoke (installed tarballs)",
});
console.log(formatConformanceFailures(ports));
console.log(\`smoke/ports: passed=\${ports.passed} cases=\${ports.results.length}\`);

const store = createInMemoryTransactionStore();
const transaction = await runTransactionConformance({
	target: { read: store, apply: store, getContext: store, watch: store },
	label: "scratch smoke (installed tarballs)",
});
console.log(formatConformanceFailures(transaction));
console.log(\`smoke/transaction: passed=\${transaction.passed} cases=\${transaction.results.length}\`);

const sample = transaction.results[0].name;
const requirement = requirementOf(sample);
console.log(\`smoke/requirements: requirementOf("\${sample}") = \${requirement?.requirement}\`);
if (!ports.passed || !transaction.passed || requirement === undefined) {
	console.log("REAL_EXIT_CODE[suites]:1");
	process.exit(1);
}
console.log("REAL_EXIT_CODE[suites]:0");
`;

const REMOVAL_PROBE = `// Control 3's import step: a bare resolution of the removed package.
import "@opencut/editor-ports/conformance";
console.log("UNEXPECTED: import resolved after removal");
`;

/** Log label for a template dir: repo-relative when inside the repo (the committed default prints exactly as it always has), absolute when an env seam points outside. */
function templateLabel(templateDir) {
	return isInside(templateDir, REPO_ROOT)
		? relative(REPO_ROOT, templateDir).replace(/\\/g, "/")
		: templateDir;
}

function materialize(root, variant) {
	if (variant) {
		if (!existsSync(join(VARIANT_TEMPLATE, "run.ts"))) {
			fail("materialize", `variant template missing at ${VARIANT_TEMPLATE}`);
		}
		cpSync(VARIANT_TEMPLATE, join(root, "adapter"), { recursive: true });
		console.log(
			`adapter: NONCONFORMING VARIANT materialized into scratch (${templateLabel(VARIANT_TEMPLATE)})`,
		);
		return "adapter/run.ts";
	}
	if (existsSync(ADAPTER_TEMPLATE)) {
		cpSync(ADAPTER_TEMPLATE, join(root, "adapter"), { recursive: true });
		console.log(`adapter: committed template materialized into scratch (${templateLabel(ADAPTER_TEMPLATE)})`);
		return "adapter/run.ts";
	}
	writeFileSync(join(root, "consumer.ts"), SMOKE_CONSUMER);
	console.log(
		`adapter: no template present at ${ADAPTER_TEMPLATE} — using the built-in smoke consumer ` +
			"(ports + transaction only); point OPENCUT_ADAPTER_TEMPLATE at an adapter directory for the full run",
	);
	return "consumer.ts";
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

const controlRemoval = process.argv.includes("--control-removal");
const variantNonconforming = process.argv.includes("--variant-nonconforming");
if (controlRemoval && variantNonconforming) {
	fail("args", "--control-removal and --variant-nonconforming are separate runs");
}
const root = resolveScratchRoot();
freshLifecycle(root);
const staged = stageTarballs(root);
writeScratchManifest(root, staged);
install(root);
controlCopiesNotLinks(root);
controlReact(root, "absent");
const script = materialize(root, variantNonconforming);

if (variantNonconforming) {
	// Task 6.2/6.3: the variant MUST fail, name the defect, and fail exactly
	// the attributable set — an executable exactness gate, not a log note.
	const result = runUnderBun(root, script);
	if (result.code === 0) {
		fail("variant", "the nonconforming variant PASSED — the mutation matrix is blind");
	}
	const EXPECTED_FAILURES = [
		"a known edit round-trips without losing opaque nested fields",
		"project values are defensively cloned in both directions",
		"T1: opaque provider fields survive adapter round-trip",
		"T1: Project dry-run/apply/replay/reopen preserves one durable candidate",
	];
	for (const name of EXPECTED_FAILURES) {
		if (!result.output.includes(name)) {
			fail("variant", `expected failing case is absent from the report: ${name}`);
		}
	}
	const caseLines = result.output
		.split(/\r?\n/)
		.filter((line) => /^\s*(port: .+, )?case: /.test(line));
	if (caseLines.length !== EXPECTED_FAILURES.length) {
		console.log(caseLines.join("\n"));
		fail(
			"variant",
			`exactness violated: ${caseLines.length} failing case(s) but ${EXPECTED_FAILURES.length} expected — ` +
				"a case failing extra is an over-constrained suite and a finding (task 6.3)",
		);
	}
	console.log(
		`CONTROL-variant-exactness: PASS (${EXPECTED_FAILURES.length} failing case(s), every one attributable to the dropped-fields defect, names above)`,
	);
	console.log("REAL_EXIT_CODE[scratch-run]:0");
	process.exit(0);
}

if (!controlRemoval) {
	const result = runUnderBun(root, script);
	if (result.code !== 0) fail("suites", "consumer run failed — see output above");
	console.log("REAL_EXIT_CODE[scratch-run]:0");
	process.exit(0);
}

// Control 3: remove the installed editor-ports copy; the import step MUST fail.
const removedAt = join(root, "node_modules", "@opencut", "editor-ports");
rmSync(removedAt, { recursive: true, force: true });
console.log(`control-3: removed ${removedAt} — re-running the import step`);
// Adapter-shaped re-proof (task 4.4): when the committed adapter was
// materialized, the re-run target is the adapter's own runner — its first
// import is `@opencut/editor-ports`, so the whole consumer surface, not a
// bare probe, must collapse with a resolution failure.
let removalTarget;
if (script === "adapter/run.ts") {
	removalTarget = script;
	console.log("control-3: re-running the ADAPTER runner (adapter-shaped re-proof)");
} else {
	writeFileSync(join(root, "control-removal-import.ts"), REMOVAL_PROBE);
	removalTarget = "control-removal-import.ts";
}
const bun = process.env.OPENCUT_BUN ?? "npx --yes bun@1.2.18";
const probe = spawnSync(`${bun} ${removalTarget}`, {
	shell: true,
	encoding: "utf8",
	maxBuffer: 256 * 1024 * 1024,
	cwd: root,
});
const probeOutput = `${probe.stdout || ""}${probe.stderr || ""}`.trim();
if (probeOutput) console.log(probeOutput);
console.log(`REAL_EXIT_CODE[control-3-import]:${probe.status ?? -1}`);
if (probe.status === 0) {
	fail(
		"control-3",
		"the import step RESOLVED after the installed copy was removed — the run was reaching into the monorepo",
	);
}
if (!/editor-ports|Cannot find package|ModuleNotFound|ERR_MODULE_NOT_FOUND|Could not resolve/i.test(probeOutput)) {
	fail(
		"control-3",
		"the import step failed, but not with a resolution failure — inspect the output above",
	);
}
console.log("CONTROL-3 removal: PASS (import step failed to resolve after removal, failure text above)");
console.log("REAL_EXIT_CODE[scratch-run]:0");
