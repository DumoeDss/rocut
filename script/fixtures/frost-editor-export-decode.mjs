import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	accepts,
	frameIndex,
	metric,
	thresholds,
} from "./flame-wrap-export-metrics.mjs";

const execute = promisify(execFile);

export async function flameWrapMediaCommand({
	command,
	args,
	encoding = "buffer",
}) {
	assert(
		["buffer", "utf8"].includes(encoding),
		"Explicit binary or UTF-8 transport required",
	);
	const { stdout } = await execute(command, args, {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: 8 * 1024 * 1024,
		encoding,
	});
	if (encoding === "buffer")
		assert(
			Buffer.isBuffer(stdout),
			"Decoder output must retain exact binary bytes",
		);
	else assert.equal(typeof stdout, "string");
	return stdout;
}

export async function decodeFrostExport({
	outputPath,
	artifacts,
	references,
	baseline,
	startTicks,
	videoChroma = "420",
}) {
	assert(["420", "444"].includes(videoChroma));
	const ff = (name, args, encoding) =>
		flameWrapMediaCommand({
			command: artifacts.ffmpegDirectory
				? join(artifacts.ffmpegDirectory, `${name}.exe`)
				: name,
			args,
			encoding,
		});
	const metadata = JSON.parse(
		await ff(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-show_frames",
				"-of",
				"json",
				outputPath,
			],
			"utf8",
		),
	);
	assert.equal(metadata.streams.length, 1);
	const stream = metadata.streams[0];
	assert.equal(stream.codec_name, "vp9");
	assert.equal(stream.width, artifacts.width);
	assert.equal(stream.height, artifacts.height);
	assert.equal(stream.r_frame_rate, "24/1");
	assert.equal(stream.nb_read_frames, "13");
	assert.equal(stream.pix_fmt, videoChroma === "444" ? "yuv444p" : "yuv420p");
	assert.notEqual(stream.tags?.alpha_mode, "1");
	assert.equal(metadata.frames.length, 13);
	assert(Math.abs(Number(metadata.format.duration) - 13 / 24) <= 0.01);
	metadata.frames.forEach((frame, index) =>
		assert(
			Math.abs(Number(frame.best_effort_timestamp_time) - index / 24) <=
				thresholds.timestamp,
		),
	);
	const metrics = [];
	for (const reference of references) {
		const index = frameIndex(reference.ticks, startTicks);
		const actual = await ff("ffmpeg", [
			"-v",
			"error",
			"-i",
			outputPath,
			"-vf",
			`select=eq(n\\,${index})`,
			"-frames:v",
			"1",
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"pipe:1",
		]);
		assert.equal(actual.length, artifacts.width * artifacts.height * 3);
		const value = {
			ticks: reference.ticks,
			frameIndex: index,
			...metric(actual, reference.rgb, baseline),
		};
		metrics.push(value);
		await writeFile(
			join(artifacts.root, `frost-export-frame-${index}.rgb`),
			actual,
			{ flag: "wx" },
		);
	}
	if (!metrics.every(accepts)) {
		const error = new Error(
			`Export pixel parity rejected: ${JSON.stringify(metrics.filter((value) => !accepts(value)))}`,
		);
		error.code = "FROST_EXPORT_PIXEL_PARITY";
		error.decodeReceipt = { metadata, metrics, thresholds };
		throw error;
	}
	return { metadata, metrics };
}
