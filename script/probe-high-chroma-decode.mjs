import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	assertScratch,
	sha256,
	verifyDropletsInputs,
} from "./probe-droplets-evidence.mjs";
import { historical420 } from "./probe-high-chroma-contract.mjs";
import {
	highChromaPixels,
	highChromaProbeTiming,
} from "./probe-high-chroma-metrics.mjs";

export async function decodeHighChromaArtifacts(directory, ffmpegDirectory) {
	assertScratch(directory);
	const evidencePath = join(directory, "evidence.json");
	const evidenceBytes = await readFile(evidencePath),
		evidence = JSON.parse(evidenceBytes);
	assert.equal(
		evidence.ok,
		true,
		"Original browser/provenance/cleanup evidence is not successful",
	);
	assert.equal(evidence.kind, "high-chroma-production-pipeline");
	assert.equal(evidence.browserClosed, true);
	assert.equal(evidence.serverClosed, true);
	assert.equal(
		(await verifyDropletsInputs(evidence)).ok,
		true,
		"Source changed since browser execution",
	);
	const media = JSON.parse(
		await readFile(join(directory, "media.json"), "utf8"),
	);
	const inputs = {};
	for (const [key, file] of Object.entries(media.files)) {
		assert(!/[\\/]/.test(file.filename), "Unsafe media filename");
		inputs[key] = await readFile(join(directory, file.filename));
		assert.equal(sha256(inputs[key]), file.sha256, `Media changed: ${key}`);
	}
	const video = join(directory, media.files.video.filename);
	const options = {
		windowsHide: true,
		timeout: 60000,
		maxBuffer: 32 * 1024 * 1024,
	};
	const probeArgs = [
		"-v",
		"error",
		"-show_format",
		"-show_streams",
		"-show_frames",
		"-show_packets",
		"-show_data_hash",
		"sha256",
		"-of",
		"json",
		video,
	];
	const probe = JSON.parse(
		execFileSync(join(ffmpegDirectory, "ffprobe.exe"), probeArgs, {
			...options,
			encoding: "utf8",
		}),
	);
	const timing = highChromaProbeTiming(probe, media);
	const decodeArgs = [
		"-v",
		"error",
		"-i",
		video,
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgba",
		"pipe:1",
	];
	const pixels = execFileSync(
		join(ffmpegDirectory, "ffmpeg.exe"),
		decodeArgs,
		options,
	);
	await writeFile(join(directory, "decoded-default.rgba"), pixels, {
		flag: "wx",
	});
	const comparison = highChromaPixels(
		pixels,
		inputs.expected,
		inputs.baseline,
		media,
	);
	const failedFrames = comparison.metrics
		.filter((item) => !item.actual.pass)
		.map((item) => item.frame);
	let preservedHistoricalFailure = false;
	if (media.requestedVideoChroma !== "444") {
		assert.equal(
			media.files.video.sha256,
			historical420.videoSha256,
			"Default/420 output no longer reproduces frozen history",
		);
		assert.deepEqual(failedFrames, historical420.defaultFfmpegFailedFrames);
		preservedHistoricalFailure = true;
	}
	const report = {
		kind: "high-chroma-independent-default-ffmpeg",
		caseId: media.caseId,
		requestedVideoChroma: media.requestedVideoChroma,
		evidenceSha256: sha256(evidenceBytes),
		videoSha256: sha256(inputs.video),
		probeArgs,
		decodeArgs,
		probe,
		timing,
		comparison,
		decodedSha256: sha256(pixels),
		failedFrames,
		preservedHistoricalFailure,
		accepted: media.requestedVideoChroma === "444" && comparison.actualPassed,
		ok:
			media.requestedVideoChroma === "444"
				? comparison.actualPassed
				: preservedHistoricalFailure,
		postDecodeSourceVerification: await verifyDropletsInputs(evidence),
	};
	assert.equal(
		sha256(await readFile(evidencePath)),
		report.evidenceSha256,
		"Browser evidence changed during decode",
	);
	assert.equal(report.postDecodeSourceVerification.ok, true);
	await writeFile(
		join(directory, "independent-decode.json"),
		JSON.stringify(report, null, 2) + "\n",
		{ flag: "wx" },
	);
	return report;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const args = process.argv.slice(2);
	assert(
		args.length === 2 && args.every(isAbsolute),
		"Usage: probe-high-chroma-decode <absolute C:/tmps browser artifacts> <absolute FFmpeg bin>",
	);
	const [directory, ffmpegDirectory] = await Promise.all(
		args.map((path) => realpath(path)),
	);
	const result = await decodeHighChromaArtifacts(directory, ffmpegDirectory);
	console.log(
		JSON.stringify({
			directory,
			ok: result.ok,
			accepted: result.accepted,
			preservedHistoricalFailure: result.preservedHistoricalFailure,
			failedFrames: result.failedFrames,
		}),
	);
	if (!result.ok) process.exitCode = 1;
}
