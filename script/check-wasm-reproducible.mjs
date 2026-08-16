#!/usr/bin/env node
/**
 * Byte-reproducibility of the redistributed wasm artifact.
 *
 * **The claim under test.** On the pinned toolchain, the same commit produces the same bytes —
 * not "a compatible artifact", the same SHA-256 for all nine files in `rust/wasm/pkg`. Without
 * that, "deterministic build" is an adjective; `check-wasm-api-surface` pins five of those files
 * by hash and would be re-recording noise on every rebuild.
 *
 * **Why the second build uses a different `CARGO_TARGET_DIR` by default.** Reusing the cache
 * proves only that nothing re-ran. A fresh target directory recompiles the whole graph *at a
 * different absolute path*, so it also proves the emitted bytes carry nothing of where they were
 * built — the property `check-wasm-paths.mjs` asserts by scanning, measured here by construction.
 * `--quick` reuses the cache when you only need to check the post-build emission steps.
 *
 * This is a **local gate, not a CI one**: a fresh-target run recompiles wgpu and friends (minutes),
 * which is why it is registered as `bun run check:wasm:reproducible` rather than in `check:wasm`.
 * `script/check-wasm-source.mjs`'s GATED list deliberately does not carry it — that list means
 * "must be in CI", and claiming this one is there would be false.
 *
 *   bun run check:wasm:reproducible              # fresh target directory (default)
 *   node script/check-wasm-reproducible.mjs --quick
 *   OPENCUT_WASM_REPRO_TARGET=<dir> …            # override the scratch target directory
 *
 * Leaves `rust/wasm/pkg` holding the SECOND build's output. If the two disagree, re-run
 * `bun run build:wasm && bun install` before trusting any other gate.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "rust", "wasm", "pkg");
const quick = process.argv.includes("--quick");
const scratchTarget =
	process.env.OPENCUT_WASM_REPRO_TARGET ??
	join(homedir(), ".opencut-wasm-reproducible-target");

const sha = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

function snapshot() {
	return new Map(
		readdirSync(PKG)
			.filter((name) => statSync(join(PKG, name)).isFile())
			.sort()
			.map((name) => [name, sha(join(PKG, name))]),
	);
}

if (!existsSync(PKG)) {
	console.error(
		"check-wasm-reproducible: no build output at rust/wasm/pkg; run bun run build:wasm",
	);
	process.exit(2);
}

const first = snapshot();
console.log(
	`check-wasm-reproducible: first build recorded, ${first.size} file(s) in ${relative(ROOT, PKG).replaceAll("\\", "/")}`,
);
console.log(
	quick
		? "  second build: same CARGO_TARGET_DIR (emission steps only)"
		: `  second build: CARGO_TARGET_DIR=${scratchTarget} (full recompile at a different path)`,
);

const env = { ...process.env };
if (!quick) env.CARGO_TARGET_DIR = scratchTarget;
const rebuild = spawnSync(
	process.execPath,
	[join(ROOT, "script", "build-wasm.mjs")],
	{ cwd: ROOT, stdio: "inherit", env },
);
if (rebuild.status !== 0) {
	console.error(
		`check-wasm-reproducible: the second build failed (exit ${rebuild.status})`,
	);
	process.exit(2);
}

const second = snapshot();
const names = [...new Set([...first.keys(), ...second.keys()])].sort();
const divergent = [];
for (const name of names) {
	const before = first.get(name);
	const after = second.get(name);
	if (before === after) continue;
	divergent.push({ name, before: before ?? "<absent>", after: after ?? "<absent>" });
}

console.log("");
for (const name of names) {
	const same = first.get(name) === second.get(name);
	console.log(
		`  ${same ? "PASS" : "FAIL"}  ${name}  ${(second.get(name) ?? "<absent>").slice(0, 16)}…`,
	);
}
console.log(
	`\n  ${divergent.length === 0 ? "PASS" : "FAIL"}  ${names.length - divergent.length}/${names.length} file(s) byte-identical across two builds`,
);

if (divergent.length > 0) {
	console.error("\ncheck-wasm-reproducible FAILED — these files are not reproducible:");
	for (const entry of divergent) {
		console.error(`  - ${entry.name}: ${entry.before} -> ${entry.after}`);
	}
	console.error(
		"\nrust/wasm/pkg now holds the SECOND build. Re-run `bun run build:wasm && bun install`",
	);
	console.error("before trusting the other wasm gates.");
	process.exit(1);
}

console.log(
	`\nclean — the artifact is byte-reproducible${quick ? "" : " from a fresh build directory at a different absolute path"}`,
);
