import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const [directory, ffmpegDirectory] = process.argv.slice(2);
assert(
	directory &&
		ffmpegDirectory &&
		isAbsolute(directory) &&
		isAbsolute(ffmpegDirectory),
);
const movie = join(directory, "spatial.webm");
const options = {
	windowsHide: true,
	timeout: 30000,
	maxBuffer: 16 * 1024 * 1024,
};
const metadata = JSON.parse(
	execFileSync(
		join(ffmpegDirectory, "ffprobe.exe"),
		[
			"-v",
			"error",
			"-count_frames",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			movie,
		],
		{ ...options, encoding: "utf8" },
	),
);
const track = metadata.streams.find((stream) => stream.codec_type === "video");
assert(
	track &&
		track.width === 640 &&
		track.height === 360 &&
		track.nb_read_frames === "6",
);
assert.equal(track.codec_name, "vp9");
assert.equal(track.r_frame_rate, "30/1");
const actual = execFileSync(
	join(ffmpegDirectory, "ffmpeg.exe"),
	["-v", "error", "-i", movie, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
	options,
);
const expected = await readFile(join(directory, "expected.rgba"));
const stride = 640 * 360 * 4;
// The contact sheet's first tile is the exact unfiltered reference frame.
const baseline = execFileSync(
	join(ffmpegDirectory, "ffmpeg.exe"),
	[
		"-v",
		"error",
		"-i",
		join(directory, "contact-sheet.png"),
		"-vf",
		"crop=640:360:0:0",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgba",
		"pipe:1",
	],
	options,
);
assert.equal(baseline.length, stride);
assert.equal(actual.length, stride * 6);
assert.equal(expected.length, actual.length);
const metrics = [];
for (let frame = 0; frame < 6; frame++) {
	const centerX = (0.2 + frame * 0.1) * 640,
		centerY = (0.35 + frame * 0.05) * 360;
	let error = 0,
		regionError = 0,
		regionPixels = 0,
		activeError = 0,
		activePixels = 0;
	let sum = 0,
		sum2 = 0,
		referenceSum = 0,
		referenceSum2 = 0;
	for (let y = 0; y < 360; y++)
		for (let x = 0; x < 640; x++) {
			const i = frame * stride + (y * 640 + x) * 4;
			for (let c = 0; c < 4; c++)
				error += Math.abs(actual[i + c] - expected[i + c]);
			if (
				[0, 1, 2].some(
					(c) => Math.abs(expected[i + c] - baseline[(i % stride) + c]) > 15,
				)
			) {
				activePixels++;
				for (let c = 0; c < 3; c++)
					activeError += Math.abs(actual[i + c] - expected[i + c]);
			}
			if ((x + 0.5 - centerX) ** 2 + (y + 0.5 - centerY) ** 2 >= 144 ** 2)
				continue;
			regionPixels++;
			for (let c = 0; c < 3; c++)
				regionError += Math.abs(actual[i + c] - expected[i + c]);
			const luma = (actual[i] + actual[i + 1] + actual[i + 2]) / 3;
			const reference = (expected[i] + expected[i + 1] + expected[i + 2]) / 3;
			sum += luma;
			sum2 += luma * luma;
			referenceSum += reference;
			referenceSum2 += reference * reference;
		}
	const deviation = Math.sqrt(sum2 / regionPixels - (sum / regionPixels) ** 2);
	const referenceDeviation = Math.sqrt(
		referenceSum2 / regionPixels - (referenceSum / regionPixels) ** 2,
	);
	const metric = {
		frame,
		meanRgbaError: error / stride,
		regionError: regionError / (regionPixels * 3),
		regionPixels,
		contrastRatio: deviation / referenceDeviation,
		activeError: activeError / (activePixels * 3),
		activePixels,
	};
	metrics.push(metric);
}
const ok = metrics.every(
	(metric) =>
		metric.meanRgbaError < 10 &&
		metric.regionError < 15 &&
		metric.regionPixels > 20000 &&
		metric.activeError < 15 &&
		metric.activePixels > 2000 &&
		metric.contrastRatio > 0.8 &&
		metric.contrastRatio < 1.2,
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = {
	ok,
	decoder: "independent FFmpeg/FFprobe",
	metadata,
	metrics,
	videoSha256: sha(await readFile(movie)),
	expectedSha256: sha(expected),
};
await writeFile(
	join(directory, "independent-region-decode.json"),
	JSON.stringify(evidence, null, 2) + "\n",
	{ flag: "wx" },
);
console.log(JSON.stringify({ ok, metrics, videoSha256: evidence.videoSha256 }));
assert(
	ok,
	"Spatial encoded active-region quality gate failed; report retained",
);
