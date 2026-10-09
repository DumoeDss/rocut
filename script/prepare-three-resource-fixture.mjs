import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A source copy, never a Git worktree or shared dependency installation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = await mkdtemp(join(tmpdir(), "rocut-three-resources-"));
const excluded = new Set([
	"node_modules",
	"target",
	"dist",
	"pkg",
	".next",
	".turbo",
	".artifacts",
	".tmp-probe",
	".rasen",
	"rasen",
]);
const paths = [
	...new Set(
		execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		})
			.split("\0")
			.filter(Boolean),
	),
].filter(
	(path) =>
		!path.split("/").some((part) => excluded.has(part)) &&
		!path.startsWith(".tmp"),
);
const files = [];
for (const path of paths) {
	assert.ok(
		!isAbsolute(path) &&
			!/[\\:]/u.test(path) &&
			path.split("/").every((part) => part && part !== "." && part !== ".."),
	);
	const source = join(root, path);
	const info = await lstat(source).catch((error) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	if (!info) continue; // Deleted tracked sources are not silently restored from Git.
	assert.ok(
		info.isFile() && !info.isSymbolicLink(),
		`Source must be a regular file: ${path}`,
	);
	const bytes = await readFile(source);
	const output = join(destination, path);
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, bytes, { flag: "wx" });
	files.push({
		path,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	});
}
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
await writeFile(
	join(destination, "fixture-source.json"),
	JSON.stringify(
		{ version: 1, sourceCommit, sourceWorktreeClean: false, files },
		null,
		2,
	) + "\n",
	"utf8",
);
console.log(
	JSON.stringify({
		destination,
		sourceCommit,
		files: files.length,
		dependenciesInstalled: false,
	}),
);
