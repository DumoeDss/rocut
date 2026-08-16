#!/usr/bin/env node
/**
 * Builds `rust/wasm` with build-machine paths stripped from the emitted binary.
 *
 * **Why this exists (S02 `s02-wasm-self-built-canonical`).** Since S02 the editor
 * consumes the wasm built from `rust/` rather than the published npm package, so
 * this artifact is **redistributed to every user of the built web app**. Plain
 * `wasm-pack build` records absolute source paths of the machine that built it:
 * measured at **286** absolute paths in the S02 build (285
 * `C:\\Users\\<name>\\.cargo\\registry\\src\\...` plus the builder's worktree
 * path), disclosing a home directory and an OS username.
 *
 * Published `opencut-wasm@0.2.10` is **not** a clean counter-example: it carries
 * **169** paths rooted at `/home/heart/` and discloses that username. It merely
 * looks clean to a Windows-shaped scan, having been built on Linux. So this is not
 * a property the fork dropped and restored — neither artifact had it, and the fork
 * now has it where the package it replaces does not.
 *
 * **Why not `[profile.release] trim-paths`.** That is the obvious fix and it does
 * not work on the measured Cargo 1.88.0 toolchain: `trim-paths` is still
 * unstable there, and a manifest carrying it fails to parse at all —
 * `cargo metadata` exits with "feature `trim-paths` is required … not stabilized
 * in this version of Cargo", which breaks every cargo invocation rather than only
 * release builds.
 * Measured, not assumed. `--remap-path-prefix` is the stable equivalent.
 *
 * **Why a script rather than `.cargo/config.toml`.** The two prefixes that need
 * remapping — `CARGO_HOME` and the checkout root — are machine-specific, and
 * cargo does not interpolate environment variables into `build.rustflags`. A
 * committed config would have to hardcode one developer's paths. Computing them
 * at invocation is the portable form.
 *
 * This is the single source of truth for how the wasm is built: `bun run
 * build:wasm`, `bun dev:wasm` and CI all route through it, so the flags cannot
 * drift between a local build and the one CI validates.
 *
 * **Two things happen either side of wasm-pack.** Before: the pinned toolchain is
 * asserted (`script/wasm-toolchain.mjs`) — an unpinned rustc or wasm-pack silently
 * produces a different recorded surface, which is how PR #2 merged with a red
 * `check-wasm-api-surface` leg. After: the non-bundler entry is emitted and the
 * generated `package.json` gains its `exports` conditions (see `emitSyncEntry`).
 *
 *   node script/build-wasm.mjs [extra wasm-pack args]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { assertToolchain } from "./wasm-toolchain.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARGO_HOME = process.env.CARGO_HOME ?? join(homedir(), ".cargo");

/** The generated non-bundler entry; see `emitSyncEntry` at the foot of this file. */
const SYNC_ENTRY = "opencut_wasm_sync.js";

/**
 * Remap targets are deliberately stable, meaningless-outside-the-build strings
 * rather than anything resembling a real path, so a leaked one is obviously
 * synthetic. `/cargo` covers every registry and git dependency; `/opencut` covers
 * this checkout, which is also what makes two clones at different paths able to
 * produce the same bytes.
 *
 * On POSIX, cargo hands rustc workspace-RELATIVE source paths (relative to the
 * `rust/` workspace root), so the absolute-`REPO_ROOT` remap never matches the
 * crate's own sources there — only dependencies under `CARGO_HOME` get remapped.
 * Measured on ubuntu CI (check-wasm-paths): the binary carried paths like
 * `/wasm/src/gpu.rs` and `/crates/gpu/src/context.rs` with zero `/opencut`
 * occurrences. The two relative forms below are exactly the workspace's
 * top-level source groups; a new group would surface as an unremapped path and
 * fail the check, which is the check working. Windows passes absolute paths, so
 * these two simply never match there.
 */
const REMAPS = [
	[CARGO_HOME, "/cargo"],
	[REPO_ROOT, "/opencut"],
	["/wasm/", "/opencut/rust/wasm/"],
	["/crates/", "/opencut/rust/crates/"],
];

const flags = REMAPS.map(([from, to]) => `--remap-path-prefix=${from}=${to}`);
// Preserve anything the caller already set; ours go last so they win on conflict.
const rustflags = [process.env.RUSTFLAGS, ...flags].filter(Boolean).join(" ");

if (!existsSync(join(REPO_ROOT, "rust", "wasm", "Cargo.toml"))) {
	console.error(`build-wasm: no crate at ${join(REPO_ROOT, "rust", "wasm")}`);
	process.exit(2);
}

const args = ["build", "rust/wasm", "--target", "bundler", "--out-dir", "pkg", ...process.argv.slice(2)];

if (process.env.OPENCUT_WASM_ALLOW_UNPINNED === "1") {
	console.log("build-wasm: toolchain pins BYPASSED (OPENCUT_WASM_ALLOW_UNPINNED=1)");
} else {
	console.log("build-wasm: pinned toolchain");
	assertToolchain();
}

console.log(`build-wasm: wasm-pack ${args.join(" ")}`);
for (const [from, to] of REMAPS) console.log(`  remapping ${from}  ->  ${to}`);
if (!process.env.CARGO_TARGET_DIR) {
	console.log("  note: CARGO_TARGET_DIR is unset, so the Rust build directory lands beside the checkout.");
}

const result = spawnSync("wasm-pack", args, {
	cwd: REPO_ROOT,
	stdio: "inherit",
	env: { ...process.env, RUSTFLAGS: rustflags },
	shell: process.platform === "win32",
});

if (result.error) {
	console.error(`build-wasm: could not run wasm-pack — ${result.error.message}`);
	console.error("Install it with: script/setup-rust   (or script/setup-rust.ps1 on Windows)");
	process.exit(2);
}
if (result.status !== 0) process.exit(result.status ?? 1);

emitSyncEntry();
process.exit(0);

/**
 * Emits the non-bundler entry and the `exports` conditions that route to it.
 *
 * **The defect this repairs.** wasm-pack's `--target bundler` entry is
 * `import * as wasm from "./opencut_wasm_bg.wasm"; …; wasm.__wbindgen_start();`, which needs the
 * WebAssembly/ESM integration to turn that import into instance exports. Node 24 implements it
 * (measured: the bundler entry imports and runs there today). **Bun does not** — it resolves a
 * `.wasm` import to an asset and hands back `{__esModule, default: "<path string>"}`, so
 * `wasm.__wbindgen_start` is `undefined` and every consumer that reaches the artifact outside a
 * bundler dies with `TypeError: wasm.__wbindgen_start is not a function`. That error is the
 * Direction-level wasm-init finding S05 carried; it is a runtime capability difference, not a
 * bug in the artifact, and not bun-version-specific.
 *
 * **The repair.** Emit a second entry that does the bundler's job explicitly — compile the
 * binary from disk, instantiate it against the same glue module the bundler would have linked,
 * set the glue's wasm handle, run the start function — and route the `bun` condition to it, plus
 * a declared `./sync` subpath for any other runtime that needs it. Every other condition keeps
 * resolving to the untouched bundler entry, so the browser/bundler path is byte-for-byte what it
 * was.
 *
 * **Why generated rather than committed.** The re-exported name list must be exactly the
 * bundler entry's, which wasm-bindgen rewrites on every surface change. Slicing the bundler
 * entry's own `export { … } from` block guarantees the two entries can never disagree — and
 * `check-wasm-api-surface` asserts that equality independently, so the guarantee is checked
 * rather than assumed.
 *
 * Determinism: the emitted bytes are a pure function of wasm-pack's own output (the sliced
 * export block) plus this literal template, and the manifest is re-serialised with a fixed key
 * order, so a rebuild on the same pins reproduces both exactly.
 */
function emitSyncEntry() {
	const pkgDir = join(REPO_ROOT, "rust", "wasm", "pkg");
	const bundlerEntry = join(pkgDir, "opencut_wasm.js");
	const wrapper = readFileSync(bundlerEntry, "utf8");
	const exportBlock = wrapper.match(/export \{([\s\S]*?)\} from/)?.[1];
	if (exportBlock === undefined) {
		console.error("build-wasm: opencut_wasm.js carries no `export { … } from` block to mirror");
		process.exit(2);
	}

	const source = `/* @ts-self-types="./opencut_wasm.d.ts" */
// GENERATED by script/build-wasm.mjs — do not edit. The re-exported set below is sliced from
// opencut_wasm.js so the two entries expose exactly the same names.
//
// This entry exists because the bundler entry's \`import * as wasm from "./opencut_wasm_bg.wasm"\`
// requires the WebAssembly/ESM integration, which bun does not implement (it resolves the import
// to an asset path string, leaving \`wasm.__wbindgen_start\` undefined). Here the instantiation is
// explicit, so any runtime with \`WebAssembly\` and \`node:fs\` initializes the same binary.
import { readFileSync } from "node:fs";
import * as glue from "./opencut_wasm_bg.js";

const compiled = new WebAssembly.Module(
	readFileSync(new URL("./opencut_wasm_bg.wasm", import.meta.url)),
);
// The binary's import module names are whatever wasm-bindgen wrote into it; reading them back
// keeps this entry correct if that name ever changes, instead of hardcoding a string that would
// fail at instantiation with a link error nobody can read.
const imports = {};
for (const entry of WebAssembly.Module.imports(compiled)) imports[entry.module] = glue;
const instance = new WebAssembly.Instance(compiled, imports);
glue.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
export {${exportBlock}} from "./opencut_wasm_bg.js";
`;
	writeFileSync(join(pkgDir, SYNC_ENTRY), source, "utf8");

	const manifestPath = join(pkgDir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.files = [...manifest.files.filter((name) => name !== SYNC_ENTRY), SYNC_ENTRY];
	manifest.sideEffects = [
		...manifest.sideEffects.filter((name) => name !== `./${SYNC_ENTRY}`),
		`./${SYNC_ENTRY}`,
	];
	// `types` first so a TypeScript resolver never falls through to a runtime condition; `default`
	// last so bundlers and browsers keep the bundler entry. The `./*` subpath preserves every deep
	// path that resolved before this map existed — adding `exports` otherwise silently seals them.
	//
	// **Only `bun` is routed, deliberately.** A `node` condition looks like the obvious companion
	// and is a trap: bundlers targeting node set it too, and they do not resolve
	// `new URL("./x.wasm", import.meta.url)` to a readable file. Measured on this repo's own Next
	// Host — turbopack rewrote it to the browser asset path
	// `/_next/static/media/opencut_wasm_bg.<hash>.wasm` and the SSR build died with
	// `ERR_INVALID_URL`; an earlier attempt with a realm-safe path string died one step earlier on
	// turbopack's own `URL` polyfill. `bun` and `deno` are runtime-only conditions; `node` is not.
	// Node consumers that predate the WebAssembly/ESM integration take the explicit `./sync`
	// subpath below, which is why it exists as a declared entry rather than a deep path.
	manifest.exports = {
		".": {
			types: "./opencut_wasm.d.ts",
			bun: `./${SYNC_ENTRY}`,
			default: "./opencut_wasm.js",
		},
		"./sync": `./${SYNC_ENTRY}`,
		"./*": "./*",
	};
	// wasm-pack writes this file with two-space indent and no trailing newline; matching it keeps
	// the diff against an unpatched build to exactly the three keys above.
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

	console.log(`build-wasm: emitted ${SYNC_ENTRY}, the bun condition and the ./sync subpath`);
}
