import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolchain = process.argv[2];
if (!toolchain) throw Error("Usage: node script/probe-hyperframes.mjs <isolated-toolchain-directory>");
const parent = resolve(tmpdir());
const staging = await mkdtemp(join(parent, "rocut-hyperframes-probe-"));
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
	const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", env });
	child.once("error", reject);
	child.once("exit", (code) => code === 0 ? resolve() : reject(Error(`${command} probe exited ${code}`)));
});
try {
	await run("bun", ["script/fixtures/prepare-hyperframes-probe.ts", resolve(toolchain), staging]);
	await run(process.execPath, ["script/probe-html-frames.mjs"], {
		...process.env,
		ROCUT_ENGINE_TOOLCHAIN_DIR: resolve(toolchain),
		ROCUT_PROBE_ENGINE_SPEC: join(staging, "compile.json"),
	});
} finally {
	if (dirname(staging) !== parent || !basename(staging).startsWith("rocut-hyperframes-probe-"))
		throw Error("Unsafe HyperFrames fixture cleanup");
	await rm(staging, { recursive: true, force: true });
}
