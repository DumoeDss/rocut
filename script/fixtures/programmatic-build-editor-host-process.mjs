import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const redactHostUrl = (value) =>
	String(value).replace(
		/http:\/\/127\.0\.0\.1:\d+\/[^\s"']+/g,
		"[private Host URL]",
	);

/** Own only this child and its private directories; never connect to shared Elftia. */
export async function startAuthorHost({ root, artifact, output, browserPath }) {
	const child = spawn(
		"bun",
		[
			"--preload",
			"./script/fixtures/isolated-web-wasm-preload.mjs",
			"script/fixtures/programmatic-build-editor-host.ts",
			artifact,
			output,
		],
		{
			cwd: root,
			env: { ...process.env, ROCUT_PROBE_BROWSER_PATH: browserPath },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	let ended = false,
		failure,
		diagnostics = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			diagnostics = (diagnostics + redactHostUrl(chunk)).slice(-12000);
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
					`Private author Host exited ${code}/${signal}: ${diagnostics}`,
				);
			resolve();
		});
	});
	const stop = async () => {
		if (!ended) child.stdin.end("stop\n");
		let timer;
		try {
			await Promise.race([
				completion,
				new Promise((_, reject) => {
					timer = setTimeout(
						() =>
							reject(
								Error("Private author Host did not close after stdin EOF"),
							),
						15000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
		if (failure) throw failure;
	};
	try {
		const deadline = Date.now() + 60000;
		while (Date.now() < deadline) {
			if (ended)
				throw failure ?? Error("Private author Host exited before readiness");
			try {
				const ready = JSON.parse(
					await readFile(join(artifact, "author-host-ready.json"), "utf8"),
				);
				if (!ready.editorUrl || !ready.metadata?.authorDirectoryMoved)
					throw Error("Invalid author Host readiness");
				return { ready, stop };
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await delay(100);
		}
		throw Error(`Private author Host readiness timed out: ${diagnostics}`);
	} catch (error) {
		try {
			await stop();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], "Host start/cleanup failed");
		}
		throw error;
	}
}
