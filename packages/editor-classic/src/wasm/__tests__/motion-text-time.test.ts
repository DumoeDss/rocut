import { describe, expect, test } from "bun:test";

await import("../../editor/session/__tests__/wasm-test-mock");

const { mapMotionTextClipTimeValue, mapMotionTextSequenceTimeToTimelineValue } =
	await import("../motion-text-time");
const { mapMotionTextClipTime, mapMotionTextSequenceTimeToTimeline } =
	await import("../../../../../rust/wasm/pkg/opencut_wasm_sync.js");

describe("motion-text time mapping seam", () => {
	test("round-trips a visible trimmed sequence time", () => {
		const timeline = mapMotionTextSequenceTimeToTimelineValue({
			options: {
				clipStartTime: 120_000,
				clipDuration: 180_000,
				trimStart: 60_000,
				sequenceTime: 120_000,
				sequenceDuration: 360_000,
			},
			core: mapMotionTextSequenceTimeToTimeline,
		});
		expect(timeline).toEqual({ active: true, timelineTime: 180_000 });

		const sequence = mapMotionTextClipTimeValue({
			options: {
				clipStartTime: 120_000,
				clipDuration: 180_000,
				trimStart: 60_000,
				timelineTime: timeline.timelineTime ?? -1,
				sequenceDuration: 360_000,
			},
			core: mapMotionTextClipTime,
		});
		expect(sequence).toEqual({ active: true, sequenceTime: 120_000 });
	});

	test("keeps the visible sequence range half-open", () => {
		const mapped = mapMotionTextSequenceTimeToTimelineValue({
			options: {
				clipStartTime: 120_000,
				clipDuration: 180_000,
				trimStart: 60_000,
				sequenceTime: 240_000,
				sequenceDuration: 360_000,
			},
			core: mapMotionTextSequenceTimeToTimeline,
		});
		expect(mapped).toEqual({ active: false, timelineTime: null });
	});
});
