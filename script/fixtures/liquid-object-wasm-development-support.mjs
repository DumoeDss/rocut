import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, open, statfs } from "node:fs/promises";
import { join, relative } from "node:path";

export function createLiquidWasmProbeIO({ root }) {
	const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
	const free = async () => {
		const value = await statfs("C:/");
		return value.bavail * value.bsize;
	};
	const excluded = new Set(["target", "pkg", "node_modules", ".git"]);
	async function files(directory) {
		const result = [];
		for (const item of await readdir(directory, { withFileTypes: true })) {
			if (excluded.has(item.name)) continue;
			const path = join(directory, item.name);
			assert(!item.isSymbolicLink(), `No snapshot symlink: ${path}`);
			if (item.isDirectory()) result.push(...(await files(path)));
			else if (item.isFile()) result.push(path);
		}
		return result.sort();
	}
	async function manifest(directory) {
		try {
			return await Promise.all(
				(await files(directory)).map(async (path) => {
					const bytes = await readFile(path);
					return {
						path: relative(directory, path),
						bytes: bytes.length,
						sha256: hash(bytes),
					};
				}),
			);
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
	}
	async function run(command, args, cwd, env, logName) {
		const log = await open(join(root, logName), "wx");
		const started = Date.now(),
			child = spawn(command, args, {
				cwd,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
				windowsHide: true,
			});
		let reason = null,
			writes = Promise.resolve(),
			complete = false;
		const stop = (message) => {
			if (reason || complete) return;
			reason = message;
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
				windowsHide: true,
			});
		};
		const append = (bytes) => {
			writes = writes.then(() => log.write(bytes));
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const timer = setInterval(async () => {
			try {
				if (Date.now() - started > 900000) stop("15 minute timeout");
				else if ((await free()) < 1.5 * 1024 ** 3)
					stop("disk reserve below 1.5 GiB");
			} catch (error) {
				stop(error.message);
			}
		}, 10000);
		const exit = await new Promise((accept, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => {
				complete = true;
				accept({ code, signal });
			});
		}).finally(async () => {
			clearInterval(timer);
			await writes;
			await log.close();
		});
		return {
			command,
			args,
			cwd,
			...exit,
			reason,
			durationMs: Date.now() - started,
			log: join(root, logName),
		};
	}
	return { free, files, manifest, run };
}
