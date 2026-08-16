/**
 * The two version pins that decide the bytes of `rust/wasm/pkg`, and the assertion that the
 * machine actually carries them.
 *
 * **Why this module exists.** The recorded wasm surface
 * (`script/wasm-api-surface-contract.mjs`) is a set of exact hashes and exact export sets. Two
 * tools produce them:
 *
 *   * **rustc** — compiles the crate. Its version is embedded in the binary's `producers`
 *     section verbatim, and three of the 58 wasm exports are rustc symbol-hash names that move
 *     with it. Pinned in `rust-toolchain.toml`, which rustup applies to every cargo invocation;
 *     this module reads the channel from there rather than restating it, so there is one pin.
 *   * **wasm-pack** — selects the `wasm-bindgen` CLI that writes all four glue files and the
 *     `wasm-opt` build of binaryen that rewrites the binary. rustup has nowhere to record it, so
 *     it is pinned here and asserted the same way.
 *
 * PR #2's `check-wasm-api-surface` red leg was caused by neither pin existing: CI installed
 * `wasm-pack: latest` (v0.15.0 on the merge run) against a surface recorded with 0.13.1, and ran
 * whatever rustc the runner image shipped. Both are checked before a build starts, because a
 * mismatched build produces an artifact that *looks* fine — it boots, it types, it passes the
 * path and source gates — and only the surface check can tell, three steps later.
 *
 * Bumping a pin is deliberate: change the value, rebuild, re-record every hash the surface check
 * reports as changed, and name the new version in the commit.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The rustup channel, read from the single pin in `rust-toolchain.toml`. */
export const RUSTC_VERSION = (() => {
	const manifest = readFileSync(join(REPO_ROOT, "rust-toolchain.toml"), "utf8");
	const channel = manifest.match(/^\s*channel\s*=\s*"([^"]+)"/m)?.[1];
	if (!channel) {
		throw new Error(
			"wasm-toolchain: rust-toolchain.toml carries no [toolchain] channel",
		);
	}
	return channel;
})();

/**
 * The wasm-pack pin. CI installs exactly this tag; `check-wasm-source.mjs` asserts the workflow
 * and this constant agree, so the two cannot drift apart silently.
 */
export const WASM_PACK_VERSION = "0.13.1";

/** The `jetli/wasm-pack-action` input that must appear in the workflow. */
export const WASM_PACK_ACTION_VERSION = `v${WASM_PACK_VERSION}`;

function firstVersionToken(output) {
	// `rustc 1.88.0 (6b00bc388 2025-06-23)` / `wasm-pack 0.13.1`
	return output.trim().split(/\s+/)[1] ?? "";
}

function probe(command, args) {
	// On Windows these are `.cmd`/`.bat` shims, so they need a shell. Passing the whole invocation
	// as one string rather than command+args avoids node's DEP0190 warning, which fires on every
	// build otherwise.
	// Quote only tokens that need it: quoting the command token too makes `cmd /s /c` strip the
	// wrong quote pair and resolve the name against the repo's own `node_modules`.
	const quote = (part) => (/\s/.test(part) ? `"${part}"` : part);
	const result =
		process.platform === "win32"
			? spawnSync([command, ...args].map(quote).join(" "), {
					encoding: "utf8",
					shell: true,
				})
			: spawnSync(command, args, { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		return {
			ok: false,
			version: null,
			error: result.error?.message ?? `${command} exited ${result.status}`,
		};
	}
	return {
		ok: true,
		version: firstVersionToken(`${result.stdout}${result.stderr}`),
		error: null,
	};
}

/**
 * @returns {{ok: boolean, checks: Array<{tool: string, expected: string, observed: string|null, ok: boolean, error: string|null}>}}
 */
export function inspectToolchain() {
	const checks = [
		{ tool: "rustc", expected: RUSTC_VERSION, ...probe("rustc", ["--version"]) },
		{
			tool: "wasm-pack",
			expected: WASM_PACK_VERSION,
			...probe("wasm-pack", ["--version"]),
		},
	].map((entry) => ({
		tool: entry.tool,
		expected: entry.expected,
		observed: entry.version,
		error: entry.error,
		ok: entry.ok && entry.version === entry.expected,
	}));
	return { ok: checks.every((check) => check.ok), checks };
}

/** Prints the observed toolchain and exits non-zero when either pin is unmet. */
export function assertToolchain({ exitCode = 2 } = {}) {
	const { ok, checks } = inspectToolchain();
	for (const check of checks) {
		const observed = check.observed || check.error || "not found";
		console.log(
			`  ${check.ok ? "PASS" : "FAIL"}  ${check.tool} ${check.expected} (observed: ${observed})`,
		);
	}
	if (ok) return;
	console.error("");
	console.error(
		"build-wasm: the toolchain is not the pinned one, so the artifact would not match the",
	);
	console.error(
		"recorded surface (script/wasm-api-surface-contract.mjs). Install the pins:",
	);
	console.error("");
	console.error(`      rustup toolchain install ${RUSTC_VERSION}`);
	console.error("      rustup target add wasm32-unknown-unknown");
	console.error(
		`      cargo install wasm-pack --version ${WASM_PACK_VERSION} --locked`,
	);
	console.error("");
	console.error(
		"Set OPENCUT_WASM_ALLOW_UNPINNED=1 to build anyway — the result is then a local",
	);
	console.error("experiment, not a contract-conformant artifact.");
	process.exit(exitCode);
}
