#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
	process.execPath,
	[
		join(ROOT, "node_modules", "typescript", "bin", "tsc"),
		"--ignoreConfig",
		"--noEmit",
		"--strict",
		"--skipLibCheck",
		"--target",
		"ES2022",
		"--module",
		"ESNext",
		"--moduleResolution",
		"Bundler",
		"--lib",
		"ES2022,DOM,ESNext.Disposable",
		"script/fixtures/wasm-runtime-contract.ts",
	],
	{ cwd: ROOT, encoding: "utf8" },
);
if (result.status !== 0) {
	console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}
process.exit(result.status ?? 1);
