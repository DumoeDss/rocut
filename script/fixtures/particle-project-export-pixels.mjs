export const PROJECT_EXPORT_LIMITS = Object.freeze({
	meanRgbError: 12,
	activeMeanRgbError: 18,
	activeChannelThreshold: 32,
	activeLumaRatioMinimum: 0.94,
	activeLumaRatioMaximum: 1.06,
	minimumActivePixels: 64,
	blankMeanRgbMaximum: 0.5,
	timestampToleranceSeconds: 0.001,
	negativeMinimumActiveMeanRgbError: 3,
	opacityCompositeMeanErrorMaximum: 2,
	opacityCompositeMaximumError: 4,
});
// Test oracle only: shared unchanged by browser controls and independent FFmpeg decode.
export function projectPixelMetrics(
	actual,
	reference,
	activityReference = reference,
) {
	if (
		actual.length !== reference.length ||
		activityReference.length !== reference.length ||
		!actual.length ||
		actual.length % 4
	)
		throw Error("Particle project oracle: RGBA size mismatch");
	let total = 0,
		activeError = 0,
		activePixels = 0,
		referenceLuma = 0,
		actualLuma = 0,
		meanSum = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const active =
			Math.max(
				activityReference[offset],
				activityReference[offset + 1],
				activityReference[offset + 2],
			) > PROJECT_EXPORT_LIMITS.activeChannelThreshold;
		if (active) activePixels++;
		for (let c = 0; c < 3; c++) {
			const delta = Math.abs(actual[offset + c] - reference[offset + c]);
			total += delta;
			meanSum += actual[offset + c];
			if (active) {
				activeError += delta;
				referenceLuma += reference[offset + c];
				actualLuma += actual[offset + c];
			}
		}
	}
	return {
		meanRgbError: total / ((actual.length / 4) * 3),
		activeMeanRgbError: activePixels ? activeError / (activePixels * 3) : 0,
		activePixels,
		activeLumaRatio: referenceLuma ? actualLuma / referenceLuma : null,
		actualMeanRgb: meanSum / ((actual.length / 4) * 3),
	};
}
export function opacityCompositeMetrics(saved, fullOpacity) {
	if (saved.length !== fullOpacity.length)
		throw Error("Opacity oracle size mismatch");
	let channels = 0,
		sum = 0,
		maximum = 0;
	for (let i = 0; i < saved.length; i += 4) {
		if (
			Math.max(saved[i], saved[i + 1], saved[i + 2]) <=
			PROJECT_EXPORT_LIMITS.activeChannelThreshold
		)
			continue;
		for (let c = 0; c < 3; c++) {
			const error = Math.abs(saved[i + c] - 0.85 * fullOpacity[i + c]);
			channels++;
			sum += error;
			maximum = Math.max(maximum, error);
		}
	}
	const mean = channels ? sum / channels : Infinity;
	return {
		channels,
		mean,
		maximum,
		accepted:
			channels >= PROJECT_EXPORT_LIMITS.minimumActivePixels * 3 &&
			mean <= PROJECT_EXPORT_LIMITS.opacityCompositeMeanErrorMaximum &&
			maximum <= PROJECT_EXPORT_LIMITS.opacityCompositeMaximumError,
	};
}
export function acceptsProjectPixels(metrics, active) {
	return (
		metrics.meanRgbError <= PROJECT_EXPORT_LIMITS.meanRgbError &&
		(active
			? metrics.activePixels >= PROJECT_EXPORT_LIMITS.minimumActivePixels &&
				metrics.activeMeanRgbError <=
					PROJECT_EXPORT_LIMITS.activeMeanRgbError &&
				metrics.activeLumaRatio !== null &&
				metrics.activeLumaRatio >=
					PROJECT_EXPORT_LIMITS.activeLumaRatioMinimum &&
				metrics.activeLumaRatio <= PROJECT_EXPORT_LIMITS.activeLumaRatioMaximum
			: metrics.activePixels === 0 &&
				metrics.actualMeanRgb <= PROJECT_EXPORT_LIMITS.blankMeanRgbMaximum)
	);
}
