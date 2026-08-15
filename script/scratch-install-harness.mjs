#!/usr/bin/env node
/**
 * The scratch-install harness (S05 P6 task 2.1 — the extraction P3 owes P6).
 *
 * The scratch-project lifecycle and the no-linking controls, extracted
 * behaviour-preserving from `script/run-scratch-conformance.mjs` (S05 P3,
 * design E2/E4) so the published-examples runner can inherit them by import
 * instead of re-implementing them. The extraction's own acceptance (spec
 * "The shared harness extraction is behaviour-preserving") is P3's runner
 * re-running green over the extracted code with control-assertion output
 * diffed against its pre-extraction run — see P6's Group 2 evidence.
 *
 * One factory, two consumers: `createScratchHarness({ label, ... })` binds the
 * fail() prefix, the default scratch-root name, the scratch project's manifest
 * name and the marker's `createdBy` string, so each runner's log lines and
 * marker stay byte-for-byte what they were before the extraction.
 *
 * What lives here (and nowhere else now):
 *   - control 1a/1b: the scratch root must sit outside the repo tree AND
 *     outside every Temp path (the measured AV hazard), asserted every run;
 *   - the fresh-per-run lifecycle: wipe + recreate + marker; a foreign root
 *     without the marker is refused, never reused;
 *   - tarball staging: pack through `packSdkTarballs` (imported — packing is
 *     never re-implemented) or copy pre-packed tarballs from
 *     `OPENCUT_PREPACKED_DIR`;
 *   - the scratch manifest: npm `file:` deps + the `overrides` map that makes
 *     classic's declared wasm dependency resolve honestly (the fourth-tarball
 *     LEAD ruling of 2026-08-15);
 *   - `npm install --legacy-peer-deps` (react, classic's peer, is never
 *     auto-installed);
 *   - control 2: every installed package is a real directory copy (lstat, not
 *     symlink) AND the lockfile records `file:` resolutions with no
 *     `workspace:` protocol and no `link: true`;
 *   - the react control: absent for React-free consumers (the react-free
 *     proof), or explicitly present for consumers whose own manifest supplies
 *     react (the peer-dep contract working as designed).
 *
 * Environment seams (inherited from P3 verbatim):
 *   OPENCUT_SCRATCH_ROOT    override the scratch root
 *   OPENCUT_BUN             the bun invocation (default: npx --yes bun@1.2.18)
 *   OPENCUT_PREPACKED_DIR   skip packing; copy tarballs from this directory
 *   OPENCUT_TARBALL_OUT_DIR where packing writes tarballs when not prepacked
 */
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { DEFAULT_OUT_DIR_NAME, DEFAULT_REPO_ROOT, packSdkTarballs } from "./pack-sdk-tarballs.mjs";

const IS_WINDOWS = process.platform === "win32";
const MARKER_NAME = ".opencut-scratch-marker";

const SDK_NAMES = [
	"@opencut/editor-ports",
	"@opencut/editor-contracts",
	"@opencut/editor-classic",
];
// The local wasm artifact classic depends on (LEAD ruling 2026-08-15): not a
// scratch dependency in its own right, but control 2 asserts it lands as a
// real installed copy — classic's declared closure, resolved through the
// override, must be present on disk like every other package.
const TRANSITIVE_ASSERT_NAMES = ["opencut-wasm"];
// Every tarball this harness stages, mapped to its package name. The
// prepacked-dir path derives the name from the npm pack filename (scope
// stripped): opencut-editor-ports-0.2.0.tgz -> @opencut/editor-ports.
const TARBALL_BASENAME_TO_NAME = new Map([
	["opencut-editor-ports", "@opencut/editor-ports"],
	["opencut-editor-contracts", "@opencut/editor-contracts"],
	["opencut-editor-classic", "@opencut/editor-classic"],
	["opencut-wasm", "opencut-wasm"],
]);

/**
 * Build the harness. Options (all optional):
 * - label: the fail() log prefix (P3's is "run-scratch-conformance")
 * - repoRoot: defaults to this repo
 * - defaultScratchName: the sibling-directory name used when
 *   OPENCUT_SCRATCH_ROOT is unset (P3's is "opencut-scratch-p3")
 * - scratchProjectName: the `name` field of the scratch manifest
 * - markerCreatedBy: the marker file's createdBy string
 */
export function createScratchHarness(options = {}) {
	const label = options.label ?? "scratch-install-harness";
	const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
	const defaultScratchName = options.defaultScratchName ?? "opencut-scratch";
	const scratchProjectName = options.scratchProjectName ?? "opencut-scratch-conformance";
	const markerCreatedBy = options.markerCreatedBy ?? `${label} (scratch-install-harness)`;
	const tarballOutDir = resolve(
		process.env.OPENCUT_TARBALL_OUT_DIR ?? join(repoRoot, DEFAULT_OUT_DIR_NAME),
	);

	function fail(step, message) {
		console.error(`${label}: ${message}`);
		console.log(`REAL_EXIT_CODE[${step}]:1`);
		process.exit(1);
	}

	/** Run a tool, echo its output, and self-log the exit code — never throw. */
	function runLogged(step, command, args, options = {}) {
		// A single command string when a shell is involved: an args array with
		// shell:true trips DEP0190 and the paths here contain no spaces.
		const invocation = IS_WINDOWS ? [`${command} ${args.join(" ")}`, []] : [command, args];
		const result = spawnSync(invocation[0], invocation[1], {
			shell: IS_WINDOWS,
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
			...options,
		});
		const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
		if (output) console.log(output);
		const code = result.status ?? -1;
		console.log(`REAL_EXIT_CODE[${step}]:${code}`);
		return { code, output };
	}

	/** `child` equals or lies inside `parent` (both resolved, separators normalized). */
	function isInside(child, parent) {
		const rel = relative(resolve(parent), resolve(child)).replace(/\\/g, "/");
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	}

	// -------------------------------------------------------------------------
	// Root resolution + control 1 (location), asserted every run
	// -------------------------------------------------------------------------

	function resolveScratchRoot() {
		const fromEnv = process.env.OPENCUT_SCRATCH_ROOT;
		const root = resolve(fromEnv ?? join(dirname(repoRoot), defaultScratchName));
		console.log(`scratch root: ${root}${fromEnv ? " (OPENCUT_SCRATCH_ROOT)" : " (E:-drive default)"}`);

		if (isInside(root, repoRoot)) {
			fail("control-1", `scratch root is inside the repo tree (${repoRoot}) — refusing`);
		}
		console.log(`CONTROL-1a root-outside-repo-tree: PASS (${relative(repoRoot, root) || "sibling of repo"})`);

		const temps = [process.env.TEMP, process.env.TMP, process.env.TMPDIR, tmpdir()]
			.filter(Boolean)
			.map((t) => resolve(t));
		const underTemp = temps.filter((t) => isInside(root, t));
		if (underTemp.length > 0) {
			fail(
				"control-1",
				`scratch root sits under a Temp path (${underTemp[0]}) — the measured AV hazard; refusing`,
			);
		}
		console.log(`CONTROL-1b root-outside-temp: PASS (checked ${temps.length} Temp root(s))`);
		return root;
	}

	// -------------------------------------------------------------------------
	// Fresh-per-run lifecycle (wipe + recreate + marker; refuse foreign roots)
	// -------------------------------------------------------------------------

	function freshLifecycle(root) {
		if (existsSync(root)) {
			const stat = lstatSync(root);
			if (!stat.isDirectory()) {
				fail("lifecycle", `scratch root exists and is not a directory: ${root}`);
			}
			if (!existsSync(join(root, MARKER_NAME))) {
				fail(
					"lifecycle",
					`pre-existing root has no ${MARKER_NAME} marker — foreign root, refusing to touch it`,
				);
			}
			console.log(`lifecycle: wiping previous scratch root (marker verified)`);
			rmSync(root, { recursive: true, force: true });
		}
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, MARKER_NAME),
			`${JSON.stringify({ createdBy: markerCreatedBy, createdAt: new Date().toISOString() }, null, 2)}\n`,
		);
		console.log(`lifecycle: fresh scratch root created with marker (${root})`);
	}

	// -------------------------------------------------------------------------
	// Pack + install (gate-1 mechanism: npm file: deps + overrides)
	// -------------------------------------------------------------------------

	/** npm pack filename (scope stripped, version and .tgz removed) -> package name. */
	function nameOfTarball(filename) {
		const base = filename.replace(/-\d+\.\d+\.\d+[^.]*\.tgz$/, "");
		const name = TARBALL_BASENAME_TO_NAME.get(base);
		if (!name) {
			fail("pack", `unrecognized tarball filename (no package-name mapping): ${filename}`);
		}
		return name;
	}

	function stageTarballs(root) {
		const tarballsDir = join(root, "tarballs");
		mkdirSync(tarballsDir, { recursive: true });
		const prepacked = process.env.OPENCUT_PREPACKED_DIR;
		let staged;
		if (prepacked) {
			const dir = resolve(prepacked);
			console.log(`pack: skipped — copying pre-packed tarballs from ${dir}`);
			staged = readdirSync(dir)
				.filter((name) => name.endsWith(".tgz"))
				.sort()
				.map((name) => ({ name: nameOfTarball(name), file: name }));
		} else {
			const outDir = tarballOutDir;
			const manifest = packSdkTarballs({
				repoRoot,
				outDir,
				determinism: false,
				log: (line) => console.log(`pack: ${line}`),
			});
			staged = manifest.packages.map((entry) => ({
				name: entry.name,
				file: basename(entry.tarball),
			}));
		}
		for (const entry of staged) {
			cpSync(join(prepacked ? resolve(prepacked) : tarballOutDir, entry.file), join(tarballsDir, entry.file));
		}
		console.log(`pack: ${staged.length} tarball(s) staged into the scratch project`);
		return staged.map((entry) => ({ name: entry.name, spec: `file:tarballs/${entry.file}` }));
	}

	function writeScratchManifest(root, staged) {
		const byName = new Map(staged.map((entry) => [entry.name, entry.spec]));
		for (const name of SDK_NAMES) {
			if (!byName.has(name)) fail("manifest", `no staged tarball for ${name}`);
		}
		if (!byName.has("opencut-wasm")) {
			fail("manifest", "no staged tarball for opencut-wasm — the fourth-tarball ruling is not wired");
		}
		const manifest = {
			name: scratchProjectName,
			version: "0.0.0",
			private: true,
			type: "module",
			dependencies: Object.fromEntries(SDK_NAMES.map((name) => [name, byName.get(name)])),
			// Gate-1's proven shape, extended by the 2026-08-15 ruling: the
			// overrides replace the workspace:* protocol that rides verbatim
			// inside the packed editor-contracts/classic manifests AND classic's
			// `file:../../rust/wasm/pkg` spec (dead from node_modules) with the
			// same file: tarball specs. The override is the control that makes
			// classic's declared wasm dependency resolve honestly.
			overrides: {
				"@opencut/editor-ports": byName.get("@opencut/editor-ports"),
				"@opencut/editor-contracts": byName.get("@opencut/editor-contracts"),
				"opencut-wasm": byName.get("opencut-wasm"),
			},
		};
		writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		console.log(`install: scratch package.json written (deps + overrides, gate-1 shape + wasm)`);
	}

	function install(root, stepLabel = "npm-install") {
		// --legacy-peer-deps: classic's react peer must NOT be auto-installed —
		// the react-free property of ./storage/migrations is proven by this
		// project resolving and running with react absent from the tree.
		const result = runLogged(
			stepLabel,
			IS_WINDOWS ? "npm.cmd" : "npm",
			["install", "--legacy-peer-deps"],
			{ cwd: root },
		);
		if (result.code !== 0) fail("npm-install", "npm install failed — see output above");
	}

	// -------------------------------------------------------------------------
	// Control 2: copies, not links (lstat + lockfile), every run
	// -------------------------------------------------------------------------

	// `names` defaults to the full SDK set (P3's fixed list, unchanged); the
	// examples runner passes the names each example's own manifest declares —
	// the control's meaning (everything installed is a real copy with a file:
	// resolution) is identical, the asserted set just matches the consumer.
	function controlCopiesNotLinks(root, names = [...SDK_NAMES, ...TRANSITIVE_ASSERT_NAMES]) {
		const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
		for (const name of names) {
			// Scoped packages install under node_modules/@opencut/<short>; the
			// unscoped wasm artifact installs flat under node_modules/.
			const installed = name.startsWith("@")
				? join(root, "node_modules", "@opencut", name.replace("@opencut/", ""))
				: join(root, "node_modules", name);
			if (!existsSync(installed)) {
				fail("control-2", `${name} is not installed at ${installed}`);
			}
			const stat = lstatSync(installed);
			if (stat.isSymbolicLink() || !stat.isDirectory()) {
				fail(
					"control-2",
					`${name} is a ${stat.isSymbolicLink() ? "symlink" : "non-directory"} — workspace linking, not a copy`,
				);
			}
			const lockEntry = lock.packages?.[`node_modules/${name}`];
			const resolved = lockEntry?.resolved ?? "(missing lockfile entry)";
			const linked = lockEntry?.link === true || resolved.startsWith("workspace:");
			if (linked) {
				fail("control-2", `${name} lockfile resolution is ${resolved} — not a tarball file: spec`);
			}
			if (!resolved.startsWith("file:")) {
				fail("control-2", `${name} lockfile resolution is ${resolved} — expected a file: tarball spec`);
			}
			console.log(
				`CONTROL-2 copy-not-link ${name}: PASS (lstat: real directory, symlink=false; lockfile resolved=${resolved}, link=false)`,
			);
		}
	}

	// -------------------------------------------------------------------------
	// The react control. Absent mode (P3's shape, unchanged): classic's react
	// peer is never installed (--legacy-peer-deps), so nothing in node_modules
	// can satisfy a react specifier — if ./storage/migrations' closure reached
	// react, the migration leg would fail to resolve it. Present mode (P6's
	// embed example): react comes from the consumer's OWN manifest — the
	// peer-dep contract working as designed — and the control asserts exactly
	// that instead.
	// -------------------------------------------------------------------------

	function controlReact(root, expectation = "absent") {
		const react = join(root, "node_modules", "react");
		if (expectation === "absent") {
			if (existsSync(react)) {
				fail(
					"control-react-free",
					`react is installed at ${react} — the react-free proof is void (peer auto-install leaked in)`,
				);
			}
			console.log(
				"CONTROL-react-free react-absent: PASS (node_modules/react does not exist; the migration entry's closure needs no react)",
			);
			return;
		}
		if (!existsSync(react)) {
			fail(
				"control-react-present",
				`react is NOT installed at ${react} — this consumer declares react in its own manifest; the peer-dep contract is unsatisfied`,
			);
		}
		console.log(
			"CONTROL-react-present react-satisfied: PASS (react installed from the consumer's own manifest — classic's peer resolves against it, the peer-dep contract working as designed)",
		);
	}

	/**
	 * Run a TS consumer under the configured bun invocation, self-logging its
	 * exit. `cwdLabel` defaults to the literal "scratch root" — P3's runner
	 * printed exactly that, and the extraction's acceptance diffs its output
	 * byte-for-byte.
	 */
	function runUnderBun(root, script, cwdLabel = "scratch root") {
		const bun = process.env.OPENCUT_BUN ?? "npx --yes bun@1.2.18";
		console.log(`suites: ${bun} ${script} (cwd: ${cwdLabel})`);
		const result = spawnSync(`${bun} ${script}`, {
			shell: true,
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
			cwd: root,
		});
		const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
		if (output) console.log(output);
		const code = result.status ?? -1;
		console.log(`REAL_EXIT_CODE[suites]:${code}`);
		return { code, output };
	}

	return {
		label,
		repoRoot,
		fail,
		runLogged,
		isInside,
		resolveScratchRoot,
		freshLifecycle,
		nameOfTarball,
		stageTarballs,
		writeScratchManifest,
		install,
		controlCopiesNotLinks,
		controlReact,
		runUnderBun,
		SDK_NAMES,
		TRANSITIVE_ASSERT_NAMES,
	};
}
