/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal editor collaborators for actual command behavior. */
import { expect, test } from "bun:test";
import { UpdateScalarKeyframeCurveCommand } from "./update-scalar-keyframe-curve";
import { UpsertKeyframeCommand } from "./upsert-keyframe";
import { PasteKeyframesCommand } from "../../clipboard/paste-keyframes";
import type { EditorCommandContext } from "../../../base-command";
import type { SceneTracks, VideoElement } from "../../../../timeline";

function setup() {
	const element: VideoElement = {
		id: "video",
		name: "Video",
		type: "video",
		mediaId: "media",
		startTime: 0,
		duration: 100000,
		trimStart: 0,
		trimEnd: 0,
		params: { opacity: 0.5 },
		animations: {
			opacity: {
				keys: [
					{
						id: "a",
						time: 0,
						value: 0.5,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
					{
						id: "b",
						time: 100000,
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
	rightHandle: { dt: 33333, dv: 5 },
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
		time: 0,
		clipboardItems: [
			{
				propertyPath: "opacity",
				timeOffset: 0,
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
		time: 50000,
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
	fixture.tracks().main.elements[0].duration = 0;
	const command = new UpsertKeyframeCommand({
		trackId: "main",
		elementId: "video",
		propertyPath: "opacity",
		time: 0,
		value: 0.8,
		keyframeId: "unresolved",
	});
	expect(() => command.execute(fixture.context)).not.toThrow();
	expect(fixture.writes()).toBe(1);
});
