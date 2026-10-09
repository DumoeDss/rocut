import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const [artifacts, ffmpegDirectory] = process.argv.slice(2);
assert(
	[artifacts, ffmpegDirectory].every((p) => p && isAbsolute(p)),
	"Expected absolute private artifact and host-owned FFmpeg directories",
);
const video = join(artifacts, "dither-three.webm");
const run = (binary, args, extra = {}) =>
	execFileSync(join(ffmpegDirectory, binary), args, {
		windowsHide: true,
		timeout: 60000,
		maxBuffer: 16 * 1024 * 1024,
		...extra,
	});
const metadata = JSON.parse(
	run(
		"ffprobe.exe",
		[
			"-v",
			"error",
			"-count_frames",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			video,
		],
		{ encoding: "utf8" },
	),
);
assert.equal(metadata.streams.length, 1);
const stream = metadata.streams[0];
assert.equal(stream.codec_type, "video");
assert.equal(stream.codec_name, "vp9");
assert.equal(stream.width, 640);
assert.equal(stream.height, 360);
assert.equal(stream.r_frame_rate, "30/1");
assert.equal(Number(stream.nb_read_frames), 6);
assert(Math.abs(Number(metadata.format.duration) - 0.2) < 0.001);
const expected = await readFile(join(artifacts, "expected.rgba"));
const decoded = run("ffmpeg.exe", [
	"-v",
	"error",
	"-i",
	video,
	"-f",
	"rawvideo",
	"-pix_fmt",
	"rgba",
	"pipe:1",
]);
const frameBytes = 640 * 360 * 4;
assert.equal(expected.length, frameBytes * 6);
assert.equal(decoded.length, expected.length);
const metrics = [];
for (let frame = 0; frame < 6; frame++) {
	let total = 0,
		foreground = 0,
		foregroundError = 0,
		referenceContrast = 0,
		actualContrast = 0;
	const bits = {
		black: { count: 0, retained: 0 },
		white: { count: 0, retained: 0 },
	};
	for (let p = frame * frameBytes; p < (frame + 1) * frameBytes; p += 4) {
		let e = 0,
			a = 0;
		for (let c = 0; c < 4; c++)
			total += Math.abs(decoded[p + c] - expected[p + c]);
		for (let c = 0; c < 3; c++) {
			e += Math.abs(expected[p + c] - [16, 32, 48][c]);
			a += Math.abs(decoded[p + c] - [16, 32, 48][c]);
		}
		if (e > 45) {
			foreground++;
			referenceContrast += e;
			actualContrast += a;
			for (let c = 0; c < 3; c++)
				foregroundError += Math.abs(decoded[p + c] - expected[p + c]);
		}
		// Reject a blurred gray silhouette even if empty background dominates MAE.
		if (
			expected[p] === expected[p + 1] &&
			expected[p] === expected[p + 2] &&
			[0, 255].includes(expected[p])
		) {
			const white = expected[p] === 255,
				bin = white ? bits.white : bits.black;
			bin.count++;
			const channels = decoded.subarray(p, p + 3);
			if (white ? Math.min(...channels) > 220 : Math.max(...channels) < 35)
				bin.retained++;
		}
	}
	const metric = {
		frame,
		meanRgbaError: total / frameBytes,
		foregroundPixels: foreground,
		foregroundError: foregroundError / (foreground * 3),
		contrastRatio: actualContrast / referenceContrast,
		bits,
	};
	assert(
		metric.meanRgbaError < 10 &&
			foreground > 500 &&
			metric.foregroundError < 25 &&
			metric.contrastRatio > 0.7 &&
			metric.contrastRatio < 1.3,
		JSON.stringify(metric),
	);
	for (const bin of Object.values(bits))
		assert(
			bin.count > 500 && bin.retained / bin.count > 0.75,
			JSON.stringify(metric),
		);
	metrics.push(metric);
}
const evidence = {
	ok: true,
	decoder: "host-selected FFmpeg/FFprobe; no browser decoder",
	metadata,
	videoSha256: createHash("sha256")
		.update(await readFile(video))
		.digest("hex"),
	expectedSha256: createHash("sha256").update(expected).digest("hex"),
	metrics,
};
await writeFile(
	join(artifacts, "independent-decode.json"),
	JSON.stringify(evidence, null, 2) + "\n",
	{ flag: "wx", encoding: "utf8" },
);
console.log(JSON.stringify(evidence));
