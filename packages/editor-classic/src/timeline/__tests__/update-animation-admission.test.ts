/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal collaborators execute the real command without mounting an editor. */
import { expect, test } from "bun:test";
import type { EditorCommandContext } from "../../commands/base-command";
import { UpdateElementsCommand } from "../../commands/timeline/element/update-elements";
import { collectProjectAnimationAdmissionIssues } from "../../animation/project-animation-admission";
import { isScalarChannelData } from "../../animation/scalar-batch-resolver";
import { effectsRegistry, registerDefaultEffects } from "../../effects";
import type { EffectElement, SceneTracks, VideoElement } from "..";
import { mediaTime, ZERO_MEDIA_TIME } from "../../wasm";
import { applyElementUpdate } from "../update-pipeline";

function fixture() {
	const element: VideoElement = {
		id: "video",
		type: "video",
		name: "Video",
		mediaId: "media",
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTime({ ticks: 100000 }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: { opacity: 0.5 },
		animations: {
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
						id: "b",
						time: mediaTime({ ticks: 100000 }),
						value: 1,
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
				updateTracks(next: SceneTracks) {
					tracks = next;
					writes++;
				},
			},
		},
	} as EditorCommandContext;
	return { element, context, tracks: () => tracks, writes: () => writes };
}

test("duration extension rejects newly exposed linear extrapolation", () => {
	const state = fixture();
	const before = structuredClone(state.element);
	expect(
		collectProjectAnimationAdmissionIssues({ elements: [state.element] }),
	).toEqual([]);
	// Endpoints are valid; extending the visible domain exposes values up to 2.
	expect(() =>
		applyElementUpdate({
			element: state.element,
			patch: { duration: mediaTime({ ticks: 200000 }) },
			context: { tracks: state.tracks(), trackId: "main" },
		}),
	).toThrow(RangeError);
	expect(state.element).toEqual(before);
});

test("retime-derived duration cannot bypass animation domain admission", () => {
	const state = fixture();
	const command = new UpdateElementsCommand({
		updates: [
			{ trackId: "main", elementId: "video", patch: { retime: { rate: 0.5 } } },
		],
	});
	const before = structuredClone(state.tracks());
	expect(() => command.execute(state.context)).toThrow(RangeError);
	expect(state.writes()).toBe(0);
	expect(state.tracks()).toEqual(before);
});

test("invalid domain update rejects an entire batch before publishing", () => {
	const state = fixture();
	const before = structuredClone(state.tracks());
	const command = new UpdateElementsCommand({
		updates: [
			{ trackId: "main", elementId: "video", patch: { name: "Draft" } },
			{
				trackId: "main",
				elementId: "video",
				patch: { duration: mediaTime({ ticks: 200000 }) },
			},
		],
	});
	expect(() => command.execute(state.context)).toThrow(RangeError);
	expect(state.writes()).toBe(0);
	expect(state.tracks()).toEqual(before);
});

test("safe shortening preserves existing boundary synthesis and undo redo", () => {
	const state = fixture();
	const before = structuredClone(state.tracks());
	const command = new UpdateElementsCommand({
		updates: [
			{
				trackId: "main",
				elementId: "video",
				patch: { duration: mediaTime({ ticks: 50000 }) },
			},
		],
	});
	command.execute(state.context);
	const shortened = structuredClone(state.tracks());
	expect(shortened.main.elements[0].duration).toBe(mediaTime({ ticks: 50000 }));
	expect(
		collectProjectAnimationAdmissionIssues({
			elements: shortened.main.elements,
		}),
	).toEqual([]);
	command.undo(state.context);
	expect(state.tracks()).toEqual(before);
	command.redo(state.context);
	const current = state.tracks().main.elements[0];
	const channel = current.animations?.opacity;
	if (!isScalarChannelData(channel)) throw Error("Expected scalar opacity");
	// Boundary IDs are generated on execution; redo preserves their semantics.
	expect(current.duration).toBe(shortened.main.elements[0].duration);
	expect(channel.keys.map(({ time, value }) => ({ time, value }))).toEqual([
		{ time: ZERO_MEDIA_TIME, value: 0 },
		{ time: mediaTime({ ticks: 50000 }), value: 0.5 },
	]);
	expect(
		collectProjectAnimationAdmissionIssues({ elements: [current] }),
	).toEqual([]);
});

test("metadata updates do not newly reject stored legacy channels", () => {
	const state = fixture();
	state.element.animations!.opacity = {
		keys: [
			{
				id: "legacy",
				time: ZERO_MEDIA_TIME,
				value: 2,
				segmentToNext: "linear",
				tangentMode: "flat",
			},
		],
	};
	const updated = applyElementUpdate({
		element: state.element,
		patch: { name: "Renamed" },
		context: { tracks: state.tracks(), trackId: "main" },
	});
	expect(updated.name).toBe("Renamed");
	expect(updated.animations).toEqual(state.element.animations);
});

test("direct animation replacement is admitted before publishing", () => {
	const state = fixture();
	const replacement = structuredClone(state.element.animations!);
	const channel = replacement.opacity;
	if (!isScalarChannelData(channel)) throw Error("Expected scalar opacity");
	channel.keys[1].value = 2;
	const before = structuredClone(state.tracks());
	const command = new UpdateElementsCommand({
		updates: [
			{
				trackId: "main",
				elementId: "video",
				patch: { animations: replacement },
			},
		],
	});
	expect(() => command.execute(state.context)).toThrow(RangeError);
	expect(state.writes()).toBe(0);
	expect(state.tracks()).toEqual(before);
});

test("hold extrapolation remains extendable with complete undo", () => {
	const state = fixture();
	const channel = state.element.animations!.opacity;
	if (!isScalarChannelData(channel)) throw Error("Expected scalar opacity");
	channel.extrapolation = { before: "hold", after: "hold" };
	const before = structuredClone(state.tracks());
	const command = new UpdateElementsCommand({
		updates: [
			{
				trackId: "main",
				elementId: "video",
				patch: { duration: mediaTime({ ticks: 200000 }) },
			},
		],
	});
	command.execute(state.context);
	expect(state.writes()).toBe(1);
	expect(state.tracks().main.elements[0].duration).toBe(
		mediaTime({ ticks: 200000 }),
	);
	expect(
		collectProjectAnimationAdmissionIssues({
			elements: state.tracks().main.elements,
		}),
	).toEqual([]);
	command.undo(state.context);
	expect(state.tracks()).toEqual(before);
});

test("unknown legacy targets do not block duration updates", () => {
	const state = fixture();
	state.element.animations = {
		"legacy.unknown": state.element.animations!.opacity,
	};
	const updated = applyElementUpdate({
		element: state.element,
		patch: { duration: mediaTime({ ticks: 200000 }) },
		context: { tracks: state.tracks(), trackId: "main" },
	});
	expect(updated.duration).toBe(mediaTime({ ticks: 200000 }));
	expect(updated.animations?.["legacy.unknown"]).toEqual(
		state.element.animations["legacy.unknown"],
	);
});

for (const standalone of [true, false]) {
	test(`${standalone ? "standalone" : "attached"} effect duration extension checks the new domain`, () => {
		registerDefaultEffects();
		const definition = effectsRegistry
			.getAll()
			.find((effect) =>
				effect.params.some(
					(param) =>
						param.key === "amount" &&
						param.type === "number" &&
						param.keyframable !== false,
				),
			);
		if (!definition)
			throw Error("Expected the canonical bounded amount effect");
		const state = fixture();
		const animations = {
			[standalone ? "params.amount" : "effects.attached.params.amount"]:
				state.element.animations!.opacity,
		};
		const effect: EffectElement = {
			id: "standalone",
			type: "effect",
			name: "Effect",
			effectType: definition.type,
			startTime: ZERO_MEDIA_TIME,
			duration: state.element.duration,
			trimStart: ZERO_MEDIA_TIME,
			trimEnd: ZERO_MEDIA_TIME,
			params: { amount: 0.5 },
			animations,
		};
		const element = standalone
			? effect
			: {
					...state.element,
					animations,
					effects: [
						{
							id: "attached",
							type: definition.type,
							enabled: true,
							params: { amount: 0.5 },
						},
					],
				};
		expect(
			collectProjectAnimationAdmissionIssues({ elements: [element] }),
		).toEqual([]);
		const before = structuredClone(element);
		expect(() =>
			applyElementUpdate({
				element,
				patch: { duration: mediaTime({ ticks: 200000 }) },
				context: { tracks: state.tracks(), trackId: "main" },
			}),
		).toThrow(RangeError);
		expect(element).toEqual(before);
	});
}
