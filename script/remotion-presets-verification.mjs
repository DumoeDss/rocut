import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Streaming independent decode: memory is bounded by one RGB frame, not the
 * complete movie. Reference samples are RGBA native PNG pixels, composited over
 * the same black export background. Check every frame, not just endpoints. */
export async function verifyPresetVideo({
	ffmpeg,
	file,
	framesDirectory,
	width,
	height,
	firstFrame,
	frameCount,
}) {
	const frameBytes = width * height * 3;
	assert.ok(
		Number.isSafeInteger(frameBytes) &&
			frameBytes > 0 &&
			frameBytes <= 64 * 1024 * 1024,
	);
	const decoder = spawn(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			file,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	let detail = "",
		timedOut = false;
	decoder.stderr.on("data", (chunk) => {
		detail = (detail + String(chunk)).slice(-4096);
	});
	const finished = new Promise((resolve, reject) => {
		decoder.once("error", reject);
		decoder.once("close", (code) => resolve(code));
	});
	// A decoder failure may arrive before stdout iteration reaches its await.
	void finished.catch(() => {});
	const timer = setTimeout(() => {
		timedOut = true;
		decoder.kill();
	}, 180000);
	try {
		const result = await verifyPresetRgbStream(decoder.stdout, {
			width,
			height,
			firstFrame,
			frameCount,
			readSamples: (index) =>
				readFile(join(framesDirectory, `${index}.samples`)),
		});
		const code = await finished;
		assert.equal(timedOut, false, "Independent video decode timed out");
		assert.equal(code, 0, `Independent video decode failed: ${detail}`);
		return result;
	} finally {
		clearTimeout(timer);
		if (decoder.exitCode === null && !decoder.killed) decoder.kill();
		await finished.catch(() => {});
	}
}

export async function verifyPresetRgbStream(
	chunks,
	{ width, height, firstFrame, frameCount, readSamples },
) {
	const frameBytes = width * height * 3;
	assert.ok(
		Number.isSafeInteger(frameBytes) &&
			frameBytes > 0 &&
			frameBytes <= 64 * 1024 * 1024,
	);
	assert.ok(Number.isSafeInteger(firstFrame) && firstFrame >= 0);
	assert.ok(Number.isSafeInteger(frameCount) && frameCount > 0);
	const frame = Buffer.alloc(frameBytes);
	let filled = 0,
		index = 0,
		totalDifference = 0,
		totalCount = 0,
		opaque = 0,
		nonblack = 0,
		worstFrameError = 0;
	for await (const chunk of chunks) {
		let offset = 0;
		while (offset < chunk.length) {
			const take = Math.min(frameBytes - filled, chunk.length - offset);
			chunk.copy(frame, filled, offset, offset + take);
			filled += take;
			offset += take;
			if (filled !== frameBytes) continue;
			assert.ok(index < frameCount, "Encoded video contains extra frames");
			const expected = await readSamples(firstFrame + index);
			const result = comparePresetFrame(frame, expected);
			assert.ok(
				result.meanAbsoluteError < 8,
				`Frame ${firstFrame + index}: exported picture mismatch ${result.meanAbsoluteError}`,
			);
			totalDifference += result.difference;
			totalCount += result.count;
			opaque += result.opaque;
			nonblack += result.nonblack;
			worstFrameError = Math.max(worstFrameError, result.meanAbsoluteError);
			index++;
			filled = 0;
		}
	}
	assert.equal(filled, 0, "Truncated RGB frame");
	assert.equal(index, frameCount, "Encoded video is missing frames");
	assert.ok(opaque > 100 && nonblack > 100, "Blank preset picture");
	return {
		decodedFrames: index,
		meanAbsoluteError: totalDifference / totalCount,
		worstFrameError,
	};
}

/** Keep the existing every-17th-pixel sampling density; retain all four original
 * bytes so alpha composition is performed independently during video decode. */
export function presetPixelSamples(rgba) {
	assert.equal(rgba.length % 4, 0, "Invalid RGBA source");
	const samples = Buffer.alloc(Math.ceil(rgba.length / 4 / 17) * 4);
	for (let pixel = 0, out = 0; pixel < rgba.length / 4; pixel += 17, out += 4)
		rgba.copy(samples, out, pixel * 4, pixel * 4 + 4);
	return samples;
}

export function comparePresetFrame(rgb, expected) {
	assert.equal(rgb.length % 3, 0, "Invalid RGB frame");
	assert.equal(
		expected.length,
		Math.ceil(rgb.length / 3 / 17) * 4,
		"Invalid native sample geometry",
	);
	let difference = 0,
		count = 0,
		opaque = 0,
		nonblack = 0;
	for (
		let pixel = 0, sample = 0;
		pixel < rgb.length / 3;
		pixel += 17, sample += 4
	) {
		const alpha = expected[sample + 3] / 255;
		if (alpha > 0.99) opaque++;
		for (let channel = 0; channel < 3; channel++) {
			const reference = expected[sample + channel] * alpha;
			difference += Math.abs(reference - rgb[pixel * 3 + channel]);
			count++;
			if (reference > 32) nonblack++;
		}
	}
	return {
		difference,
		count,
		opaque,
		nonblack,
		meanAbsoluteError: difference / count,
	};
}
