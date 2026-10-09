import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	cloudsContained,
	cloudsScratch,
	cloudsSha256,
} from "./probe-clouds-evidence.mjs";
import { saveCloudsJson } from "./probe-clouds-artifacts.mjs";
import {
	requireCloudsPipelineSuccess,
	validateCloudsMedia,
} from "./probe-clouds-contract.mjs";
import {
	compareCloudsSequence,
	validateCloudsProbeTiming,
} from "./probe-clouds-metrics.mjs";

const args = process.argv.slice(2);
assert(
	args.length === 2 && args.every(isAbsolute),
	"Usage: node script/probe-clouds-decode.mjs <absolute C:/tmps pipeline artifact directory> <absolute FFmpeg binary directory>",
);
const [directory, ffmpeg] = await Promise.all(
	args.map((path) => realpath(path)),
);
cloudsScratch(directory);
const report = {
	ok: false,
	accepted: false,
	decoder: "independent FFmpeg/FFprobe; default chroma reconstruction",
	startedAt: new Date().toISOString(),
};
const inputs = new Map();
async function readContained(name) {
	const path = join(directory, name);
	cloudsContained(directory, path);
	cloudsContained(directory, await realpath(path));
	return readFile(path);
}
async function readInput(name, recorded) {
	const bytes = await readContained(name),
		hash = cloudsSha256(bytes);
	if (recorded) {
		assert.equal(recorded.filename, name, `Unexpected ${name} filename`);
		assert.equal(hash, recorded.sha256, `${name} hash differs`);
		assert.equal(bytes.length, recorded.bytes, `${name} length differs`);
	}
	inputs.set(name, hash);
	return bytes;
}
const parse = (bytes) =>
	JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
try {
	const runnerDirectory = dirname(fileURLToPath(import.meta.url));
	report.decoderInputs = Object.fromEntries(
		await Promise.all(
			[
				"probe-clouds-decode.mjs",
				"probe-clouds-contract.mjs",
				"probe-clouds-metrics.mjs",
				"probe-clouds-evidence.mjs",
				"probe-clouds-artifacts.mjs",
			].map(async (name) => {
				const path = join(runnerDirectory, name);
				return [path, cloudsSha256(await readFile(path))];
			}),
		),
	);
	const evidenceBytes = await readInput("evidence.json"),
		evidence = parse(evidenceBytes);
	report.sourceEvidenceSha256 = cloudsSha256(evidenceBytes);
	requireCloudsPipelineSuccess(evidence);
	assert(
		evidence.pipelineMedia?.manifest && evidence.pipelineMedia?.files,
		"Clouds pipeline media provenance is missing",
	);
	const media = validateCloudsMedia(
		parse(await readInput("media.json", evidence.pipelineMedia.manifest)),
	);
	assert.equal(media.kind, "production-vp9-webm");
	for (const key of ["video", "expected", "baseline"])
		assert.deepEqual(media.files[key], evidence.pipelineMedia.files[key]);
	const reference = await readInput("expected.rgba", media.files.expected),
		baseline = await readInput("baseline.rgba", media.files.baseline),
		video = await readInput("production.webm", media.files.video);
	const { width, height, frames, fps } = media,
		stride = width * height * 4;
	assert.equal(reference.length, frames * stride);
	assert.equal(baseline.length, stride);
	for (const bytes of [reference, baseline])
		for (let offset = 3; offset < bytes.length; offset += 4)
			assert.equal(bytes[offset], 255, "Clouds references must be opaque");
	const options = {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: Math.max(frames * stride + 65536, 1024 * 1024),
	};
	const ffprobePath = await realpath(join(ffmpeg, "ffprobe.exe")),
		ffmpegPath = await realpath(join(ffmpeg, "ffmpeg.exe"));
	for (const path of [ffprobePath, ffmpegPath]) cloudsContained(ffmpeg, path);
	const videoPath = join(directory, "production.webm");
	const probeArgs = [
		"-v",
		"error",
		"-count_frames",
		"-show_streams",
		"-show_frames",
		"-show_packets",
		"-show_format",
		"-of",
		"json",
		videoPath,
	];
	const probe = parse(
		Buffer.from(execFileSync(ffprobePath, probeArgs, options)),
	);
	const tracks = probe.streams.filter(
		(stream) => stream.codec_type === "video",
	);
	assert.equal(tracks.length, 1, "Expected one Clouds video stream");
	const track = tracks[0];
	assert.equal(track.codec_name, "vp9");
	assert.equal(track.width, width);
	assert.equal(track.height, height);
	assert.equal(Number(track.nb_read_frames), frames);
	assert.equal(track.r_frame_rate, `${fps}/1`);
	const timing = validateCloudsProbeTiming(probe, media);
	// Intentionally no scale/chroma/filter override: this is the unchanged default conversion.
	const decodeArgs = [
		"-v",
		"error",
		"-i",
		videoPath,
		"-map",
		"0:v:0",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgba",
		"pipe:1",
	];
	const decoded = execFileSync(ffmpegPath, decodeArgs, options);
	const comparison = compareCloudsSequence(
		decoded,
		reference,
		baseline,
		stride,
		frames,
	);
	Object.assign(report, {
		reference: media.reference,
		width,
		height,
		frames,
		fps,
		codec: track.codec_name,
		thresholds: media.thresholds,
		activeMask:
			"Any expected/source RGB byte differs by more than 15; the mask never depends on decoded errors",
		repeatedFirstCounterfactual:
			"Independent expected[0] repeated across six frames; browser fixture separately checks decoded[0] repetition",
		...timing,
		...comparison,
		decodedSha256: cloudsSha256(decoded),
		videoSha256: cloudsSha256(video),
		expectedSha256: cloudsSha256(reference),
		baselineSha256: cloudsSha256(baseline),
		probeArgs,
		decodeArgs,
		stream: track,
		toolVersions: {
			ffmpeg: execFileSync(ffmpegPath, ["-version"], {
				...options,
				encoding: "utf8",
			}).split(/\r?\n/)[0],
			ffprobe: execFileSync(ffprobePath, ["-version"], {
				...options,
				encoding: "utf8",
			}).split(/\r?\n/)[0],
		},
	});
	assert(
		comparison.actualPassed,
		"Decoded Clouds video failed fixed pixel gates",
	);
	assert.deepEqual(
		comparison.baselineRejectedFrames,
		[0, 1, 2, 3, 4, 5],
		"Clouds reference no longer rejects the no-effect sequence on every frame",
	);
	assert.deepEqual(
		comparison.repeatedFirstRejectedFrames,
		[1, 2, 3, 4, 5],
		"Clouds reference no longer rejects repeated-first sequence on frames 1-5",
	);
	report.ok = true;
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	report.inputHashes = Object.fromEntries(inputs);
	report.postRunFailures = [];
	for (const [name, hash] of inputs)
		try {
			assert.equal(cloudsSha256(await readContained(name)), hash, name);
		} catch (error) {
			report.postRunFailures.push(String(error));
			report.ok = false;
		}
	for (const [path, hash] of Object.entries(report.decoderInputs ?? {}))
		try {
			assert.equal(cloudsSha256(await readFile(path)), hash, path);
		} catch (error) {
			report.postRunFailures.push(String(error));
			report.ok = false;
		}
	report.accepted = report.ok === true;
	report.finishedAt = new Date().toISOString();
	await saveCloudsJson(directory, "independent-decode.json", report);
	console.log(
		JSON.stringify({
			ok: report.ok,
			accepted: report.accepted,
			directory,
			failure: report.failure,
			metrics: report.metrics,
			postRunFailures: report.postRunFailures,
		}),
	);
	if (!report.ok) process.exitCode = 1;
}
