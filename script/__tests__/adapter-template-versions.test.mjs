import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("the template drift gate rejects stale, missing and ranged SDK versions before execution", () => {
	const fixture = mkdtempSync(join(tmpdir(), "adapter-template-versions-"));
	try {
		cpSync(join(root, "templates/adapter-project"), join(fixture, "templates/adapter-project"), { recursive: true });
		for (const relative of [
			"script/check-adapter-project-template.mjs",
			"packages/editor-ports/package.json",
			"packages/editor-contracts/package.json",
			"packages/editor-classic/package.json",
			...[
				"src/alien-codec.ts", "src/alien-control.ts", "src/alien-store.ts",
				"src/migrate.ts", "src/roles.ts", "src/transaction.ts", "types/culori.d.ts",
			].map((relative) => `examples/custom-storage/${relative}`),
		]) {
			mkdirSync(dirname(join(fixture, relative)), { recursive: true });
			cpSync(join(root, relative), join(fixture, relative));
		}
		const manifestPath = join(fixture, "templates/adapter-project/package.json");
		const original = JSON.parse(readFileSync(manifestPath, "utf8"));
		for (const [name, version] of [
			["@opencut/editor-ports", "0.2.0"],
			["@opencut/editor-contracts", "0.3.0"],
			["@opencut/editor-classic", undefined],
			["@opencut/editor-ports", "^0.3.0"],
		]) {
			const manifest = { ...original, dependencies: { ...original.dependencies, [name]: version } };
			writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
			const result = spawnSync(process.execPath, [join(fixture, "script/check-adapter-project-template.mjs")], {
				encoding: "utf8", timeout: 10_000,
			});
			assert.equal(result.status, 1, result.stderr);
			assert.ok(result.stderr.includes(`${name} template version ${version ?? "missing"} does not match SDK`), result.stderr);
			assert.ok(result.stdout.includes("REAL_EXIT_CODE[template-drift]:1"));
			assert.ok(!result.stdout.includes("seed-check/opaque-round-trip"));
		}
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
