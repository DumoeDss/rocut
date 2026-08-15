#!/usr/bin/env node
/**
 * The from-tarballs consumer-view proof (S05 P5, design E6, task 5.1).
 *
 * NOT a repo checker — one-shot evidence tooling for this change. It imports
 * `packSdkTarballs` from `script/pack-sdk-tarballs.mjs` (the P3 module; never
 * re-implements packing), packs the SDK tarballs, and verifies everything a
 * consumer sees from the PACKED artifacts, not the workspace:
 *
 *   1. every tarball's manifest version is `0.x`;
 *   2. each ships README.md containing the compatibility-policy statement
 *      (matched on a string only the new READMEs print);
 *   3. each ships surface.json classifying EXACTLY its export-map entries
 *      (set equality both directions + per-class census, reconciled against
 *      the checker's census);
 *   4. non-frozen entries' `@opencutSurface` markers are present in the
 *      EXTRACTED tarball source (tar extraction uses a relative tarball path
 *      from inside the extract dir — GNU tar on Windows reads an absolute
 *      path as `host:path`), and no frozen entry's file carries one. A
 *      declared target absent from the tarball is a dangling export entry:
 *      FAIL for non-frozen classes, a reported finding for frozen.
 *
 * Exit 0 only if every clause holds (findings are reported loudly but do not
 * fail the labeling proof — repairing or removing a declared entry is contract
 * adjudication); every step self-logs. Run from the repo
 * root:
 *   node rasen/changes/s05-versioning-and-experimental-labeling/evidence/consumer-view-from-tarballs.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
// pathToFileURL: a Windows absolute path is not a valid ESM specifier by itself.
const { packSdkTarballs } = await import(pathToFileURL(join(REPO_ROOT, "script", "pack-sdk-tarballs.mjs")).href);

const POLICY_ANCHOR = "Compatibility policy (`0.x`)"; // printed only by the new READMEs
const MECHANICAL = "./package.json";
const MARKER_RE = /@opencutSurface\s+(frozen|provider|experimental)\b/g;

const lines = [];
const log = (line) => {
	lines.push(line);
	console.log(line);
};
let failures = 0;
let dangling = 0;
const check = (ok, label) => {
	if (!ok) failures += 1;
	log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
};

const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
log(`consumer-view-from-tarballs: packing at ${head} (reads the tarballs, never the workspace)`);
const manifest = packSdkTarballs({ log: (line) => log(`  [pack] ${line}`) });
const outDir = resolve(REPO_ROOT, dirname(manifest.packages[0].tarballPath));
const viewRoot = join(outDir, ".consumer-view");
rmSync(viewRoot, { recursive: true, force: true });

for (const entry of manifest.packages.filter((p) => p.name.startsWith("@opencut/"))) {
	log(`\n=== ${entry.name}@${entry.version} (${entry.tarball}) ===`);

	// Extract the tarball (relative path from inside the extract dir).
	const extractDir = join(viewRoot, basename(entry.tarball, ".tgz"));
	mkdirSync(extractDir, { recursive: true });
	const relTarball = relative(extractDir, join(outDir, entry.tarball)).replaceAll("\\", "/");
	execFileSync("tar", ["-xf", relTarball], { cwd: extractDir });
	const pkgDir = join(extractDir, "package");
	const read = (name) => readFileSync(join(pkgDir, name), "utf8");

	// (1) version is 0.x — from the packed manifest, not the workspace.
	const packedManifest = JSON.parse(read("package.json"));
	check(/^0\.\d+\.\d+$/.test(packedManifest.version), `packed manifest version is 0.x (found ${packedManifest.version})`);

	// (2) README ships and carries the policy statement.
	check(entry.files.some((f) => f.path === "README.md"), "packed inventory lists README.md");
	const readme = (() => {
		try {
			return read("README.md");
		} catch {
			return "";
		}
	})();
	check(readme.includes(POLICY_ANCHOR), `README contains the policy statement ("${POLICY_ANCHOR}")`);

	// (3) surface.json ships and classifies EXACTLY the export-map entries.
	check(entry.files.some((f) => f.path === "surface.json"), "packed inventory lists surface.json");
	const surface = JSON.parse(read("surface.json"));
	const declared = Object.keys(packedManifest.exports).filter((e) => e !== MECHANICAL).sort();
	const classified = Object.keys(surface.entries).sort();
	check(
		declared.length === classified.length && declared.every((e, i) => e === classified[i]),
		`surface.json classifies exactly the export-map entries (${declared.length} declared = ${classified.length} classified, set-equal)`,
	);
	const byClass = { frozen: 0, provider: 0, experimental: 0 };
	for (const e of classified) byClass[surface.entries[e].class] += 1;
	log(`  census  ${entry.name}: frozen ${byClass.frozen}, provider ${byClass.provider}, experimental ${byClass.experimental}`);

	// (4) markers in the EXTRACTED source: present and matching for non-frozen
	// entries, absent for frozen entries. A declared target absent from the
	// tarball is a dangling export entry and FAILS at any class, mirroring the
	// labels checker's target-existence rule (LEAD ruling 2026-08-15, executed on
	// the finding this oracle caught: @opencut/editor-contracts ./vectors/drivers,
	// declared by S05 P0 in 5e3fc7cb, target never authored — removed).
	let markersChecked = 0;
	for (const e of classified) {
		const target = packedManifest.exports[e];
		if (typeof target !== "string") continue;
		const cls = surface.entries[e].class;
		let text;
		try {
			text = read(target.replace(/^\.\//, ""));
		} catch {
			dangling += 1;
			check(false, `${cls} entry ${e} target ${target} absent from tarball — dangling export entry, module-not-found for every consumer (fails target-existence; LEAD ruling 2026-08-15)`);
			continue;
		}
		const found = [...text.matchAll(MARKER_RE)].map((m) => m[1]);
		if (cls === "frozen") {
			check(found.length === 0, `frozen entry ${e} carries no marker in extracted source${found.length ? ` (found ${found.join(",")})` : ""}`);
		} else {
			markersChecked += 1;
			check(found.includes(cls), `${cls} entry ${e} carries @opencutSurface ${cls} in extracted source`);
		}
	}
	log(`  markers verified in extracted source: ${markersChecked} non-frozen entries`);
}

rmSync(viewRoot, { recursive: true, force: true });
log(`\nconsumer-view-from-tarballs: ${failures} failure(s), dangling-export-entries ${dangling} — a declared-but-absent entry fails target-existence at any class (LEAD ruling 2026-08-15; the one such entry, ./vectors/drivers, was removed under that ruling)`);
log(`REAL_EXIT_CODE[consumer-view]:${failures > 0 ? 1 : 0}`);
process.exit(failures > 0 ? 1 : 0);
