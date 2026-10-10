import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bubbleExportContract as contract, bubbleExportJobs } from "./bubble-export-contract.mjs";
import { bubbleExportHash as hash, bubbleExportSave as save, bubbleExportScratch } from "./bubble-export-preflight.mjs";
import { compareBubbleExportFrame } from "./bubble-export-reference.mjs";
import { validateBlazePipelineProbeTiming } from "../probe-blaze-pipeline-metrics.mjs";

export function validateBubbleExportProbe(probe, job) {
	assert.deepEqual(job, bubbleExportJobs.find((item) => item.jobKey === job.jobKey));
	assert.equal(probe.streams.length, 1);
	const stream = probe.streams[0];
	for (const [key, value] of Object.entries({ codec_type: "video", codec_name: "vp9",
		width: 192, height: 128, r_frame_rate: "30/1",
		profile: job.chroma === "444" ? "Profile 1" : "Profile 0",
		pix_fmt: job.chroma === "444" ? "yuv444p" : "yuv420p" })) assert.equal(stream[key], value, key);
	assert.equal(Number(stream.nb_read_frames), 6);
	return validateBlazePipelineProbeTiming(probe, { frames: 6, fps: 30,
		localTicks: contract.localTicks, timelineTicks: job.timelineTicks });
}

export async function decodeBubbleExport({ root, ffmpegDirectory, job, media, reference }) {
	await bubbleExportScratch(root);
	const report = { ok: false, jobKey: job.jobKey, commands: [], inputHashes: {} };
	const read = async (descriptor) => {
		assert(/^[a-z0-9][a-z0-9.-]*$/.test(descriptor.filename));
		const bytes = await readFile(join(root, descriptor.filename));
		assert.equal(bytes.length, descriptor.bytes); assert.equal(hash(bytes), descriptor.sha256);
		report.inputHashes[descriptor.filename] = descriptor.sha256; return bytes;
	};
	try {
		assert.deepEqual(job, bubbleExportJobs.find((item) => item.jobKey === job.jobKey));
		assert.equal(reference.segment, job.id);
		assert(reference.discrimination.accepted);
		await read(media);
		const expected = await read(reference.expected), baseline = await read(reference.baseline);
		const stride = contract.width * contract.height * 4;
		assert.equal(expected.length, stride * 6); assert.equal(baseline.length, stride);
		const run = (name, args) => {
			const executable = join(ffmpegDirectory, name); report.commands.push({ executable, args });
			return execFileSync(executable, args, { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
		};
		const file = join(root, media.filename);
		const probe = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(run("ffprobe.exe",
			["-v", "error", "-count_frames", "-show_streams", "-show_frames", "-show_packets", "-show_format", "-of", "json", file])));
		await save(root, `${job.jobKey}-ffprobe.json`, probe);
		report.timing = validateBubbleExportProbe(probe, job); report.stream = probe.streams[0];
		const decoded = run("ffmpeg.exe", ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
		report.decoded = await save(root, `${job.jobKey}-decoded.rgba`, decoded);
		assert.equal(decoded.length, stride * 6);
		report.metrics = []; report.repeatedDecodedFirst = [];
		for (let index = 0; index < 6; index++) {
			const frame = expected.subarray(index * stride, (index + 1) * stride);
			report.metrics.push({ frame: index, ...compareBubbleExportFrame(decoded.subarray(index * stride, (index + 1) * stride), frame, baseline, job.enabled) });
			report.repeatedDecodedFirst.push(compareBubbleExportFrame(decoded.subarray(0, stride), frame, baseline, job.enabled));
		}
		if (job.enabled) assert(report.repeatedDecodedFirst.slice(1).some((metric) => !metric.pass), "Repeated decoded first frame escaped every later frame");
		assert(report.metrics.every((metric) => metric.pass), "Frozen codec pixel gate failed");
		report.ok = true;
	} catch (error) { report.failure = error.stack ?? String(error); }
	for (const [name, expected] of Object.entries(report.inputHashes)) {
		try { assert.equal(hash(await readFile(join(root, name))), expected); }
		catch (error) { report.ok = false; (report.postRunFailures ??= []).push({ name, failure: String(error) }); }
	}
	await save(root, `${job.jobKey}-independent-decode.json`, report);
	return report;
}
