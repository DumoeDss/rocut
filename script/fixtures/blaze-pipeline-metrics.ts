import { pipelineThresholds } from "./blaze-pipeline-cases";

export function codecDifference(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	baseline: Uint8ClampedArray,
) {
	if (
		!actual.length ||
		actual.length % 4 ||
		actual.length !== expected.length ||
		baseline.length !== expected.length
	)
		throw Error("Blaze codec pixel length mismatch");
	let total = 0,
		activeError = 0,
		activePixels = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		for (let channel = 0; channel < 4; channel++)
			total += Math.abs(actual[offset + channel] - expected[offset + channel]);
		if (
			[0, 1, 2].some(
				(channel) =>
					Math.abs(expected[offset + channel] - baseline[offset + channel]) >
					15,
			)
		) {
			activePixels++;
			for (let channel = 0; channel < 3; channel++)
				activeError += Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
		}
	}
	const meanRgba = total / actual.length;
	const activeRgb = activePixels
		? activeError / (activePixels * 3)
		: Number.MAX_VALUE;
	return {
		meanRgba,
		activeRgb,
		activePixels,
		accepted:
			meanRgba <= pipelineThresholds.exportMeanRgba &&
			activeRgb <= pipelineThresholds.exportActiveRgb &&
			activePixels >= pipelineThresholds.exportMinimumActivePixels,
	};
}
