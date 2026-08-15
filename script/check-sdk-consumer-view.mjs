#!/usr/bin/env node
/**
 * The from-tarballs consumer-view gate (S05 P5 design E6 authored it as
 * one-shot evidence; S05 P6 task 2.2 promotes it to committed standing
 * tooling — the only gate that reads the PACKED artifacts, not the workspace).
 *
 * Verifies everything a consumer sees from the tarballs:
 *
 *   1. every tarball's manifest version is `0.x`;
 *   2. each ships README.md containing the compatibility-policy statement
 *      (matched on a string only the policy READMEs print);
 *   3. each ships surface.json classifying EXACTLY its export-map entries
 *      (set equality both directions + per-class census);
 *   4. non-frozen entries' `@opencutSurface` markers are present in the
 *      EXTRACTED tarball source, and no frozen entry's file carries one.
 *      A declared target absent from the tarball is a dangling export entry
 *      and FAILS at any class (LEAD ruling 2026-08-15 — the labels checker's
 *      target-existence rule, mirrored here; the one such entry,
 *      ./vectors/drivers, was removed under that ruling).
 *
 * This is the standing form: `script/run-published-examples.mjs` executes it
 * every run (and CI therefore every push), and its own CLI is the cheap daily
 * gate — pack (or consume `OPENCUT_PREPACKED_DIR`) and verify, nothing else.
 * The P5 original stays in the archive as the historical record.
 *
 * CLI:
 *   node script/check-sdk-consumer-view.mjs
 * Env:
 *   OPENCUT_PREPACKED_DIR    verify these pre-packed tarballs instead of packing
 *   OPENCUT_TARBALL_OUT_DIR  where packing writes tarballs (default: the
 *                            gitignored <repo>/dist-sdk-tarballs)
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	readdirSync as listDir,
	rmSync,
	statSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_OUT_DIR_NAME, DEFAULT_REPO_ROOT, packSdkTarballs, SDK_PACKAGES } from "./pack-sdk-tarballs.mjs";

const POLICY_ANCHOR = "Compatibility policy (`0.x`)"; // printed only by the policy READMEs
const MECHANICAL = "./package.json";
const MARKER_RE = /@opencutSurface\s+(frozen|provider|experimental)\b/g;
const IS_WINDOWS = process.platform === "win32";

/** Walk a directory, returning every regular file's path relative to it. */
function walkRelative(dir, prefix = "") {
	const entries = [];
	for (const name of readdirSync(dir).sort()) {
		const abs = join(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		if (statSync(abs).isDirectory()) {
			entries.push(...walkRelative(abs, rel));
		} else {
			entries.push(rel);
		}
	}
	return entries;
}

function runTool(step, command, args, options = {}) {
	// A single command string when a shell is involved: an args array with
	// shell:true trips DEP0190 and the paths here contain no spaces.
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
		throw new Error(`${step} failed with exit code ${code}:\n${output.slice(0, 4000)}`);
	}
	return output;
}

/**
 * Resolve the tarballs to verify. Returns { tarballsDir, files } where files
 * is the sorted list of .tgz basenames. Packing (when needed) goes through
 * `packSdkTarballs` — the P3 module, never re-implemented here.
 */
function resolveTarballs({ repoRoot, log }) {
	const prepacked = process.env.OPENCUT_PREPACKED_DIR;
	if (prepacked) {
		const dir = resolve(prepacked);
		const files = listDir(dir)
			.filter((name) => name.endsWith(".tgz"))
			.sort();
		if (files.length === 0) {
			throw new Error(`OPENCUT_PREPACKED_DIR=${dir} contains no .tgz files`);
		}
		log(`consumer-view: verifying pre-packed tarballs from ${dir} (${files.length} file(s))`);
		return { tarballsDir: dir, files };
	}
	const outDir = resolve(
		process.env.OPENCUT_TARBALL_OUT_DIR ?? join(repoRoot, DEFAULT_OUT_DIR_NAME),
	);
	const manifest = packSdkTarballs({ repoRoot, outDir, determinism: false });
	const files = manifest.packages.map((entry) => basename(entry.tarball));
	log(`consumer-view: packed fresh tarballs into ${outDir} (${files.length} file(s))`);
	return { tarballsDir: outDir, files };
}

/**
 * Run the four clauses over every @opencut tarball in `tarballsDir`. Returns
 * { failures, dangling, packages } — packages carries each verified
 * package's name/version and per-class census for the caller's log. Throws
 * only on tool failure (tar, unreadable archives); clause failures are
 * counted, never thrown, so the caller decides the exit shape.
 */
export function runConsumerView(args = {}) {
	const repoRoot = resolve(args.repoRoot ?? DEFAULT_REPO_ROOT);
	const log = args.log ?? ((line) => console.log(line));
	const { tarballsDir, files } = resolveTarballs({ repoRoot, log });

	let failures = 0;
	let dangling = 0;
	const check = (ok, label) => {
		if (!ok) failures += 1;
		log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
	};

	// Extraction happens beside the tarballs (never %TEMP% — the measured AV
	// hazard; dist-sdk-tarballs is gitignored and on the repo's drive), under
	// a dot-dir the run wipes first. Relative tarball paths on purpose: GNU
	// tar on Windows reads an absolute path as a `host:path` remote spec.
	const viewRoot = join(tarballsDir, ".consumer-view");
	rmSync(viewRoot, { recursive: true, force: true });
	const packages = [];

	for (const file of files) {
		const extractDir = join(viewRoot, basename(file, ".tgz"));
		mkdirSync(extractDir, { recursive: true });
		const relTarball = relative(extractDir, join(tarballsDir, file)).replaceAll("\\", "/");
		runTool(`tar -xf ${file}`, "tar", ["-xf", relTarball], { cwd: extractDir });
		const pkgDir = join(extractDir, "package");
		const read = (name) => readFileSync(join(pkgDir, name), "utf8");
		const inventory = new Set(walkRelative(pkgDir));

		const packedManifest = JSON.parse(read("package.json"));
		// The flat wasm artifact has no exports/surface to classify — only the
		// three @opencut packages carry a labeled surface.
		if (!packedManifest.name?.startsWith("@opencut/")) {
			log(`consumer-view: ${file} — flat artifact (${packedManifest.name ?? "unnamed"}), no surface clauses`);
			continue;
		}

		log(`\n=== ${packedManifest.name}@${packedManifest.version} (${file}) ===`);

		// (1) version is 0.x — from the packed manifest, not the workspace.
		check(
			/^0\.\d+\.\d+$/.test(packedManifest.version),
			`packed manifest version is 0.x (found ${packedManifest.version})`,
		);

		// (2) README ships and carries the policy statement.
		check(inventory.has("README.md"), "packed inventory lists README.md");
		const readme = inventory.has("README.md") ? read("README.md") : "";
		check(readme.includes(POLICY_ANCHOR), `README contains the policy statement ("${POLICY_ANCHOR}")`);

		// (3) surface.json ships and classifies EXACTLY the export-map entries.
		check(inventory.has("surface.json"), "packed inventory lists surface.json");
		const surface = inventory.has("surface.json") ? JSON.parse(read("surface.json")) : { entries: {} };
		const declared = Object.keys(packedManifest.exports ?? {}).filter((e) => e !== MECHANICAL).sort();
		const classified = Object.keys(surface.entries ?? {}).sort();
		check(
			declared.length === classified.length && declared.every((e, i) => e === classified[i]),
			`surface.json classifies exactly the export-map entries (${declared.length} declared = ${classified.length} classified, set-equal)`,
		);
		const byClass = { frozen: 0, provider: 0, experimental: 0 };
		for (const e of classified) byClass[surface.entries[e].class] += 1;
		log(`  census  ${packedManifest.name}: frozen ${byClass.frozen}, provider ${byClass.provider}, experimental ${byClass.experimental}`);

		// (4) markers in the EXTRACTED source: present and matching for
		// non-frozen entries, absent for frozen entries. A declared target
		// absent from the tarball is a dangling export entry and FAILS at any
		// class (LEAD ruling 2026-08-15).
		let markersChecked = 0;
		for (const e of classified) {
			const target = packedManifest.exports[e];
			if (typeof target !== "string") continue;
			const cls = surface.entries[e].class;
			const targetPath = target.replace(/^\.\//, "");
			let text;
			if (!inventory.has(targetPath)) {
				dangling += 1;
				check(
					false,
					`${cls} entry ${e} target ${target} absent from tarball — dangling export entry, module-not-found for every consumer (fails target-existence at any class; LEAD ruling 2026-08-15)`,
				);
				continue;
			}
			text = read(targetPath);
			const found = [...text.matchAll(MARKER_RE)].map((m) => m[1]);
			if (cls === "frozen") {
				check(
					found.length === 0,
					`frozen entry ${e} carries no marker in extracted source${found.length ? ` (found ${found.join(",")})` : ""}`,
				);
			} else {
				markersChecked += 1;
				check(found.includes(cls), `${cls} entry ${e} carries @opencutSurface ${cls} in extracted source`);
			}
		}
		log(`  markers verified in extracted source: ${markersChecked} non-frozen entries`);

		packages.push({
			name: packedManifest.name,
			version: packedManifest.version,
			tarball: file,
			...byClass,
		});
	}

	rmSync(viewRoot, { recursive: true, force: true });
	return { failures, dangling, packages };
}

/** CLI: the cheap daily gate — pack (or consume pre-packed tarballs) and verify. */
function main() {
	const head = runTool("git rev-parse HEAD", "git", ["rev-parse", "--short", "HEAD"], {
		cwd: DEFAULT_REPO_ROOT,
	}).trim();
	console.log(`check-sdk-consumer-view: verifying at ${head} (reads the tarballs, never the workspace)`);
	let result;
	try {
		result = runConsumerView({ log: (line) => console.log(line) });
	} catch (error) {
		console.error(String(error));
		console.log("REAL_EXIT_CODE[consumer-view]:1");
		process.exit(1);
	}
	console.log(
		`\nconsumer-view: ${result.failures} failure(s), dangling-export-entries ${result.dangling} — a declared-but-absent entry fails target-existence at any class (LEAD ruling 2026-08-15)`,
	);
	console.log(`REAL_EXIT_CODE[consumer-view]:${result.failures > 0 ? 1 : 0}`);
	process.exit(result.failures > 0 ? 1 : 0);
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	main();
}
