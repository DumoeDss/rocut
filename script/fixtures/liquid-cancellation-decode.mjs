import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const paths = process.argv.slice(2);
assert.equal(
	paths.length,
	2,
	"Expected artifact directory and FFmpeg directory",
);
assert(paths.every(isAbsolute));
const [directory, ffmpeg] = await Promise.all(
	paths.map((path) => realpath(path)),
);
assert(/^c:[/\\]tmps[/\\]/i.test(directory));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalBytes = await readFile(join(directory, "evidence.json"));
const original = JSON.parse(originalBytes);
assert(original.ok && original.mode === "pipeline");
const exported = original.checks.checks.find((check) => check.codec === "vp9");
assert(exported && exported.frames === 3);
const { width, height, frames, fps, thresholds } = exported;
const reference = await readFile(join(directory, "expected.rgba"));
const baseline = await readFile(join(directory, "baseline.rgba"));
const video = join(directory, "recovery.webm");
assert.equal(hash(await readFile(video)), original.recoveryVideo.sha256);
assert.equal(hash(reference), original.recoveryReference.sha256);
assert.equal(hash(baseline), original.recoveryBaseline.sha256);
const options = {
	windowsHide: true,
	timeout: 30000,
	maxBuffer: 16 * 1024 * 1024,
};
const metadata = JSON.parse(
	execFileSync(
		join(ffmpeg, "ffprobe.exe"),
		[
			"-v",
			"error",
			"-count_frames",
			"-show_streams",
			"-show_frames",
			"-of",
			"json",
			video,
		],
		{ ...options, encoding: "utf8" },
	),
);
const track = metadata.streams.find((stream) => stream.codec_type === "video");
assert(
	track &&
		track.codec_name === "vp9" &&
		track.width === width &&
		track.height === height,
);
assert.equal(Number(track.nb_read_frames), frames);
assert.equal(track.r_frame_rate, `${fps}/1`);
const decoded = execFileSync(
	join(ffmpeg, "ffmpeg.exe"),
	["-v", "error", "-i", video, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
	options,
);
const stride = width * height * 4;
assert.equal(decoded.length, frames * stride);
assert.equal(reference.length, decoded.length);
assert.equal(baseline.length, stride);
const decodedFrames = metadata.frames.filter(
	(frame) => frame.media_type === "video",
);
const metrics = [];
for (let frame = 0; frame < frames; frame++) {
	let total = 0,
		activeTotal = 0,
		activePixels = 0,
		baselineActiveError = 0;
	for (let pixel = 0; pixel < stride; pixel += 4) {
		const offset = frame * stride + pixel;
		for (let channel = 0; channel < 4; channel++)
			total += Math.abs(
				decoded[offset + channel] - reference[offset + channel],
			);
		if (
			[0, 1, 2].some(
				(channel) =>
					Math.abs(reference[offset + channel] - baseline[pixel + channel]) >
					15,
			)
		) {
			activePixels++;
			for (let channel = 0; channel < 3; channel++) {
				activeTotal += Math.abs(
					decoded[offset + channel] - reference[offset + channel],
				);
				baselineActiveError += Math.abs(
					baseline[pixel + channel] - reference[offset + channel],
				);
			}
		}
	}
	const result = {
		frame,
		meanRgba: total / stride,
		activeRgb: activeTotal / (activePixels * 3),
		activePixels,
		baselineCounterfactualActiveRgb: baselineActiveError / (activePixels * 3),
		timestamp: Number(decodedFrames[frame].best_effort_timestamp_time),
	};
	assert(
		result.meanRgba <= thresholds.meanRgba &&
			result.activeRgb <= thresholds.activeRgb &&
			activePixels >= thresholds.activePixels,
		JSON.stringify(result),
	);
	assert(Math.abs(result.timestamp - frame / fps) <= thresholds.timestamp);
	assert(
		result.baselineCounterfactualActiveRgb > thresholds.activeRgb,
		"Pixel test would accept a stale baseline",
	);
	metrics.push(result);
}
assert.equal(
	hash(await readFile(join(directory, "evidence.json"))),
	hash(originalBytes),
);
const evidence = {
	ok: true,
	sourceEvidenceSha256: hash(originalBytes),
	decoder: "independent FFmpeg/FFprobe",
	reference:
		"Recovered production CanvasRenderer frames, not an independent solver oracle",
	width,
	height,
	frames,
	fps,
	codec: track.codec_name,
	thresholds,
	metrics,
	decodedSha256: hash(decoded),
	movieSha256: original.recoveryVideo.sha256,
	baselineSha256: hash(baseline),
	expectedSha256: hash(reference),
};
await writeFile(
	join(directory, "independent-decode.json"),
	JSON.stringify(evidence, null, 2) + "\n",
	{ flag: "wx" },
);
console.log(JSON.stringify(evidence));
