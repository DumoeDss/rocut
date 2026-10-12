/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal editor collaborators for actual command behavior. */
import { expect, test } from "bun:test";
import { UpdateScalarKeyframeCurveCommand } from "./update-scalar-keyframe-curve";
import { UpsertKeyframeCommand } from "./upsert-keyframe";
import { PasteKeyframesCommand } from "../../clipboard/paste-keyframes";
import { RemoveKeyframeCommand } from "./remove-keyframe";
import { RetimeKeyframeCommand } from "./retime-keyframe";
import type { EditorCommandContext } from "../../../base-command";
import type { SceneTracks, VideoElement } from "../../../../timeline";
import { mediaTime, ZERO_MEDIA_TIME } from "../../../../wasm";

function setup() {
	const element: VideoElement = {
		id: "video",
		name: "Video",
		type: "video",
		mediaId: "media",
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTime({ ticks: 100000 }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: { opacity: 0.5 },
		animations: {
			opacity: {
				keys: [
					{
						id: "a",
						time: ZERO_MEDIA_TIME,
						value: 0.5,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
					{
						id: "b",
						time: mediaTime({ ticks: 100000 }),
						value: 0.5,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
				],
			},
		},
	};
	let tracks: SceneTracks = {
		main: {
			id: "main",
			name: "Main",
			type: "video",
			elements: [element],
			muted: false,
			hidden: false,
		},
		overlay: [],
		audio: [],
	};
	let writes = 0;
	const context = {
		editor: {
			scenes: { getActiveScene: () => ({ tracks }) },
			timeline: {
				updateTracks: (next: SceneTracks) => {
					tracks = next;
					writes++;
				},
			},
		},
	} as EditorCommandContext;
	return { context, tracks: () => tracks, writes: () => writes };
}
const overshoot = {
	segmentToNext: "bezier" as const,
	tangentMode: "broken" as const,
	rightHandle: { dt: mediaTime({ ticks: 33333 }), dv: 5 },
};
test("actual curve edit rejects proven leaf overshoot without publishing tracks", () => {
	const fixture = setup(),
		before = structuredClone(fixture.tracks());
	const command = new UpdateScalarKeyframeCurveCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		componentKey: "value",
		keyframeId: "a",
		patch: overshoot,
	});
	expect(() => command.execute(fixture.context)).toThrow(RangeError);
	expect(fixture.writes()).toBe(0);
	expect(fixture.tracks()).toEqual(before);
});
test("actual paste rejects proven curve overshoot atomically", () => {
	const fixture = setup(),
		before = structuredClone(fixture.tracks());
	const command = new PasteKeyframesCommand({
		trackId: "main",
		elementId: "video",
		time: ZERO_MEDIA_TIME,
		clipboardItems: [
			{
				propertyPath: "opacity",
				timeOffset: ZERO_MEDIA_TIME,
				value: 0.5,
				interpolation: "bezier",
				curvePatches: [{ componentKey: "value", patch: overshoot }],
			},
		],
	});
	expect(() => command.execute(fixture.context)).toThrow(RangeError);
	expect(fixture.writes()).toBe(0);
	expect(fixture.tracks()).toEqual(before);
});
test("actual safe leaf upsert and undo retain existing behavior", () => {
	const fixture = setup(),
		before = structuredClone(fixture.tracks());
	const command = new UpsertKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		time: mediaTime({ ticks: 50000 }),
		value: 0.8,
		keyframeId: "safe",
	});
	command.execute(fixture.context);
	expect(fixture.writes()).toBe(1);
	expect(fixture.tracks().main.elements[0].animations?.opacity).toBeDefined();
	command.undo(fixture.context);
	expect(fixture.tracks()).toEqual(before);
});

test("unresolved leaf domain does not become a rejection in authoring", () => {
	const fixture = setup();
	fixture.tracks().main.elements[0].duration = ZERO_MEDIA_TIME;
	const command = new UpsertKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		time: ZERO_MEDIA_TIME,
		value: 0.8,
		keyframeId: "unresolved",
	});
	expect(() => command.execute(fixture.context)).not.toThrow();
	expect(fixture.writes()).toBe(1);
});

function extrapolatingFixture() {
	const fixture = setup();
	fixture.tracks().main.elements[0].animations = {
		opacity: {
			extrapolation: { before: "hold", after: "linear" },
			keys: [
				{
					id: "a",
					time: ZERO_MEDIA_TIME,
					value: 0,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
				{
					id: "mid",
					time: mediaTime({ ticks: 50000 }),
					value: 0.8,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
				{
					id: "b",
					time: mediaTime({ ticks: 100000 }),
					value: 1,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		},
	};
	return fixture;
}

test("deleting an endpoint cannot introduce out-of-range linear extrapolation", () => {
	const fixture = extrapolatingFixture(),
		before = structuredClone(fixture.tracks());
	const command = new RemoveKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		keyframeId: "b",
		valueAtPlayhead: 0.8,
	});
	// Removing the endpoint leaves slope .8 / 50000, hence 1.6 at duration.
	expect(() => command.execute(fixture.context)).toThrow(RangeError);
	expect(fixture.writes()).toBe(0);
	expect(fixture.tracks()).toEqual(before);
});

test("retiming an endpoint rejects new extrapolation but safe deletion retains undo", () => {
	const fixture = extrapolatingFixture(),
		before = structuredClone(fixture.tracks());
	const retime = new RetimeKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		keyframeId: "b",
		nextTime: mediaTime({ ticks: 75000 }),
	});
	// The new final slope produces 1.2 at 100000; endpoint values remain legal.
	expect(() => retime.execute(fixture.context)).toThrow(RangeError);
	expect(fixture.writes()).toBe(0);
	expect(fixture.tracks()).toEqual(before);
	const remove = new RemoveKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		keyframeId: "mid",
		valueAtPlayhead: 0.8,
	});
	remove.execute(fixture.context);
	expect(fixture.writes()).toBe(1);
	remove.undo(fixture.context);
	expect(fixture.tracks()).toEqual(before);
	const safeRetime = new RetimeKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		keyframeId: "mid",
		nextTime: mediaTime({ ticks: 40000 }),
	});
	safeRetime.execute(fixture.context);
	expect(fixture.writes()).toBe(3);
	safeRetime.undo(fixture.context);
	expect(fixture.tracks()).toEqual(before);
});
