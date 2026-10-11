import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 3)
	throw Error(
		"Usage: node script/probe-meshopt-three.mjs <private-toolchain-directory>",
	);
const toolchain = resolve(process.argv[2]);
const parent = join(root, ".artifacts", "meshopt-three");
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Pin every input this run reads, mirroring the shared acceptance harness:
// probe sources, fixture generator, toolchain lock, WASM and decoder.
const inputs = new Map();
const pin = async (path) => {
	const bytes = await readFile(path);
	inputs.set(path, { path, bytes: bytes.length, sha256: digest(bytes) });
	return bytes;
};
const pinnedSources = [
	"script/probe-meshopt-three.mjs",
	"script/probe-html-frames.mjs",
	"script/fixtures/prepare-meshopt-three-probe.ts",
	"script/fixtures/three-assets.ts",
	"script/fixtures/meshopt-three-browser-probe.html",
	"script/fixtures/meshopt-three-browser-probe.ts",
].map((file) => join(root, file));
for (const file of pinnedSources) await pin(file);
const lock = await pin(join(toolchain, "package-lock.json"));
await pin(join(toolchain, "node_modules/three/package.json"));
const decoder = await pin(
	join(
		toolchain,
		"node_modules/three/examples/jsm/libs/meshopt_decoder.module.js",
	),
);
const wasm = await pin(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm"));
await writeFile(
	join(artifacts, "provenance.json"),
	JSON.stringify(
		{
			toolchainDirectory: toolchain,
			toolchainLockSha256: digest(lock),
			wasmSha256: digest(wasm),
			meshoptDecoderSha256: digest(decoder),
			inputs: [...inputs.values()],
		},
		null,
		2,
	) + "\n",
	{ flag: "wx" },
);
const run = (command, args, env = process.env) =>
	new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			windowsHide: true,
			stdio: "inherit",
			env,
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? resolvePromise()
				: reject(
						Error(
							`Meshopt Three probe exited ${code}; artifacts: ${artifacts}`,
						),
					),
		);
	});
await run("bun", [
	"script/fixtures/prepare-meshopt-three-probe.ts",
	artifacts,
]);
await run(process.execPath, ["script/probe-html-frames.mjs", "--meshopt-three"], {
	...process.env,
	ROCUT_ENGINE_TOOLCHAIN_DIR: toolchain,
	ROCUT_PROBE_ENGINE_SPEC: join(artifacts, "compile.json"),
	ROCUT_PROBE_ARTIFACTS: artifacts,
	ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
});
// Guard against source drift between pinning and completion.
for (const item of inputs.values())
	if (digest(await readFile(item.path)) !== item.sha256)
		throw Error(`Input changed during the probe run: ${item.path}`);
await writeFile(
	join(artifacts, "inputs-unchanged.json"),
	JSON.stringify({ inputsUnchanged: true }, null, 2) + "\n",
	{ flag: "wx" },
);
console.log(JSON.stringify({ artifacts }));
