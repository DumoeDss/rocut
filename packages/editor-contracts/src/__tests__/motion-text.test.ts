/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Each test mutates one field of a valid structured fixture to probe the runtime wire validator. */
import { describe, expect, test } from "bun:test";

import { assetId, clipId, mediaTime } from "../domain";
import { motionTextResolvedPlanFromPlanner } from "../motion-text-planner";
import {
	MOTION_TEXT_LIMITS,
	motionTextCueId,
	motionTextCutId,
	motionTextFontId,
	motionTextSequenceId,
	type MotionTextSequence,
	validateMotionTextSequence,
} from "../motion-text";
import type { MotionTextPlan as WasmMotionTextPlan } from "../../../../rust/wasm/pkg/opencut_wasm.js";

function validSequence(): MotionTextSequence {
	return {
		id: motionTextSequenceId("sequence:opening"),
		schemaVersion: 1,
		revision: 3,
		source: { format: "lrc", text: "[00:00.00]Hello" },
		language: "en",
		planningControls: {
			presetSets: { horror: false, typo: true, kinetic: true },
			unify: false,
			centerFree: false,
			centerDirection: "tb",
		},
		duration: mediaTime({ ticks: 240_000 }),
		compositionMode: "overlay",
		seed: 42,
		engine: {
			id: "jizura",
			version: "0.9.0",
			catalogHash: "sha256:catalog",
			plannerVersion: 1,
			tokenizerVersion: "unicode-v1",
		},
		audioBinding: {
			assetId: assetId("asset:music"),
			clipId: clipId("clip:music"),
			sourceOffset: mediaTime({ ticks: 0 }),
			duration: mediaTime({ ticks: 240_000 }),
		},
		fonts: [
			{
				id: motionTextFontId("font:inter"),
				source: "builtin",
				family: "Inter",
				style: "normal",
				weight: 700,
				supportedLanguages: ["en"],
				builtinPath: "motion-text/fonts/inter-bold.ttf",
				contentDigest: "sha256:fixture",
			},
		],
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
			fontId: motionTextFontId("font:inter"),
			colors: {},
			parameters: {},
		},
		cues: [
			{
				id: motionTextCueId("cue:hello"),
				text: "Hello",
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 120_000 }),
				interlude: false,
				gapBefore: false,
				impact: false,
				emphasis: [],
				segments: ["Hello"],
				locks: [],
				overrides: {},
			},
		],
		resolvedPlan: {
			version: 1,
			sequenceRevision: 3,
			cuts: [
				{
					id: motionTextCutId("cut:hello"),
					cueId: motionTextCueId("cue:hello"),
					text: "Hello",
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 120_000 }),
					seed: 9,
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
					fontId: motionTextFontId("font:inter"),
					parameters: { opacity: 1 },
				},
			],
		},
	};
}

function mutableSequence(): Record<string, unknown> {
	return structuredClone(validSequence()) as Record<string, unknown>;
}

function issueCodes(args: {
	readonly value: unknown;
	readonly knownPresetIds?: ReadonlySet<string>;
}) {
	return validateMotionTextSequence({
		value: args.value,
		...(args.knownPresetIds === undefined
			? {}
			: { options: { knownPresetIds: args.knownPresetIds } }),
	}).map((entry) => entry.code);
}

describe("motion-text contract validation", () => {
	test("accepts a valid sequence", () => {
		expect(validateMotionTextSequence({ value: validSequence() })).toEqual([]);
	});

	test("validates planning controls while accepting legacy v1 omission", () => {
		const legacy = mutableSequence();
		delete legacy.planningControls;
		expect(validateMotionTextSequence({ value: legacy })).toEqual([]);

		const invalid = mutableSequence();
		invalid.planningControls = {
			presetSets: { horror: "yes", typo: true, kinetic: true },
			unify: false,
			centerFree: true,
			centerDirection: "center",
		};
		expect(issueCodes({ value: invalid })).toContain("invalid-value");
	});

	test("validates cue lock identities and uniqueness", () => {
		const valid = mutableSequence();
		const validCue = (valid.cues as Array<Record<string, unknown>>)[0]!;
		validCue.locks = [
			{ scope: "cue", key: "all" },
			{ scope: "preset-group", key: "trans" },
			{ scope: "cut", key: "cut:hello" },
			{ scope: "parameter", key: "tracking" },
		];
		expect(validateMotionTextSequence({ value: valid })).toEqual([]);

		const invalid = mutableSequence();
		const invalidCue = (invalid.cues as Array<Record<string, unknown>>)[0]!;
		invalidCue.locks = [
			{ scope: "preset-group", key: "unknown" },
			{ scope: "cue", key: "all" },
			{ scope: "cue", key: "all" },
		];
		expect(issueCodes({ value: invalid })).toEqual([
			"invalid-value",
			"duplicate-id",
		]);
	});

	test("rejects unknown schema and plan versions", () => {
		const sequence = mutableSequence();
		sequence.schemaVersion = 2;
		const plan = sequence.resolvedPlan as Record<string, unknown>;
		plan.version = 2;
		expect(issueCodes({ value: sequence })).toEqual([
			"unsupported-version",
			"unsupported-version",
		]);
	});

	test("rejects non-finite parameters", () => {
		const sequence = mutableSequence();
		const plan = sequence.resolvedPlan as {
			cuts: Array<Record<string, unknown>>;
		};
		plan.cuts[0]!.parameters = { scale: Number.POSITIVE_INFINITY };
		expect(issueCodes({ value: sequence })).toContain("invalid-value");
	});

	test("validates an optional audio clip binding", () => {
		const sequence = mutableSequence();
		const binding = sequence.audioBinding as Record<string, unknown>;
		binding.clipId = "";
		expect(issueCodes({ value: sequence })).toContain("invalid-value");
	});

	test("rejects builtin font paths outside the motion-text TTF namespace", () => {
		const sequence = mutableSequence();
		const fonts = sequence.fonts as Array<Record<string, unknown>>;
		fonts[0]!.builtinPath = "../secrets/font.ttf";
		expect(issueCodes({ value: sequence })).toContain("invalid-value");
	});

	test("validates optional declared font language coverage", () => {
		const sequence = mutableSequence();
		const fonts = sequence.fonts as Array<Record<string, unknown>>;
		fonts[0]!.supportedLanguages = ["en", "en"];
		expect(issueCodes({ value: sequence })).toContain("invalid-value");

		fonts[0]!.supportedLanguages = ["zh-Hans", "en"];
		expect(validateMotionTextSequence({ value: sequence })).toEqual([]);
	});

	test("distinguishes valid manual beat overrides from invalid metadata", () => {
		const valid = mutableSequence();
		const validBinding = valid.audioBinding as Record<string, unknown>;
		validBinding.beatOverride = { bpm: 120, firstBeat: 24_000 };
		expect(validateMotionTextSequence({ value: valid })).toEqual([]);

		const invalid = mutableSequence();
		const invalidBinding = invalid.audioBinding as Record<string, unknown>;
		invalidBinding.beatOverride = { bpm: 500 };
		expect(issueCodes({ value: invalid })).toContain("invalid-value");

		const empty = mutableSequence();
		const emptyBinding = empty.audioBinding as Record<string, unknown>;
		emptyBinding.beatOverride = {};
		expect(issueCodes({ value: empty })).toContain("invalid-value");
	});

	test("rejects non-positive cue and cut durations", () => {
		const sequence = mutableSequence();
		const cues = sequence.cues as Array<Record<string, unknown>>;
		const plan = sequence.resolvedPlan as {
			cuts: Array<Record<string, unknown>>;
		};
		cues[0]!.duration = 0;
		plan.cuts[0]!.duration = 0;
		expect(
			issueCodes({ value: sequence }).filter(
				(code) => code === "invalid-value",
			),
		).toHaveLength(2);
	});

	test("validates explicit cue timing provenance", () => {
		const valid = mutableSequence();
		const validCues = valid.cues as Array<Record<string, unknown>>;
		validCues[0]!.timingSource = "tap";
		expect(validateMotionTextSequence({ value: valid })).toEqual([]);

		const invalid = mutableSequence();
		const invalidCues = invalid.cues as Array<Record<string, unknown>>;
		invalidCues[0]!.timingSource = "magic";
		expect(issueCodes({ value: invalid })).toContain("invalid-value");
	});

	test("validates persisted custom cut duration partitions", () => {
		const valid = mutableSequence();
		const validCues = valid.cues as Array<Record<string, unknown>>;
		validCues[0]!.cutDurations = [120_000];
		expect(validateMotionTextSequence({ value: valid })).toEqual([]);

		const wrongTotal = mutableSequence();
		const wrongTotalCues = wrongTotal.cues as Array<Record<string, unknown>>;
		wrongTotalCues[0]!.cutDurations = [119_999];
		expect(issueCodes({ value: wrongTotal })).toContain("invalid-value");

		const wrongCount = mutableSequence();
		const wrongCountCues = wrongCount.cues as Array<Record<string, unknown>>;
		wrongCountCues[0]!.cutDurations = [60_000, 60_000];
		expect(issueCodes({ value: wrongCount })).toContain("invalid-value");
	});

	test("rejects duplicate cue and cut ids", () => {
		const sequence = mutableSequence();
		const cues = sequence.cues as Array<Record<string, unknown>>;
		const plan = sequence.resolvedPlan as {
			cuts: Array<Record<string, unknown>>;
		};
		cues.push(structuredClone(cues[0]!));
		plan.cuts.push(structuredClone(plan.cuts[0]!));
		expect(
			issueCodes({ value: sequence }).filter((code) => code === "duplicate-id"),
		).toHaveLength(2);
	});

	test("rejects a cut that references a missing cue", () => {
		const sequence = mutableSequence();
		const plan = sequence.resolvedPlan as {
			cuts: Array<Record<string, unknown>>;
		};
		plan.cuts[0]!.cueId = "cue:missing";
		expect(issueCodes({ value: sequence })).toContain("missing-relation");
	});

	test("rejects presets outside the supplied catalog", () => {
		const known = new Set([
			"style:base",
			"layout:center",
			"enter:fade",
			"hold:still",
			"exit:fade",
			"treat:none",
			"bg:transparent",
			"cam:static",
		]);
		const sequence = mutableSequence();
		const plan = sequence.resolvedPlan as {
			cuts: Array<Record<string, unknown>>;
		};
		const preset = plan.cuts[0]!.preset as Record<string, unknown>;
		preset.layout = "does-not-exist";
		expect(issueCodes({ value: sequence, knownPresetIds: known })).toEqual([
			"unknown-preset",
		]);
	});

	test("enforces source, cue and parameter resource limits", () => {
		const sourceSequence = mutableSequence();
		(sourceSequence.source as Record<string, unknown>).text = "x".repeat(
			MOTION_TEXT_LIMITS.maxSourceCharacters + 1,
		);
		expect(issueCodes({ value: sourceSequence })).toContain("resource-limit");

		const cueSequence = mutableSequence();
		(cueSequence.cues as Array<Record<string, unknown>>)[0]!.text = "x".repeat(
			MOTION_TEXT_LIMITS.maxCueCharacters + 1,
		);
		expect(issueCodes({ value: cueSequence })).toContain("resource-limit");

		const parameterSequence = mutableSequence();
		const plan = parameterSequence.resolvedPlan as {
			cuts: Array<Record<string, unknown>>;
		};
		plan.cuts[0]!.parameters = {
			label: "x".repeat(MOTION_TEXT_LIMITS.maxParameterStringCharacters + 1),
		};
		expect(issueCodes({ value: parameterSequence })).toContain(
			"resource-limit",
		);
	});
});

describe("motion-text planner boundary", () => {
	test("accepts the generated WASM plan shape and adds nominal editor types", () => {
		const wasmPlan = {
			version: 1,
			sequenceRevision: 3,
			cuts: [
				{
					id: "cut:wire",
					cueId: "cue:hello",
					text: "Hello",
					startTime: 0,
					duration: 120_000,
					seed: 9,
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
					fontId: null,
					parameters: { nullable: null },
				},
			],
		} satisfies WasmMotionTextPlan;

		const plan = motionTextResolvedPlanFromPlanner(wasmPlan);
		expect(plan.version).toBe(1);
		expect(plan.cuts[0]).toMatchObject({
			id: "cut:wire",
			cueId: "cue:hello",
			startTime: 0,
			duration: 120_000,
			parameters: { nullable: null },
		});
		expect("fontId" in plan.cuts[0]!).toBe(false);
		expect(
			validateMotionTextSequence({
				value: { ...validSequence(), resolvedPlan: plan },
			}),
		).toEqual([]);
	});

	test("rejects an incompatible planner version", () => {
		expect(() =>
			motionTextResolvedPlanFromPlanner({
				version: 2,
				sequenceRevision: 0,
				cuts: [],
			}),
		).toThrow("Unsupported motion-text plan version 2");
	});
});
