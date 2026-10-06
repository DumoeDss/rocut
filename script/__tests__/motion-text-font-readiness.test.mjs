import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

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

function run(args) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
}

function parseOutput(result) {
	expect(result.stdout).not.toBeEmpty();
	return JSON.parse(result.stdout);
}

describe("motion-text font readiness CLI", () => {
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
		]);
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
