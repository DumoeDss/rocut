#!/usr/bin/env node
/**
 * Regenerate the probe source snapshot manifest (fixture-source.json).
 *
 * Browser probes pin every tracked source file they may read so a receipt can
 * prove the exact source state a run observed. The manifest is the integrity
 * claim: each tracked file's path and SHA-256 plus the source commit. Regenate
 * it whenever tracked sources change and a probe run must be reproducible.
 *
 *   node script/generate-fixture-source.mjs           # rewrite the manifest
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "fixture-source.json");
const list = (args) =>
	execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		windowsHide: true,
	});
const sourceCommit = list(["rev-parse", "HEAD"]).trim();
const paths = list(["ls-files"])
	.split(/\r?\n/)
	.filter((line) => line && line !== "fixture-source.json")
	.sort();
if (!paths.length) throw Error("No tracked sources found; refusing empty manifest");
const files = paths.map((path) => ({
	path,
	sha256: createHash("sha256").update(readFileSync(join(root, path))).digest("hex"),
}));
const manifest = { schema: "fixture-source/v2", sourceCommit, files };
writeFileSync(out, JSON.stringify(manifest, null, "\t") + "\n");
console.log(
	`wrote ${files.length} source file(s) at commit ${sourceCommit.slice(0, 12)}`,
);
