#!/usr/bin/env node
/**
 * The packed-manifest dependency-closure gate (S05 P7 design E3) — the static
 * checker family's 30th. Like its 29th sibling it reads the PACKED artifacts,
 * never the workspace: what a consumer installs is decided by the tarball's
 * manifest and the source it ships, so the closure claim is proven there.
 *
 * Two levels:
 *
 *   1. Bare-specifier closure (manifest truth). Every bare specifier the
 *      shipped source imports must be declared in the packed manifest's
 *      dependencies/peerDependencies/optionalDependencies, be a Node builtin,
 *      or carry a written disposition. The known residuals `bun:test` and
 *      `@napi-rs/canvas` are test-file-only and dispositioned below — a
 *      disposition licenses the specifier in test files ONLY, so the same
 *      import appearing in runtime code still fails.
 *
 *   2. Peer reachability (the documented-latent register). For every peer P
 *      of a declared dependency D — excluding peers the package itself
 *      declares, which consumers install anyway, and peers no runtime file of
 *      D ever imports, which cannot activate — the checker derives whether
 *      any file REACHABLE from the package's export-map entries imports a
 *      subpath of D whose transitive closure needs P. Latent-only peers must
 *      appear in the register below with their reachability reason; the
 *      register is RE-DERIVED every run, never trusted:
 *        - a registered peer that becomes reachable FAILS naming the row;
 *        - a latent peer with no row FAILS (unregistered latent peer);
 *        - a peer needed by a reachable closure FAILS (manifest truth: it
 *          belongs in the package's own dependencies — P6's F-P6-7);
 *        - a row whose premise died FAILS (stale row).
 *
 * The dependency-side graph is read from the repository's node_modules (the
 * locked resolutions the tarball manifests range over) — stated here because
 * that is the one input that is workspace, not tarball.
 *
 * CLI:
 *   node script/check-packed-manifest-closure.mjs
 *   node script/check-packed-manifest-closure.mjs --negative-control
 *   node script/check-packed-manifest-closure.mjs --converse-control
 * Env:
 *   OPENCUT_PREPACKED_DIR    verify these pre-packed tarballs instead of packing
 *   OPENCUT_TARBALL_OUT_DIR  where packing writes tarballs (default: the
 *                            gitignored <repo>/dist-sdk-tarballs)
 *   OPENCUT_SCRATCH_ROOT     control scratch root (default: a dot-dir under
 *                            the user profile; CONTROL-1c discipline applies)
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	DEFAULT_OUT_DIR_NAME,
	DEFAULT_REPO_ROOT,
	packSdkTarballs,
} from "./pack-sdk-tarballs.mjs";

const IS_WINDOWS = process.platform === "win32";

/** Test files: under __tests__/, or *.test.* / *.spec. * source files. */
const TEST_FILE_RE =
	/(?:^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/;

const NODE_BUILTINS = new Set([
	"assert", "async_hooks", "buffer", "child_process", "cluster", "console",
	"constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
	"events", "fs", "http", "http2", "https", "inspector", "module", "net",
	"os", "path", "perf_hooks", "process", "punycode", "querystring",
	"readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
	"tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

/**
 * Written dispositions for level-1 residuals (P6 round-1 probe, verbatim).
 * A disposition names the files it licenses — it is never a blanket allow.
 */
const SPECIFIER_DISPOSITIONS = [
	{
		specifier: "bun:test",
		where: "test-files",
		reason:
			"Bun's test-runner module, imported only by test files executed under `bun test`; never by shipped runtime code (P6 round-1 probe).",
	},
	{
		specifier: "@napi-rs/canvas",
		where: "test-files",
		reason:
			"Native canvas used only by Node-side asset tests (thumbnails, stickers, effect previews); runtime rendering goes through the Host's canvas (P6 round-1 probe).",
	},
];

/**
 * The documented-latent register (design E3; seeds verbatim from P6's
 * round-1 probe). Entries carry their reachability reason; the checker
 * re-derives latency every run and fails on any divergence, either way.
 */
const LATENT_PEER_REGISTER = [
	{
		dep: "zustand",
		peer: "use-sync-external-store",
		reason:
			"Imported at runtime only by zustand's traditional subpath (traditional.js / esm/traditional.mjs). classic's reachable graph imports zustand, zustand/vanilla and zustand/middleware only; the middleware barrel is a self-contained bundle (P6 round-1 probe, seeded verbatim).",
	},
	{
		dep: "zustand",
		peer: "immer",
		reason:
			"Imported at runtime only by zustand's immer middleware subpath (middleware/immer.js / esm/middleware/immer.mjs). classic imports zustand/middleware — the barrel, never the immer subpath (P6 round-1 probe, seeded verbatim).",
	},
];

const SCANNABLE_RE = /\.[cm]?(ts|tsx|js|jsx)$/;

function logVia(sink) {
	return (line) => (sink ? sink(line) : console.log(line));
}

function runTool(step, command, args, options = {}) {
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
 * Every import/require/dynamic-import specifier appearing in `text`. The
 * `from` clauses are LINE-ANCHORED on `import`/`export`/`}` so English prose
 * in comments and JSDoc (`transitions from 'hidden' to 'visible'`) never
 * reads as an import — the naive `\bfrom\s*["']…` shape matched exactly that.
 */
function extractSpecifiers(text) {
	const specs = [];
	const push = (s) => {
		if (s && !specs.includes(s)) specs.push(s);
	};
	for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:import|export)\s[^;\n]*?\bfrom\s*["']([^"'\n]+)["']/g)) push(m[1]);
	for (const m of text.matchAll(/(?:^|\n)[ \t]*\}[ \t]*from\s*["']([^"'\n]+)["']/g)) push(m[1]);
	for (const m of text.matchAll(/(?:^|\n)[ \t]*import\s*["']([^"'\n]+)["']/g)) push(m[1]);
	for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) push(m[1]);
	for (const m of text.matchAll(/\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) push(m[1]);
	return specs;
}

const isBare = (spec) => !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("#");
const isBuiltin = (spec) => spec.startsWith("node:") || NODE_BUILTINS.has(spec);

/**
 * The package name a bare specifier resolves against: `pkg`, `@scope/pkg`,
 * and any `pkg/sub…` / `@scope/pkg/sub…` all name the same dependency —
 * npm installs the root, so declaring the root covers the subpath.
 */
const packageNameOf = (spec) => {
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

/** Walk a directory, returning every regular file's path relative to it. */
function walkFiles(dir, prefix = "") {
	const entries = [];
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return entries;
	}
	for (const name of names.sort()) {
		if (name === "node_modules") continue; // nested dep trees are not this dep's own files
		const abs = join(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (st.isDirectory()) entries.push(...walkFiles(abs, rel));
		else entries.push([rel, abs]);
	}
	return entries;
}

/**
 * Resolve a relative specifier from `fromRel` against a set of known files,
 * trying the TS-then-JS extension ladder and index files. Returns the
 * resolved relative path or null.
 */
function resolveRelative(fromRel, spec, knownFiles) {
	const base = join(dirname(fromRel), spec).replaceAll("\\", "/");
	const candidates = [base];
	for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"]) {
		candidates.push(base + ext);
	}
	for (const c of candidates) if (knownFiles.has(c)) return c;
	// Directory-import forms: `base` itself, then its index files.
	if (knownFiles.has(base)) return base;
	for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
		const c = `${base}/index${ext}`;
		if (knownFiles.has(c)) return c;
	}
	return null;
}

/**
 * Walk a dependency's `exports` map for subpath `sub` ("." or "./x"),
 * preferring the import condition. Returns the target file (relative to the
 * dep root) with wildcards substituted, or null when unresolvable.
 */
function resolveDepExport(depManifest, sub) {
	const exports = depManifest.exports;
	if (exports === undefined) return null;
	if (typeof exports === "string") return sub === "." ? exports : null;
	let key = null;
	if (exports[sub] !== undefined) key = sub;
	else if (sub !== "." && exports["./*"] !== undefined) key = "./*";
	if (key === null) return null;
	const pattern = key === "./*";
	const walk = (node) => {
		if (typeof node === "string") return node;
		if (node && typeof node === "object") {
			for (const cond of ["import", "module-sync", "node", "default"]) {
				if (node[cond] !== undefined) {
					const r = walk(node[cond]);
					if (r !== null) return r;
				}
			}
		}
		return null;
	};
	let target = walk(exports[key]);
	if (target === null) return null;
	if (pattern) target = target.replace("*", sub.slice(2));
	return target;
}

/**
 * Run the closure scan over the resolved tarballs. Returns
 * { failures, refusals, packages } — clause failures are counted, never
 * thrown; tool failures and empty scans refuse (exit shape is the caller's).
 */
export function runClosure(args = {}) {
	const repoRoot = resolve(args.repoRoot ?? DEFAULT_REPO_ROOT);
	const log = logVia(args.log);
	const tarballsDir = args.tarballsDir;
	const files = args.tarballFiles;

	let failures = 0;
	let refusals = 0;
	const fail = (label) => {
		failures += 1;
		log(`  FAIL ${label}`);
	};

	// Extraction beside the tarballs under a dot-dir the run wipes first
	// (never %TEMP% — the measured AV hazard). Relative tarball paths on
	// purpose: GNU tar on Windows reads an absolute path as `host:path`.
	const viewRoot = join(tarballsDir, ".closure-view");
	rmSync(viewRoot, { recursive: true, force: true });
	const packages = [];
	// Register evidence aggregates ACROSS packages: a row belongs to whichever
	// package declares the dependency, so staleness is judged over the whole
	// set, not per tarball (a package that does not declare zustand has no
	// say over zustand's rows).
	const rowKey = (p) => `${p.dep}|${p.peer}`;
	const activatedWhere = new Map(); // rowKey -> [package names]
	const latentWhere = new Map();

	for (const file of files) {
		const extractDir = join(viewRoot, basename(file, ".tgz"));
		mkdirSync(extractDir, { recursive: true });
		const relTarball = relative(extractDir, join(tarballsDir, file)).replaceAll("\\", "/");
		runTool(`tar -xf ${file}`, "tar", ["-xf", relTarball], { cwd: extractDir });
		const pkgDir = join(extractDir, "package");
		const packedManifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

		log(`\n=== ${packedManifest.name}@${packedManifest.version} (${file}) ===`);

		// ---- the shipped file universe and the package-side import graph ----
		const allFiles = walkFiles(pkgDir).filter(([rel]) => SCANNABLE_RE.test(rel));
		const knownFiles = new Set(allFiles.map(([rel]) => rel));
		if (allFiles.length === 0) {
			log(`  REFUSE ${file} extracted to zero scannable files — an empty scan proves nothing`);
			refusals += 1;
			continue;
		}
		const importsOf = new Map(); // rel -> { all: [specs], bare: [specs] }
		for (const [rel, abs] of allFiles) {
			const specs = extractSpecifiers(readFileSync(abs, "utf8"));
			importsOf.set(rel, { all: specs, bare: specs.filter(isBare) });
		}
		const importOccurrences = [...importsOf.values()].reduce((n, v) => n + v.all.length, 0);
		if (importOccurrences === 0) {
			log(`  REFUSE ${file} shipped source contains zero import specifiers — an empty scan proves nothing`);
			refusals += 1;
			continue;
		}

		// Reachable set: BFS from the export-map entry targets through
		// relative (and `#`-alias) edges. Bare specifiers leave the package.
		// Packages without an `exports` map (the wasm artifact) root at
		// their `main`/`module` instead.
		const entryTargets = (
			packedManifest.exports
				? Object.entries(packedManifest.exports)
						.filter(([e]) => e !== "./package.json")
						.map(([, t]) => (typeof t === "string" ? t : null))
				: [packedManifest.main, packedManifest.module].filter(Boolean)
		)
			.filter((t) => t !== null)
			.map((t) => t.replace(/^\.\//, ""))
			.filter((t) => SCANNABLE_RE.test(t));
		const reachable = new Set();
		const queue = [...entryTargets];
		while (queue.length > 0) {
			const rel = queue.pop();
			if (reachable.has(rel) || !knownFiles.has(rel)) continue;
			reachable.add(rel);
			for (const spec of importsOf.get(rel).all) {
				if (spec.startsWith(".")) {
					const r = resolveRelative(rel, spec, knownFiles);
					if (r) queue.push(r);
				} else if (spec.startsWith("#")) {
					// Subpath-import aliases: `#x` maps through the manifest's
					// `imports` field; unresolvable ones fail level 1 below.
					const imports = packedManifest.imports ?? {};
					const target = imports[spec] ?? imports["#/*"];
					if (typeof target === "string") {
						const mapped = target
							.replace(/^\.\//, "")
							.replace("*", spec.slice(spec.indexOf("/") + 1));
						if (knownFiles.has(mapped)) queue.push(mapped);
					}
				}
			}
		}

		// ---- level 1: bare-specifier closure (all shipped source) ----
		const declared = new Set([
			...Object.keys(packedManifest.dependencies ?? {}),
			...Object.keys(packedManifest.peerDependencies ?? {}),
			...Object.keys(packedManifest.optionalDependencies ?? {}),
		]);
		const dispositionHits = new Map();
		for (const [rel, { bare }] of importsOf) {
			for (const spec of bare) {
				if (isBuiltin(spec)) continue;
				if (declared.has(spec) || declared.has(packageNameOf(spec))) continue;
				const disposition = SPECIFIER_DISPOSITIONS.find((d) => d.specifier === spec);
				if (disposition) {
					if (disposition.where === "test-files" && TEST_FILE_RE.test(rel)) {
						dispositionHits.set(spec, (dispositionHits.get(spec) ?? 0) + 1);
						continue;
					}
					fail(
						`level-1: ${rel} imports ${spec} — dispositioned test-files-only but this file is not a test file (manifest truth: declare it or keep it out of runtime code)`,
					);
					continue;
				}
				fail(`level-1: ${rel} imports undeclared bare specifier ${spec} (packed manifest declares ${declared.size} runtime names)`);
			}
		}

		// ---- level 2: peer reachability over declared deps ----
		let level2Subjects = 0;
		const latentPairs = [];
		const activatedPairs = [];
		for (const dep of declared) {
			if (isBuiltin(dep)) continue;
			const depDir = join(repoRoot, "node_modules", dep);
			const depManifestPath = join(depDir, "package.json");
			if (!existsSync(depManifestPath)) {
				fail(`level-2: declared dependency ${dep} is not installed under the repo's node_modules — cannot analyze its peers`);
				continue;
			}
			const depManifest = JSON.parse(readFileSync(depManifestPath, "utf8"));
			const peers = Object.keys(depManifest.peerDependencies ?? {});
			// Peers the package itself declares are consumer-installed by the
			// package's own manifest; peers no runtime file of the dep ever
			// imports (types-only peers like @types/react) cannot activate.
			const candidatePeers = peers.filter((p) => !declared.has(p));
			if (candidatePeers.length === 0) continue;

			const depFiles = walkFiles(depDir).filter(([rel]) => /\.(?:js|mjs|cjs)$/.test(rel));
			const depKnown = new Set(depFiles.map(([rel]) => rel));
			const depImports = new Map();
			for (const [rel, abs] of depFiles) {
				depImports.set(rel, extractSpecifiers(readFileSync(abs, "utf8")));
			}
			const runtimeImporters = new Map(); // peer package name -> [files]
			for (const [rel, specs] of depImports) {
				for (const s of specs) {
					if (isBare(s) && !isBuiltin(s)) {
						const name = packageNameOf(s);
						if (!runtimeImporters.has(name)) runtimeImporters.set(name, []);
						runtimeImporters.get(name).push(rel);
					}
				}
			}
			const subjects = candidatePeers.filter((p) => runtimeImporters.has(p));
			if (subjects.length === 0) continue;

			// Which subpaths of the dep does the package's reachable graph import?
			const depSpecs = new Set();
			for (const rel of reachable) {
				for (const s of importsOf.get(rel).bare) {
					if (s === dep || s.startsWith(`${dep}/`)) depSpecs.add(s);
				}
			}
			// Closure of bare imports from every dep file landed on.
			const activated = new Set();
			const seen = new Set();
			const landQueue = [];
			for (const spec of depSpecs) {
				const sub = spec === dep ? "." : `./${spec.slice(dep.length + 1)}`;
				let target = resolveDepExport(depManifest, sub);
				if (target === null) {
					target =
						sub === "."
							? depManifest.main ?? depManifest.module ?? "index.js"
							: `${sub.slice(1)}`;
				}
				const rel = target.replace(/^\.\//, "");
				if (depKnown.has(rel)) landQueue.push(rel);
				else fail(`level-2: reachable code imports ${spec}, which resolves to ${target} — absent from the installed ${dep}; cannot analyze`);
			}
			while (landQueue.length > 0) {
				const rel = landQueue.pop();
				if (seen.has(rel)) continue;
				seen.add(rel);
				for (const s of depImports.get(rel) ?? []) {
					if (isBare(s)) {
						if (!isBuiltin(s)) activated.add(packageNameOf(s));
					} else if (s.startsWith(".")) {
						const r = resolveRelative(rel, s, depKnown);
						if (r) landQueue.push(r);
					}
				}
			}
			for (const peer of subjects) {
				level2Subjects += 1;
				if (activated.has(peer)) {
					const k = `${dep}|${peer}`;
					if (!activatedWhere.has(k)) activatedWhere.set(k, []);
					activatedWhere.get(k).push(packedManifest.name);
					activatedPairs.push({ dep, peer });
				} else {
					const k = `${dep}|${peer}`;
					if (!latentWhere.has(k)) latentWhere.set(k, []);
					latentWhere.get(k).push(packedManifest.name);
					latentPairs.push({ dep, peer });
				}
			}
		}

		const uniqueBare = new Set([...importsOf.values()].flatMap((v) => v.bare));
		log(
			`  census  ${packedManifest.name}: files-scanned ${allFiles.length}, import-occurrences ${importOccurrences}, unique-bare ${uniqueBare.size}, declared ${declared.size}, entry-roots ${entryTargets.length}, reachable ${reachable.size}, level2-subjects ${level2Subjects}, latent ${latentPairs.length}, activated ${activatedPairs.length}`,
		);
		const hits = [...dispositionHits.entries()].map(([s, n]) => `${s}×${n}`).join(", ");
		log(`  census  dispositions honoured: ${hits || "none"} (register: ${LATENT_PEER_REGISTER.length} row(s))`);
		if (dispositionHits.size === 0 && SPECIFIER_DISPOSITIONS.length > 0) {
			log(`  note    no dispositioned specifier occurred in this package's shipped source`);
		}

		packages.push({
			name: packedManifest.name,
			version: packedManifest.version,
			tarball: file,
			filesScanned: allFiles.length,
			importOccurrences,
			uniqueBare: uniqueBare.size,
			declared: declared.size,
			level2Subjects,
			latent: latentPairs.length,
			activated: activatedPairs.length,
		});
	}

	// Register comparison — re-derived every run, both directions, judged
	// across the whole package set.
	for (const row of LATENT_PEER_REGISTER) {
		const k = `${row.dep}|${row.peer}`;
		if (activatedWhere.has(k)) {
			fail(`REGISTER ACTIVATION: row ${k} — the registered latent peer is now reachable from the shipped entries of ${activatedWhere.get(k).join(", ")}; declare it in that packed manifest (F-P6-7) and prune the row. Registered reason: ${row.reason}`);
		} else if (!latentWhere.has(k)) {
			fail(`stale register row ${k} — the premise no longer holds (peer dropped from ${row.dep}, no runtime file of it imports the peer any more, or every declaring package now declares the peer itself); update or prune the row`);
		}
	}
	for (const [k, where] of latentWhere) {
		if (!LATENT_PEER_REGISTER.some((r) => `${r.dep}|${r.peer}` === k)) {
			fail(`unregistered latent peer ${k} (latent in ${where.join(", ")}) — every latent peer of a declared dependency SHALL be recorded in the documented-latent register with its reachability reason`);
		}
	}
	for (const [k, where] of activatedWhere) {
		if (!LATENT_PEER_REGISTER.some((r) => `${r.dep}|${r.peer}` === k)) {
			fail(`level-2: peer ${k} is needed by the reachable closure of ${where.join(", ")} but is not declared in those packed manifests — promote it to the package's own dependencies (F-P6-7: --legacy-peer-deps consumers never auto-satisfy peers)`);
		}
	}

	rmSync(viewRoot, { recursive: true, force: true });
	return { failures, refusals, packages };
}

/** Resolve tarballs the same way the 29th checker does — shared seams. */
function resolveTarballs({ repoRoot, log }) {
	const prepacked = process.env.OPENCUT_PREPACKED_DIR;
	if (prepacked) {
		const dir = resolve(prepacked);
		const files = readdirSync(dir)
			.filter((name) => name.endsWith(".tgz"))
			.sort();
		if (files.length === 0) {
			throw new Error(`OPENCUT_PREPACKED_DIR=${dir} contains no .tgz files`);
		}
		log(`closure: verifying pre-packed tarballs from ${dir} (${files.length} file(s))`);
		return { tarballsDir: dir, files };
	}
	const outDir = resolve(
		process.env.OPENCUT_TARBALL_OUT_DIR ?? join(repoRoot, DEFAULT_OUT_DIR_NAME),
	);
	const manifest = packSdkTarballs({ repoRoot, outDir, determinism: false });
	const files = manifest.packages.map((entry) => basename(entry.tarball));
	log(`closure: packed fresh tarballs into ${outDir} (${files.length} file(s))`);
	return { tarballsDir: outDir, files };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * CONTROL-1c discipline for the controls' scratch root: refuse Temp paths
 * and any ancestor carrying node_modules (the green-by-leakage class).
 */
function controlScratchRoot(repoRoot) {
	const root = resolve(
		process.env.OPENCUT_SCRATCH_ROOT ?? join(homedir(), ".opencut-scratch-p7-closure"),
	);
	if (root.startsWith(repoRoot)) {
		throw new Error(`scratch root ${root} sits inside the repo tree — refuse (CONTROL-1a)`);
	}
	const temps = [process.env.TEMP, process.env.TMP, process.env.TMPDIR]
		.filter(Boolean)
		.map((t) => resolve(t));
	if (temps.some((t) => root.startsWith(t))) {
		throw new Error(`scratch root ${root} sits under a Temp path — refuse (CONTROL-1b, the measured AV hazard)`);
	}
	for (let dir = dirname(root); ; dir = dirname(dir)) {
		if (existsSync(join(dir, "node_modules"))) {
			throw new Error(
				`an ancestor of the scratch root carries node_modules (${dir}) — upward resolution can satisfy imports this control never installed (CONTROL-1c); set OPENCUT_SCRATCH_ROOT under an ancestor chain with no node_modules`,
			);
		}
		if (dirname(dir) === dir) break;
	}
	console.log(`CONTROL-1a/1b/1c scratch root: ${root} (outside repo, outside Temp, ancestors node_modules-free)`);
	return root;
}

/**
 * Shared control world builder: pack fresh, extract the classic tarball into
 * a doctorable copy, repack it after doctoring, stage all four tarballs in a
 * prepacked dir. Returns { prepackedDir, classicPkgDir }.
 */
function buildControlWorld(repoRoot, scratchRoot, label, doctor) {
	const packDir = join(scratchRoot, `${label}-pack`);
	const extractRoot = join(scratchRoot, `${label}-extract`);
	const prepackedDir = join(scratchRoot, `${label}-prepacked`);
	rmSync(packDir, { recursive: true, force: true });
	rmSync(extractRoot, { recursive: true, force: true });
	rmSync(prepackedDir, { recursive: true, force: true });

	const manifest = packSdkTarballs({ repoRoot, outDir: packDir, determinism: false });
	const classicEntry = manifest.packages.find((p) => p.name === "@opencut/editor-classic");
	if (!classicEntry) throw new Error("classic tarball missing from the fresh pack");

	const classicExtract = join(extractRoot, "classic");
	mkdirSync(classicExtract, { recursive: true });
	// NOTE: entry.tarballPath is repo-relative (packSdkTarballs normalizes
	// it), but the control's pack dir lives outside the repo on a possibly
	// different drive — address by basename against packDir, and hand tar a
	// RELATIVE path (an absolute E:/... reads as `host:path` to GNU tar).
	const classicTarball = join(packDir, classicEntry.tarball);
	runTool(
		`tar -xf ${classicEntry.tarball}`,
		"tar",
		["-xf", relative(classicExtract, classicTarball).replaceAll("\\", "/")],
		{ cwd: classicExtract },
	);
	const classicPkgDir = join(classicExtract, "package");
	doctor(classicPkgDir);

	// Repack the doctored classic with the real distribution path, then stage
	// it beside the untouched three.
	mkdirSync(prepackedDir, { recursive: true });
	const repacked = runTool(
		"npm pack (doctored classic)",
		IS_WINDOWS ? "npm.cmd" : "npm",
		["pack", "--json", "--pack-destination", prepackedDir],
		{ cwd: classicPkgDir },
	);
	const start = repacked.indexOf("[");
	const packed = JSON.parse(repacked.slice(start, repacked.lastIndexOf("]") + 1));
	for (const entry of manifest.packages) {
		if (entry.name === "@opencut/editor-classic") continue;
		cpSync(join(packDir, entry.tarball), join(prepackedDir, entry.tarball));
	}
	console.log(`control world (${label}): doctored classic repacked as ${packed[0].filename}; ${manifest.packages.length - 1} untouched tarball(s) staged beside it`);
	return { prepackedDir, classicPkgDir };
}

/** The reachable file both controls doctor: classic's `.` entry target. */
const CONTROL_ENTRY_FILE = "src/index.ts";

function runNegativeControl() {
	const repoRoot = resolve(DEFAULT_REPO_ROOT);
	const head = runTool("git rev-parse HEAD", "git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).trim();
	console.log(`negative control at ${head}: plant an undeclared runtime import AND a register activation; both must FIRE`);
	const scratchRoot = controlScratchRoot(repoRoot);
	const { prepackedDir } = buildControlWorld(repoRoot, scratchRoot, "negative", (pkgDir) => {
		const entry = join(pkgDir, CONTROL_ENTRY_FILE);
		const before = readFileSync(entry, "utf8");
		writeFileSync(
			entry,
			`${before}\n// P7 negative control (synthetic, in-scratch only):\nimport "@synthetic/undeclared-closure-probe";\nimport "zustand/traditional";\n`,
		);
		console.log(`doctored ${CONTROL_ENTRY_FILE}: + "@synthetic/undeclared-closure-probe" (undeclared) + "zustand/traditional" (register activation)`);
	});

	process.env.OPENCUT_PREPACKED_DIR = prepackedDir;
	const { tarballsDir, files } = resolveTarballs({ repoRoot, log: (line) => console.log(line) });
	const result = runClosure({ repoRoot, tarballsDir, tarballFiles: files, log: (line) => console.log(line) });
	const status = runTool("git status --porcelain", "git", ["status", "--porcelain"], { cwd: repoRoot });
	console.log(`repo-untouched proof: git status --porcelain -> ${JSON.stringify(status)}`);
	const fired = result.packages.find((p) => p.name === "@opencut/editor-classic");
	const ok =
		fired &&
		fired.activated >= 1; // the register-activation leg is structural; the undeclared leg shows as failures
	console.log(
		result.failures >= 2 && ok
			? `negative control: planted violations FIRED (${result.failures} failure line(s), activated peers ${fired.activated}) — the FAIL half is this log`
			: `negative control FAILED: expected both planted violations to fire, saw ${result.failures} failure(s)`,
	);
	console.log(`REAL_EXIT_CODE[closure-negative]:${result.failures >= 2 && ok ? 1 : 2}`);
	process.exit(result.failures >= 2 && ok ? 1 : 2);
}

function runConverseControl() {
	const repoRoot = resolve(DEFAULT_REPO_ROOT);
	const head = runTool("git rev-parse HEAD", "git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).trim();
	console.log(`converse control at ${head}: a dispositioned specifier in a TEST file and the register rows must stay SILENT`);
	const scratchRoot = controlScratchRoot(repoRoot);
	const { prepackedDir } = buildControlWorld(repoRoot, scratchRoot, "converse", (pkgDir) => {
		const testDir = join(pkgDir, "src/__tests__");
		mkdirSync(testDir, { recursive: true });
		writeFileSync(
			join(testDir, "converse-disposition.test.ts"),
			`// P7 converse control (synthetic, in-scratch only):\nimport { createCanvas } from "@napi-rs/canvas";\nexport const canvas = () => createCanvas(1, 1);\n`,
		);
		console.log(`doctored src/__tests__/converse-disposition.test.ts: + "@napi-rs/canvas" (dispositioned, test file)`);
	});

	process.env.OPENCUT_PREPACKED_DIR = prepackedDir;
	const { tarballsDir, files } = resolveTarballs({ repoRoot, log: (line) => console.log(line) });
	const result = runClosure({ repoRoot, tarballsDir, tarballFiles: files, log: (line) => console.log(line) });
	const status = runTool("git status --porcelain", "git", ["status", "--porcelain"], { cwd: repoRoot });
	console.log(`repo-untouched proof: git status --porcelain -> ${JSON.stringify(status)}`);
	const classic = result.packages.find((p) => p.name === "@opencut/editor-classic");
	console.log(
		result.failures === 0 && result.refusals === 0
			? `converse control: clean — the dispositioned test-file import stayed silent and the ${LATENT_PEER_REGISTER.length} register row(s) stayed silent (classic: latent ${classic.latent}, activated ${classic.activated})`
			: `converse control FAILED: ${result.failures} failure(s), ${result.refusals} refusal(s) — the disposition or a register row misfired`,
	);
	console.log(`REAL_EXIT_CODE[closure-converse]:${result.failures === 0 && result.refusals === 0 ? 0 : 1}`);
	process.exit(result.failures === 0 && result.refusals === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
	const repoRoot = resolve(DEFAULT_REPO_ROOT);
	const head = runTool("git rev-parse HEAD", "git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).trim();
	console.log(`check-packed-manifest-closure: verifying at ${head} (reads the tarballs, never the workspace)`);
	let result;
	try {
		const { tarballsDir, files } = resolveTarballs({ repoRoot, log: (line) => console.log(line) });
		result = runClosure({ repoRoot, tarballsDir, tarballFiles: files, log: (line) => console.log(line) });
	} catch (error) {
		console.error(String(error));
		console.log("REAL_EXIT_CODE[closure]:2");
		process.exit(2);
	}
	if (result.refusals > 0) {
		console.log(`\nclosure: REFUSED — ${result.refusals} empty scan(s); nothing proven`);
		console.log("REAL_EXIT_CODE[closure]:2");
		process.exit(2);
	}
	console.log(
		`\nclosure: ${result.failures} failure(s) over ${result.packages.length} package(s) — dispositions ${SPECIFIER_DISPOSITIONS.length}, register ${LATENT_PEER_REGISTER.length} row(s), re-derived this run`,
	);
	console.log(`REAL_EXIT_CODE[closure]:${result.failures > 0 ? 1 : 0}`);
	process.exit(result.failures > 0 ? 1 : 0);
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (process.argv.includes("--negative-control")) {
	runNegativeControl();
} else if (process.argv.includes("--converse-control")) {
	runConverseControl();
} else if (isCli) {
	main();
}
