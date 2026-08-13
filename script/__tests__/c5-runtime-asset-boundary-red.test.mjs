import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checker = join(repoRoot, "script", "check-runtime-asset-boundary.mjs");
const probe = join(
	repoRoot,
	"apps",
	"web",
	"src",
	"c5-runtime-asset-boundary-probe.ts",
);

function runChecker() {
	return spawnSync(process.execPath, [checker], {
		cwd: repoRoot,
		encoding: "utf8",
	});
}

describe("C5 runtime asset boundary deleted-file regression", () => {
	test("ignores deleted cached paths but still scans an existing production file", () => {
		const clean = runChecker();
		expect(
			clean.status,
			`deleted cached path caused a checker failure:\n${clean.stdout}\n${clean.stderr}`,
		).toBe(0);
		expect(`${clean.stdout}\n${clean.stderr}`).not.toContain(
			"browser-host-adapter.ts",
		);

		try {
			writeFileSync(probe, 'fetch("/fonts/atlas.json");\n', "utf8");
			const violation = runChecker();
			expect(violation.status).not.toBe(0);
			expect(`${violation.stdout}\n${violation.stderr}`).toContain(
				"root-fetch",
			);
		} finally {
			rmSync(probe, { force: true });
		}
	});
});
