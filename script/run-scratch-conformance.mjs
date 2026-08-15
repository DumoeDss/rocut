#!/usr/bin/env node
/**
 * The scratch-conformance runner (S05 P3, design E1/E2/E4).
 *
 * Owns the whole scratch-project lifecycle in one foreground process: resolve
 * the scratch root (E2), assert it is outside the repo tree and outside any
 * Temp path (control 1), wipe-and-recreate it fresh per run with a marker file
 * (a root this script did not create is refused, never reused), pack the SDK
 * tarballs through the pack module, install them via gate-1's proven mechanism
 * (npm `file:` deps + `overrides`), assert every installed `@opencut/*` is a
 * real directory copy and the lockfile records `file:` resolutions (control
 * 2), materialize the committed adapter template, run the suites under bun,
 * and capture every step's self-logged exit code.
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
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { DEFAULT_OUT_DIR_NAME, packSdkTarballs } from "./pack-sdk-tarballs.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
const IS_WINDOWS = process.platform === "win32";
const MARKER_NAME = ".opencut-scratch-marker";
// Adapter/variant template locations and the packing output dir are env seams
// (review round 1, F3): the spec's CI-readiness clause — "root, tarball
// output and adapter location all env-configurable" — must be implemented,
// so CI (P6's leg) can point the harness at its own geography and its own
// example fixture without forking the runner.
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
const TARBALL_OUT_DIR = resolve(
	process.env.OPENCUT_TARBALL_OUT_DIR ?? join(REPO_ROOT, DEFAULT_OUT_DIR_NAME),
);
const SDK_NAMES = [
	"@opencut/editor-ports",
	"@opencut/editor-contracts",
	"@opencut/editor-classic",
];
// The local wasm artifact classic depends on (LEAD ruling 2026-08-15): not a
// scratch dependency in its own right, but control 2 asserts it lands as a
// real installed copy — classic's declared closure, resolved through the
// override, must be present on disk like every other package.
const TRANSITIVE_ASSERT_NAMES = ["opencut-wasm"];
// Every tarball this harness stages, mapped to its package name. The
// prepacked-dir path derives the name from the npm pack filename (scope
// stripped): opencut-editor-ports-0.1.0.tgz -> @opencut/editor-ports.
const TARBALL_BASENAME_TO_NAME = new Map([
	["opencut-editor-ports", "@opencut/editor-ports"],
	["opencut-editor-contracts", "@opencut/editor-contracts"],
	["opencut-editor-classic", "@opencut/editor-classic"],
	["opencut-wasm", "opencut-wasm"],
]);

/** `child` equals or lies inside `parent` (both resolved, separators normalized). */
function isInside(child, parent) {
	const rel = relative(resolve(parent), resolve(child)).replace(/\\/g, "/");
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function fail(step, message) {
	console.error(`run-scratch-conformance: ${message}`);
	console.log(`REAL_EXIT_CODE[${step}]:1`);
	process.exit(1);
}

/** Run a tool, echo its output, and self-log the exit code — never throw. */
function runLogged(step, command, args, options = {}) {
	// A single command string when a shell is involved: an args array with
	// shell:true trips DEP0190 and the paths here contain no spaces.
	const invocation = IS_WINDOWS ? [`${command} ${args.join(" ")}`, []] : [command, args];
	const result = spawnSync(invocation[0], invocation[1], {
		shell: IS_WINDOWS,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		...options,
	});
	const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
	if (output) console.log(output);
	const code = result.status ?? -1;
	console.log(`REAL_EXIT_CODE[${step}]:${code}`);
	return { code, output };
}

// ---------------------------------------------------------------------------
// E2: root resolution + control 1 (location), asserted every run
// ---------------------------------------------------------------------------

function resolveScratchRoot() {
	const fromEnv = process.env.OPENCUT_SCRATCH_ROOT;
	const root = resolve(fromEnv ?? join(dirname(REPO_ROOT), "opencut-scratch-p3"));
	console.log(`scratch root: ${root}${fromEnv ? " (OPENCUT_SCRATCH_ROOT)" : " (E:-drive default)"}`);

	if (isInside(root, REPO_ROOT)) {
		fail("control-1", `scratch root is inside the repo tree (${REPO_ROOT}) — refusing`);
	}
	console.log(`CONTROL-1a root-outside-repo-tree: PASS (${relative(REPO_ROOT, root) || "sibling of repo"})`);

	const temps = [process.env.TEMP, process.env.TMP, process.env.TMPDIR, tmpdir()]
		.filter(Boolean)
		.map((t) => resolve(t));
	const underTemp = temps.filter((t) => isInside(root, t));
	if (underTemp.length > 0) {
		fail(
			"control-1",
			`scratch root sits under a Temp path (${underTemp[0]}) — the measured AV hazard; refusing`,
		);
	}
	console.log(`CONTROL-1b root-outside-temp: PASS (checked ${temps.length} Temp root(s))`);
	return root;
}

// ---------------------------------------------------------------------------
// E2: fresh-per-run lifecycle (wipe + recreate + marker; refuse foreign roots)
// ---------------------------------------------------------------------------

function freshLifecycle(root) {
	if (existsSync(root)) {
		const stat = lstatSync(root);
		if (!stat.isDirectory()) {
			fail("lifecycle", `scratch root exists and is not a directory: ${root}`);
		}
		if (!existsSync(join(root, MARKER_NAME))) {
			fail(
				"lifecycle",
				`pre-existing root has no ${MARKER_NAME} marker — foreign root, refusing to touch it`,
			);
		}
		console.log(`lifecycle: wiping previous scratch root (marker verified)`);
		rmSync(root, { recursive: true, force: true });
	}
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, MARKER_NAME),
		`${JSON.stringify({ createdBy: "script/run-scratch-conformance.mjs", createdAt: new Date().toISOString() }, null, 2)}\n`,
	);
	console.log(`lifecycle: fresh scratch root created with marker (${root})`);
}

// ---------------------------------------------------------------------------
// Pack + install (gate-1 mechanism: npm file: deps + overrides)
// ---------------------------------------------------------------------------

/** npm pack filename (scope stripped, version and .tgz removed) -> package name. */
function nameOfTarball(filename) {
	const base = filename.replace(/-\d+\.\d+\.\d+[^.]*\.tgz$/, "");
	const name = TARBALL_BASENAME_TO_NAME.get(base);
	if (!name) {
		fail("pack", `unrecognized tarball filename (no package-name mapping): ${filename}`);
	}
	return name;
}

function stageTarballs(root) {
	const tarballsDir = join(root, "tarballs");
	mkdirSync(tarballsDir, { recursive: true });
	const prepacked = process.env.OPENCUT_PREPACKED_DIR;
	let staged;
	if (prepacked) {
		const dir = resolve(prepacked);
		console.log(`pack: skipped — copying pre-packed tarballs from ${dir}`);
		staged = readdirSync(dir)
			.filter((name) => name.endsWith(".tgz"))
			.sort()
			.map((name) => ({ name: nameOfTarball(name), file: name }));
	} else {
		const outDir = TARBALL_OUT_DIR;
		const manifest = packSdkTarballs({
			repoRoot: REPO_ROOT,
			outDir,
			determinism: false,
			log: (line) => console.log(`pack: ${line}`),
		});
		staged = manifest.packages.map((entry) => ({
			name: entry.name,
			file: basename(entry.tarball),
		}));
	}
	for (const entry of staged) {
		cpSync(join(prepacked ? resolve(prepacked) : TARBALL_OUT_DIR, entry.file), join(tarballsDir, entry.file));
	}
	console.log(`pack: ${staged.length} tarball(s) staged into the scratch project`);
	return staged.map((entry) => ({ name: entry.name, spec: `file:tarballs/${entry.file}` }));
}

function writeScratchManifest(root, staged) {
	const byName = new Map(staged.map((entry) => [entry.name, entry.spec]));
	for (const name of SDK_NAMES) {
		if (!byName.has(name)) fail("manifest", `no staged tarball for ${name}`);
	}
	if (!byName.has("opencut-wasm")) {
		fail("manifest", "no staged tarball for opencut-wasm — the fourth-tarball ruling is not wired");
	}
	const manifest = {
		name: "opencut-scratch-conformance",
		version: "0.0.0",
		private: true,
		type: "module",
		dependencies: Object.fromEntries(SDK_NAMES.map((name) => [name, byName.get(name)])),
		// Gate-1's proven shape, extended by the 2026-08-15 ruling: the
		// overrides replace the workspace:* protocol that rides verbatim
		// inside the packed editor-contracts/classic manifests AND classic's
		// `file:../../rust/wasm/pkg` spec (dead from node_modules) with the
		// same file: tarball specs. The override is the control that makes
		// classic's declared wasm dependency resolve honestly.
		overrides: {
			"@opencut/editor-ports": byName.get("@opencut/editor-ports"),
			"@opencut/editor-contracts": byName.get("@opencut/editor-contracts"),
			"opencut-wasm": byName.get("opencut-wasm"),
		},
	};
	writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`install: scratch package.json written (deps + overrides, gate-1 shape + wasm)`);
}

function install(root) {
	// --legacy-peer-deps: classic's react peer must NOT be auto-installed —
	// the react-free property of ./storage/migrations is proven by this
	// project resolving and running with react absent from the tree.
	const result = runLogged(
		"npm-install",
		IS_WINDOWS ? "npm.cmd" : "npm",
		["install", "--legacy-peer-deps"],
		{ cwd: root },
	);
	if (result.code !== 0) fail("npm-install", "npm install failed — see output above");
}

// ---------------------------------------------------------------------------
// Control 2: copies, not links (lstat + lockfile), every run
// ---------------------------------------------------------------------------

function controlCopiesNotLinks(root) {
	const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
	for (const name of [...SDK_NAMES, ...TRANSITIVE_ASSERT_NAMES]) {
		// Scoped packages install under node_modules/@opencut/<short>; the
		// unscoped wasm artifact installs flat under node_modules/.
		const installed = name.startsWith("@")
			? join(root, "node_modules", "@opencut", name.replace("@opencut/", ""))
			: join(root, "node_modules", name);
		if (!existsSync(installed)) {
			fail("control-2", `${name} is not installed at ${installed}`);
		}
		const stat = lstatSync(installed);
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			fail(
				"control-2",
				`${name} is a ${stat.isSymbolicLink() ? "symlink" : "non-directory"} — workspace linking, not a copy`,
			);
		}
		const lockEntry = lock.packages?.[`node_modules/${name}`];
		const resolved = lockEntry?.resolved ?? "(missing lockfile entry)";
		const linked = lockEntry?.link === true || resolved.startsWith("workspace:");
		if (linked) {
			fail("control-2", `${name} lockfile resolution is ${resolved} — not a tarball file: spec`);
		}
		if (!resolved.startsWith("file:")) {
			fail("control-2", `${name} lockfile resolution is ${resolved} — expected a file: tarball spec`);
		}
		console.log(
			`CONTROL-2 copy-not-link ${name}: PASS (lstat: real directory, symlink=false; lockfile resolved=${resolved}, link=false)`,
		);
	}
}

// ---------------------------------------------------------------------------
// React-free control (LEAD ruling 2026-08-15): classic's react peer is never
// installed (--legacy-peer-deps), so nothing in node_modules can satisfy a
// react specifier — if ./storage/migrations' closure reached react, the
// adapter's migration leg below would fail to resolve it.
// ---------------------------------------------------------------------------

function controlReactFree(root) {
	const react = join(root, "node_modules", "react");
	if (existsSync(react)) {
		fail(
			"control-react-free",
			`react is installed at ${react} — the react-free proof is void (peer auto-install leaked in)`,
		);
	}
	console.log(
		"CONTROL-react-free react-absent: PASS (node_modules/react does not exist; the migration entry's closure needs no react)",
	);
}

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

function runUnderBun(root, script) {
	const bun = process.env.OPENCUT_BUN ?? "npx --yes bun@1.2.18";
	console.log(`suites: ${bun} ${script} (cwd: scratch root)`);
	const result = spawnSync(`${bun} ${script}`, {
		shell: true,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		cwd: root,
	});
	const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
	if (output) console.log(output);
	const code = result.status ?? -1;
	console.log(`REAL_EXIT_CODE[suites]:${code}`);
	return { code, output };
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
controlReactFree(root);
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
