import assert from "node:assert/strict";
import { spawn } from "node:child_process";

/** Fixture-only process seam. The decoder uses the fixed native frame size;
 * CPU tests inject a mock process and small frameBytes, never alternate pixels.
 */
export function flameExportRawFrames({
	ffmpeg,
	args,
	signal,
	frameBytes = 1920 * 1080 * 3,
	spawnProcess = spawn,
}) {
	signal?.throwIfAborted();
	assert(Number.isSafeInteger(frameBytes) && frameBytes > 0);
	const child = spawnProcess(
		ffmpeg,
		[
			"-v",
			"error",
			"-threads",
			"1",
			...args,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	let errorText = "",
		stopped = false;
	child.stderr.on("data", (chunk) => {
		errorText = (errorText + chunk.toString()).slice(-4000);
	});
	const completed = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? resolve()
				: reject(Error(`Flame independent FFmpeg exit ${code}: ${errorText}`)),
		);
	});
	completed.catch(() => {});
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearTimeout(timer);
		signal?.removeEventListener("abort", stop);
		if (child.exitCode === null && child.signalCode === null) child.kill();
		// Interrupt a pending iterator.next before awaiting iterator.return.
		if (!child.stdout.destroyed) child.stdout.destroy();
	};
	const timer = setTimeout(stop, 120000);
	signal?.addEventListener("abort", stop, { once: true });
	if (signal?.aborted) stop();
	async function* read() {
		let frame = Buffer.alloc(frameBytes),
			offset = 0;
		try {
			for await (const chunk of child.stdout) {
				signal?.throwIfAborted();
				let cursor = 0;
				while (cursor < chunk.length) {
					const count = Math.min(frame.length - offset, chunk.length - cursor);
					chunk.copy(frame, offset, cursor, cursor + count);
					cursor += count;
					offset += count;
					if (offset === frame.length) {
						yield frame;
						frame = Buffer.alloc(frameBytes);
						offset = 0;
					}
				}
			}
			signal?.throwIfAborted();
			assert.equal(offset, 0, "Incomplete independent RGB frame");
			await completed;
		} finally {
			stop();
		}
	}
	const iterator = read();
	return {
		next: () => iterator.next(),
		stop,
		return: async () => {
			stop();
			await iterator.return();
			await completed.catch(() => {});
		},
	};
}

/** Stop both owned processes synchronously before awaiting either iterator. */
export async function closeFlameExportReaders(readers) {
	for (const reader of readers) reader?.stop();
	await Promise.all(readers.map((reader) => reader?.return()));
}
