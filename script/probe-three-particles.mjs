import { build } from "esbuild";
import { runProbeChild } from "./probe-child-lifecycle.mjs";
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keys = [
	"artifacts-root",
	"bun",
	"wasm-sync",
	"sampler-dir",
	"toolchain",
	"chromium",
	"ffmpeg",
	"creator-root",
];
const args = process.argv.slice(2),
	options = {};
const scenario = args[0] === "--scenario" ? args.splice(0, 2)[1] : "c2";
if (!["c2", "c3", "c3-creator", "c4-persistence"].includes(scenario))
	throw Error(
		"Particle probe scenario must be c2, c3, c3-creator or c4-persistence",
	);
const creatorScenario =
	scenario === "c3-creator" || scenario === "c4-persistence";
for (let index = 0; index < args.length; index += 2) {
	const key = args[index].replace(/^--/, ""),
		value = args[index + 1];
	if (!keys.includes(key) || options[key] || !value || !isAbsolute(value))
		throw Error(
			"Use explicit absolute --" + keys.join(" <path> --") + " <path>",
		);
	options[key] = resolve(value);
}
if (keys.some((key) => key !== "creator-root" && !options[key]))
	throw Error("Missing particle probe paths");
if (creatorScenario && !options["creator-root"])
	throw Error("Creator scenario requires --creator-root");
const root = await mkdtemp(
	join(options["artifacts-root"], `particle-${scenario}-`),
);
await mkdir(join(root, "temp"));
await mkdir(join(root, "author"));
const digest = (body) => createHash("sha256").update(body).digest("hex");
const sources = new Map();
const result = await build({
	absWorkingDir: repo,
	entryPoints: [join(repo, `script/fixtures/particle-${scenario}-host.ts`)],
	outfile: join(root, "harness.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "es2022",
	write: false,
	metafile: true,
	define: {
		"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify(
			"./particle-sampler-wasm.mjs",
		),
	},
	plugins: [
		{
			name: "exact-particle-probe-inputs",
			setup(api) {
				api.onResolve({ filter: /^opencut-wasm(?:\/sync)?$/ }, () => ({
					path: pathToFileURL(options["wasm-sync"]).href,
					external: true,
				}));
				api.onResolve({ filter: /^node:child_process$/ }, ({ importer }) =>
					importer.endsWith("particle-c2-process-observer.mjs")
						? { path: "node:child_process", external: true }
						: {
								path: join(
									repo,
									"script/fixtures/particle-c2-process-observer.mjs",
								),
							},
				);
				api.onLoad(
					{ filter: /\.(?:ts|tsx|js|mjs|json)$/ },
					async ({ path }) => {
						const body = await readFile(path);
						sources.set(path, {
							path,
							bytes: body.length,
							sha256: digest(body),
						});
						return {
							contents: new TextDecoder("utf-8", { fatal: true }).decode(body),
							loader:
								{ ".ts": "ts", ".tsx": "tsx", ".json": "json" }[
									extname(path)
								] ?? "js",
							resolveDir: dirname(path),
						};
					},
				);
			},
		},
	],
});
if (result.outputFiles.length !== 1)
	throw Error("Expected one isolated host bundle");
await writeFile(join(root, "harness.mjs"), result.outputFiles[0].contents, {
	flag: "wx",
});
for (const name of [
	"particle-sampler-wasm.mjs",
	"opencut_wasm_bg.wasm",
	"particle-sampler-worker-entry.mjs",
])
	await copyFile(
		join(options["sampler-dir"], name),
		join(root, name),
		constants.COPYFILE_EXCL,
	);
await copyFile(
	creatorScenario
		? join(
				options["creator-root"],
				"resources/agent/skills/html-video/assets/rocut-stylized/particle-scene.ts",
			)
		: join(repo, `script/fixtures/particle-${scenario}-author.ts`),
	join(root, creatorScenario ? "author/particle-scene.ts" : "author/index.ts"),
	constants.COPYFILE_EXCL,
);
if (creatorScenario)
	await copyFile(
		join(
			options["creator-root"],
			"resources/agent/skills/html-video/assets/rocut-stylized/particle-object.mjs",
		),
		join(root, "particle-object.mjs"),
		constants.COPYFILE_EXCL,
	);
if (scenario === "c3") {
	const browserChecks = await build({
		absWorkingDir: repo,
		entryPoints: [
			"apps/cli/src/__tests__/three-particle-material-browser-fixture.ts",
		],
		bundle: true,
		write: false,
		platform: "browser",
		format: "esm",
		target: "chrome120",
		metafile: true,
	});
	await writeFile(
		join(root, "author/material-checks.js"),
		browserChecks.outputFiles[0].contents,
		{ flag: "wx" },
	);
	for (const path of Object.keys(browserChecks.metafile.inputs)) {
		const absolute = resolve(repo, path),
			body = await readFile(absolute);
		sources.set(absolute, {
			path: absolute,
			bytes: body.length,
			sha256: digest(body),
		});
	}
}
await copyFile(
	join(repo, "script/fixtures/particle-c2-process-observer.mjs"),
	join(root, "process-observer.mjs"),
	constants.COPYFILE_EXCL,
);
for (const path of [
	fileURLToPath(import.meta.url),
	join(repo, "script/probe-child-lifecycle.mjs"),
	options["wasm-sync"],
	join(dirname(options["wasm-sync"]), "opencut_wasm_bg.js"),
	join(dirname(options["wasm-sync"]), "opencut_wasm_bg.wasm"),
	...[
		"harness.mjs",
		...(creatorScenario
			? ["author/particle-scene.ts", "particle-object.mjs"]
			: ["author/index.ts"]),
		"process-observer.mjs",
		"particle-sampler-wasm.mjs",
		"opencut_wasm_bg.wasm",
		"particle-sampler-worker-entry.mjs",
		...(scenario === "c3" ? ["author/material-checks.js"] : []),
	].map((name) => join(root, name)),
]) {
	const body = await readFile(path);
	sources.set(path, { path, bytes: body.length, sha256: digest(body) });
}
await writeFile(
	join(root, "source-manifest.json"),
	JSON.stringify({ root, sources: [...sources.values()] }, null, 2) + "\n",
	{ flag: "wx" },
);
console.log(
	JSON.stringify({ root, phase: "real-capture", files: sources.size }),
);
const log = createWriteStream(join(root, "run.log"), { flags: "wx" });
let failure;
let launcherLifecycle;
try {
	launcherLifecycle = await runProbeChild({
		executable: options.bun,
		args: [
			join(root, "harness.mjs"),
			root,
			options.toolchain,
			options.chromium,
			options.ffmpeg,
		],
		cwd: repo,
		env: {
			...process.env,
			TEMP: join(root, "temp"),
			TMP: join(root, "temp"),
			ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
		},
		onOutput(bytes) {
			log.write(bytes);
			process.stdout.write(bytes);
		},
	});
} catch (error) {
	failure = error;
	launcherLifecycle = error.lifecycle ?? {
		status: "failed",
		closed: false,
		errors: [String(error)],
	};
} finally {
	await new Promise((done) => log.end(done));
}
await writeFile(
	join(root, "launcher-lifecycle.json"),
	JSON.stringify(launcherLifecycle, null, 2) + "\n",
	{ flag: "wx" },
);
const changed = [];
for (const file of sources.values())
	if (digest(await readFile(file.path)) !== file.sha256)
		changed.push(file.path);
await writeFile(
	join(root, "source-stability.json"),
	JSON.stringify({ stable: changed.length === 0, changed }, null, 2) + "\n",
	{ flag: "wx" },
);
if (failure) throw failure;
if (changed.length)
	throw Error(
		"Probe inputs changed during execution; retain the run but do not certify it",
	);
console.log(
	JSON.stringify({
		status: "passed",
		root,
		evidenceSha256: digest(await readFile(join(root, "evidence.json"))),
	}),
);
