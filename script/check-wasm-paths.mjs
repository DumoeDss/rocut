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
/**
 * Sanctioned roots. `/cargo` and `/opencut` are the machine-path remap roots
 * emitted by `script/build-wasm.mjs` (absolute-prefix remaps). `/wasm` and
 * `/crates` are the workspace-RELATIVE forms that wasm-bindgen produces when it
 * rewrites DWARF paths relative to the `rust` workspace root AFTER rustc has
 * run — on POSIX these survive as `/wasm/src/...` and `/crates/<crate>/src/...`
 * (measured on ubuntu CI; on Windows the same relativization yields
 * backslash forms that no POSIX pattern matches, which is why the absolute
 * remap path alone kept every local run green). Relative paths cannot disclose
 * a build machine — there is no machine in them by construction — so they are
 * sanctioned exactly like the remap roots. An ABSOLUTE machine path that merely
 * contains a `/crates` segment (e.g. `/workspace/checkout/rust/crates/...`)
 * still starts with its machine root and stays rejected: the allowlist anchors
 * at the path start.
 */
const REMAPPED_ROOTS = [/^\/cargo(?:\/|$)/, /^\/opencut(?:\/|$)/, /^\/wasm(?:\/|$)/, /^\/crates(?:\/|$)/];
const RUSTC_VIRTUAL_ROOTS = [
	/^\/rustc\/[0-9a-f]{40}\/library\//,
	/^\/rust\/deps\//,
	/^\/(?:alloc|core|std)\/src\//,
];
const SOURCE_OR_BUILD_SEGMENT = /\/(?:src|checkout|workspaces?|builds?|\.cargo|\.rustup)(?:\/|$)/;
const SOURCE_FILE_SUFFIX = /\.(?:c|cc|cpp|h|hpp|lock|rs|toml)(?:$|[^A-Za-z0-9])/;

/**
 * A sanctioned root also terminates whatever precedes it.
 *
 * The scan is a flat regex over the binary read as latin1: the data section has no string
 * boundaries, so two unrelated literals laid end to end read as one token. When the left literal
 * happens to end in `/`, `POSIX_PATH` matches straight through the join and the `^`-anchored
 * allowlist no longer sees the sanctioned root at the start.
 *
 * Measured, on CI (run 31940037053, PR #3): ubuntu emitted
 * `/from_iter` + `/cargo/registry/src/index.crates.io-…/parking_lot_core-0.9.12/src/parking_lot.rs`
 * as one match — 1 of the 285 remapped `/cargo` paths in that build — and the gate reported it as
 * an unremapped machine path. `from_iter` is a Rust iterator adapter name, `/cargo` is this
 * repository's own synthetic remap target; there is no build machine in that string.
 *
 * So each candidate is cut at every embedded sanctioned root and the fragments judged
 * independently. That is narrower than it looks, because the roots are synthetic: `/cargo` and
 * `/opencut` exist only as remap targets. A real machine path that contains one as an interior
 * segment still fails on its own prefix — `/workspace/checkout/cargo/registry/src/x.rs` splits to
 * `/workspace/checkout`, which carries a build segment and is rejected; `/home/bob/cargo/...`
 * splits to `/home/bob`, which the dedicated home-directory disclosure rule rejects regardless of
 * this function. Both are committed as controls below.
 *
 * This class cannot be reproduced on Windows: there the remapped dependency paths embed as
 * `/cargo\registry\...` (measured: 286 backslash forms, 0 forward-slash) and `POSIX_PATH` never
 * matches them at all. A local Windows run is therefore structurally blind to it — which is why
 * it took a CI run to surface, and why the controls below now carry it.
 */
function splitAtSanctionedRoots(path) {
	const fragments = [];
	let rest = path;
	while (rest.length > 0) {
		const cut = [/(?!^)\/cargo(?:\/|$)/, /(?!^)\/opencut(?:\/|$)/, /(?!^)\/wasm(?:\/|$)/, /(?!^)\/crates(?:\/|$)/]
			.map((root) => rest.search(root))
			.filter((at) => at > 0)
			.sort((a, b) => a - b)[0];
		if (cut === undefined) {
			fragments.push(rest);
			break;
		}
		fragments.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	return fragments;
}

function unremappedPosixPaths(value) {
	const paths = value.match(POSIX_PATH) ?? [];
	return paths.filter((path) =>
		splitAtSanctionedRoots(path).some((fragment) => {
			if (REMAPPED_ROOTS.some((allowed) => allowed.test(fragment))) return false;
			if (RUSTC_VIRTUAL_ROOTS.some((virtual) => virtual.test(fragment))) return false;
			return SOURCE_OR_BUILD_SEGMENT.test(fragment) || SOURCE_FILE_SUFFIX.test(fragment);
		}),
	);
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
	// A real machine path whose INTERIOR contains a sanctioned root. Splitting at that root must
	// not sanction the whole string: the prefix carries a build segment and stays a finding. This
	// is the hole the adjacency fix could have opened, so it is asserted rather than reasoned.
	"/workspace/checkout/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/lib.rs",
	"/builds/ci/opencut/rust/wasm/src/gpu.rs",
];
for (const control of POSIX_NEGATIVE_CONTROLS) {
	const rejected = unremappedPosixPaths(control).includes(control);
	console.log(`  ${rejected ? "PASS" : "FAIL"}  scanner rejects negative control ${control}`);
	if (!rejected) findings.push(`POSIX scanner missed negative control ${control}`);
}

const POSIX_REMAP_CONTROLS = [
	"/cargo/registry/src/example-crate/src/lib.rs",
	"/opencut/rust/crates/gpu/src/context.rs",
	"/wasm/src/gpu.rs",
	"/crates/gpu/src/context.rs",
	// The literal-adjacency shape CI hit (run 31940037053): an unrelated Rust identifier ending in
	// `/` laid immediately before a remapped `/cargo` path, read as one token because the data
	// section has no string boundaries. Committed verbatim so the fix is proved on the real string.
	"/from_iter/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_lot_core-0.9.12/src/parking_lot.rs",
];
const remapControlFindings = POSIX_REMAP_CONTROLS.flatMap(unremappedPosixPaths);
const remapControlsOk = remapControlFindings.length === 0;
console.log(`  ${remapControlsOk ? "PASS" : "FAIL"}  intentional sanctioned roots are allowed (/cargo, /opencut, /wasm, /crates)`);
if (!remapControlsOk) findings.push(`POSIX scanner rejected intentional sanctioned root(s): ${remapControlFindings.join(", ")}`);

/**
 * Anti-vacuity. A scan that finds nothing because it is looking for the wrong
 * shape is indistinguishable from a clean artifact — precisely the error that
 * made published `0.2.10` look clean. The remapped prefixes MUST be present:
 * their absence means the binary was not produced by `script/build-wasm.mjs`,
 * even though every disclosure pattern above would be satisfied.
 */
if (fileIndex === -1) {
	/**
	 * `/cargo` must be present on every platform: dependency sources always
	 * embed as absolute remapped paths. The WORKSPACE roots are
	 * platform-conditional: Windows embeds the absolutely-remapped `/opencut`
	 * form, while POSIX embeds wasm-bindgen's relativized `/wasm` / `/crates`
	 * forms (see REMAPPED_ROOTS). Vacuity protection requires at least ONE
	 * workspace-root form — which one depends on where the artifact was built.
	 */
	const cargoCount = (text.match(/\/cargo[\\/][^\x00-\x1f"]{0,120}/g) ?? []).length;
	const opencutCount = (text.match(/\/opencut[\\/][^\x00-\x1f"]{0,120}/g) ?? []).length;
	const workspaceRelativeCount = (text.match(/\/(?:wasm|crates)[\\/][A-Za-z0-9._+@=-]+[\\/]/g) ?? []).length;
	const cargoOk = cargoCount > 0;
	const workspaceOk = opencutCount + workspaceRelativeCount > 0;
	console.log(`  ${cargoOk ? "PASS" : "FAIL"}  remapped \`/cargo\` prefix present (${cargoCount}) — proves the scan is not vacuous`);
	console.log(`  ${workspaceOk ? "PASS" : "FAIL"}  a workspace root form is present (/opencut ${opencutCount}, relativized ${workspaceRelativeCount}) — proves workspace paths were sanctioned`);
	if (!cargoOk) findings.push("no remapped `/cargo` prefix — was this built with script/build-wasm.mjs?");
	if (!workspaceOk) findings.push("no `/opencut` or relativized `/wasm`/`/crates` form — was this built with script/build-wasm.mjs?");
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
