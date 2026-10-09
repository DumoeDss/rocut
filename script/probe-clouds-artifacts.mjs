import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudsContained, cloudsSha256 } from "./probe-clouds-evidence.mjs";

export async function saveCloudsJson(directory, filename, value) {
	const path = join(directory, filename);
	cloudsContained(directory, path);
	const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
	await writeFile(path, bytes, { flag: "wx" });
	return { filename, bytes: bytes.length, sha256: cloudsSha256(bytes) };
}
export async function cloudsDeadline(promise, milliseconds, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error(`${label} timed out`)),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
export async function captureClouds(page, directory, report) {
	if (!page || page.isClosed()) return;
	const read = (key) =>
		cloudsDeadline(
			page.evaluate((name) => Reflect.get(globalThis, name) ?? null, key),
			5000,
			`Capture ${key}`,
		);
	try {
		report.checks = await read("__cloudsResult");
		const progress = await read("__cloudsProgress");
		if (report.checks)
			report.resultArtifact = await saveCloudsJson(
				directory,
				"browser-result.json",
				report.checks,
			);
		if (progress)
			report.progressArtifact = await saveCloudsJson(
				directory,
				"browser-progress.json",
				progress,
			);
	} catch (error) {
		report.captureErrors.push(`results: ${String(error)}`);
	}
	try {
		const raw = await read("__cloudsFrames");
		if (!raw) return;
		assert.equal(raw.width, 192);
		assert.equal(raw.height, 128);
		assert.deepEqual(raw.rate, { numerator: 30, denominator: 1 });
		assert.equal(raw.frames.length, 6);
		assert.deepEqual(
			raw.frames.map((frame) => frame.ticks),
			[48000, 52000, 56000, 60000, 64000, 68000],
		);
		const stride = raw.width * raw.height * 4;
		const decode = (value) => {
			assert(
				typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
				"Invalid raw RGBA encoding",
			);
			const bytes = Buffer.from(value, "base64");
			assert.equal(bytes.length, stride);
			return bytes;
		};
		const source = decode(raw.source),
			actual = Buffer.concat(raw.frames.map((frame) => decode(frame.rgba))),
			expected = Buffer.concat(
				raw.frames.map((frame) => decode(frame.expectedRgba)),
			);
		const files = {};
		for (const [name, bytes] of [
			["source.rgba", source],
			["native.rgba", actual],
			["expected.rgba", expected],
		]) {
			await writeFile(join(directory, name), bytes, { flag: "wx" });
			files[name] = {
				filename: name,
				bytes: bytes.length,
				sha256: cloudsSha256(bytes),
			};
		}
		report.rawFrames = {
			kind: "raw-native-raster-not-an-encoded-video",
			width: raw.width,
			height: raw.height,
			rate: raw.rate,
			params: raw.params,
			ticks: raw.frames.map((frame) => frame.ticks),
			files,
		};
		await saveCloudsJson(directory, "raw-frames.json", report.rawFrames);
	} catch (error) {
		report.captureErrors.push(`rawFrames: ${String(error)}`);
	}
}
