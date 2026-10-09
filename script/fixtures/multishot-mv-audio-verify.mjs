import { strict as assert } from "node:assert";

/** Compares independently decoded Opus with original-source WAV arithmetic.
 * No time shift is applied to any error or boundary assertion. */
export function verifyMultishotAudio(decoded, mixed, expected) {
	const samples = 288000;
	assert.equal(expected.length, samples * 8);
	assert.equal(mixed.length, expected.length);
	assert.ok(
		decoded.length >= expected.length &&
			decoded.length <= expected.length + 960 * 8,
		`Export lost source samples or has excess padding: ${decoded.length / 8}`,
	);
	const read = (body, i, c) => body.readFloatLE(i * 8 + c * 4);
	let exactError = 0;
	for (let i = 0; i < samples; i++)
		for (let c = 0; c < 2; c++)
			exactError = Math.max(
				exactError,
				Math.abs(read(mixed, i, c) - read(expected, i, c)),
			);
	assert.ok(
		exactError < 2e-7,
		`Independent source/native/ordinary mix differs: ${exactError}`,
	);
	const sections = [
		[0, 9600],
		[9600, 48000],
		[48000, 96000],
		[96000, 192000],
		[192000, 240000],
		[240000, 278400],
		[278400, samples],
	];
	const channels = [];
	for (let c = 0; c < 2; c++) {
		const sectionRms = sections.map(([start, end]) => {
			let error = 0;
			for (let i = start; i < end; i++)
				error += (read(decoded, i, c) - read(expected, i, c)) ** 2;
			return Math.sqrt(error / (end - start));
		});
		let bestLag = 0,
			bestCorrelation = -1,
			zeroCorrelation = -1;
		for (let lag = -48; lag <= 48; lag++) {
			let cross = 0,
				a = 0,
				b = 0;
			for (let i = 12000; i < 270000; i += 4) {
				const wanted = read(expected, i, c),
					actual = read(decoded, i + lag, c);
				cross += wanted * actual;
				a += actual * actual;
				b += wanted * wanted;
			}
			const correlation = cross / Math.sqrt(a * b);
			if (lag === 0) zeroCorrelation = correlation;
			if (correlation > bestCorrelation) {
				bestCorrelation = correlation;
				bestLag = lag;
			}
		}
		let earlyPeak = 0,
			latePeak = 0,
			wrongShiftSquares = 0,
			wrongCount = 0;
		for (let i = 0; i < decoded.length / 8; i++) {
			const actual = read(decoded, i, c);
			if (i < 7200) earlyPeak = Math.max(earlyPeak, Math.abs(actual));
			if (i >= 280320) latePeak = Math.max(latePeak, Math.abs(actual));
			if (i >= 12000 && i < 270000) {
				wrongShiftSquares += (actual - read(expected, i - 1920, c)) ** 2;
				wrongCount++;
			}
		}
		const oneFrameOffsetRms = Math.sqrt(wrongShiftSquares / wrongCount);
		assert.ok(
			sectionRms.every((value) => value < 0.004),
			`Decoded boundary/interior errors: ${sectionRms}`,
		);
		assert.equal(
			bestLag,
			0,
			`Encoded audio has ${bestLag}-sample clock displacement`,
		);
		assert.ok(
			zeroCorrelation > 0.998,
			`Zero-shift correlation ${zeroCorrelation}`,
		);
		assert.ok(
			earlyPeak < 0.001 && latePeak < 0.001,
			`Non-silent boundaries: ${earlyPeak}/${latePeak}`,
		);
		assert.ok(
			oneFrameOffsetRms > 0.012,
			`One-frame audio error escaped the positive RMS gate: ${oneFrameOffsetRms}`,
		);
		channels.push({
			channel: c,
			sectionRms,
			bestLagSamples: bestLag,
			zeroCorrelation,
			bestCorrelation,
			earlyPeak,
			latePeak,
			oneFrameOffsetRms,
		});
	}
	return {
		exactPcmMaxError: exactError,
		sourceSamples: samples,
		decodedSamples: decoded.length / 8,
		codecPaddingSamples: decoded.length / 8 - samples,
		sections,
		channels,
	};
}
