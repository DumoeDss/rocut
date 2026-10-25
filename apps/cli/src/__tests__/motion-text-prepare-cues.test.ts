import { expect, test } from "bun:test";
import { prepareMotionTextCues } from "../motion-text-prepare-cues";
import { core } from "./structured-cues-fixture";
import {
	createStructuredMotionTextSequence,
	MOTION_TEXT_RENDERER_SUPPORT,
} from "@opencut/editor-classic/motion-text/factory";

const input = {
	sequenceId: "pure-jz",
	source: "A line",
	cues: [
		{
			lineId: "line-one",
			sourceLine: 1,
			text: "A line",
			startTicks: 12000,
			endTicks: 120000,
		},
	],
	durationTicks: 240000,
	language: "auto",
	starterPreset: "clean-caption",
	seed: 18,
};
test("pure preparation preserves fixed cue identity/clock without a project or track", () => {
	const result = prepareMotionTextCues(input, core);
	expect(result.sequence).toMatchObject({
		id: input.sequenceId,
		duration: 240000,
		source: { text: input.source },
	});
	expect(result.lineMappings).toEqual([
		{ lineId: "line-one", sourceLine: 1, cueId: "cue:line-one" },
	]);
});
test("pure preparation rejects unknown presets and mutation fields", () => {
	expect(() =>
		prepareMotionTextCues({ ...input, starterPreset: "made-up" }, core),
	).toThrow();
	expect(() =>
		prepareMotionTextCues({ ...input, trackId: "mutate" }, core),
	).toThrow();
});

test("text syntax is optional and explicit, and transport does not parse lyrics", () => {
	let received: unknown;
	const capture: typeof core = (options) => {
		received = options;
		return core(options);
	};
	prepareMotionTextCues(input, capture);
	expect(received).toMatchObject({ source: input.source });
	expect((received as { textSyntax?: string }).textSyntax).toBeUndefined();
	prepareMotionTextCues({ ...input, textSyntax: "jizura" }, capture);
	expect(received).toMatchObject({
		textSyntax: "jizura",
		source: input.source,
	});
	prepareMotionTextCues({ ...input, textSyntax: "literal" }, capture);
	expect(received).toMatchObject({ textSyntax: "literal" });
	expect(() =>
		prepareMotionTextCues({ ...input, textSyntax: "guess" }, capture),
	).toThrow();
});

test("wrapper allows parsed display only in explicit jizura mode and retains fixed identities and clock", () => {
	type FixedSequence = {
		source: { text: string };
		cues: Array<{ sourceLine: number; startTime: number; duration: number }>;
	};
	const options = { ...input, rendererSupport: MOTION_TEXT_RENDERER_SUPPORT };
	const changed: typeof core = (options) => {
		const result = core(options) as { sequenceJson: string };
		const sequence = JSON.parse(result.sequenceJson);
		sequence.cues[0].text = "parsed display";
		return { ...result, sequenceJson: JSON.stringify(sequence) };
	};
	expect(() =>
		createStructuredMotionTextSequence({ options, core: changed }),
	).toThrow("fixed cue");
	expect(() =>
		createStructuredMotionTextSequence({
			options: { ...options, textSyntax: "literal" },
			core: changed,
		}),
	).toThrow("fixed cue");
	expect(
		createStructuredMotionTextSequence({
			options: { ...options, textSyntax: "jizura" },
			core: changed,
		}).sequence?.cues[0].text,
	).toBe("parsed display");
	for (const mutate of [
		(sequence: FixedSequence) => {
			sequence.source.text = "different raw source";
		},
		(sequence: FixedSequence) => {
			sequence.cues[0].sourceLine = 2;
		},
		(sequence: FixedSequence) => {
			sequence.cues[0].startTime += 1;
		},
		(sequence: FixedSequence) => {
			sequence.cues[0].duration -= 1;
		},
	]) {
		const invalid: typeof core = (options) => {
			const result = changed(options) as { sequenceJson: string };
			const sequence = JSON.parse(result.sequenceJson);
			mutate(sequence);
			return { ...result, sequenceJson: JSON.stringify(sequence) };
		};
		expect(() =>
			createStructuredMotionTextSequence({
				options: { ...options, textSyntax: "jizura" },
				core: invalid,
			}),
		).toThrow();
	}
});
