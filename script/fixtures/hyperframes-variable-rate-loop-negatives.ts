import assert from "node:assert/strict";
import type { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { pcmDifference } from "./hyperframes-variable-rate-io";
import {
	LOOP_NATIVE_RATE,
	materializeSourceLoop,
	prepareLoopReference,
} from "./hyperframes-variable-rate-loop-media";
import type { RateLane } from "./hyperframes-variable-rate-native";
import type { RateOracle } from "./hyperframes-variable-rate-production-media";

export async function sourceLoopNegatives({
	oracle,
	directory,
	name,
	source,
	tile,
	untrimmedTile,
	expected,
	duration,
	rate,
	firstLapSeconds,
	trim,
}: {
	oracle: RateOracle;
	directory: string;
	name: string;
	source: string;
	tile: Buffer;
	untrimmedTile: Buffer;
	expected: Buffer;
	duration: number;
	rate: RateLane;
	firstLapSeconds: number;
	trim: number;
}) {
	const first = await prepareLoopReference(
		oracle,
		directory,
		`${name}-wrong-first-lap`,
		source,
		firstLapSeconds,
		rate,
	);
	const repeated = Buffer.alloc(expected.length);
	for (let offset = 0; offset < repeated.length; offset += first.pcm.length)
		first.pcm.copy(
			repeated,
			offset,
			0,
			Math.min(first.pcm.length, repeated.length - offset),
		);
	const wrongPreparedRepeat = pcmDifference(expected, repeated);
	assert.ok(
		wrongPreparedRepeat.maximum > 0.01,
		"Repeated first prepared lap must fail",
	);
	const frames =
		Math.ceil(oracle.speed.sourceTimeAt(rate, duration) * LOOP_NATIVE_RATE) +
		480;
	const zeroSource = await materializeSourceLoop(
		directory,
		`${name}-wrong-source-zero`,
		untrimmedTile,
		frames,
		Math.round(trim * LOOP_NATIVE_RATE),
	);
	const wrongZero = await prepareLoopReference(
		oracle,
		directory,
		`${name}-wrong-source-zero`,
		zeroSource,
		duration,
		rate,
	);
	const wrongSourceZero = pcmDifference(expected, wrongZero.pcm);
	assert.ok(
		wrongSourceZero.maximum > 0.01,
		"Looping through source zero must fail",
	);
	// Even granting the fresh crop its correct source phase and shifted rate,
	// a new native slice grid/atempo state is not a crop of full preparation.
	const cropStart = 0.63,
		cropDuration = 0.23;
	const shifted = oracle.speed.shiftRateLane(rate, cropStart);
	const cropSourceFrames =
		Math.ceil(
			oracle.speed.sourceTimeAt(shifted, cropDuration) * LOOP_NATIVE_RATE,
		) + 480;
	const offset =
		Math.round(oracle.speed.sourceTimeAt(rate, cropStart) * LOOP_NATIVE_RATE) %
		(tile.length / 8);
	const cropSource = await materializeSourceLoop(
		directory,
		`${name}-wrong-crop-source`,
		tile,
		cropSourceFrames,
		offset,
	);
	const fresh = await prepareLoopReference(
		oracle,
		directory,
		`${name}-wrong-fresh-crop`,
		cropSource,
		cropDuration,
		shifted,
	);
	const crop = expected.subarray(
		Math.round(cropStart * LOOP_NATIVE_RATE) * 8,
		Math.round((cropStart + cropDuration) * LOOP_NATIVE_RATE) * 8,
	);
	const wrongCropRestart = pcmDifference(crop, fresh.pcm);
	assert.ok(
		wrongCropRestart.maximum > 0.001,
		"Fresh crop preparation must differ from complete history",
	);
	return {
		wrongPreparedRepeat,
		wrongSourceZero,
		wrongCropRestart,
		cropStart,
		cropDuration,
	};
}

/** Fourth negative: real unchanged native WebAudio delay state is not reset at
 * a source wrap. Optional separate browser slot; never labelled passed unrun. */
export async function loopFxResetNegative(
	oracle: Awaited<ReturnType<typeof createFxAutomationOracle>>,
	pcm: Buffer,
	firstLapSeconds: number,
) {
	const request = {
		sampleRate: LOOP_NATIVE_RATE,
		chain: {
			version: 1 as const,
			nodes: [
				{ type: "delay", params: { time: 70, feedback: 0.25, mix: 0.7 } },
			],
		},
	};
	const full = await oracle.render(request, pcm);
	const split = Math.round(firstLapSeconds * LOOP_NATIVE_RATE) * 8;
	assert.ok(split > 0 && split < pcm.length);
	const before = await oracle.render(request, pcm.subarray(0, split));
	const after = await oracle.render(request, pcm.subarray(split));
	const reset = Buffer.concat([
		before.pcm.subarray(0, split),
		after.pcm.subarray(0, pcm.length - split),
	]);
	const wrongFxReset = pcmDifference(full.pcm.subarray(0, pcm.length), reset);
	assert.ok(
		wrongFxReset.maximum > 0.001,
		"Restarting FX at the source wrap must fail",
	);
	return {
		wrongFxReset,
		splitFrame: split / 8,
		fullFrames: full.frames,
		boundary:
			"Unmodified native delay graph on independent prepared PCM, not production Rocut execution.",
	};
}
