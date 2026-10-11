import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 3 && process.argv.length !== 4)
	throw Error(
		"Usage: node script/probe-meshopt-persistence.mjs <private-toolchain-directory> [editor-dist]",
	);
const toolchain = resolve(process.argv[2]);
const editorDist = process.argv[3] ? resolve(process.argv[3]) : null;
const parent = join(root, ".artifacts", "meshopt-persistence");
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
				: reject(Error(`Probe exited ${code}; artifacts: ${artifacts}`)),
		);
	});
// Reuse the browser-probe fixture generator for identical GLB/HDR/scene inputs.
await run("bun", [
	"script/fixtures/prepare-meshopt-three-probe.ts",
	artifacts,
]);
await writeFile(
	join(artifacts, "host-config.json"),
	JSON.stringify(
		{
			editorDist,
			toolchainDirectory: toolchain,
			compileSpec: join(artifacts, "compile.json"),
		},
		null,
		2,
	) + "\n",
	{ flag: "wx" },
);
await run("bun", [
	"script/fixtures/meshopt-persistence-host.ts",
	artifacts,
	join(artifacts, "host-config.json"),
]);
const result = JSON.parse(
	await readFile(join(artifacts, "meshopt-persistence.json"), "utf8"),
);
await writeFile(
	join(artifacts, "evidence.json"),
	JSON.stringify(
		{
			...result,
			artifacts,
			toolchainLockSha256: digest(await readFile(join(toolchain, "package-lock.json"))),
			meshoptDecoderSha256: digest(
				await readFile(
					join(
						toolchain,
						"node_modules/three/examples/jsm/libs/meshopt_decoder.module.js",
					),
				),
			),
			finishedAt: new Date().toISOString(),
		},
		null,
		2,
	) + "\n",
	{ flag: "wx" },
);
console.log(JSON.stringify({ artifacts, ok: result.ok }));
