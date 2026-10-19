import { expect, test } from "bun:test";
import { mergeMotionTextMarkers } from "../motion-text-marker-layout";

test("marker spacing threshold is exact and grouping retains every source reference", () => {
	const markers = [
		{ startTime: 100, endTime: 150 },
		{ startTime: 107, endTime: 160 },
		{ startTime: 108, endTime: 170 },
		{ startTime: 116, endTime: 180 },
	];
	const groups = mergeMotionTextMarkers({
		markers,
		clipStartTime: 100,
		clipDuration: 100,
		width: 100,
	});
	expect(groups.map((group) => group.items.length)).toEqual([2, 1, 1]);
	expect(groups.map((group) => group.startTime)).toEqual([100, 108, 116]);
	expect(groups[0].endTime).toBe(160);
	expect(groups.flatMap((group) => group.items)).toEqual(markers);
	expect(groups[0].items[0]).toBe(markers[0]);
	expect(groups[0].items[1]).toBe(markers[1]);
});

test("empty, zero-duration and unmeasured clips do not produce unbounded markers", () => {
	for (const width of [0, -1, NaN, Infinity]) {
		expect(
			mergeMotionTextMarkers({
				markers: [
					{ startTime: 0, endTime: 10 },
					{ startTime: 10, endTime: 20 },
				],
				clipStartTime: 0,
				clipDuration: 20,
				width,
			}),
		).toHaveLength(1);
	}
	expect(
		mergeMotionTextMarkers({
			markers: [{ startTime: 0, endTime: 10 }],
			clipStartTime: 0,
			clipDuration: 0,
			width: 100,
		}),
	).toEqual([]);
	expect(
		mergeMotionTextMarkers({
			markers: [],
			clipStartTime: 0,
			clipDuration: 20,
			width: 100,
		}),
	).toEqual([]);
});
