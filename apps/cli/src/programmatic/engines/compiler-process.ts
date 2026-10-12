import { spawn } from "node:child_process";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HYPERFRAMES_COMPILER_CHILD } from "./hyperframes-compiler-child";

/** Dedicated, bounded child. Abort/host shutdown cannot leave work in the daemon. */
export async function runCompilerChild(
	config: object,
	signal: AbortSignal,
	script = HYPERFRAMES_COMPILER_CHILD,
): Promise<void> {
	signal.throwIfAborted();
	const input = JSON.stringify(config);
	// Windows command lines are bounded at 32 KiB. The fixed compiler adapter
	// exceeds that limit; only its trusted source goes in this private entry.
	// Authored project bytes still reach the compiler through staged files, never
	// through a Node/Bun import or evaluation in this host process.
	const directory = await mkdtemp(join(tmpdir(), "rocut-compiler-entry-"));
	const entry = join(directory, "compiler.cjs");
	try {
		await writeFile(entry, script, { encoding: "utf8", flag: "wx" });
		signal.throwIfAborted();
		const env = Object.fromEntries(
			["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((key) =>
				process.env[key] === undefined ? [] : [[key, process.env[key]!]],
			),
		);
		// The plugin daemon may run Electron's executable in Node mode. Its
		// compiler must keep that mode without inheriting other host variables.
		if (process.env.ELECTRON_RUN_AS_NODE === "1") {
			env.ELECTRON_RUN_AS_NODE = "1";
		}
		await new Promise<void>((resolve, reject) => {
			const child = spawn(process.execPath, [entry], {
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
				env,
			});
			let logs = "",
				timedOut = false;
			const stop = () => {
				child.kill();
			};
			const timer = setTimeout(() => {
				timedOut = true;
				stop();
			}, 30000);
			signal.addEventListener("abort", stop, { once: true });
			const finish = (error?: Error) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", stop);
				if (error) reject(error);
				else resolve();
			};
			child.once("error", finish);
			child.once("close", (code) =>
				finish(
					signal.aborted
						? Error("Engine compilation cancelled")
						: timedOut
							? Error("Engine compilation timed out")
							: code !== 0
								? Error(`Engine compiler failed: ${logs.slice(-2000)}`)
								: undefined,
				),
			);
			const collect = (chunk: Buffer) => {
				logs = (logs + chunk.toString("utf8")).slice(-4000);
			};
			child.stdout.on("data", collect);
			child.stderr.on("data", collect);
			child.stdin.on("error", () => {}); // spawn failure or abort; close/error decides result
			child.stdin.end(input);
			if (signal.aborted) stop();
		});
	} finally {
		// Remove exactly our generated file, not an arbitrary child-created tree.
		await rm(entry, { force: true });
		await rmdir(directory);
	}
}
