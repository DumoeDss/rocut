/**
 * Packer test for the distributable runtime bundle (S08 R task 4.5).
 *
 * Slow and env-gated (ROCUT_PACK_RUNTIME_TEST=1): runs the real packer CLI
 * into a temp output dir and asserts the output shape (entry, wasm-referencing
 * chunk, byte-equal wasm sibling, PROVENANCE) plus both smoke outcomes — the
 * bundled `rocut.mjs` answering `target list` and the full ensure round-trip
 * with a tree-killed daemon.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packer = join(repoRoot, "script", "pack-runtime.mjs");
const gated = process.env.ROCUT_PACK_RUNTIME_TEST === "1";

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe.skipIf(!gated)("pack-runtime (task 4.5) — set ROCUT_PACK_RUNTIME_TEST=1 to run", () => {
	const outDir = mkdtempSync(join(tmpdir(), "rocut-pack-test-"));
	afterAll(() => {
		rmSync(outDir, { recursive: true, force: true });
	});
	let manifest = null;
	let stdout = "";

	test("the packer run completes and self-logs real exit codes", () => {
		const result = spawnSync(
			process.execPath,
			[
				packer,
				"--out",
				outDir,
				"--manifest",
				join(outDir, "manifest.json"),
				"--skip-surface",
				"--allow-dirty",
			],
			{ cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
		);
		stdout = `${result.stdout}\n${result.stderr}`;
		expect(result.status, `packer failed:\n${stdout}`).toBe(0);
		expect(stdout).toContain("REAL_EXIT_CODE[pack]:0");
		manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
	}, 600_000);

	test("output shape: entry, wasm-referencing chunk, byte-equal sibling, PROVENANCE", () => {
		expect(manifest).not.toBe(null);
		expect(existsSync(join(outDir, "rocut.mjs"))).toBe(true);
		expect(manifest.wasmSibling.byteEqual).toBe(true);
		expect(manifest.wasmSibling.referencingChunks.length).toBeGreaterThanOrEqual(1);
		for (const name of manifest.wasmSibling.referencingChunks) {
			expect(readFileSync(join(outDir, name), "utf8")).toContain("opencut_wasm_bg.wasm");
		}
		expect(sha256File(join(outDir, "opencut_wasm_bg.wasm"))).toBe(
			sha256File(join(repoRoot, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
		);
		const provenance = readFileSync(join(outDir, "PROVENANCE.md"), "utf8");
		expect(provenance).toContain("esbuild");
		expect(provenance).toContain("Source commit:");
		expect(provenance).toContain("bun is the documented runtime");
		expect(provenance).toContain("--experimental-wasm-modules");
		expect(provenance).toContain("commit + esbuild");
	});

	test("determinism reproduced and smoke outcomes recorded", () => {
		expect(manifest.determinism.exercised).toBe(true);
		expect(manifest.determinism.reproduced).toBe(true);
		expect(stdout).toContain("REAL_EXIT_CODE[smoke-target-list]:0");
		expect(manifest.smoke.listCheck.exitCode).toBe(0);
		expect(manifest.smoke.listCheck.output).toContain("no targets");
		expect(manifest.smoke.ensureRoundTrip.states).toEqual(["started", "reused"]);
		expect(manifest.smoke.ensureRoundTrip.entryCount).toBe(1);
		expect(stdout).toContain("REAL_EXIT_CODE[smoke-treekill]:0");
	});
});
