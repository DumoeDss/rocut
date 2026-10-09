import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	resolveProgrammaticFrame,
	type ProgrammaticFrame,
} from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvResourceFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-resource-frame";
import {
	emberAnalysis,
	emberAudioFacts,
	EMBER_INPUT_SHA,
} from "./mv-ember-audio";

const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: "",
	width: 64,
	height: 64,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 30,
	seed: 17,
	recipe: {
		version: 1,
		songStartSeconds: 1.5,
		outputRoles: ["background"],
		root: "fill",
		post: [],
		nodes: [
			{
				id: "fill",
				scene: { kind: "solid", role: "background", color: [1, 0, 0, 0.5] },
			},
		],
	},
};
function frame(): ProgrammaticFrame {
	const result = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: 12000,
		trimStart: 8000,
		timelineTime: 125005,
	});
	if (!result) throw Error("Missing native fixture frame");
	return result;
}

test("resource-free native scenes discard supplied drawing plans and limits, preserving timeline clock", async () => {
	const actual = frame();
	const forged: ProgrammaticFrame = {
		...actual,
		time: 999,
		seed: 2,
		frameRate: { numerator: 1, denominator: 1 },
		durationFrames: 1,
		recipePlan: {
			...actual.recipePlan!,
			root: { kind: "solid", role: "background", color: [0, 1, 0, 1] },
		},
		fontMetricRequests: [],
		imageDimensionRequests: [],
		imageDecodeLimits: { maxDecodedBytes: 1, maxDimension: 1 },
	};
	const result = await resolveMvResourceFrame({
		source,
		frame: forged,
		resources: [],
	});
	expect(result.recipePlan).toEqual(actual.recipePlan);
	expect(result.time).toBe(actual.time);
	expect(result.seed).toBe(17);
	expect(result.frameRate).toEqual(source.frameRate);
	expect(result.durationFrames).toBe(30);
	expect(result.timelineTime).toBe(125005);
	expect(result.imageDecodeLimits).toBeUndefined();
	expect(forged.time).toBe(999);
});

test("fresh Rust admission rejects invalid source, mismatched frame and invalid sampling ticks", async () => {
	const actual = frame();
	for (const invalid of [
		{ ...source, code: "throw Error('author')" },
		{ ...source, width: 8192 },
	])
		await expect(
			resolveMvResourceFrame({ source: invalid, frame: actual, resources: [] }),
		).rejects.toThrow();
	for (const invalid of [
		{ ...actual, index: actual.index + 1 },
		{ ...actual, sampleTime: -1 },
		{ ...actual, sampleTime: 120000 },
		{ ...actual, sourceTime: 1.5 },
	])
		await expect(
			resolveMvResourceFrame({ source, frame: invalid, resources: [] }),
		).rejects.toThrow();
});

test("cancelled native requests do not bypass cancellation on a no-resource fast path", async () => {
	const signal = AbortSignal.abort(Error("native-frame-cancelled"));
	await expect(
		resolveMvResourceFrame({ source, frame: frame(), resources: [], signal }),
	).rejects.toThrow("native-frame-cancelled");
});

test("ordinary authored Canvas remains on its existing non-native resource path", async () => {
	const { recipe: _recipe, ...base } = source;
	const authored = {
		...base,
		code: "canvas.getContext('2d').fillRect(0,0,1,1)",
	};
	const input = frame();
	expect(
		await resolveMvResourceFrame({
			source: authored,
			frame: input,
			resources: [],
		}),
	).toBe(input);
});

test("analysis JSON is parsed from the exact bytes that were hashed across async IO", async () => {
	const analysis = await emberAnalysis(emberAudioFacts());
	const bound: ProgrammaticSource = {
		...source,
		resources: [analysis.resource],
		recipe: {
			...source.recipe!,
			audio: { resource: analysis.resource.id, inputSha256: EMBER_INPUT_SHA },
			post: [
				{
					roles: ["background"],
					effects: [{ kind: "fade", amount: 0 }],
					audio: [
						{
							effect: 0,
							amount: 0.5,
							signal: {
								kind: "envelope",
								channel: "mix_rms",
								clock: "song",
								missing: "error",
							},
						},
					],
				},
			],
		},
	};
	const initial = resolveProgrammaticFrame({
		source: bound,
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime: 8000,
	});
	if (!initial) throw Error("Missing deferred audio frame");
	expect(initial.recipePlan).toBeUndefined();
	const expected = await resolveMvResourceFrame({
		source: bound,
		frame: initial,
		resources: [analysis],
	});
	expect(expected.recipePlan).toBeTruthy();
	const pending = resolveMvResourceFrame({
		source: bound,
		frame: initial,
		resources: [analysis],
	});
	new Uint8Array(analysis.body).fill(0);
	const actual = await pending;
	expect(actual.recipePlan).toEqual(expected.recipePlan);
	expect(actual.sampleTime).toBe(expected.sampleTime);
	expect(actual.timelineTime).toBe(8000);
	await expect(
		resolveMvResourceFrame({
			source: bound,
			frame: initial,
			resources: [analysis],
		}),
	).rejects.toThrow("digest mismatch");
});
