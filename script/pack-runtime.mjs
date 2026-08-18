#!/usr/bin/env node
/**
 * The distributable runtime bundle packer (S08 R group 4, design D7).
 *
 * Bundles the CLI entry (`apps/cli/src/main.ts`) with esbuild into
 * `dist-runtime/rocut.mjs` — bundle/platform=node/format=esm/target=es2022/
 * splitting=true — so the dynamic migration import stays a separate chunk and
 * the `opencut_wasm_bg.wasm` ESM import it contains is preserved verbatim
 * (`*.wasm` external) and satisfied by a byte-equal sibling copy beside the
 * chunk. Also copies the prebuilt editor surface dist verbatim (absence fails
 * with build instructions unless `--skip-surface`) and writes `PROVENANCE.md`
 * into the output (source commit — refusing a dirty tree without
 * `--allow-dirty` — esbuild version, toolchain, per-file SHA-256, and the
 * commit+esbuild reproducible claim wording).
 *
 * Output is gitignored machine-local build product; the committed record is
 * the evidence manifest this writes into the change's evidence directory —
 * the `pack-sdk-tarballs.mjs` shape.
 *
 *   node script/pack-runtime.mjs [--out <dir>] [--manifest <path>]
 *                                [--skip-surface] [--skip-determinism]
 *                                [--skip-smoke] [--allow-dirty]
 *
 * Runtime claim (PROVENANCE carries it verbatim): bun is the bundle's
 * documented runtime; plain node runs the whole surface except legacy-record
 * migration, whose chunk needs `--experimental-wasm-modules`.
 */
import { createHash } from "node:crypto";
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
import { spawnSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, "..");
export const DEFAULT_OUT_DIR_NAME = "dist-runtime";
export const DEFAULT_MANIFEST_PATH = join(
	DEFAULT_REPO_ROOT,
	"rasen/changes/r08-host-ensure-and-runtime/evidence/runtime-bundle-manifest.json",
);

const IS_WINDOWS = process.platform === "win32";
const ENTRY = "apps/cli/src/main.ts";
const WASM_SOURCE = "rust/wasm/pkg/opencut_wasm_bg.wasm";
const WASM_NAME = "opencut_wasm_bg.wasm";
const SURFACE_DIST = "apps/vite-example/dist";

function logVia(sink) {
	return (line) => (sink ? sink(line) : console.log(line));
}

function runTool(step, command, args, options = {}) {
	const result = spawnSync(command, args, {
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

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

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

function gitStatus(repoRoot) {
	return spawnSync("git", ["status", "--porcelain"], {
		cwd: repoRoot,
		encoding: "utf8",
	}).stdout;
}

function esbuildVersion() {
	const pkg = JSON.parse(
		readFileSync(join(DEFAULT_REPO_ROOT, "node_modules", "esbuild", "package.json"), "utf8"),
	);
	return pkg.version;
}

function bunVersion(log) {
	const result = spawnSync(IS_WINDOWS ? "bun.exe" : "bun", ["--version"], {
		encoding: "utf8",
	});
	if (result.status !== 0 || !result.stdout) return "unavailable";
	return result.stdout.trim();
}

/** One esbuild pass into outDir; esbuild 0.27.3 rejects `.mjs` as an
 * outExtension value here, so the entry is renamed after the build — the
 * rename is part of the deterministic build step, not a post-hoc fix. */
async function buildOnce({ repoRoot, outDir }) {
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	const result = await build({
		entryPoints: [join(repoRoot, ENTRY)],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "es2022",
		splitting: true,
		outdir: outDir,
		entryNames: "rocut", // dist-runtime/rocut.mjs — the runnable name
		chunkNames: "chunk-[hash]",
		external: ["*.wasm"], // the ESM wasm specifier stays verbatim in the chunk
		metafile: true,
		logLevel: "silent",
		sourcemap: false,
	});
	// chunks import each other by name; nothing imports the entry, so the
	// entry rename never breaks an intra-bundle reference
	const entryOut = join(outDir, "rocut.js");
	const entryFinal = join(outDir, "rocut.mjs");
	rmSync(entryFinal, { force: true });
	cpSync(entryOut, entryFinal);
	rmSync(entryOut);
	return { metafile: result.metafile };
}

/** Locate the chunk that references the wasm sibling; copy the wasm beside it. */
function placeWasmSibling({ repoRoot, outDir }) {
	const referencers = [];
	for (const name of readdirSync(outDir)) {
		if (!name.endsWith(".mjs") && !name.endsWith(".js")) continue;
		const text = readFileSync(join(outDir, name), "utf8");
		if (text.includes(WASM_NAME)) referencers.push(name);
	}
	if (referencers.length === 0) {
		throw new Error(
			`no output chunk references "${WASM_NAME}" — the external-wasm contract broke; ` +
				"inspect the bundle for an inlined loader",
		);
	}
	const source = join(repoRoot, WASM_SOURCE);
	if (!existsSync(source)) {
		throw new Error(`${WASM_SOURCE} is missing — run \`bun run build:wasm\` first`);
	}
	cpSync(source, join(outDir, WASM_NAME));
	const byteEqual = sha256File(source) === sha256File(join(outDir, WASM_NAME));
	if (!byteEqual) throw new Error(`the copied ${WASM_NAME} is not byte-equal to ${WASM_SOURCE}`);
	return { referencers, byteEqual, sha256: sha256File(source) };
}

function provenanceText({ head, dirty, esbuild, toolchain, files }) {
	return [
		"# rocut runtime bundle — provenance",
		"",
		`- Source commit: ${head}${dirty ? " (DIRTY working tree — packed with --allow-dirty; not a release artifact)" : ""}`,
		`- Bundler: esbuild ${esbuild} (bundle/platform=node/format=esm/target=es2022/splitting=true, \`*.wasm\` external)`,
		`- Toolchain: node ${toolchain.node}, bun ${toolchain.bun}, ${toolchain.platform}`,
		"- Runtime: **bun is the documented runtime** — the source CLI is bun-run and the",
		"  wasm ESM import in the migration chunk is native there. Plain node runs the",
		"  whole surface except legacy-record migration, whose chunk requires",
		"  `node --experimental-wasm-modules`. Fresh projects (current schema) never",
		"  load that chunk.",
		"- Reproducible: **commit + esbuild** — packing the same source commit with the",
		"  same esbuild version on the same platform reproduces these per-file SHA-256",
		"  digests (the determinism control in the evidence manifest exercises exactly",
		"  this). No stronger cross-platform or cross-toolchain claim is made.",
		"",
		"## Files",
		"",
		"| file | sha256 | bytes |",
		"|---|---|---|",
		...files.map((file) => `| ${file.path} | ${file.sha256} | ${file.sizeBytes} |`),
		"",
	].join("\n");
}

/** Both smoke legs (design D7): target list against an empty root, and a full ensure round-trip. */
function smoke({ outDir, log }) {
	const results = { listCheck: null, ensureRoundTrip: null };
	{
		const root = join(outDir, ".smoke-registry");
		rmSync(root, { recursive: true, force: true });
		mkdirSync(root, { recursive: true });
		const result = spawnSync(
			IS_WINDOWS ? "bun.exe" : "bun",
			[join(outDir, "rocut.mjs"), "target", "list", "--targets-root", root],
			{ encoding: "utf8", env: { ...process.env, ROCUT_TARGETS_ROOT: root } },
		);
		const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
		log(`REAL_EXIT_CODE[smoke-target-list]:${result.status}`);
		if (result.status !== 0 || !output.includes("no targets")) {
			throw new Error(
				`smoke target list failed (exit ${result.status}):\n${output.slice(0, 4000)}`,
			);
		}
		results.listCheck = { exitCode: result.status, output };
	}
	{
		const parent = join(outDir, ".smoke-project");
		rmSync(parent, { recursive: true, force: true });
		const project = join(parent, "proj");
		mkdirSync(project, { recursive: true });
		const registryRoot = join(parent, "targets-root");
		const ensure = () => {
			const result = spawnSync(
				IS_WINDOWS ? "bun.exe" : "bun",
				[
					join(outDir, "rocut.mjs"),
					"host",
					"ensure",
					project,
					"--targets-root",
					registryRoot,
					"--timeout",
					"60000",
				],
				{ encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
			);
			const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
			log(`REAL_EXIT_CODE[smoke-ensure]:${result.status}`);
			if (result.status !== 0) {
				throw new Error(`smoke ensure failed (exit ${result.status}):\n${output.slice(0, 4000)}`);
			}
			const lines = Object.fromEntries(
				output
					.split("\n")
					.filter((line) => line.includes(" "))
					.map((line) => {
						const space = line.indexOf(" ");
						return [line.slice(0, space), line.slice(space + 1)];
					}),
			);
			for (const key of ["target", "editorUrl", "pid", "state"]) {
				if (lines[key] === undefined) {
					throw new Error(`smoke ensure output lacks a \`${key}\` line:\n${output}`);
				}
			}
			return { lines, output };
		};
		const first = ensure();
		if (first.lines.state !== "started") {
			throw new Error(`first ensure reported state=${first.lines.state}, expected started`);
		}
		const second = ensure();
		if (
			second.lines.state !== "reused" ||
			second.lines.target !== first.lines.target ||
			second.lines.editorUrl !== first.lines.editorUrl
		) {
			throw new Error(
				`second ensure did not reuse (state=${second.lines.state}, ` +
					`target=${second.lines.target}, url=${second.lines.editorUrl})`,
			);
		}
		const index = join(registryRoot, "targets.json");
		const entries = JSON.parse(readFileSync(index, "utf8"));
		if (!Array.isArray(entries) || entries.length !== 1) {
			throw new Error(`expected exactly one registry entry, found ${entries?.length}`);
		}
		const pid = Number(first.lines.pid);
		if (IS_WINDOWS) {
			runTool(`taskkill /pid ${pid} /t /f`, "taskkill", ["/pid", String(pid), "/t", "/f"]);
		} else {
			try {
				process.kill(-pid, "SIGKILL"); // detached daemon ⇒ its own process group
			} catch {
				throw new Error(`process-group kill of pid ${pid} failed — daemon may linger`);
			}
		}
		log(`REAL_EXIT_CODE[smoke-treekill]:0`);
		results.ensureRoundTrip = {
			targetId: first.lines.target,
			editorUrl: first.lines.editorUrl,
			pid,
			states: [first.lines.state, second.lines.state],
			entryCount: entries.length,
		};
		rmSync(parent, { recursive: true, force: true });
	}
	rmSync(join(outDir, ".smoke-registry"), { recursive: true, force: true });
	return results;
}

/**
 * Pack the runtime bundle; returns the evidence manifest (the same structure
 * the CLI writes) without writing it, so tests can run the pack in isolation.
 */
export async function packRuntime(args = {}) {
	const repoRoot = resolve(args.repoRoot ?? DEFAULT_REPO_ROOT);
	const outDir = resolve(args.outDir ?? join(repoRoot, DEFAULT_OUT_DIR_NAME));
	const skipSurface = args.skipSurface ?? false;
	const determinism = args.determinism ?? true;
	const runSmoke = args.smoke ?? true;
	const allowDirty = args.allowDirty ?? false;
	const log = logVia(args.log);

	const dirty = gitStatus(repoRoot).trim() !== "";
	if (dirty && !allowDirty) {
		throw new Error(
			"refusing to pack a dirty tree (PROVENANCE pins the source commit) — commit first, " +
				"or pass --allow-dirty for a clearly-marked dev artifact",
		);
	}
	const head = runTool("git rev-parse HEAD", "git", ["rev-parse", "HEAD"], {
		cwd: repoRoot,
	}).trim();

	await buildOnce({ repoRoot, outDir });
	const wasm = placeWasmSibling({ repoRoot, outDir });
	const chunkCount = readdirSync(outDir).filter(
		(name) => name.endsWith(".mjs") || name.endsWith(".js"),
	).length - 1;
	log(`bundle: rocut.mjs + ${chunkCount} chunk(s); ${WASM_NAME} sibling referenced by ${wasm.referencers.join(", ")}`);

	// Surface: the prebuilt editor dist, vendored verbatim for the plugin tail.
	const surface = { source: SURFACE_DIST, copied: false, skippedReason: null, fileCount: 0 };
	const surfaceDist = join(repoRoot, SURFACE_DIST);
	if (existsSync(surfaceDist)) {
		cpSync(surfaceDist, join(outDir, "surface"), { recursive: true });
		surface.copied = true;
		surface.fileCount = walkFiles(join(outDir, "surface")).length;
		log(`surface: copied ${surface.fileCount} file(s) from ${SURFACE_DIST}`);
	} else if (skipSurface) {
		surface.skippedReason = `--skip-surface (${SURFACE_DIST} absent)`;
		log(`surface: skipped (${SURFACE_DIST} absent)`);
	} else {
		throw new Error(
			`${SURFACE_DIST} is absent — build the editor surface first:\n` +
				"  cd apps/vite-example && bun run build\n" +
				"(or pass --skip-surface when only the runtime bundle is needed)",
		);
	}

	// PROVENANCE with the real per-file inventory of this output.
	const toolchain = {
		node: process.version,
		bun: bunVersion(log),
		platform: `${process.platform} ${process.arch}`,
	};
	const esbuild = esbuildVersion();
	const filesNow = () =>
		walkFiles(outDir).map(([rel, abs]) => ({
			path: rel,
			sha256: sha256File(abs),
			sizeBytes: statSync(abs).size,
		}));
	writeFileSync(join(outDir, "PROVENANCE.md"), provenanceText({ head, dirty, esbuild, toolchain, files: filesNow() }));

	const manifest = {
		generatedAt: new Date().toISOString(),
		repoHead: head,
		dirty,
		entry: ENTRY,
		esbuildVersion: esbuild,
		toolchain,
		outputDir: relative(repoRoot, outDir).replace(/\\/g, "/"),
		wasmSibling: {
			source: WASM_SOURCE,
			name: WASM_NAME,
			referencingChunks: wasm.referencers,
			byteEqual: wasm.byteEqual,
			sha256: wasm.sha256,
		},
		surface,
		files: filesNow(),
		determinism: { exercised: determinism, reproduced: null, divergences: [] },
		smoke: null,
	};

	if (determinism) {
		const secondDir = join(outDir, ".determinism-second");
		try {
			await buildOnce({ repoRoot, outDir: secondDir });
			placeWasmSibling({ repoRoot, outDir: secondDir });
			// The determinism claim covers the BUILD OUTPUTS (entry, chunks, wasm
			// sibling) — post-build artifacts (PROVENANCE, the vendored surface)
			// are not esbuild products and are excluded on both sides.
			const isBuildOutput = (path) => !path.startsWith("surface/") && path !== "PROVENANCE.md";
			const first = manifest.files
				.filter((file) => isBuildOutput(file.path))
				.map((file) => [file.path, file.sha256]);
			const second = new Map(
				walkFiles(secondDir)
					.filter(([rel]) => isBuildOutput(rel))
					.map(([rel, abs]) => [rel, sha256File(abs)]),
			);
			let reproduced = true;
			for (const [path, sha] of first) {
				if (second.get(path) !== sha) {
					reproduced = false;
					manifest.determinism.divergences.push({
						path,
						first: sha,
						second: second.get(path) ?? "<absent>",
					});
				}
			}
			for (const path of second.keys()) {
				if (!first.some(([p]) => p === path)) {
					reproduced = false;
					manifest.determinism.divergences.push({ path, first: "<absent>", second: second.get(path) });
				}
			}
			manifest.determinism.reproduced = reproduced;
			log(`determinism: ${reproduced ? "reproduced" : "DIVERGED"} across two packs of ${head.slice(0, 12)}`);
		} finally {
			rmSync(secondDir, { recursive: true, force: true });
		}
	}

	if (runSmoke) {
		manifest.smoke = smoke({ outDir, log });
	}

	return manifest;
}

async function main() {
	const argv = process.argv.slice(2);
	const arg = (name) => {
		const index = argv.indexOf(`--${name}`);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const manifestPath = resolve(
		arg("manifest") ?? DEFAULT_MANIFEST_PATH,
	);

	console.log("pack-runtime: bundling the distributable runtime (design D7)");
	let manifest;
	try {
		manifest = await packRuntime({
			outDir: arg("out") === undefined ? undefined : resolve(arg("out")),
			skipSurface: argv.includes("--skip-surface"),
			determinism: !argv.includes("--skip-determinism"),
			smoke: !argv.includes("--skip-smoke"),
			allowDirty: argv.includes("--allow-dirty"),
		});
	} catch (error) {
		console.error(String(error));
		console.log("REAL_EXIT_CODE[pack]:1");
		process.exit(1);
	}

	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`manifest written: ${manifestPath}`);
	console.log(
		`  ${manifest.files.length} file(s), wasm sibling byte-equal=${manifest.wasmSibling.byteEqual}` +
			(manifest.surface.copied ? `, surface ${manifest.surface.fileCount} file(s)` : ", surface skipped"),
	);
	if (manifest.determinism.exercised) {
		console.log(`  determinism: ${manifest.determinism.reproduced ? "reproduced" : "DIVERGED"}`);
		if (!manifest.determinism.reproduced) {
			console.log("REAL_EXIT_CODE[pack]:1");
			process.exit(1);
		}
	}
	if (manifest.smoke) {
		console.log(
			`  smoke: target-list ok; ensure round-trip ${manifest.smoke.ensureRoundTrip.targetId} ` +
				`(${manifest.smoke.ensureRoundTrip.states.join(" -> ")}), daemon tree-killed`,
		);
	}
	console.log("REAL_EXIT_CODE[pack]:0");
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	main();
}
