#!/usr/bin/env node
/**
 * Self-built WASM verification (S02 `s02-wasm-self-built-canonical`, design D-D).
 *
 * Asserts that the `opencut-wasm` the build actually **resolves** is the artifact
 * built from this repository's `rust/` sources, and not a copy from the npm
 * registry.
 *
 * **The declaration in `package.json` is not evidence.** A `file:` dependency can
 * be symlinked or copied, each Host resolves independently, and a stale
 * `node_modules/opencut-wasm` left over from a registry install survives a
 * lockfile change and silently satisfies every import. That failure is invisible:
 * the editor builds, boots and passes parity against the *wrong* artifact, and
 * every later child in the Slice then measures the wrong artifact too. So this
 * check reads content at the resolved path rather than trusting the manifest,
 * and it checks **every** physical copy in the tree, not only the one that wins
 * resolution — a losing copy is the same defect one `bun install` away.
 *
 * It deliberately does not run `cargo` or `wasm-pack`. It is a fast, hermetic
 * assertion that works on a machine mid-build, and it names the command to run
 * when it fails.
 *
 * It also asserts **its own wiring**. A check nobody invokes is indistinguishable
 * from a check that passes, and this one guards a failure mode that is silent by
 * construction, so the gate wiring is part of what it verifies.
 *
 *   node script/check-wasm-source.mjs                    # full check (also `bun run check:wasm`)
 *   node script/check-wasm-source.mjs --preflight        # `preinstall` guard: is the build output there at all?
 *   node script/check-wasm-source.mjs --resolved <dir>   # negative control
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(REPO_ROOT, "rust", "wasm", "pkg");
const REBUILD = "bun run build:wasm   (node script/build-wasm.mjs), then bun install";

/** Hosts that resolve `opencut-wasm` independently. */
const HOSTS = ["", "apps/web", "apps/vite-example"];

/** wasm-pack writes a `.gitignore` containing `*` into its out-dir; it is not part of the package. */
const IGNORED_IN_PKG = new Set([".gitignore"]);

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const rel = (p) => relative(REPO_ROOT, p).replaceAll("\\", "/");

const overrideIndex = process.argv.indexOf("--resolved");
const override = overrideIndex === -1 ? null : resolve(process.argv[overrideIndex + 1] ?? "");
const preflight = process.argv.includes("--preflight");

/**
 * `--preflight` runs as root `preinstall`, BEFORE `bun install` resolves anything.
 *
 * Without it, a clean checkout that skipped the wasm build gets
 * `error: opencut-wasm@file:./rust/wasm/pkg failed to resolve` — an unresolved
 * module specifier that never names the command that fixes it. That is the exact
 * outcome `developer-reproducibility` requires the developer path NOT to produce.
 *
 * It deliberately asserts only that the build output exists: at `preinstall` time
 * `node_modules` legitimately does not, so the resolved-content assertions below
 * would fail for the wrong reason and block a first install.
 */
if (preflight) {
	const emitted = join(PKG_DIR, "opencut_wasm_bg.wasm");
	if (existsSync(emitted)) process.exit(0);
	console.error("");
	console.error("  The wasm artifact has not been built, so `opencut-wasm` cannot resolve.");
	console.error("");
	console.error(`  Missing: ${rel(emitted)}`);
	console.error("");
	console.error("  This repository builds `opencut-wasm` from its own rust/ sources; there is no");
	console.error("  published package to fall back on. Build it BEFORE installing dependencies:");
	console.error("");
	console.error("      script/setup-rust                      # once per machine (rustup + wasm-pack)");
	console.error("      rustup target add wasm32-unknown-unknown");
	console.error("      bun run build:wasm");
	console.error("      bun install");
	console.error("");
	process.exit(1);
}

if (!existsSync(PKG_DIR)) {
	console.error(`check-wasm-source: no build output at ${rel(PKG_DIR)}`);
	console.error(`Produce it with: ${REBUILD}`);
	process.exit(2);
}

function packageFiles(dir) {
	return readdirSync(dir)
		.filter((n) => !IGNORED_IN_PKG.has(n) && statSync(join(dir, n)).isFile())
		.sort();
}

const built = new Map(packageFiles(PKG_DIR).map((n) => [n, sha(join(PKG_DIR, n))]));

// --- 1. every location `opencut-wasm` resolves to, per Host -----------------
/**
 * @returns {{dir: string|null, error: string|null}} where `opencut-wasm` resolves
 * from `hostDir`. A resolution failure is **reported**, never silently treated as
 * "nothing to check" — a Host whose resolution is broken is a finding, not a pass.
 */
function resolveFrom(hostDir) {
	const from = join(REPO_ROOT, hostDir, "package.json");
	if (!existsSync(from)) return { dir: null, error: null };
	try {
		return { dir: dirname(createRequire(from).resolve("opencut-wasm")), error: null };
	} catch (e) {
		return { dir: null, error: e.message };
	}
}

/** Every physical `node_modules/opencut-wasm` in the tree, resolution winner or not. */
function physicalCopies() {
	const found = [];
	for (const host of HOSTS) {
		const dir = join(REPO_ROOT, host, "node_modules", "opencut-wasm");
		if (existsSync(dir)) found.push(dir);
	}
	return found;
}

const failures = [];

const hostResolutions = override ? [] : HOSTS.map((h) => ({ host: h || "<root>", ...resolveFrom(h) }));

const locations = override
	? [{ label: `--resolved ${rel(override)}`, dir: override }]
	: [
			...hostResolutions.filter((r) => r.dir).map((r) => ({ label: `resolved from ${r.host}`, dir: r.dir })),
			...physicalCopies().map((d) => ({ label: `physical copy ${rel(d)}`, dir: d })),
		];

const seen = new Set();
const checked = [];
for (const loc of locations) {
	if (!loc.dir) continue;
	const key = `${loc.dir}`;
	if (seen.has(key) && !override) continue;
	seen.add(key);
	checked.push(loc);
}

if (checked.length === 0) {
	console.error("check-wasm-source: `opencut-wasm` does not resolve from any Host.");
	console.error(`Produce it with: ${REBUILD}`);
	process.exit(2);
}

console.log(`check-wasm-source: build output ${rel(PKG_DIR)} (${built.size} file(s))`);

// A Host whose resolution throws is a finding, not an absence of work to do.
for (const r of hostResolutions) {
	if (!r.error) continue;
	console.log(`  FAIL  resolved from ${r.host} -> \`opencut-wasm\` does not resolve`);
	console.log(`          ${r.error.split("\n")[0]}`);
	failures.push(`${r.host}: \`opencut-wasm\` does not resolve`);
}

for (const loc of checked) {
	const present = existsSync(loc.dir) ? packageFiles(loc.dir) : [];
	const mismatches = [];
	for (const [name, hash] of built) {
		if (!present.includes(name)) {
			mismatches.push(`${name}: absent at the resolved location`);
			continue;
		}
		if (sha(join(loc.dir, name)) !== hash) mismatches.push(`${name}: content differs from the build output`);
	}
	for (const name of present) {
		if (!built.has(name)) mismatches.push(`${name}: present at the resolved location but not in the build output`);
	}
	const ok = mismatches.length === 0;
	console.log(`  ${ok ? "PASS" : "FAIL"}  ${loc.label} -> ${rel(loc.dir)}`);
	for (const m of mismatches) console.log(`          ${m}`);
	if (!ok) failures.push(`${loc.label}: ${mismatches.length} file mismatch(es)`);
}

// --- 2. the build output is not stale relative to its inputs ----------------
const INPUT_DIRS = [join(REPO_ROOT, "rust", "wasm", "src")];
const INPUT_FILES = [
	join(REPO_ROOT, "rust", "wasm", "Cargo.toml"),
	join(REPO_ROOT, "Cargo.lock"),
	// The workspace manifest carries `[profile.*]`, which changes codegen.
	join(REPO_ROOT, "Cargo.toml"),
];
for (const crate of readdirSync(join(REPO_ROOT, "rust", "crates"))) {
	const src = join(REPO_ROOT, "rust", "crates", crate, "src");
	if (existsSync(src)) INPUT_DIRS.push(src);
	// Each crate's own manifest too: a feature-flag, `[lints]` or `[profile]`
	// edit changes the emitted code without necessarily moving `Cargo.lock`,
	// so manifests-are-not-inputs would leave that class of staleness invisible.
	const manifest = join(REPO_ROOT, "rust", "crates", crate, "Cargo.toml");
	if (existsSync(manifest)) INPUT_FILES.push(manifest);
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const inputs = [...INPUT_DIRS.flatMap((d) => walk(d)), ...INPUT_FILES.filter((f) => existsSync(f))];
let newestInput = { path: null, mtime: 0 };
for (const p of inputs) {
	const m = statSync(p).mtimeMs;
	if (m > newestInput.mtime) newestInput = { path: p, mtime: m };
}
const emitted = join(PKG_DIR, "opencut_wasm_bg.wasm");
const emittedMtime = existsSync(emitted) ? statSync(emitted).mtimeMs : 0;
const fresh = emittedMtime >= newestInput.mtime;
console.log(`  ${fresh ? "PASS" : "FAIL"}  build output is newer than every Rust input (${inputs.length} file(s) considered)`);
if (!fresh) {
	console.log(`          newest input:  ${rel(newestInput.path)} @ ${new Date(newestInput.mtime).toISOString()}`);
	console.log(`          emitted .wasm: ${rel(emitted)} @ ${new Date(emittedMtime).toISOString()}`);
	failures.push("the build output is stale relative to rust/ sources");
}

// --- 3. the crate ships the licence it declares -----------------------------
const crateLicense = join(REPO_ROOT, "rust", "wasm", "LICENSE");
const rootLicense = join(REPO_ROOT, "LICENSE");
const licenceOk = existsSync(crateLicense) && sha(crateLicense) === sha(rootLicense);
console.log(`  ${licenceOk ? "PASS" : "FAIL"}  rust/wasm/LICENSE exists and matches the root LICENSE`);
if (!licenceOk) failures.push("rust/wasm/LICENSE is missing or differs from the root LICENSE");

// --- 4. this check is actually wired into a gate ----------------------------
// A check nobody invokes is indistinguishable from a check that passes, and the
// failure this one guards is silent by construction: a stale-but-valid artifact
// passes the type baseline, both Host builds and the parity fixture. So the
// wiring is part of what gets asserted. If someone drops the CI step, every
// local run says so.
// This explicit list owns the current wasm gates. A future gate must be
// added here as well as to the root npm script and CI; this check does not claim
// to discover arbitrary new `check-wasm-*.mjs` files.
const GATED = [
	"script/check-wasm-source.mjs",
	"script/check-wasm-paths.mjs",
	"script/check-wasm-api-surface.mjs",
];
const wiringProblems = [];

const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const workflowPath = join(REPO_ROOT, ".github", "workflows", "bun-ci.yml");
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : null;
// `bun install` is what materialises the resolved copies these checks read, so
// running before it would validate a tree nobody consumes.
const installAt = workflow === null ? -1 : workflow.search(/run:\s*bun install/);

for (const gate of GATED) {
	if (!existsSync(join(REPO_ROOT, gate))) {
		wiringProblems.push(`${gate} is referenced as a gate but not present in the repository`);
		continue;
	}
	if (!Object.values(rootManifest.scripts ?? {}).some((cmd) => cmd.includes(gate))) {
		wiringProblems.push(`no root package.json script invokes ${gate}`);
	}
	if (workflow === null) {
		wiringProblems.push("no .github/workflows/bun-ci.yml to carry the gate");
		continue;
	}
	const gateAt = workflow.indexOf(gate);
	if (gateAt === -1) wiringProblems.push(`bun-ci.yml has no step running ${gate}`);
	else if (installAt === -1) wiringProblems.push("bun-ci.yml no longer runs `bun install`");
	else if (gateAt < installAt) wiringProblems.push(`bun-ci.yml runs ${gate} BEFORE \`bun install\`, so it checks an uninstalled tree`);
}

console.log(`  ${wiringProblems.length === 0 ? "PASS" : "FAIL"}  all wasm gates are wired (npm script + CI step after \`bun install\`)`);
for (const p of wiringProblems) console.log(`          ${p}`);
if (wiringProblems.length > 0) failures.push(`gate wiring: ${wiringProblems.join("; ")}`);

if (failures.length > 0) {
	console.error("\ncheck-wasm-source FAILED:");
	for (const f of failures) console.error(`  - ${f}`);
	console.error(`\nThe editor must consume the artifact built from rust/, not a registry copy.`);
	console.error(`Rebuild and re-install with:\n  ${REBUILD}`);
	process.exit(1);
}

console.log("\nclean — the resolved `opencut-wasm` is the self-built artifact");
