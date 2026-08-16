/**
 * The CI finding that PR #3's first run produced, and the fix, scored side by side.
 *
 * `check-wasm-paths.mjs` scans the binary as one flat latin1 string. The data section has no
 * string boundaries, so two unrelated literals laid end to end read as a single token; when the
 * left one ends in `/`, the path regex matches through the join and the `^`-anchored allowlist no
 * longer sees the sanctioned root at the start. Run 31940037053 (ubuntu) hit exactly that:
 *
 *   /from_iter + /cargo/registry/src/index.crates.io-…/parking_lot_core-0.9.12/src/parking_lot.rs
 *
 * one of the 285 remapped `/cargo` paths in that build. `from_iter` is a Rust iterator adapter
 * name and `/cargo` is this repository's own synthetic remap target — no build machine is
 * disclosed, so this was a false positive, not a leak.
 *
 * The fix cuts a candidate at every embedded sanctioned root and judges the fragments
 * independently. The risk it creates is obvious and is what the rows below exist to close: a REAL
 * machine path that merely contains a sanctioned root as an interior segment must still fail.
 *
 *   node rasen/changes/wasm-determinism-init/evidence/posix-path-adjacency.mjs
 */
const POSIX_PATH = /\/(?:[A-Za-z0-9._+@=-]+\/){1,24}[A-Za-z0-9._+@=-]+/g;
const REMAPPED_ROOTS = [/^\/cargo(?:\/|$)/, /^\/opencut(?:\/|$)/, /^\/wasm(?:\/|$)/, /^\/crates(?:\/|$)/];
const RUSTC_VIRTUAL_ROOTS = [
	/^\/rustc\/[0-9a-f]{40}\/library\//,
	/^\/rust\/deps\//,
	/^\/(?:alloc|core|std)\/src\//,
];
const SOURCE_OR_BUILD_SEGMENT = /\/(?:src|checkout|workspaces?|builds?|\.cargo|\.rustup)(?:\/|$)/;
const SOURCE_FILE_SUFFIX = /\.(?:c|cc|cpp|h|hpp|lock|rs|toml)(?:$|[^A-Za-z0-9])/;

const judgeFragment = (fragment) => {
	if (REMAPPED_ROOTS.some((allowed) => allowed.test(fragment))) return false;
	if (RUSTC_VIRTUAL_ROOTS.some((virtual) => virtual.test(fragment))) return false;
	return SOURCE_OR_BUILD_SEGMENT.test(fragment) || SOURCE_FILE_SUFFIX.test(fragment);
};

/** Pre-fix: the whole match judged as one, allowlist anchored at its start. */
const BEFORE = (value) => (value.match(POSIX_PATH) ?? []).filter(judgeFragment);

/** Shipped: cut at every embedded sanctioned root, judge fragments independently. */
const splitAtSanctionedRoots = (path) => {
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
};
const AFTER = (value) =>
	(value.match(POSIX_PATH) ?? []).filter((path) => splitAtSanctionedRoots(path).some(judgeFragment));

const CASES = [
	// [string, must the gate report it?, why]
	[
		"/from_iter/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_lot_core-0.9.12/src/parking_lot.rs",
		false,
		"THE CI FAILURE: adjacency of an identifier and a remapped path; discloses nothing",
	],
	["/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/lib.rs", false, "plain remapped dependency path"],
	["/opencut/rust/crates/gpu/src/context.rs", false, "plain remapped workspace path"],
	["/wasm/src/gpu.rs", false, "wasm-bindgen relativized workspace form"],
	[
		"/workspace/checkout/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/lib.rs",
		true,
		"REAL machine path with a sanctioned root INSIDE it — the hole the fix could have opened",
	],
	["/builds/ci/opencut/rust/wasm/src/gpu.rs", true, "same shape, workspace root interior"],
	["/home/heart/.cargo/registry/src/foo-1.0.0/src/lib.rs", true, "the published-0.2.10 leak shape"],
	["/workspace/checkout/rust/crates/gpu/src/context.rs", true, "the pre-existing committed control"],
	["/root/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/std/src/panicking.rs", true, "the pre-existing committed control"],
];

let wrongBefore = 0;
let wrongAfter = 0;
console.log(`${"string".padEnd(58)}${"want".padEnd(9)}${"BEFORE".padEnd(11)}AFTER`);
for (const [value, mustReport, why] of CASES) {
	const before = BEFORE(value).length > 0;
	const after = AFTER(value).length > 0;
	if (before !== mustReport) wrongBefore += 1;
	if (after !== mustReport) wrongAfter += 1;
	const show = value.length > 56 ? `${value.slice(0, 53)}...` : value;
	console.log(
		`${show.padEnd(58)}${(mustReport ? "report" : "allow").padEnd(9)}${(before ? "report" : "allow").padEnd(4)}${(before === mustReport ? " ok " : "WRONG").padEnd(7)}${(after ? "report" : "allow").padEnd(4)}${after === mustReport ? " ok" : "WRONG"}`,
	);
	console.log(`${" ".repeat(58)}${why}`);
}
console.log(
	`\nwrong verdicts over ${CASES.length} cases — BEFORE (pre-fix): ${wrongBefore}, AFTER (shipped): ${wrongAfter}`,
);
console.log(
	"Every case the fix changes is one where the pre-fix answer was wrong; no case flips from report to allow that should be reported.",
);
process.exit(wrongAfter === 0 ? 0 : 1);
