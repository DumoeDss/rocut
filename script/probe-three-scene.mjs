import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ascii = process.argv[3] === "--ascii";
const dither = process.argv[3] === "--dither";
if (
	process.argv.length !== 3 &&
	!(process.argv.length === 4 && ascii) &&
	!(process.argv.length === 5 && dither)
)
	throw Error(
		"Usage: node script/probe-three-scene.mjs <private-toolchain-directory> [--ascii | --dither <Creator-template-directory>]",
	);
const parent = join(
	root,
	".artifacts",
	dither ? "dither-three" : ascii ? "ascii-three" : "three-scene",
);
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json"));
const manifest = JSON.parse(manifestBytes);
for (const file of manifest.files) {
	if (digest(await readFile(join(root, file.path))) !== file.sha256)
		throw Error(
			`Fixture source changed without provenance update: ${file.path}`,
		);
}
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
await writeFile(
	join(artifacts, "provenance.json"),
	JSON.stringify(
		{
			sourceCommit: manifest.sourceCommit,
			sourceWorktreeClean: false,
			sourceManifestSha256: digest(manifestBytes),
			wasmSha256: digest(
				await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
			),
			toolchainLockSha256: digest(
				await readFile(join(resolve(process.argv[2]), "package-lock.json")),
			),
		},
		null,
		2,
	) + "\n",
	{ flag: "wx" },
);
const run = (command, args, env = process.env) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			windowsHide: true,
			stdio: "inherit",
			env,
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? resolve()
				: reject(Error(`Three probe exited ${code}; artifacts: ${artifacts}`)),
		);
	});
await run("bun", [
	dither
		? "script/fixtures/prepare-dither-three-probe.ts"
		: ascii
			? "script/fixtures/prepare-ascii-three-probe.ts"
			: "script/fixtures/prepare-three-probe.ts",
	artifacts,
	...(dither ? [resolve(process.argv[4])] : []),
]);
await run(
	process.execPath,
	[
		"script/probe-html-frames.mjs",
		dither ? "--dither-three" : ascii ? "--ascii-three" : "--three-scene",
	],
	{
		...process.env,
		ROCUT_ENGINE_TOOLCHAIN_DIR: resolve(process.argv[2]),
		ROCUT_PROBE_ENGINE_SPEC: join(artifacts, "compile.json"),
		ROCUT_PROBE_ARTIFACTS: artifacts,
		// Never inherit permission to connect this fixture to an existing Electron instance.
		ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
	},
);
console.log(JSON.stringify({ artifacts }));
