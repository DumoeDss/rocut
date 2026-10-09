import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Launch only the private fixture. Never print its bearer-token URL. */
export async function startImageSequenceHost({ root, artifacts, output }) {
	const child = spawn(
		"bun",
		[
			"--preload",
			"./script/fixtures/isolated-web-wasm-preload.mjs",
			"script/fixtures/image-sequence-host.ts",
			artifacts,
			output,
		],
		{
			cwd: root,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	let ended = false,
		failure;
	const redact = (value) =>
		value.replace(/http:\/\/127\.0\.0\.1:\d+\/[^\s"']+/g, "[private Host URL]");
	let diagnostics = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			diagnostics = (diagnostics + redact(String(chunk))).slice(-12000);
		});
	const completion = new Promise((resolve) => {
		child.once("error", (error) => {
			failure = error;
			ended = true;
			resolve();
		});
		child.once("exit", (code, signal) => {
			ended = true;
			if (code !== 0)
				failure = Error(
					`Private sequence Host exited ${code}/${signal}: ${diagnostics}`,
				);
			resolve();
		});
	});
	const stop = async () => {
		if (!ended) child.stdin.end("stop\n");
		let timeout;
		try {
			await Promise.race([
				completion,
				new Promise((_, reject) => {
					timeout = setTimeout(
						() =>
							reject(
								Error("Private sequence Host did not stop after stdin closure"),
							),
						15000,
					);
				}),
			]);
		} finally {
			clearTimeout(timeout);
		}
		if (failure) throw failure;
	};
	try {
		const deadline = Date.now() + 60000;
		while (Date.now() < deadline) {
			if (ended)
				throw failure ?? Error("Private sequence Host exited before readiness");
			try {
				const ready = JSON.parse(
					await readFile(
						join(artifacts, "image-sequence-host", "ready.json"),
						"utf8",
					),
				);
				if (!ready.editorUrl || !ready.source)
					throw Error("Invalid private Host readiness descriptor");
				return { ready, stop };
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await delay(100);
		}
		throw Error(`Private sequence Host readiness timed out: ${diagnostics}`);
	} catch (error) {
		try {
			await stop();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Private sequence Host failed and cleanup failed",
			);
		}
		throw error;
	}
}
