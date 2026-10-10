import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bubbleExportContract as spec, bubbleExportJobs } from "./bubble-export-contract.mjs";
import { bubbleExportReferences, bubbleExportSource, bubbleExportParams, compareBubbleExportFrame } from "./bubble-export-reference.mjs";
import { bubbleExportSave } from "./bubble-export-preflight.mjs";
import { validateBubbleExportProbe } from "./bubble-export-decode.mjs";

test("frozen matrix keeps independent clip-local clocks and explicit chroma requests", () => {
	assert.equal(bubbleExportJobs.length, 6);
	assert.deepEqual(spec.thresholds, { exportMeanRgba: 10, exportActiveRgb: 15, exportMinimumActivePixels: 64, exportTimestampSeconds: 0.0011 });
	assert.equal(spec.schedule.startTicks, 12000); assert.equal(spec.trimStart, 16000);
	for (const job of bubbleExportJobs) {
		assert.deepEqual(job.timelineTicks, spec.localTicks.map((time) => job.offset + time));
		assert.equal(job.options.range.endTime - job.options.range.startTime, 24000);
		assert.equal(Object.hasOwn(job.options, "videoChroma"), job.chroma === "444");
	}
});
test("optical keys interpolate at clip-local times", () => {
	assert.equal(bubbleExportParams("animated", 12000).radius, 0.15);
	assert.equal(bubbleExportParams("animated", 32000).radius, 0.4);
	assert.equal(bubbleExportParams("animated", 22000).radius, 0.275);
	assert.deepEqual(bubbleExportParams("animated", 32000).tint, [1, 0.09999999999999998, 0.8999999999999999]);
});
test("independent oracle rejects clock, omitted-effect and repeated-frame faults", () => {
	const source = bubbleExportSource();
	for (const segment of ["moving", "animated", "disabled"]) {
		const references = bubbleExportReferences(source, segment);
		assert(references.discrimination.accepted);
		assert.equal(references.expected.length, 6);
		assert(compareBubbleExportFrame(references.expected[0], references.expected[0], references.baseline, segment !== "disabled").pass);
	}
});
test("binary artifact save preserves Uint8ClampedArray bytes and view offsets", async () => {
	const root = await mkdtemp("C:/tmps/bubble-export-save-test-");
	const source = new Uint8ClampedArray([90, 1, 2, 3, 91]).subarray(1, 4);
	const descriptor = await bubbleExportSave(root, "source.rgba", source);
	assert.equal(descriptor.bytes, 3);
	assert.deepEqual(await readFile(join(root, descriptor.filename)), Buffer.from([1, 2, 3]));
	await assert.rejects(bubbleExportSave(root, "source.rgba", source), { code: "EEXIST" });
});
function probe(job) {
	const frames = spec.localTicks.map((_, index) => ({ media_type: "video", best_effort_timestamp_time: String(index / 30), pkt_duration_time: String(1 / 30) }));
	return { streams: [{ codec_type: "video", codec_name: "vp9", width: 192, height: 128, nb_read_frames: "6", r_frame_rate: "30/1", profile: job.chroma === "444" ? "Profile 1" : "Profile 0", pix_fmt: job.chroma === "444" ? "yuv444p" : "yuv420p" }], frames,
		packets: frames.map((_, index) => ({ codec_type: "video", pts_time: String(index / 30), duration_time: String(1 / 30) })), format: { duration: "0.2" } };
}
test("codec metadata rejects wrong chroma, dimensions, count and timestamps", () => {
	for (const job of bubbleExportJobs) {
		assert.equal(validateBubbleExportProbe(probe(job), job).formatDuration, 0.2);
		for (const mutate of [(p) => { p.streams[0].pix_fmt = "rgba"; }, (p) => { p.streams[0].width = 193; },
			(p) => { p.streams[0].nb_read_frames = "5"; }, (p) => { p.frames[2].best_effort_timestamp_time = "0"; },
			(p) => { p.format.duration = "0.3"; }]) {
			const value = probe(job); mutate(value); assert.throws(() => validateBubbleExportProbe(value, job));
		}
	}
});
