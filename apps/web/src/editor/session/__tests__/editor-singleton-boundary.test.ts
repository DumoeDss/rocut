import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const script = resolve(process.cwd(), "script/check-editor-singleton.mjs");

function run(...args: string[]) {
	return Bun.spawnSync({
		cmd: ["node", script, ...args],
		cwd: process.cwd(),
		stderr: "pipe",
		stdout: "pipe",
	});
}

describe("editor singleton boundary", () => {
	test("the complete runtime graph has no implicit editor owner", () => {
		const result = run();
		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toContain("39 command module(s)");
		expect(result.stderr.toString()).toContain("PASS explicit-session-only");
	});

	for (const rule of [
		"singleton-accessor",
		"singleton-reset",
		"static-core-instance",
		"module-scope-construction",
		"construction-outside-owner",
	]) {
		test(`negative control detects ${rule}`, () => {
			const result = run("--negative-control", rule);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain(`FAIL ${rule}:`);
		});
	}
});
