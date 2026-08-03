import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checker = join(repoRoot, "script", "check-emitted-runtime-assets.mjs");

describe("C5 mounted-base dot-segment emitted-asset RED controls", () => {
	test("rejects literal and encoded dot-segment escapes after URL canonicalization", () => {
		for (const [fixture, url] of [
			["vite-mounted-dot-segment-literal", "url=/c4-vite/../assets/entry.js"],
			[
				"vite-mounted-dot-segment-encoded",
				"url=/c4-vite/%2e%2e/assets/entry.js",
			],
		]) {
			const result = spawnSync(
				process.execPath,
				[checker, "--fixture", fixture],
				{
					cwd: repoRoot,
					encoding: "utf8",
				},
			);
			const output = `${result.stdout}\n${result.stderr}`;
			expect(
				result.status,
				`${fixture} unexpectedly passed:\n${output}`,
			).not.toBe(0);
			expect(output).toContain("[root-emitted-entry-url]");
			expect(output).toContain("file=assets/entry.js");
			expect(output).toContain(url);
		}
	});
});
