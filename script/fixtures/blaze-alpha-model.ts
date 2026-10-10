import type { AlphaImage } from "./blaze-alpha-cases";

export function alphaObservation(
	pixels: Uint8ClampedArray,
	count = 1,
	floor = false,
) {
	if (!pixels.length || pixels.length % 4)
		throw Error("Invalid calibration RGBA length");
	const output = new Uint8ClampedArray(pixels);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		const alpha = pixels[offset + 3];
		for (let channel = 0; channel < 3; channel++) {
			let value = pixels[offset + channel];
			for (let index = 0; index < count; index++)
				value = (floor ? Math.floor : Math.round)((value * alpha) / 255);
			output[offset + channel] = alpha ? Math.round((value * 255) / alpha) : 0;
		}
	}
	return output;
}

export function alphaPredictions(image: AlphaImage) {
	const observed = alphaObservation(image.pixels),
		opaque = new Uint8ClampedArray(image.pixels);
	const swapped = new Uint8ClampedArray(observed),
		flipped = new Uint8ClampedArray(observed.length);
	for (let offset = 0; offset < observed.length; offset += 4) {
		opaque[offset + 3] = 255;
		[swapped[offset], swapped[offset + 2]] = [
			swapped[offset + 2],
			swapped[offset],
		];
	}
	for (let y = 0; y < image.height; y++)
		flipped.set(
			observed.subarray(y * image.width * 4, (y + 1) * image.width * 4),
			(image.height - y - 1) * image.width * 4,
		);
	return {
		"single-premultiplication": observed,
		"omitted-premultiplication": new Uint8ClampedArray(image.pixels),
		"double-premultiplication": alphaObservation(image.pixels, 2),
		"forced-opaque": opaque,
		"red-blue-swap": swapped,
		"vertical-row-reversal": flipped,
		"floor-premultiplication": alphaObservation(image.pixels, 1, true),
	};
}

export function alphaMetrics(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
) {
	if (!actual.length || actual.length !== expected.length || actual.length % 4)
		throw Error("Invalid calibration pair");
	let differentBytes = 0,
		alphaDifferences = 0,
		integerPremultipliedDifferences = 0;
	let premultipliedSum = 0,
		premultipliedMaximum = 0,
		alphaMaximum = 0;
	let straightSum = 0,
		straightMaximum = 0,
		visibleChannels = 0;
	const bins = [
		[0, 0],
		[1, 15],
		[16, 31],
		[32, 63],
		[64, 127],
		[128, 255],
	].map(([minimum, maximum]) => ({
		minimum,
		maximum,
		pixels: 0,
		straightSum: 0,
		straightMaximum: 0,
	}));
	for (let offset = 0; offset < actual.length; offset += 4) {
		const aa = actual[offset + 3],
			ea = expected[offset + 3];
		const bin = bins.find((bin) => ea >= bin.minimum && ea <= bin.maximum)!;
		bin.pixels++;
		if (aa !== ea) alphaDifferences++;
		alphaMaximum = Math.max(alphaMaximum, Math.abs(aa - ea));
		for (let channel = 0; channel < 4; channel++) {
			const difference = Math.abs(
				actual[offset + channel] - expected[offset + channel],
			);
			if (difference) differentBytes++;
			if (channel === 3) continue;
			const ap = (actual[offset + channel] * aa) / 255,
				ep = (expected[offset + channel] * ea) / 255;
			if (Math.round(ap) !== Math.round(ep)) integerPremultipliedDifferences++;
			premultipliedSum += Math.abs(ap - ep);
			premultipliedMaximum = Math.max(premultipliedMaximum, Math.abs(ap - ep));
			bin.straightSum += difference;
			bin.straightMaximum = Math.max(bin.straightMaximum, difference);
			if (aa >= 16 && ea >= 16) {
				straightSum += difference;
				straightMaximum = Math.max(straightMaximum, difference);
				visibleChannels++;
			}
		}
	}
	return {
		differentBytes,
		alphaDifferences,
		alphaMaximum,
		integerPremultipliedDifferences,
		premultipliedMean: premultipliedSum / ((actual.length / 4) * 3),
		premultipliedMaximum,
		straightMean: visibleChannels ? straightSum / visibleChannels : 0,
		straightMaximum,
		visibleChannels,
		bins: bins.map((bin) => ({
			...bin,
			straightMean: bin.pixels ? bin.straightSum / (bin.pixels * 3) : 0,
		})),
	};
}
