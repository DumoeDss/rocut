import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Immutable private producer snapshot. This never builds, swaps, removes or
 * writes a shared dependency. A manifest is published only after all copies
 * and the still-current input identities have been verified. */
export function snapshotNativeSource({
	root,
	destination,
	selectionSnapshot,
	additionalPaths = [],
}) {
	assert.ok(isAbsolute(root) && isAbsolute(destination));
	root = resolve(root);
	destination = resolve(destination);
	const within = relative(root, destination);
	assert.ok(
		within &&
			(within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)),
		"Private destination must be outside the worktree",
	);
	assert.ok(!existsSync(destination), "Snapshot destination already exists");
	function ordinaryAncestors(directory) {
		for (let current = directory; ; current = dirname(current)) {
			const stat = lstatSync(current);
			assert.ok(
				stat.isDirectory() && !stat.isSymbolicLink(),
				"Snapshot directory redirects",
			);
			if (dirname(current) === current) break;
		}
	}
	ordinaryAncestors(root);
	ordinaryAncestors(dirname(destination));
	const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
	function readOrdinary(file) {
		ordinaryAncestors(dirname(file));
		const stat = lstatSync(file);
		assert.ok(
			stat.isFile() && !stat.isSymbolicLink(),
			"Snapshot source must be an ordinary file",
		);
		return readFileSync(file);
	}
	let selection;
	let selectedNames;
	assert.ok(Array.isArray(additionalPaths));
	assert.ok(
		selectionSnapshot !== undefined || additionalPaths.length === 0,
		"Additional paths require a verified selection snapshot",
	);
	if (selectionSnapshot !== undefined) {
		assert.ok(isAbsolute(selectionSnapshot));
		selectionSnapshot = resolve(selectionSnapshot);
		ordinaryAncestors(selectionSnapshot);
		const manifestBytes = readOrdinary(
			join(selectionSnapshot, "source-manifest.json"),
		);
		const previous = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
		);
		assert.equal(
			resolve(previous.sourceRoot),
			root,
			"Selection belongs to another workspace",
		);
		assert.equal(resolve(previous.source), selectionSnapshot);
		assert.ok(Array.isArray(previous.entries) && previous.entries.length > 0);
		const seen = new Set();
		selectedNames = previous.entries.map((entry) => {
			assert.ok(
				typeof entry.path === "string" &&
					!isAbsolute(entry.path) &&
					!entry.path.split(/[\\/]/).includes("..") &&
					!seen.has(entry.path),
			);
			seen.add(entry.path);
			assert.equal(
				hash(readOrdinary(join(selectionSnapshot, entry.path))),
				entry.sha256,
				"Selection snapshot bytes changed",
			);
			return entry.path;
		});
		for (const required of ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"])
			assert.ok(seen.has(required), "Incomplete selection manifest");
		for (const path of additionalPaths) {
			assert.ok(
				typeof path === "string" &&
					/^rust\/[A-Za-z0-9_./-]+\.(rs|wgsl|toml)$/.test(path) &&
					!path
						.split("/")
						.some((part) => part === ".." || part === "." || !part) &&
					!seen.has(path),
				"Additional path must be a unique relative Rust compilation input",
			);
			seen.add(path);
			selectedNames.push(path);
		}
		selection = {
			directory: selectionSnapshot,
			manifestSha256: hash(manifestBytes),
			additionalPaths: [...additionalPaths],
		};
	}
	const names = (
		selectedNames ?? [
			...new Set([
				"Cargo.toml",
				"Cargo.lock",
				"rust-toolchain.toml",
				...execFileSync(
					"rg",
					[
						"--files",
						"rust",
						"apps/desktop",
						"-g",
						"!**/target/**",
						"-g",
						"!**/node_modules/**",
						"-g",
						"!rust/wasm/pkg/**",
					],
					{ cwd: root, encoding: "utf8", windowsHide: true },
				)
					.trim()
					.split(/\r?\n/)
					.map((name) => name.replaceAll("\\", "/")),
			]),
		]
	).sort();
	const entries = names.map((path) => {
		assert.ok(path && !isAbsolute(path) && !path.split("/").includes(".."));
		const original = join(root, path),
			bytes = readOrdinary(original);
		if (/\.(rs|toml|lock)$/.test(path))
			new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return { path, origin: root, sha256: hash(bytes) };
	});
	assert.ok(
		entries.some(({ path }) => path.endsWith("mv_recipe/tunnel.rs")),
		"Missing Tunnel producer",
	);
	for (const entry of entries) {
		const original = join(root, entry.path),
			copy = join(destination, entry.path);
		mkdirSync(dirname(copy), { recursive: true });
		copyFileSync(original, copy);
		assert.equal(
			hash(readOrdinary(copy)),
			entry.sha256,
			"Snapshot copy mismatch",
		);
	}
	for (const entry of entries)
		assert.equal(
			hash(readOrdinary(join(root, entry.path))),
			entry.sha256,
			"Source changed while snapshotting",
		);
	const manifest = {
		version: 1,
		source: destination,
		sourceRoot: root,
		scope: selection
			? "Recaptured current bytes of verified prior snapshot paths plus explicitly declared additional compilation inputs; other newly created files are intentionally excluded, and a newly registered uncaptured module must fail the isolated build; not a whole-current-worktree checkpoint"
			: "Enumerated current Rust workspace and desktop member sources; not the complete frontend, installation or a claim that every copied module is registered",
		...(selection ? { selectionSnapshot: selection } : {}),
		entries,
	};
	const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
	writeFileSync(join(destination, "source-manifest.json"), bytes, {
		flag: "wx",
	});
	return {
		source: destination,
		files: entries.length,
		sourceManifestSha256: hash(bytes),
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	assert.ok(
		process.argv.length >= 3,
		"Supply an absolute fresh private directory, optional verified prior snapshot selection and optional additional relative compilation inputs",
	);
	console.log(
		JSON.stringify(
			snapshotNativeSource({
				root: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
				destination: process.argv[2],
				selectionSnapshot: process.argv[3],
				additionalPaths: process.argv.slice(4),
			}),
		),
	);
}
