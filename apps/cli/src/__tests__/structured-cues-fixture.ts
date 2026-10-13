import { createAutomation } from "@opencut/editor-automation";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import { createTransactionNativeProjectSeed } from "@opencut/editor-contracts/engine";
import {
	mediaTime,
	motionTextCueId,
	motionTextSequenceId,
	projectId,
	trackId,
	revisionOf,
	type MotionTextSequence,
} from "@opencut/editor-contracts";
import type {
	CreateMotionTextStructuredCuesCore,
	StructuredMotionTextOptions,
} from "@opencut/editor-classic/motion-text/factory";

// Controlled transport fixture. Rust factory fidelity is tested in the native crate.
export const core: CreateMotionTextStructuredCuesCore = (
	input: StructuredMotionTextOptions,
) => {
	const mappings = input.cues.map((cue) => ({
		lineId: cue.lineId,
		sourceLine: cue.sourceLine,
		cueId: `cue:${cue.lineId}`,
	}));
	const sequence: MotionTextSequence = {
		id: motionTextSequenceId(input.sequenceId),
		schemaVersion: 1,
		revision: 0,
		source: { format: "plain", text: input.source },
		language: input.language,
		duration: mediaTime({ ticks: input.durationTicks }),
		compositionMode: "overlay",
		seed: input.seed ?? 7,
		engine: {
			id: "jizura",
			version: "0.9.0",
			catalogHash: "controlled-catalog",
			plannerVersion: 1,
			tokenizerVersion: "unicode-v1",
		},
		fonts: [],
		defaults: {
			preset: {
				style: "base",
				layout: "center",
				enter: "fade",
				hold: "still",
				exit: "fade",
				decor: [],
				treat: "none",
				bg: "transparent",
				cam: "static",
				fx: [],
				trans: null,
			},
			colors: {},
			parameters: {},
		},
		cues: input.cues.map((cue, index) => ({
			id: motionTextCueId(mappings[index].cueId),
			text: cue.text,
			sourceLine: cue.sourceLine,
			startTime: mediaTime({ ticks: cue.startTicks }),
			duration: mediaTime({ ticks: cue.endTicks - cue.startTicks }),
			timingSource: "manual",
			interlude: false,
			gapBefore: false,
			impact: false,
			emphasis: [],
			segments: [cue.text],
			locks: [],
			overrides: {},
		})),
	};
	return {
		sequenceJson: JSON.stringify(sequence),
		diagnostics: [],
		lineMappings: mappings,
	};
};

export async function fixture() {
	const { store } = createInMemoryProjectStoreFixture();
	const id = projectId("structured-project");
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: id,
			project: {
				id,
				name: "Controlled",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 640,
				canvasHeight: 360,
			},
		}),
	);
	const open = () => createAutomation({ store, projectId: id });
	const automation = await open();
	await automation.apply({
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("graphic"),
					kind: "graphic",
					name: "Lyrics",
					hidden: false,
				},
			},
		],
		expectedRevision: revisionOf(0),
	});
	const input = {
		expectedRevision: 1,
		idempotencyKey: "structured-request",
		trackId: "graphic",
		timelineStartTicks: 24000,
		durationTicks: 300000,
		language: "en",
		starterPreset: "clean-caption",
		source: "\r\n  A! | *B* / [x]  \r\n\r\n  A! | *B* / [x]  \n",
		cues: [2, 4].map((sourceLine, i) => ({
			lineId: `line-${i}`,
			sourceLine,
			text: "  A! | *B* / [x]  ",
			startTicks: 13 + i * 120000,
			endTicks: 110013 + i * 120000,
		})),
	};
	return { automation, input, open };
}
