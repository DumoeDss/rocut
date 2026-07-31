#!/usr/bin/env node
/**
 * Asserts the redistributed wasm discloses nothing about the machine that built it.
 *
 * Since S02 the editor consumes the wasm built from `rust/`, so this binary ships
 * to every user of the built application. Plain `wasm-pack build` records the
 * absolute source paths of the build machine in it. Measured on the first S02
 * build: **286** absolute paths — 285 rooted at `C:\\Users\\<name>\\.cargo` and one
 * at the checkout — disclosing a home directory and an OS username.
 * `script/build-wasm.mjs` remaps those prefixes; this check is what makes the
 * remapping enforced rather than conventional.
 *
 * **Why it exists as a gate and not as a habit.** An unremapped artifact is
 * behaviourally perfect: it passes the type baseline, both Host builds, the parity
 * fixture and `check-wasm-source.mjs`. Nothing else in the repository can tell the
 * difference, so without this the single build path is convention only — someone
 * running `wasm-pack build` directly would ship a leaking binary with every gate
 * green.
 *
 * **Both platform shapes are scanned, deliberately.** A Windows-shaped scan
 * reports a false zero for a Linux-built binary. That is not hypothetical: it is
 * why published `opencut-wasm@0.2.10` was first believed to embed no paths at all,
 * when it in fact carries 169 rooted at `/home/heart/`.
 *
 *   node script/check-wasm-paths.mjs
 *   node script/check-wasm-paths.mjs --file <some.wasm>   # negative control
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGET = join(REPO_ROOT, "rust", "wasm", "pkg", "opencut_wasm_bg.wasm");
const rel = (p) => relative(REPO_ROOT, p).replaceAll("\\", "/") || p;

const fileIndex = process.argv.indexOf("--file");
const target = fileIndex === -1 ? DEFAULT_TARGET : process.argv[fileIndex + 1];

if (!target || !existsSync(target)) {
	console.error(`check-wasm-paths: no artifact at ${target ?? "<unset>"}`);
	console.error("Produce it with: bun run build:wasm");
	process.exit(2);
}

/**
 * The binary stores paths as raw UTF-8 without terminators, so this reads it as
 * latin1 and pattern-matches. Each pattern is a *disclosure* shape, not merely a
 * path shape — a remapped `/cargo\registry\...` path is fine and expected.
 */
const DISCLOSURES = [
	{ name: "Windows user-profile path", re: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\[^\x00-\x1f"]{0,180}/g },
	{ name: "any Windows drive-letter path", re: /[A-Za-z]:\\[A-Za-z0-9_.\\-]{4,200}/g },
	{ name: "POSIX home-directory path", re: /\/home\/[A-Za-z0-9_.-]+\/[^\x00-\x1f"]{0,180}/g },
	{ name: "macOS home-directory path", re: /\/Users\/[A-Za-z0-9_.-]+\/[^\x00-\x1f"]{0,180}/g },
	{ name: "POSIX root home-directory path", re: /\/root\/[^\x00-\x1f"]{0,180}/g },
];

const USERNAME_SHAPES = [
	/[A-Za-z]:\\Users\\([A-Za-z0-9_.-]+)\\/g,
	/\/home\/([A-Za-z0-9_.-]+)\//g,
	/\/Users\/([A-Za-z0-9_.-]+)\//g,
	/\/(root)\//g,
];

/**
 * Home-directory patterns catch the usual layouts, but checkouts and container
 * homes may be rooted anywhere (`/workspace`, `/builds`, `/root`, a mounted
 * volume, and so on). Find path-shaped POSIX strings that carry source/build
 * markers instead of trying to enumerate every possible root.
 *
 * `/cargo` and `/opencut` are the only machine-path remap roots emitted by
 * `script/build-wasm.mjs`; they are intentionally public and stable. rustc also
 * emits virtual standard-library paths that are already independent of the
 * build machine. Those are classified separately from remapped machine paths so
 * a real checkout rooted at (for example) `/workspace` cannot hide behind them.
 */
const POSIX_PATH = /\/(?:[A-Za-z0-9._+@=-]+\/){1,24}[A-Za-z0-9._+@=-]+/g;
const REMAPPED_ROOTS = [/^\/cargo(?:\/|$)/, /^\/opencut(?:\/|$)/];
const RUSTC_VIRTUAL_ROOTS = [
	/^\/rustc\/[0-9a-f]{40}\/library\//,
	/^\/rust\/deps\//,
	/^\/(?:alloc|core|std)\/src\//,
];
const SOURCE_OR_BUILD_SEGMENT = /\/(?:src|checkout|workspaces?|builds?|\.cargo|\.rustup)(?:\/|$)/;
const SOURCE_FILE_SUFFIX = /\.(?:c|cc|cpp|h|hpp|lock|rs|toml)(?:$|[^A-Za-z0-9])/;

function unremappedPosixPaths(value) {
	const paths = value.match(POSIX_PATH) ?? [];
	return paths.filter((path) => {
		if (REMAPPED_ROOTS.some((allowed) => allowed.test(path))) return false;
		if (RUSTC_VIRTUAL_ROOTS.some((virtual) => virtual.test(path))) return false;
		return SOURCE_OR_BUILD_SEGMENT.test(path) || SOURCE_FILE_SUFFIX.test(path);
	});
}

const bytes = readFileSync(target);
const text = bytes.toString("latin1");

console.log(`check-wasm-paths: ${rel(target)} (${bytes.length} bytes)`);

const findings = [];
for (const { name, re } of DISCLOSURES) {
	const hits = text.match(re) ?? [];
	const unique = [...new Set(hits)];
	const ok = hits.length === 0;
	console.log(`  ${ok ? "PASS" : "FAIL"}  no ${name} (${hits.length} occurrence(s), ${unique.length} unique)`);
	if (!ok) {
		findings.push(`${hits.length} × ${name}`);
		for (const sample of unique.slice(0, 3)) console.log(`          e.g. ${sample.slice(0, 120)}`);
	}
}

const posixPaths = unremappedPosixPaths(text);
const uniquePosixPaths = [...new Set(posixPaths)];
const posixPathsOk = posixPaths.length === 0;
console.log(
	`  ${posixPathsOk ? "PASS" : "FAIL"}  no unremapped POSIX source/home/checkout path (${posixPaths.length} occurrence(s), ${uniquePosixPaths.length} unique)`,
);
if (!posixPathsOk) {
	findings.push(`${posixPaths.length} × unremapped POSIX source/home/checkout path`);
	for (const sample of uniquePosixPaths.slice(0, 3)) console.log(`          e.g. ${sample.slice(0, 120)}`);
}

const users = [
	...new Set(
		USERNAME_SHAPES.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])),
	),
];
const usersOk = users.length === 0;
console.log(`  ${usersOk ? "PASS" : "FAIL"}  no operating-system username disclosed`);
if (!usersOk) {
	console.log(`          disclosed: ${users.join(", ")}`);
	findings.push(`username(s) disclosed: ${users.join(", ")}`);
}

/**
 * Committed negative controls for the two POSIX shapes that escaped the first
 * implementation, plus positive controls for the intentional remap roots.
 * Running them on every invocation prevents a future regex edit from making the
 * scanner vacuously green again.
 */
const POSIX_NEGATIVE_CONTROLS = [
	"/root/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/std/src/panicking.rs",
	"/workspace/checkout/rust/crates/gpu/src/context.rs",
];
for (const control of POSIX_NEGATIVE_CONTROLS) {
	const rejected = unremappedPosixPaths(control).includes(control);
	console.log(`  ${rejected ? "PASS" : "FAIL"}  scanner rejects negative control ${control}`);
	if (!rejected) findings.push(`POSIX scanner missed negative control ${control}`);
}

const POSIX_REMAP_CONTROLS = [
	"/cargo/registry/src/example-crate/src/lib.rs",
	"/opencut/rust/crates/gpu/src/context.rs",
];
const remapControlFindings = POSIX_REMAP_CONTROLS.flatMap(unremappedPosixPaths);
const remapControlsOk = remapControlFindings.length === 0;
console.log(`  ${remapControlsOk ? "PASS" : "FAIL"}  intentional /cargo and /opencut remap roots are allowed`);
if (!remapControlsOk) findings.push(`POSIX scanner rejected intentional remap root(s): ${remapControlFindings.join(", ")}`);

/**
 * Anti-vacuity. A scan that finds nothing because it is looking for the wrong
 * shape is indistinguishable from a clean artifact — precisely the error that
 * made published `0.2.10` look clean. The remapped prefixes MUST be present:
 * their absence means the binary was not produced by `script/build-wasm.mjs`,
 * even though every disclosure pattern above would be satisfied.
 */
if (fileIndex === -1) {
	const remapped = [
		{ name: "/cargo", re: /\/cargo[\\/][^\x00-\x1f"]{0,120}/g },
		{ name: "/opencut", re: /\/opencut[\\/][^\x00-\x1f"]{0,120}/g },
	];
	for (const { name, re } of remapped) {
		const count = (text.match(re) ?? []).length;
		const ok = count > 0;
		console.log(`  ${ok ? "PASS" : "FAIL"}  remapped \`${name}\` prefix present (${count}) — proves the scan is not vacuous`);
		if (!ok) findings.push(`no remapped \`${name}\` prefix — was this built with script/build-wasm.mjs?`);
	}
}

if (findings.length > 0) {
	console.error("\ncheck-wasm-paths FAILED:");
	for (const f of findings) console.error(`  - ${f}`);
	console.error("\nThis artifact is redistributed to every user of the built application.");
	console.error("Rebuild it through the script that applies --remap-path-prefix:");
	console.error("  bun run build:wasm   (node script/build-wasm.mjs), then bun install");
	process.exit(1);
}

console.log("\nclean — the redistributed wasm discloses no build-machine identity");
