import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertContained,
	assertScratch,
	sha256,
} from "./probe-droplets-evidence.mjs";
import { saveDropletsJson } from "./probe-droplets-artifacts.mjs";
import { validateDropletsMedia } from "./probe-droplets-pipeline-artifacts.mjs";
import {
	compareDropletsSequence,
	validateDropletsProbeTiming,
} from "./probe-droplets-metrics.mjs";

const args = process.argv.slice(2);
assert(
	args.length === 2 && args.every(isAbsolute),
	"Usage: node script/probe-droplets-decode.mjs <absolute pipeline artifact directory> <absolute FFmpeg binary directory>",
);
const [directory, ffmpeg] = await Promise.all(
	args.map((path) => realpath(path)),
);
assertScratch(directory);
const report = {
	ok: false,
	decoder: "independent FFmpeg/FFprobe",
	startedAt: new Date().toISOString(),
};
const inputs = new Map();
async function readInput(name, recorded) {
	const path = join(directory, name);
	assertContained(directory, await realpath(path));
	const bytes = await readFile(path),
		hash = sha256(bytes);
	if (recorded) {
		assert.equal(hash, recorded.sha256, `${name} hash differs`);
		assert.equal(bytes.length, recorded.bytes, `${name} byte length differs`);
	}
	inputs.set(name, hash);
	return bytes;
}
try {
	const runnerDirectory = dirname(fileURLToPath(import.meta.url));
	report.decoderInputs = Object.fromEntries(
		await Promise.all(
			[
				"probe-droplets-decode.mjs",
				"probe-droplets-evidence.mjs",
				"probe-droplets-artifacts.mjs",
				"probe-droplets-pipeline-artifacts.mjs",
				"probe-droplets-metrics.mjs",
			].map(async (name) => [
				join(runnerDirectory, name),
				sha256(await readFile(join(runnerDirectory, name))),
			]),
		),
	);
	const evidenceBytes = await readInput("evidence.json"),
		evidence = JSON.parse(evidenceBytes);
	assert(
		evidence.ok &&
			evidence.mode === "pipeline" &&
			evidence.kind === "droplets-production-pipeline",
		"Requires successful pipeline evidence",
	);
	const metadata = validateDropletsMedia(
		JSON.parse(await readInput("media.json", evidence.pipelineMedia.manifest)),
	);
	assert.equal(metadata.kind, "production-vp9-webm");
	for (const name of ["video", "expected", "baseline"])
		assert.deepEqual(metadata.files[name], evidence.pipelineMedia.files[name]);
	const reference = await readInput("expected.rgba", metadata.files.expected);
	const baseline = await readInput("baseline.rgba", metadata.files.baseline);
	const video = await readInput("production.webm", metadata.files.video);
	const { width, height, frames, fps } = metadata,
		stride = width * height * 4;
	assert.equal(reference.length, frames * stride);
	assert.equal(baseline.length, stride);
	for (const pixels of [reference, baseline])
		for (let offset = 3; offset < pixels.length; offset += 4)
			assert.equal(
				pixels[offset],
				255,
				"References were not composited onto opaque background",
			);
	const options = {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: Math.max(frames * stride + 65536, 1024 * 1024),
	};
	const ffprobePath = await realpath(join(ffmpeg, "ffprobe.exe")),
		ffmpegPath = await realpath(join(ffmpeg, "ffmpeg.exe"));
	const probe = JSON.parse(
		execFileSync(
			ffprobePath,
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_frames",
				"-show_format",
				"-of",
				"json",
				join(directory, "production.webm"),
			],
			{ ...options, encoding: "utf8" },
		),
	);
	const tracks = probe.streams.filter(
		(stream) => stream.codec_type === "video",
	);
	assert.equal(tracks.length, 1, "Expected one video stream");
	const track = tracks[0];
	assert.equal(track.codec_name, "vp9");
	assert.equal(track.width, width);
	assert.equal(track.height, height);
	assert.equal(Number(track.nb_read_frames), frames);
	assert.equal(track.r_frame_rate, `${fps}/1`);
	const timing = validateDropletsProbeTiming(probe, metadata);
	const decoded = execFileSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-i",
			join(directory, "production.webm"),
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"pipe:1",
		],
		options,
	);
	const comparison = compareDropletsSequence(
		decoded,
		reference,
		baseline,
		stride,
		frames,
	);
	Object.assign(report, {
		sourceEvidenceSha256: sha256(evidenceBytes),
		reference: metadata.reference,
		width,
		height,
		frames,
		fps,
		codec: track.codec_name,
		thresholds: metadata.thresholds,
		activeMask:
			"Any expected/source RGB byte differs by more than 15; mask does not depend on decoded pixels",
		...timing,
		repeatedFirstCounterfactual:
			"Independent expected[0] repeated across six frames; browser fixture separately tests decoded[0] repetition",
		...comparison,
		decodedSha256: sha256(decoded),
		videoSha256: sha256(video),
		expectedSha256: sha256(reference),
		baselineSha256: sha256(baseline),
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
	assert(comparison.actualPassed, "Decoded video failed fixed pixel gates");
	assert(
		comparison.baselineRejectedFrames.length > 0,
		"Verifier would accept stale baseline sequence",
	);
	assert(
		comparison.repeatedFirstRejectedFrames.length > 0,
		"Verifier would accept repeated-first-frame sequence",
	);
	report.ok = true;
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	report.inputHashes = Object.fromEntries(inputs);
	report.postRunFailures = [];
	for (const [name, hash] of inputs) {
		try {
			assert.equal(sha256(await readFile(join(directory, name))), hash, name);
		} catch (error) {
			report.postRunFailures.push(String(error));
			report.ok = false;
		}
	}
	for (const [path, hash] of Object.entries(report.decoderInputs ?? {})) {
		try {
			assert.equal(sha256(await readFile(path)), hash, path);
		} catch (error) {
			report.postRunFailures.push(String(error));
			report.ok = false;
		}
	}
	report.finishedAt = new Date().toISOString();
	await saveDropletsJson(directory, "independent-decode.json", report);
	console.log(JSON.stringify(report));
	if (!report.ok) process.exitCode = 1;
}
