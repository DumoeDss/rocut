import assert from "node:assert/strict";
import { thresholds as frameThresholds } from "./flame-wrap-export-metrics.mjs";

// Independent of encoded output: reuse the original visible-change and region
// thresholds. Two accepted frames allow twice the original active RGB error.
export const temporalThresholds = Object.freeze({
	minimumPixels: frameThresholds.activePixels,
	visibleDelta: frameThresholds.activeDelta,
	minimumSignedChange: frameThresholds.activeDelta / 2,
	maximumDeltaError: frameThresholds.activeRgb * 2,
});

function validateRgb(bytes, expectedLength) {
	assert(bytes instanceof Uint8Array, "RGB input must be a byte view");
	assert.equal(bytes.length, expectedLength, "RGB frame length mismatch");
}

/** The reference pair must be chosen before examining encoded output. */
export function measureTemporalChange({
	actualFirst,
	actualLast,
	expectedFirst,
	expectedLast,
	width,
	height,
}) {
	assert(Number.isSafeInteger(width) && width > 0);
	assert(Number.isSafeInteger(height) && height > 0);
	assert(width * height <= 1_000_000, "Fixture frame exceeds pixel budget");
	const length = width * height * 3;
	for (const input of [
		actualFirst,
		actualLast,
		expectedFirst,
		expectedLast,
	]) {
		validateRgb(input, length);
	}
	let pixels = 0;
	let channels = 0;
	let signedChange = 0;
	let expectedChange = 0;
	let error = 0;
	for (let pixel = 0; pixel < length; pixel += 3) {
		let eligible = false;
		for (let channel = 0; channel < 3; channel++) {
			const index = pixel + channel;
			const delta = expectedLast[index] - expectedFirst[index];
			if (Math.abs(delta) <= temporalThresholds.visibleDelta) continue;
			eligible = true;
			channels++;
			const actualDelta = actualLast[index] - actualFirst[index];
			signedChange += Math.sign(delta) * actualDelta;
			expectedChange += Math.abs(delta);
			error += Math.abs(actualDelta - delta);
		}
		if (eligible) pixels++;
	}
	const result = {
		pixels,
		channels,
		expectedChangeMean: channels ? expectedChange / channels : null,
		signedChangeMean: channels ? signedChange / channels : null,
		deltaErrorMean: channels ? error / channels : null,
	};
	return {
		...result,
		identifiable: pixels >= temporalThresholds.minimumPixels,
		accepted:
			pixels >= temporalThresholds.minimumPixels &&
			result.signedChangeMean >= temporalThresholds.minimumSignedChange &&
			result.deltaErrorMean <= temporalThresholds.maximumDeltaError,
	};
}
