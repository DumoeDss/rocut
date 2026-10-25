import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { fontReadinessDifferences } from "../motion-text-font-readiness-diff.mjs";
import { canonicalFontReportForCheck, readFontBuildHost } from "../motion-text-font-build-identity.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(
	REPO_ROOT,
	"script",
	"probe-motion-text-font-readiness.mjs",
);
const FONT = join(
	REPO_ROOT,
	"apps/web/public/motion-text/fonts/noto-sans-jp-variable.ttf",
);
const LICENSE = join(
	REPO_ROOT,
	"apps/web/public/motion-text/fonts/licenses/notosansjp-OFL.txt",
);
const FONT_DIGEST =
	"sha256:c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f";
const LICENSE_DIGEST =
	"sha256:1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9";
const ZH_HANS_FONT = join(
	REPO_ROOT,
	"apps/web/public/motion-text/fonts/noto-sans-sc-variable.ttf",
);
const ZH_HANS_LICENSE = join(
	REPO_ROOT,
	"apps/web/public/motion-text/fonts/licenses/notosanssc-OFL.txt",
);
const ZH_HANS_FONT_DIGEST =
	"sha256:a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da";
const ZH_HANS_LICENSE_DIGEST =
	"sha256:1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9";

function run(args, options = {}) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
}

function parseOutput(result) {
	expect(result.stdout).not.toBeEmpty();
	return JSON.parse(result.stdout);
}

describe("font readiness mismatch diagnostics", () => {
	test("identifies exact WASM identity differences without dumping other report data", () => {
		const pinned = { source: { canonicalWasm: { bytes: 1, sha256: "old" } }, fixture: { text: "unchanged" } };
		const current = { ...pinned, source: { canonicalWasm: { bytes: 2, sha256: "new" } } };
		expect(fontReadinessDifferences(pinned, current)).toEqual([
			{ field: "/source/canonicalWasm/bytes", pinned: "1", current: "2" },
			{ field: "/source/canonicalWasm/sha256", pinned: '"old"', current: '"new"' },
		]);
	});
	test("bounds fields and scalar length for unexpected differences", () => {
		const differences = fontReadinessDifferences(Array(20).fill("a"), Array(20).fill("x".repeat(1000)));
		expect(differences).toHaveLength(12);
		expect(differences.every((entry) => entry.current.length <= 161)).toBe(true);
		expect(fontReadinessDifferences({ a: 1 }, { a: 1 })).toEqual([]);
	});
});

describe("reviewed font-readiness build identities", () => {
	const baseline = { bytes: 10, sha256: "a".repeat(64) };
	const alternate = { bytes: 11, sha256: "b".repeat(64) };
	const manifest = { schemaVersion: 1, baselineHost: "baseline-host", builds: {
		"baseline-host": { wasm: baseline }, "alternate-host": { wasm: alternate },
	} };
	const pinned = { source: { canonicalWasm: baseline, fontCatalog: { sha256: "catalog" } },
		fixture: { textSha256: "fixture" }, assets: [{ missingCodePoints: [] }] };
	const current = { ...pinned, source: { ...pinned.source, canonicalWasm: alternate } };
	const check = (overrides = {}) => canonicalFontReportForCheck({
		pinned, current, manifest, host: "alternate-host", ...overrides,
	});
	test("accepts a separately reviewed host without changing semantic report fields", () => {
		expect(JSON.stringify(check())).toBe(JSON.stringify(pinned));
		expect(current.source.canonicalWasm).toEqual(alternate);
	});
	test("rejects unknown hosts and baseline/report disagreement", () => {
		expect(() => check({ host: "unknown-host" })).toThrow("Unreviewed");
		expect(() => check({ pinned: current })).toThrow("canonical report baseline mismatch");
	});
	test("rejects wrong size, wrong hash and another host's reviewed artifact", () => {
		for (const wasm of [{ ...alternate, bytes: 12 }, { ...alternate, sha256: "c".repeat(64) }, baseline]) {
			expect(() => check({ current: { ...current, source: { ...current.source, canonicalWasm: wasm } } })).toThrow("mismatch");
		}
	});
	test("retains exact comparison failures for fixture, catalog, glyph and extra-field drift", () => {
		for (const drift of [
			{ ...current, fixture: { textSha256: "changed" } },
			{ ...current, source: { ...current.source, fontCatalog: { sha256: "changed" } } },
			{ ...current, assets: [{ missingCodePoints: [65] }] },
			{ ...current, unreviewed: true },
		]) expect(JSON.stringify(check({ current: drift }))).not.toBe(JSON.stringify(pinned));
	});
	test("refuses missing or ambiguous rustc host instead of assuming Windows", () => {
		expect(readFontBuildHost(() => ({ status: 0, stdout: "host: x86_64-pc-windows-msvc\r\n" }))).toBe("x86_64-pc-windows-msvc");
		for (const result of [{ status: 1 }, { status: 0, stdout: "release: 1.88.0" },
			{ status: 0, stdout: "host: first-host\nhost: second-host\n" }]) {
			expect(() => readFontBuildHost(() => result)).toThrow();
		}
	});
});

describe("motion-text font readiness CLI", () => {
	test("ordinary report generation does not require rustc on PATH", () => {
		const result = run([], { env: { ...process.env, PATH: "" } });
		expect(result.status, result.stderr).toBe(0);
		expect(parseOutput(result).source.canonicalWasm.sha256).toMatch(/^[a-f0-9]{64}$/);
	});

	test("check fails explicitly when its build host cannot be determined", () => {
		const result = run(["--check"], { env: { ...process.env, PATH: "" } });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Cannot determine font-readiness build host");
	});

	test("checks the pinned report against canonical assets", () => {
		const result = run(["--check"]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"20 assets, default missing 0, full coverage 1",
		);
	});

	test("accepts the shipped zh-Hans candidate with full F01 coverage", () => {
		const result = run([
			"--candidate",
			ZH_HANS_FONT,
			"--expected-sha256",
			ZH_HANS_FONT_DIGEST,
			"--license",
			ZH_HANS_LICENSE,
			"--expected-license-sha256",
			ZH_HANS_LICENSE_DIGEST,
		], { env: { ...process.env, PATH: "" } });
		expect(result.status, result.stderr).toBe(0);
		const report = parseOutput(result);
		expect(report.candidate.digestMatches).toBe(true);
		expect(report.candidate.licenseDigestMatches).toBe(true);
		expect(report.candidate.licenseRecognized).toBe(true);
		expect(report.candidate.glyphCount).toBe(31_036);
		expect(report.candidate.missingCodePoints).toEqual([]);
	});

	test("rejects a digest-valid licensed candidate with missing F01 glyphs", () => {
		const result = run([
			"--candidate",
			FONT,
			"--expected-sha256",
			FONT_DIGEST,
			"--license",
			LICENSE,
			"--expected-license-sha256",
			LICENSE_DIGEST,
		]);
		expect(result.status).toBe(1);
		const report = parseOutput(result);
		expect(report.candidate.digestMatches).toBe(true);
		expect(report.candidate.licenseDigestMatches).toBe(true);
		expect(report.candidate.actualLicenseDigest).toBe(LICENSE_DIGEST);
		expect(report.candidate.licenseRecognized).toBe(true);
		expect(report.candidate.missingCodePoints).toHaveLength(14);
	});

	test("rejects a glyph candidate when its expected digest is wrong", () => {
		const result = run([
			"--candidate",
			FONT,
			"--expected-sha256",
			`sha256:${"0".repeat(64)}`,
			"--license",
			LICENSE,
			"--expected-license-sha256",
			LICENSE_DIGEST,
		]);
		expect(result.status).toBe(1);
		const report = parseOutput(result);
		expect(report.candidate.digestMatches).toBe(false);
		expect(report.candidate.actualDigest).toBe(FONT_DIGEST);
	});

	test("requires a pinned license digest for candidate review", () => {
		const result = run([
			"--candidate",
			FONT,
			"--expected-sha256",
			FONT_DIGEST,
			"--license",
			LICENSE,
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("--expected-license-sha256");
	});

	test("rejects a candidate when the pinned license digest is wrong", () => {
		const result = run([
			"--candidate",
			FONT,
			"--expected-sha256",
			FONT_DIGEST,
			"--license",
			LICENSE,
			"--expected-license-sha256",
			`sha256:${"0".repeat(64)}`,
		]);
		expect(result.status).toBe(1);
		const report = parseOutput(result);
		expect(report.candidate.licenseDigestMatches).toBe(false);
		expect(report.candidate.actualLicenseDigest).toBe(LICENSE_DIGEST);
	});

	test("rejects digest-pinned text that is not an OFL 1.1 license", () => {
		const root = mkdtempSync(join(tmpdir(), "rocut-font-license-"));
		try {
			const license = join(root, "LICENSE.txt");
			const bytes = Buffer.from("not a font license\n", "utf8");
			writeFileSync(license, bytes);
			const digest = `sha256:${createHash("sha256")
				.update(bytes)
				.digest("hex")}`;
			const result = run([
				"--candidate",
				FONT,
				"--expected-sha256",
				FONT_DIGEST,
				"--license",
				license,
				"--expected-license-sha256",
				digest,
			]);
			expect(result.status).toBe(1);
			const report = parseOutput(result);
			expect(report.candidate.licenseDigestMatches).toBe(true);
			expect(report.candidate.licenseRecognized).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("rejects a digest-pinned license that is not valid UTF-8", () => {
		const root = mkdtempSync(join(tmpdir(), "rocut-font-license-"));
		try {
			const license = join(root, "LICENSE.txt");
			const bytes = Buffer.from([0xc3, 0x28]);
			writeFileSync(license, bytes);
			const digest = `sha256:${createHash("sha256")
				.update(bytes)
				.digest("hex")}`;
			const result = run([
				"--candidate",
				FONT,
				"--expected-sha256",
				FONT_DIGEST,
				"--license",
				license,
				"--expected-license-sha256",
				digest,
			]);
			expect(result.status).toBe(1);
			expect(result.stdout).toBeEmpty();
			expect(result.stderr).toMatch(/utf-8|encoded data/iu);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
