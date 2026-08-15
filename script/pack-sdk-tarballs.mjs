#!/usr/bin/env node
/**
 * The SDK tarball pack module (S05 P3, design E1).
 *
 * Packs the three distributable packages with `npm pack` — the real
 * distribution path, byte for byte: no extract-fix-repack, ever (E3's ruling)
 * — and writes a committed **tarball manifest** into the change's evidence
 * directory: names, versions, npm shasum/integrity per tarball, and a
 * per-file SHA-256 inventory. A determinism control packs every tarball twice
 * from the same tree and records that the digests reproduce.
 *
 * This is the module P6 imports for its CI leg — the exported API
 * (`SDK_PACKAGES`, `packSdkTarballs`) is the deliverable, named in
 * BOUNDARIES.md §13. The CLI entry below is the same API driven end-to-end:
 *
 *   node script/pack-sdk-tarballs.mjs [--no-determinism] [--out <dir>]
 *                                     [--manifest <path>]
 *
 * Every spawned tool's exit status is self-logged as `REAL_EXIT_CODE[<step>]`.
 * Tarballs land in a gitignored build dir (`dist-sdk-tarballs/` by default)
 * and are never committed; the manifest is the committed record.
 */
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, "..");

/** The three distributable packages, in dependency-layer order. */
export const SDK_PACKAGES = [
	"packages/editor-ports",
	"packages/editor-contracts",
	"packages/editor-classic",
];

export const DEFAULT_OUT_DIR_NAME = "dist-sdk-tarballs";
export const DEFAULT_MANIFEST_PATH = join(
	DEFAULT_REPO_ROOT,
	"rasen/changes/s05-conformance-for-third-parties/evidence/tarball-manifest.json",
);

const IS_WINDOWS = process.platform === "win32";

/** Log through the caller's sink, or stdout when used as a plain module. */
function logVia(sink) {
	return (line) => (sink ? sink(line) : console.log(line));
}

function runTool(step, command, args, options = {}) {
	// A single command string when a shell is involved: passing an args array
	// with shell:true trips DEP0190 and the paths here contain no spaces.
	const invocation = IS_WINDOWS ? [`${command} ${args.join(" ")}`, []] : [command, args];
	const result = spawnSync(invocation[0], invocation[1], {
		shell: IS_WINDOWS,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		...options,
	});
	const code = result.status;
	const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
	if (code !== 0) {
		throw new Error(
			`${step} failed with exit code ${code}:\n${output.slice(0, 4000)}`,
		);
	}
	return output;
}

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function npmShasumOf(path) {
	return createHash("sha1").update(readFileSync(path)).digest("hex");
}

function npmIntegrityOf(path) {
	const digest = createHash("sha512").update(readFileSync(path)).digest("base64");
	return `sha512-${digest}`;
}

/** Walk a directory, returning every regular file as [relativePath, absolutePath]. */
function walkFiles(dir, prefix = "") {
	const entries = [];
	for (const name of readdirSync(dir).sort()) {
		const abs = join(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		if (statSync(abs).isDirectory()) {
			entries.push(...walkFiles(abs, rel));
		} else {
			entries.push([rel, abs]);
		}
	}
	return entries;
}

/**
 * Pack one package with `npm pack` into `outDir`, returning the produced
 * tarball's absolute path. `--json` keeps the filename out of npm's notice
 * chatter: the pack result is a JSON array on stdout.
 */
function packOne({ repoRoot, packageDir, outDir, log }) {
	mkdirSync(outDir, { recursive: true });
	const output = runTool(
		`npm pack ${packageDir}`,
		IS_WINDOWS ? "npm.cmd" : "npm",
		["pack", "--json", "--pack-destination", outDir],
		{ cwd: join(repoRoot, packageDir) },
	);
	const start = output.indexOf("[");
	const end = output.lastIndexOf("]");
	if (start < 0 || end <= start) {
		throw new Error(
			`npm pack for ${packageDir} printed no JSON result — output:\n${output.slice(0, 4000)}`,
		);
	}
	const packed = JSON.parse(output.slice(start, end + 1));
	if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename) {
		throw new Error(
			`npm pack for ${packageDir} returned an unexpected result:\n${output.slice(0, 4000)}`,
		);
	}
	const tarball = join(outDir, packed[0].filename);
	if (!existsSync(tarball)) {
		throw new Error(`npm pack reported ${tarball} but the file does not exist`);
	}
	log(`packed ${packageDir} -> ${packed[0].filename}`);
	return tarball;
}

/**
 * Per-file SHA-256 inventory of a tarball: extract with the system tar into a
 * scratch directory next to the tarball (never %TEMP% — plain file extraction
 * on the same drive), hash every extracted file, remove the scratch dir.
 */
function inventoryTarball({ tarball, log }) {
	const extractDir = `${tarball}.inventory`;
	rmSync(extractDir, { recursive: true, force: true });
	mkdirSync(extractDir, { recursive: true });
	try {
		// Relative tarball path on purpose: GNU tar reads an absolute Windows
		// path as a `host:path` remote spec and tries to resolve the drive
		// letter as a hostname ("Cannot connect to E:").
		runTool(
			`tar -xf ../${basename(tarball)}`,
			"tar",
			["-xf", `../${basename(tarball)}`],
			{ cwd: extractDir },
		);
		const files = walkFiles(join(extractDir, "package")).map(([rel, abs]) => ({
			path: rel,
			sha256: sha256File(abs),
			sizeBytes: statSync(abs).size,
		}));
		if (files.length === 0) {
			throw new Error(`tarball ${tarball} extracted to zero files`);
		}
		log(`inventory: ${basename(tarball)} — ${files.length} file(s) hashed`);
		return files;
	} finally {
		rmSync(extractDir, { recursive: true, force: true });
	}
}

/**
 * Pack the SDK packages and (optionally) run the determinism control.
 *
 * Returns the manifest object — the same structure written to the evidence
 * directory by the CLI — without writing the manifest file, so P6 can embed
 * the pack step in its own pipeline.
 *
 * args:
 * - repoRoot (default: this repo)
 * - outDir (default: <repoRoot>/dist-sdk-tarballs)
 * - packages (default: SDK_PACKAGES)
 * - determinism (default: true) — pack every tarball a second time into a
 *   scratch dir and record whether the sha256 digests reproduce
 * - log (default: console.log) — a line sink for progress output
 */
export function packSdkTarballs(args = {}) {
	const repoRoot = resolve(args.repoRoot ?? DEFAULT_REPO_ROOT);
	const outDir = resolve(args.outDir ?? join(repoRoot, DEFAULT_OUT_DIR_NAME));
	const packages = args.packages ?? SDK_PACKAGES;
	const determinism = args.determinism ?? true;
	const log = logVia(args.log);

	const head = runTool("git rev-parse HEAD", "git", ["rev-parse", "HEAD"], {
		cwd: repoRoot,
	}).trim();

	const manifest = {
		generatedAt: new Date().toISOString(),
		repoHead: head,
		packTool: "npm pack (node " + process.version + ")",
		packages: [],
		determinism: { exercised: determinism, reproduced: null, tarballs: [] },
	};

	for (const packageDir of packages) {
		const manifestJson = JSON.parse(
			readFileSync(join(repoRoot, packageDir, "package.json"), "utf8"),
		);
		const tarball = packOne({ repoRoot, packageDir, outDir, log });
		const files = inventoryTarball({ tarball, log });
		manifest.packages.push({
			name: manifestJson.name,
			dir: packageDir,
			version: manifestJson.version,
			tarball: basename(tarball),
			tarballPath: tarball,
			sizeBytes: statSync(tarball).size,
			npmShasum: npmShasumOf(tarball),
			integrity: npmIntegrityOf(tarball),
			fileCount: files.length,
			files,
		});
	}

	if (determinism) {
		const secondDir = join(outDir, ".determinism-second");
		rmSync(secondDir, { recursive: true, force: true });
		let reproduced = true;
		try {
			manifest.packages.forEach((entry) => {
				const second = packOne({
					repoRoot,
					packageDir: entry.dir,
					outDir: secondDir,
					log,
				});
				const firstSha = sha256File(entry.tarballPath);
				const secondSha = sha256File(second);
				const same = firstSha === secondSha;
				if (!same) reproduced = false;
				manifest.determinism.tarballs.push({
					tarball: entry.tarball,
					sha256First: firstSha,
					sha256Second: secondSha,
					reproduced: same,
				});
				log(
					`determinism: ${entry.tarball} ${same ? "reproduced" : "DIVERGED"} (${firstSha.slice(0, 12)}…)`,
				);
			});
		} finally {
			rmSync(secondDir, { recursive: true, force: true });
		}
		manifest.determinism.reproduced = reproduced;
	}

	// The manifest is committed evidence: record repo-relative tarball paths so
	// the same file is meaningful outside this machine.
	for (const entry of manifest.packages) {
		entry.tarballPath = relative(repoRoot, entry.tarballPath).replace(/\\/g, "/");
	}
	return manifest;
}

/** CLI: pack, run the determinism control, write the committed manifest. */
function main() {
	const argv = process.argv.slice(2);
	const outArg = argv.indexOf("--out");
	const manifestArg = argv.indexOf("--manifest");
	const outDir = outArg >= 0 ? resolve(argv[outArg + 1]) : undefined;
	const manifestPath = resolve(
		manifestArg >= 0 ? argv[manifestArg + 1] : DEFAULT_MANIFEST_PATH,
	);
	const determinism = !argv.includes("--no-determinism");

	console.log("pack-sdk-tarballs: packing the SDK packages (design E1)");
	let manifest;
	try {
		manifest = packSdkTarballs({ outDir, determinism });
	} catch (error) {
		console.error(String(error));
		console.log("REAL_EXIT_CODE[pack]:1");
		process.exit(1);
	}

	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`manifest written: ${manifestPath}`);

	for (const entry of manifest.packages) {
		console.log(
			`  ${entry.name}@${entry.version} — ${entry.fileCount} file(s), ` +
				`shasum ${entry.npmShasum}`,
		);
	}
	if (manifest.determinism.exercised) {
		console.log(
			`determinism control: ${manifest.determinism.reproduced ? "reproduced" : "DIVERGED"} ` +
				`(${manifest.determinism.tarballs.length} tarball(s) packed twice)`,
		);
		if (!manifest.determinism.reproduced) {
			console.log("REAL_EXIT_CODE[pack]:1");
			process.exit(1);
		}
	}
	console.log("REAL_EXIT_CODE[pack]:0");
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	main();
}
