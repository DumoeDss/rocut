import assert from "node:assert/strict";
import { spawn } from "node:child_process";

export async function particleMaterialPixels(ffmpeg: string, png: string) {
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
	let red = 0,
		green = 0,
		sumX2 = 0;
	let count = 0,
		sumX = 0,
		minX = 320,
		maxX = -1;
	for (let y = 0; y < 240; y++)
		for (let x = 0; x < 320; x++) {
			const i = (y * 320 + x) * 4;
			const isRed = bytes[i] > 200 && bytes[i + 1] < 30;
			const isGreen = bytes[i + 1] > 200 && bytes[i] < 30;
			if (bytes[i + 3] > 200 && (isRed || isGreen)) {
				if (isRed) red++;
				else green++;
				sumX2 += x * x;
				count++;
				sumX += x;
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
			}
		}
	assert.ok(
		count > 1000 && red > 300 && green > 300,
		`Expected visible sampled particles, got ${count} pixels`,
	);
	return {
		activePixels: count,
		red,
		green,
		centroidX: sumX / count,
		varianceX: sumX2 / count - (sumX / count) ** 2,
		minX,
		maxX,
	};
}
