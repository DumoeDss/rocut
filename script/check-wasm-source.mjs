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
 *   node script/check-wasm-source.mjs
 *   node script/check-wasm-source.mjs --resolved <dir>   # negative control
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(REPO_ROOT, "rust", "wasm", "pkg");
const REBUILD = "bun run build:wasm  (wasm-pack build rust/wasm --target bundler --out-dir pkg), then bun install";

/** Hosts that resolve `opencut-wasm` independently. */
const HOSTS = ["", "apps/web", "apps/vite-example"];

/** wasm-pack writes a `.gitignore` containing `*` into its out-dir; it is not part of the package. */
const IGNORED_IN_PKG = new Set([".gitignore"]);

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const rel = (p) => relative(REPO_ROOT, p).replaceAll("\\", "/");

const overrideIndex = process.argv.indexOf("--resolved");
const override = overrideIndex === -1 ? null : resolve(process.argv[overrideIndex + 1] ?? "");

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
/** @returns {string|null} the directory `opencut-wasm` resolves to from `hostDir`. */
function resolveFrom(hostDir) {
	const from = join(REPO_ROOT, hostDir, "package.json");
	if (!existsSync(from)) return null;
	try {
		return dirname(createRequire(from).resolve("opencut-wasm"));
	} catch {
		return null;
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

const locations = override
	? [{ label: `--resolved ${rel(override)}`, dir: override }]
	: [
			...HOSTS.map((h) => ({ label: `resolved from ${h || "<root>"}`, dir: resolveFrom(h) })),
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

const failures = [];

if (checked.length === 0) {
	console.error("check-wasm-source: `opencut-wasm` does not resolve from any Host.");
	console.error(`Produce it with: ${REBUILD}`);
	process.exit(2);
}

console.log(`check-wasm-source: build output ${rel(PKG_DIR)} (${built.size} file(s))`);
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
for (const crate of readdirSync(join(REPO_ROOT, "rust", "crates"))) {
	const src = join(REPO_ROOT, "rust", "crates", crate, "src");
	if (existsSync(src)) INPUT_DIRS.push(src);
}
const INPUT_FILES = [join(REPO_ROOT, "rust", "wasm", "Cargo.toml"), join(REPO_ROOT, "Cargo.lock")];

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

if (failures.length > 0) {
	console.error("\ncheck-wasm-source FAILED:");
	for (const f of failures) console.error(`  - ${f}`);
	console.error(`\nThe editor must consume the artifact built from rust/, not a registry copy.`);
	console.error(`Rebuild and re-install with:\n  ${REBUILD}`);
	process.exit(1);
}

console.log("\nclean — the resolved `opencut-wasm` is the self-built artifact");
