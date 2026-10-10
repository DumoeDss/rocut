import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	blazeEditorDigest as digest,
	blazeEditorWrite as save,
} from "./blaze-editor-control.mjs";
import {
	blazeEditorExportFrameTicks,
	blazeEditorExportThresholds as thresholds,
} from "./blaze-editor-export-contract.mjs";
import {
	compareBlazePipelineFrame,
	validateBlazePipelineProbeTiming,
} from "../probe-blaze-pipeline-metrics.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";

export function compareBlazeEditorExportFrame(
	actual,
	expected,
	baseline,
	enabled,
) {
	const metric = compareBlazePipelineFrame(actual, expected, baseline);
	return enabled
		? metric
		: {
				...metric,
				pass: metric.meanRgba <= thresholds.meanRgba,
				criterion:
					"Disabled control uses whole-image error; no active-effect population exists",
			};
}
export async function decodeBlazeEditorExport({
	root,
	ffmpegDirectory,
	spec,
	media,
	reference,
}) {
	const report = {
		ok: false,
		jobKey: spec.jobKey,
		requestsIndependent: true,
		commands: [],
		inputHashes: {},
	};
	const read = async (descriptor) => {
		assert(!/[\\/:]/.test(descriptor.filename));
		const bytes = await readFile(join(root, descriptor.filename));
		assert.equal(bytes.length, descriptor.bytes);
		assert.equal(digest(bytes), descriptor.sha256);
		report.inputHashes[descriptor.filename] = descriptor.sha256;
		return bytes;
	};
	try {
		await read(media);
		const expected = await read(reference.expected),
			baseline = await read(reference.baseline);
		const stride = 192 * 128 * 4;
		assert.equal(expected.length, stride * 6);
		assert.equal(baseline.length, stride);
		const run = (name, args) => {
			report.commands.push({ executable: join(ffmpegDirectory, name), args });
			return execFileSync(join(ffmpegDirectory, name), args, {
				windowsHide: true,
				timeout: 30000,
				maxBuffer: 16 * 1024 * 1024,
			});
		};
		const file = join(root, media.filename);
		const probe = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				run("ffprobe.exe", [
					"-v",
					"error",
					"-count_frames",
					"-show_streams",
					"-show_frames",
					"-show_packets",
					"-show_format",
					"-of",
					"json",
					file,
				]),
			),
		);
		await save(root, `${spec.jobKey}-ffprobe.json`, probe);
		assert.equal(probe.streams.length, 1);
		const track = probe.streams[0];
		assert.equal(track.codec_type, "video");
		assert.equal(track.codec_name, "vp9");
		assert.equal(track.width, 192);
		assert.equal(track.height, 128);
		assert.equal(Number(track.nb_read_frames), 6);
		assert.equal(track.r_frame_rate, "30/1");
		assert.equal(
			track.profile,
			spec.chroma === "444" ? "Profile 1" : "Profile 0",
		);
		assert.equal(track.pix_fmt, spec.chroma === "444" ? "yuv444p" : "yuv420p");
		report.track = track;
		report.timing = validateBlazePipelineProbeTiming(probe, {
			frames: 6,
			fps: 30,
			localTicks: blazeEditorExportFrameTicks,
			timelineTicks: blazeEditorExportFrameTicks.map(
				(ticks) => ticks + spec.offset,
			),
		});
		const decoded = run("ffmpeg.exe", [
			"-v",
			"error",
			"-i",
			file,
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"pipe:1",
		]);
		await save(root, `${spec.jobKey}-decoded.rgba`, decoded);
		assert.equal(decoded.length, stride * 6);
		report.decodedSha256 = digest(decoded);
		report.metrics = [];
		const repeatedDecoded = [];
		for (let index = 0; index < 6; index++) {
			const actual = decoded.subarray(index * stride, (index + 1) * stride),
				frame = expected.subarray(index * stride, (index + 1) * stride);
			await save(
				root,
				`${spec.jobKey}-decoded-${index}.png`,
				blazePipelinePng(actual, 192, 128),
			);
			report.metrics.push({
				frame: index,
				...compareBlazeEditorExportFrame(actual, frame, baseline, spec.enabled),
			});
			repeatedDecoded.push(
				compareBlazeEditorExportFrame(
					decoded.subarray(0, stride),
					frame,
					baseline,
					spec.enabled,
				),
			);
		}
		report.repeatedDecodedFirst = repeatedDecoded;
		await save(
			root,
			`${spec.jobKey}-counterfactual-baseline.rgba`,
			Buffer.concat(Array.from({ length: 6 }, () => baseline)),
		);
		await save(
			root,
			`${spec.jobKey}-counterfactual-expected-first.rgba`,
			Buffer.concat(
				Array.from({ length: 6 }, () => expected.subarray(0, stride)),
			),
		);
		await save(
			root,
			`${spec.jobKey}-counterfactual-decoded-first.rgba`,
			Buffer.concat(
				Array.from({ length: 6 }, () => decoded.subarray(0, stride)),
			),
		);
		assert(
			reference.discrimination.accepted,
			"Independent expected negative controls failed",
		);
		if (spec.id === "animated")
			assert(
				repeatedDecoded.slice(1).some((metric) => !metric.pass),
				"Repeated decoded first frame escaped every later frame",
			);
		assert(
			report.metrics.every((metric) => metric.pass),
			JSON.stringify(report.metrics),
		);
		report.ok = true;
	} catch (error) {
		report.failure = error.stack ?? String(error);
	} finally {
		report.postRunFailures = [];
		for (const [name, hash] of Object.entries(report.inputHashes))
			if (digest(await readFile(join(root, name))) !== hash)
				report.postRunFailures.push(name);
		if (report.postRunFailures.length) report.ok = false;
		await save(root, `${spec.jobKey}-independent-decode.json`, report);
	}
	return report;
}
