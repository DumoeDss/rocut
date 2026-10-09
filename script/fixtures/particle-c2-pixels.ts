import assert from "node:assert/strict";
import { spawn } from "node:child_process";

export async function particlePixels(ffmpeg: string, png: string) {
	const bytes = await new Promise<Buffer>((resolve, reject) => {
		const child = spawn(
			ffmpeg,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				png,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		const output: Buffer[] = [],
			errors: Buffer[] = [];
		child.stdout.on("data", (value) => output.push(value));
		child.stderr.on("data", (value) => errors.push(value));
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? resolve(Buffer.concat(output))
				: reject(
						Error(
							"PNG decode failed: " +
								Buffer.concat(errors).toString("utf8").slice(0, 1000),
						),
					),
		);
	});
	assert.equal(bytes.length, 320 * 240 * 4);
	let count = 0,
		sumX = 0,
		minX = 320,
		maxX = -1;
	for (let y = 0; y < 240; y++)
		for (let x = 0; x < 320; x++) {
			const i = (y * 320 + x) * 4;
			if (bytes[i + 3] > 200 && bytes[i + 2] > 180 && bytes[i + 1] > 100) {
				count++;
				sumX += x;
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
			}
		}
	assert.ok(
		count > 2500,
		`Expected visible sampled particles, got ${count} pixels`,
	);
	return { activePixels: count, centroidX: sumX / count, minX, maxX };
}
