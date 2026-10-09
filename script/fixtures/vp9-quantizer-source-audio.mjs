import assert from "node:assert/strict";
import { AUDIO, audioSamples } from "./vp9-quantizer-source-cases.mjs";

export const AUDIO_TIMING_GATE = {
	minimumUnshiftedCorrelation: 0.95,
	maximumAbsoluteLagSamples: 48,
	searchLagSamples: 960,
	activityWindowSamples: 48,
	activityThresholdFractionOfInputRms: 0.02,
};
function rms(samples) {
	let energy = 0;
	for (const value of samples) energy += value * value;
	return Math.sqrt(energy / samples.length);
}
function activity(samples, threshold) {
	const window = AUDIO_TIMING_GATE.activityWindowSamples;
	let first = null,
		end = null;
	for (let offset = 0; offset < samples.length; offset += window) {
		if (
			rms(samples.subarray(offset, Math.min(offset + window, samples.length))) >
			threshold
		) {
			first ??= offset;
			end = Math.min(offset + window, samples.length);
		}
	}
	return {
		firstActiveSample: first,
		activeEndSampleExclusive: end,
		leadingInactiveSamples: first,
		trailingInactiveSamples:
			end === null ? samples.length : samples.length - end,
	};
}
/** Uses the entire unshifted decoded track; lag search is diagnostic only. */
export function analyseCompanionAudio(decoded) {
	const original = audioSamples();
	assert.ok(
		decoded.length >= original.length &&
			decoded.length < original.length + AUDIO.sampleRate / 50,
	);
	assert.ok(decoded.every(Number.isFinite));
	let actualEnergy = 0;
	for (const value of decoded) actualEnergy += value * value;
	const correlate = (lag) => {
		let product = 0,
			expectedEnergy = 0;
		for (let index = 0; index < decoded.length; index++) {
			const expected = original[index - lag] ?? 0;
			product += decoded[index] * expected;
			expectedEnergy += expected * expected;
		}
		return product / Math.sqrt(actualEnergy * expectedEnergy);
	};
	const unshiftedCorrelation = correlate(0);
	let bestLagSamples = 0,
		bestLagCorrelation = unshiftedCorrelation;
	for (
		let lag = -AUDIO_TIMING_GATE.searchLagSamples;
		lag <= AUDIO_TIMING_GATE.searchLagSamples;
		lag++
	) {
		const correlation = correlate(lag);
		if (correlation > bestLagCorrelation) {
			bestLagSamples = lag;
			bestLagCorrelation = correlation;
		}
	}
	const inputRms = rms(original);
	const activityThresholdRms =
		inputRms * AUDIO_TIMING_GATE.activityThresholdFractionOfInputRms;
	const inputActivity = activity(original, activityThresholdRms);
	const decodedActivity = activity(decoded, activityThresholdRms);
	const tail = decoded.subarray(original.length);
	const onsetDifferenceSamples =
		decodedActivity.firstActiveSample - inputActivity.firstActiveSample;
	const offsetDifferenceSamples =
		decodedActivity.activeEndSampleExclusive -
		inputActivity.activeEndSampleExclusive;
	const passed =
		unshiftedCorrelation >= AUDIO_TIMING_GATE.minimumUnshiftedCorrelation &&
		Math.abs(bestLagSamples) <= AUDIO_TIMING_GATE.maximumAbsoluteLagSamples &&
		Math.abs(onsetDifferenceSamples) <=
			AUDIO_TIMING_GATE.activityWindowSamples &&
		offsetDifferenceSamples >= -AUDIO_TIMING_GATE.activityWindowSamples &&
		offsetDifferenceSamples < AUDIO.sampleRate / 50;
	return {
		passed,
		gates: AUDIO_TIMING_GATE,
		inputSamples: original.length,
		decodedSamples: decoded.length,
		tailPaddingSamples: decoded.length - original.length,
		sampleRate: AUDIO.sampleRate,
		unshiftedCorrelation,
		bestLagSamples,
		bestLagSeconds: bestLagSamples / AUDIO.sampleRate,
		bestLagCorrelation,
		inputRms,
		decodedRms: rms(decoded),
		tailRms: tail.length ? rms(tail) : 0,
		activityThresholdRms,
		inputActivity,
		decodedActivity,
		onsetDifferenceSamples,
		offsetDifferenceSamples,
		scope:
			"Entire FFmpeg-decoded audio compared to the original input at lag zero. Best lag is independently reported, never applied. Native Opus flush tail is retained and its activity/RMS reported; no sample-exact duration claim.",
	};
}
export function pcmFloat32(bytes) {
	assert.equal(bytes.byteLength % 4, 0);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Float32Array.from({ length: bytes.byteLength / 4 }, (_, index) =>
		view.getFloat32(index * 4, true),
	);
}
