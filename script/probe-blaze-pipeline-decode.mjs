import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	blazeContained,
	blazeScratch,
	blazeSha256,
	verifyBlazeInputs,
} from "./probe-blaze-evidence.mjs";
import { saveBlazeJson } from "./probe-blaze-artifacts.mjs";
import { validateBlazePipelineMedia } from "./probe-blaze-pipeline-contract.mjs";
import {
	compareBlazePipelineSequence,
	validateBlazePipelineProbeTiming,
} from "./probe-blaze-pipeline-metrics.mjs";
import { blazePipelinePng } from "./probe-blaze-pipeline-png.mjs";

export async function decodeBlazePipelineArtifacts(directory, ffmpegDirectory) {
	blazeScratch(directory);
	const report = {
		ok: false,
		independentAccepted: false,
		overallPipelineAccepted: false,
		kind: "blaze-independent-default-ffmpeg",
		inputHashes: {},
		startedAt: new Date().toISOString(),
	};
	const read = async (name, descriptor) => {
		assert(typeof name === "string" && !/[\\/:]/.test(name));
		const path = join(directory, name);
		blazeContained(directory, await realpath(path));
		const bytes = await readFile(path),
			sha256 = blazeSha256(bytes);
		if (descriptor) {
			assert.equal(descriptor.filename, name);
			assert.equal(descriptor.bytes, bytes.length);
			assert.equal(descriptor.sha256, sha256);
		}
		report.inputHashes[name] = sha256;
		return bytes;
	};
	const save = async (name, bytes) => {
		await writeFile(join(directory, name), bytes, { flag: "wx" });
		return { filename: name, bytes: bytes.length, sha256: blazeSha256(bytes) };
	};
	const parse = (bytes) =>
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	let evidence;
	try {
		const runnerDirectory = dirname(fileURLToPath(import.meta.url));
		report.decoderInputs = Object.fromEntries(
			await Promise.all(
				[
					"probe-blaze-pipeline-decode.mjs",
					"probe-blaze-pipeline-metrics.mjs",
					"probe-blaze-pipeline-contract.mjs",
					"probe-blaze-pipeline-png.mjs",
					"probe-blaze-evidence.mjs",
					"probe-blaze-artifacts.mjs",
					"probe-blaze-contract.mjs",
				].map(async (name) => {
					const path = join(runnerDirectory, name);
					return [path, blazeSha256(await readFile(path))];
				}),
			),
		);
		evidence = parse(await read("evidence.json"));
		assert.equal(evidence.kind, "blaze-production-pipeline");
		assert.equal(evidence.mode, "pipeline");
		assert.equal(evidence.browserClosed, true);
		assert.equal(evidence.serverClosed, true);
		assert.equal(evidence.checks?.nativeHandlesGone, true);
		assert.deepEqual(evidence.checks.cleanupErrors, []);
		for (const key of [
			"captureErrors",
			"pageErrors",
			"httpErrors",
			"externalRequests",
		])
			assert.deepEqual(evidence[key], []);
		assert(
			!evidence.failure &&
				!evidence.console.some((message) => message.type === "error"),
		);
		assert.equal((await verifyBlazeInputs(evidence)).ok, true);
		report.browserAccepted = evidence.ok === true;
		assert(evidence.pipelineMedia?.manifest);
		const media = validateBlazePipelineMedia(
			parse(await read("media.json", evidence.pipelineMedia.manifest)),
		);
		assert.equal(media.kind, "blaze-production-vp9-webm");
		assert.deepEqual(media.files, evidence.pipelineMedia.files);
		const inputs = {};
		for (const [key, file] of Object.entries(media.files))
			inputs[key] = await read(file.filename, file);
		const stride = media.width * media.height * 4;
		assert.equal(inputs.expected.length, stride * 6);
		assert.equal(inputs.baseline.length, stride);
		const ffprobe = await realpath(join(ffmpegDirectory, "ffprobe.exe")),
			ffmpeg = await realpath(join(ffmpegDirectory, "ffmpeg.exe"));
		for (const path of [ffprobe, ffmpeg]) blazeContained(ffmpegDirectory, path);
		const options = {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 16 * 1024 * 1024,
		};
		const video = join(directory, "production.webm");
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
			video,
		];
		const probe = parse(execFileSync(ffprobe, probeArgs, options));
		report.probeArtifact = await saveBlazeJson(
			directory,
			"ffprobe.json",
			probe,
		);
		const tracks = probe.streams.filter(
			(stream) => stream.codec_type === "video",
		);
		assert.equal(tracks.length, 1);
		const track = tracks[0];
		assert.equal(track.codec_name, "vp9");
		assert.equal(track.width, 192);
		assert.equal(track.height, 128);
		assert.equal(Number(track.nb_read_frames), 6);
		assert.equal(
			track.r_frame_rate,
			"30000/1001",
			"Encoded nominal rational frame rate changed",
		);
		assert.equal(
			track.profile,
			media.requestedVideoChroma === "444" ? "Profile 1" : "Profile 0",
		);
		assert.equal(
			track.pix_fmt,
			media.requestedVideoChroma === "444" ? "yuv444p" : "yuv420p",
		);
		const timing = validateBlazePipelineProbeTiming(probe, media);
		// Default FFmpeg conversion only. No filter, kernel, scale or chroma override.
		const decodeArgs = [
			"-v",
			"error",
			"-i",
			video,
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"pipe:1",
		];
		const decoded = execFileSync(ffmpeg, decodeArgs, options);
		report.decoded = await save("decoded-default.rgba", decoded);
		assert.equal(decoded.length, stride * 6);
		report.decodedPngs = [];
		for (let index = 0; index < 6; index++)
			report.decodedPngs.push(
				await save(
					`ffmpeg-decoded-${index}.png`,
					blazePipelinePng(
						decoded.subarray(index * stride, (index + 1) * stride),
						192,
						128,
					),
				),
			);
		const comparison = compareBlazePipelineSequence(
			decoded,
			inputs.expected,
			inputs.baseline,
			stride,
			6,
		);
		const repeatedDecoded = compareBlazePipelineSequence(
			Buffer.concat(
				Array.from({ length: 6 }, () => decoded.subarray(0, stride)),
			),
			inputs.expected,
			inputs.baseline,
			stride,
			6,
		);
		report.counterfactuals = {
			baseline: await save(
				"counterfactual-baseline.rgba",
				Buffer.concat(Array.from({ length: 6 }, () => inputs.baseline)),
			),
			repeatedExpectedFirst: await save(
				"counterfactual-expected-first.rgba",
				Buffer.concat(
					Array.from({ length: 6 }, () => inputs.expected.subarray(0, stride)),
				),
			),
			repeatedDecodedFirst: await save(
				"counterfactual-decoded-first.rgba",
				Buffer.concat(
					Array.from({ length: 6 }, () => decoded.subarray(0, stride)),
				),
			),
		};
		Object.assign(report, {
			requestedVideoChroma: media.requestedVideoChroma,
			thresholds: media.thresholds,
			frameRate: media.frameRate,
			fps: media.fps,
			localTicks: media.localTicks,
			timelineTicks: media.timelineTicks,
			probeArgs,
			decodeArgs,
			stream: track,
			timing,
			comparison,
			repeatedDecoded,
		});
		assert.deepEqual(comparison.baselineRejectedFrames, [0, 1, 2, 3, 4, 5]);
		assert(comparison.repeatedFirstRejectedFrames.some((frame) => frame > 0));
		assert(
			repeatedDecoded.metrics.slice(1).some((metric) => !metric.actual.pass),
		);
		report.independentAccepted = comparison.actualPassed;
		report.overallPipelineAccepted =
			report.browserAccepted && report.independentAccepted;
		report.ok = report.overallPipelineAccepted;
		if (!report.independentAccepted)
			report.failure =
				"Default independent FFmpeg decode failed frozen pixel gates";
	} catch (error) {
		report.failure = error.stack ?? String(error);
	} finally {
		report.postRunFailures = [];
		for (const [name, sha] of Object.entries(report.inputHashes))
			try {
				assert.equal(blazeSha256(await readFile(join(directory, name))), sha);
			} catch (error) {
				report.postRunFailures.push(String(error));
			}
		for (const [path, sha] of Object.entries(report.decoderInputs ?? {}))
			try {
				assert.equal(blazeSha256(await readFile(path)), sha);
			} catch (error) {
				report.postRunFailures.push(String(error));
			}
		if (evidence) {
			try {
				report.postRunVerification = await verifyBlazeInputs(evidence);
			} catch (error) {
				report.postRunFailures.push(`Source verification: ${String(error)}`);
			}
		}
		if (
			report.postRunFailures.length ||
			report.postRunVerification?.ok !== true
		)
			report.ok = report.overallPipelineAccepted = false;
		report.finishedAt = new Date().toISOString();
		await saveBlazeJson(directory, "independent-decode.json", report);
	}
	return report;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const args = process.argv.slice(2);
	assert(
		args.length === 2 && args.every(isAbsolute),
		"Usage: probe-blaze-pipeline-decode <absolute C:/tmps browser artifacts> <absolute FFmpeg bin>",
	);
	const [directory, ffmpeg] = await Promise.all(
		args.map((path) => realpath(path)),
	);
	const report = await decodeBlazePipelineArtifacts(directory, ffmpeg);
	console.log(
		JSON.stringify({
			directory,
			ok: report.ok,
			independentAccepted: report.independentAccepted,
			overallPipelineAccepted: report.overallPipelineAccepted,
			failure: report.failure,
		}),
	);
	if (!report.ok) process.exitCode = 1;
}
