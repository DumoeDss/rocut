import { expect, test } from "bun:test";
import {
	getTrackHeight,
	getCumulativeHeightBefore,
	getTotalTracksHeight,
	getExpandedTrackHeight,
} from "../track-layout";
import {
	hoverSourceTime,
	createHoverScrubber,
} from "../../../components/editor/panels/assets/views/use-hover-scrub";

test("track height presets keep cumulative positions and expanded lanes aligned", () => {
	const tracks = [{ type: "video" as const }, { type: "audio" as const }];
	for (const heightScale of [0.8, 1, 1.5, 2]) {
		const video = getTrackHeight({ type: "video", heightScale });
		const audio = getTrackHeight({ type: "audio", heightScale });
		expect(
			getCumulativeHeightBefore({ tracks, trackIndex: 1, heightScale }),
		).toBe(video + 6);
		expect(getTotalTracksHeight({ tracks, heightScale })).toBe(
			video + audio + 6,
		);
		expect(
			getExpandedTrackHeight({
				type: "video",
				expandedLaneCount: 2,
				heightScale,
			}),
		).toBe(video + 40);
	}
	expect(getTrackHeight({ type: "video", heightScale: Number.NaN })).toBe(65);
});

test("hover sampling stays inside short media and rejects unusable durations", () => {
	expect(hoverSourceTime({ ratio: -1, duration: 10 })).toBe(0);
	expect(hoverSourceTime({ ratio: 0.5, duration: 10 })).toBe(5);
	expect(hoverSourceTime({ ratio: 2, duration: 0.01 })).toBeCloseTo(0.009);
	expect(hoverSourceTime({ ratio: 0.5, duration: 0 })).toBeUndefined();
	expect(hoverSourceTime({ ratio: 0.5, duration: Number.NaN })).toBeUndefined();
});

test("scaled hit testing and drop indicator use the visible track boundaries", async () => {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const { getDropLineY } = await import("../drop-target");
	const { resolveTimelineElementIntersections } = await import("../selection-hit-testing");
	const tracks = [{ id: "visual", type: "video", elements: [{ id: "v", startTime: 0, duration: 1_000_000 }] }, { id: "sound", type: "audio", elements: [{ id: "a", startTime: 0, duration: 1_000_000 }] }];
	const container = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
	const dropTarget = { trackIndex: 1, isNewTrack: true, insertPosition: "above" };
	// Identity-only fixtures provide only fields read by these geometry functions.
	expect(getDropLineY({ tracks: tracks as any, dropTarget: dropTarget as any, heightScale: 2 })).toBe(136);
	const result = resolveTimelineElementIntersections({ container: container as any, scrollContainer: null, tracks: tracks as any, zoomLevel: 1, heightScale: 2, startPos: { x: 1, y: 100 }, currentPos: { x: 2, y: 101 } });
	expect(result).toEqual([{ trackId: "visual", elementId: "v" }]);
});

test("hover moves coalesce into one latest card and leaving or disposing cancels pending work", async () => {
	const samples: unknown[] = [];
	const hover = createHoverScrubber({
		onSample: (value) => samples.push(value),
	});
	hover.move({ id: "old", ratio: 0.1, duration: 10 });
	hover.move({ id: "new", ratio: 0.8, duration: 10 });
	expect(samples).toEqual([]);
	await new Promise((resolve) => setTimeout(resolve, 115));
	expect(samples).toEqual([{ id: "new", time: 8 }]);
	hover.move({ id: "old", ratio: 0.1, duration: 10 });
	hover.cancel();
	await new Promise((resolve) => setTimeout(resolve, 115));
	expect(samples).toEqual([{ id: "new", time: 8 }, undefined]);
	hover.move({ id: "old", ratio: 0.1, duration: 10 });
	hover.dispose();
	await new Promise((resolve) => setTimeout(resolve, 115));
	expect(samples).toHaveLength(2);
});

test("common edits preserve other parameters and refuse animation, locked and unsupported members", async () => {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const { buildCommonPropertyUpdates } =
		await import("../../../components/editor/panels/properties/common-property-edit");
	const param = {
		key: "opacity",
		label: "Opacity",
		type: "number" as const,
		default: 1,
		min: 0,
		max: 1,
		step: 0.01,
	};
	const element = {
		id: "first",
		type: "image" as const,
		name: "image",
		duration: 100,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		mediaId: "source",
		params: { opacity: 1, "transform.rotate": 45 },
	};
	const track = {
		id: "track",
		type: "video" as const,
		name: "track",
		elements: [element],
		muted: false,
		hidden: false,
	};
	const selected = [
		{ element, track },
		{
			element: {
				...element,
				id: "second",
				params: { ...element.params, opacity: 0.2 },
			},
			track,
		},
	];
	const updates = buildCommonPropertyUpdates({ selected, param, raw: "0.5" });
	expect(updates).toHaveLength(2);
	expect(updates[0].patch.params).toEqual({
		opacity: 0.5,
		"transform.rotate": 45,
	});
	expect(element.params.opacity).toBe(1);
	for (const raw of ["", "NaN", "Infinity"])
		expect(buildCommonPropertyUpdates({ selected, param, raw })).toEqual([]);
	expect(
		buildCommonPropertyUpdates({
			selected: [{ element, track: { ...track, locked: true } }],
			param,
			raw: "0.5",
		}),
	).toEqual([]);
	expect(
		buildCommonPropertyUpdates({
			selected: [
				{ element: { ...element, animations: { opacity: {} } }, track },
			],
			param,
			raw: "0.5",
		}),
	).toEqual([]);
	const volume = { ...param, key: "volume" };
	expect(
		buildCommonPropertyUpdates({ selected, param: volume, raw: "0.5" }),
	).toEqual([]);
});
