#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
	MOTION_TEXT_PLAN_VERSION,
	MOTION_TEXT_SCHEMA_VERSION,
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	duplicateMotionTextSequence,
	inspectMotionTextFont,
	mapMotionTextClipTime,
	parseMotionTextSource,
	planMotionTextSequence,
	tokenizeMotionText,
} from "../rust/wasm/pkg/opencut_wasm_sync.js";
import {
	invalidMotionTextPlannerFixture,
	motionTextPlannerFixture,
	motionTextSemanticSummary,
} from "./fixtures/motion-text-planner-fixture.mjs";

if (Number(process.versions.node.split(".")[0]) < 20) {
	throw new Error(
		`motion-text requires Node 20 or newer; observed ${process.version}`,
	);
}
if (
	typeof globalThis.document !== "undefined" ||
	typeof globalThis.window !== "undefined"
) {
	throw new Error("The Node bridge probe must run without DOM globals.");
}

const parsed = parseMotionTextSource({
	sequenceId: "node-bridge-probe",
	source: `[ti:Node bridge]
[00:01.25]*hello*/world! | note
[interlude 2s]`,
});

const firstCue = parsed.cues[0];
const interlude = parsed.cues[1];
const planned = planMotionTextSequence(motionTextPlannerFixture());
const invalidPlan = planMotionTextSequence(invalidMotionTextPlannerFixture());
const tokenized = tokenizeMotionText({
	text: "你好世界再次相见",
	language: "zh-Hans",
});
const clipTime = mapMotionTextClipTime({
	clipStartTime: 120_000,
	clipDuration: 240_000,
	trimStart: 60_000,
	timelineTime: 180_000,
	sequenceDuration: 360_000,
});
const invalidFont = inspectMotionTextFont({
	bytes: new TextEncoder().encode("not-a-font"),
	text: "hello",
	faceIndex: 0,
});
const duplicatedIdentity = duplicateMotionTextSequence({
	sequenceJson: JSON.stringify({
		id: "sequence:source",
		revision: 4,
		futureExtension: { keep: true },
		cues: [{ id: "cue:source", locks: [{ key: "trans" }] }],
		resolvedPlan: {
			sequenceRevision: 4,
			cuts: [{ id: "cut:source", cueId: "cue:source" }],
		},
	}),
	newSequenceId: "sequence:independent",
});
const duplicatedSequence = duplicatedIdentity.sequenceJson
	? JSON.parse(duplicatedIdentity.sequenceJson)
	: null;
const rendererSupport = [
	{ group: "style", id: "base" },
	{ group: "style", id: "crimson" },
	{ group: "layout", id: "center" },
	{ group: "layout", id: "huge" },
	{ group: "enter", id: "fade" },
	{ group: "hold", id: "still" },
	{ group: "exit", id: "fade" },
	{ group: "treat", id: "none" },
	{ group: "bg", id: "transparent" },
	{ group: "cam", id: "static" },
];
const createdSequence = createMotionTextSequence({
	sequenceId: "sequence:node-variation",
	source: "第一句\n第二句",
	sourceFormat: "plain",
	language: "zh-Hans",
	duration: 1_200_000,
	seed: 7,
	starterPreset: "clean-caption",
	rendererSupport,
});
const createdSequenceDocument = createdSequence.sequenceJson
	? JSON.parse(createdSequence.sequenceJson)
	: null;
const variationCandidate = createMotionTextVariationCandidate({
	sequenceJson: createdSequence.sequenceJson ?? "null",
	salt: 11,
	cueIds: createdSequenceDocument?.cues?.[0]?.id
		? [createdSequenceDocument.cues[0].id]
		: [],
	groups: ["style", "layout"],
	rendererSupport,
});
const variationSequence = variationCandidate.sequenceJson
	? JSON.parse(variationCandidate.sequenceJson)
	: null;
const semanticSummary = motionTextSemanticSummary({
	parseMotionTextSource,
	planMotionTextSequence,
	tokenizeMotionText,
});
const expectedSemanticSummary = JSON.parse(
	readFileSync(
		new URL("./fixtures/motion-text-semantic-expected.json", import.meta.url),
		"utf8",
	),
);
const failures = [];
if (MOTION_TEXT_SCHEMA_VERSION() !== 1 || parsed.schemaVersion !== 1) {
	failures.push("schema version did not cross the WASM boundary");
}
if (
	!firstCue ||
	firstCue.text !== "hello world" ||
	firstCue.startTicks !== 150_000 ||
	firstCue.note !== "note" ||
	firstCue.impact !== true ||
	firstCue.emphasis[0] !== "hello"
) {
	failures.push("the lyric cue did not retain its parsed fields");
}
if (
	!interlude ||
	interlude.interlude !== true ||
	interlude.interludeDurationTicks !== 240_000
) {
	failures.push("the interlude did not retain its duration");
}
if (
	MOTION_TEXT_PLAN_VERSION() !== 1 ||
	!planned.plan ||
	planned.plan.cuts.length !== 3 ||
	planned.plan.sequenceRevision !== 2
) {
	failures.push(
		"the deterministic planner result did not cross the WASM boundary",
	);
}
if (
	invalidPlan.plan !== null ||
	!invalidPlan.diagnostics.some(
		(diagnostic) => diagnostic.code === "overlapping-cues",
	)
) {
	failures.push("invalid cue timing did not fail without a partial plan");
}
if (
	tokenized.version !== "unicode-v1" ||
	tokenized.segments.join("|") !== "你好世界|再次相见"
) {
	failures.push("the deterministic tokenizer result changed");
}
if (!clipTime.active || clipTime.sequenceTime !== 120_000) {
	failures.push("clip source-time mapping changed");
}
if (
	invalidFont.inspection !== null ||
	typeof invalidFont.error !== "string" ||
	!invalidFont.error.startsWith("invalid-font:")
) {
	failures.push("invalid font bytes did not fail closed in Rust");
}
if (
	duplicatedIdentity.error !== null ||
	duplicatedIdentity.cueIds.length !== 1 ||
	duplicatedIdentity.cutIds.length !== 1 ||
	duplicatedSequence?.id !== "sequence:independent" ||
	duplicatedSequence?.revision !== 0 ||
	duplicatedSequence?.resolvedPlan?.sequenceRevision !== 0 ||
	duplicatedSequence?.resolvedPlan?.cuts?.[0]?.cueId !==
		duplicatedSequence?.cues?.[0]?.id ||
	duplicatedSequence?.futureExtension?.keep !== true ||
	duplicatedSequence?.cues?.[0]?.locks?.[0]?.key !== "trans"
) {
	failures.push("independent copy did not rebuild identity in Rust");
}
if (
	variationCandidate.baseRevision !== 0 ||
	variationCandidate.candidateRevision !== 1 ||
	variationCandidate.salt !== 11 ||
	variationSequence?.revision !== 1 ||
	variationSequence?.resolvedPlan?.sequenceRevision !== 1
) {
	failures.push(
		"variation candidate revisions did not cross the WASM boundary",
	);
}
if (
	!planned.plan ||
	Object.getPrototypeOf(planned.plan.cuts[0].parameters) !== Object.prototype ||
	planned.plan.cuts[0].parameters.nullable !== null ||
	planned.plan.cuts[0].preset.trans !== null ||
	planned.plan.cuts[0].fontId !== null
) {
	failures.push("planner output is not JSON-compatible at the WASM boundary");
}
if (
	JSON.stringify(semanticSummary) !== JSON.stringify(expectedSemanticSummary)
) {
	failures.push("the committed motion-text semantic fixture changed");
}

if (failures.length > 0) {
	throw new Error(`motion-text Node bridge failed: ${failures.join("; ")}`);
}

console.log(
	JSON.stringify(
		{
			checks: {
				clipTimeMapping: true,
				domIndependent: true,
				fontInspection: true,
				independentIdentity: true,
				interludeRoundTrip: true,
				lyricRoundTrip: true,
				plannerRoundTrip: true,
				schemaVersion: true,
				tokenizerRoundTrip: true,
				variationCandidate: true,
			},
			cueIds: parsed.cues.map((cue) => cue.id),
			node: process.version,
			wasmEntry: "rust/wasm/pkg/opencut_wasm_sync.js",
		},
		null,
		2,
	),
);
