export const blazeRawThresholds = Object.freeze({
	premultipliedRgbMean: 0.5,
	premultipliedRgbMaximum: 4,
	alphaMean: 0.35,
	alphaMaximum: 3,
	straightRgbAlphaMinimum: 16,
	straightRgbMean: 1.5,
	straightRgbMaximum: 8,
	activeDifference: 8,
	minimumBroadActivePixels: 64,
	minimumSparkActivePixels: 8,
	identity: 0,
});

export function blazeEqual(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Full-frame RAW RGBA8 comparison; no crop, masked-out holes, or RGB rounding. */
export function compareBlazeRaw(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
) {
	if (!actual.length || actual.length !== expected.length || actual.length % 4)
		throw Error("Invalid Blaze RAW lengths");
	let premultipliedSum = 0,
		premultipliedMaximum = 0,
		alphaSum = 0,
		alphaMaximum = 0,
		straightSum = 0,
		straightMaximum = 0,
		straightChannels = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const actualAlpha = actual[offset + 3],
			expectedAlpha = expected[offset + 3];
		const alpha = Math.abs(actualAlpha - expectedAlpha);
		alphaSum += alpha;
		alphaMaximum = Math.max(alphaMaximum, alpha);
		for (let channel = 0; channel < 3; channel++) {
			const delta =
				Math.abs(
					actual[offset + channel] * actualAlpha -
						expected[offset + channel] * expectedAlpha,
				) / 255;
			premultipliedSum += delta;
			premultipliedMaximum = Math.max(premultipliedMaximum, delta);
			if (
				Math.min(actualAlpha, expectedAlpha) >=
				blazeRawThresholds.straightRgbAlphaMinimum
			) {
				const straight = Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
				straightSum += straight;
				straightMaximum = Math.max(straightMaximum, straight);
				straightChannels++;
			}
		}
	}
	const premultipliedMean = premultipliedSum / ((actual.length / 4) * 3),
		alphaMean = alphaSum / (actual.length / 4),
		straightMean = straightChannels ? straightSum / straightChannels : 0;
	return {
		premultipliedMean,
		premultipliedMaximum,
		alphaMean,
		alphaMaximum,
		straightMean,
		straightMaximum,
		straightChannels,
		pass:
			premultipliedMean <= blazeRawThresholds.premultipliedRgbMean &&
			premultipliedMaximum <= blazeRawThresholds.premultipliedRgbMaximum &&
			alphaMean <= blazeRawThresholds.alphaMean &&
			alphaMaximum <= blazeRawThresholds.alphaMaximum &&
			straightMean <= blazeRawThresholds.straightRgbMean &&
			straightMaximum <= blazeRawThresholds.straightRgbMaximum,
	};
}

/** Activity is selected from oracle versus original input, never production output. */
export function blazeActivePixels(
	expected: Uint8ClampedArray,
	source: Uint8ClampedArray,
) {
	if (
		!expected.length ||
		expected.length !== source.length ||
		expected.length % 4
	)
		throw Error("Invalid Blaze activity lengths");
	let active = 0;
	for (let offset = 0; offset < expected.length; offset += 4) {
		let delta = Math.abs(expected[offset + 3] - source[offset + 3]);
		for (let channel = 0; channel < 3; channel++)
			delta = Math.max(
				delta,
				Math.abs(
					expected[offset + channel] * expected[offset + 3] -
						source[offset + channel] * source[offset + 3],
				) / 255,
			);
		active += Number(delta >= blazeRawThresholds.activeDifference);
	}
	return active;
}
