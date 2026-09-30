import { describe, expect, test } from "bun:test";

import {
	mediaTime,
	resolveMediaTimeRange,
	type ValidateMediaTimeRangeCore,
} from "../media-time";

const rustRangeCore: ValidateMediaTimeRangeCore = ({
	startTime,
	endTime,
	timelineDuration,
}) => {
	const error =
		timelineDuration <= 0
			? "invalid-timeline-duration"
			: startTime < 0
				? "start-before-zero"
				: endTime <= startTime
					? "end-not-after-start"
					: endTime > timelineDuration
						? "end-after-timeline-duration"
						: null;
	return { duration: error === null ? endTime - startTime : null, error };
};

describe("timeline time ranges", () => {
	test("an omitted range resolves to the complete timeline", () => {
		expect(
			resolveMediaTimeRange({
				timelineDuration: mediaTime({ ticks: 1_200_000 }),
				core: rustRangeCore,
			}),
		).toEqual({ startTime: 0, endTime: 1_200_000, duration: 1_200_000 });
	});

	test("a strict half-open subrange keeps its absolute bounds and duration", () => {
		expect(
			resolveMediaTimeRange({
				range: {
					startTime: mediaTime({ ticks: 120_000 }),
					endTime: mediaTime({ ticks: 360_000 }),
				},
				timelineDuration: mediaTime({ ticks: 1_200_000 }),
				core: rustRangeCore,
			}),
		).toEqual({ startTime: 120_000, endTime: 360_000, duration: 240_000 });
	});

	test("invalid bounds surface the Rust validation reason", () => {
		const timelineDuration = mediaTime({ ticks: 1_200_000 });
		for (const [startTime, endTime, message] of [
			[-1, 1, /must not be negative/],
			[120_000, 120_000, /must be after/],
			[120_000, 1_200_001, /exceeds/],
		] as const) {
			expect(() =>
				resolveMediaTimeRange({
					range: {
						startTime: mediaTime({ ticks: startTime }),
						endTime: mediaTime({ ticks: endTime }),
					},
					timelineDuration,
					core: rustRangeCore,
				}),
			).toThrow(message);
		}
	});

	test("malformed core output fails closed", () => {
		expect(() =>
			resolveMediaTimeRange({
				timelineDuration: mediaTime({ ticks: 10 }),
				core: () => ({ duration: 10, error: "unknown" }),
			}),
		).toThrow(/invalid range error/);
	});
});
