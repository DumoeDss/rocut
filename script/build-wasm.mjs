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
 *   node script/build-wasm.mjs [extra wasm-pack args]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARGO_HOME = process.env.CARGO_HOME ?? join(homedir(), ".cargo");

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
 * Measured on ubuntu CI (check-wasm-paths): the binary carried `/wasm/src/*.rs`
 * and `/crates/*/src/*.rs` with zero `/opencut` occurrences. The two relative
 * forms below are exactly the workspace's top-level source groups; a new group
 * would surface as an unremapped path and fail the check, which is the check
 * working. Windows passes absolute paths, so these two simply never match there.
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
process.exit(result.status ?? 1);
