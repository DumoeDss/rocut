/** Measure without shifting decoded samples to match the independent oracle. */
export function durationEditorAudioMeasurements(decoded, expected, mixedPcm) {
	const channels = [];
	for (let channel = 0; channel < 2; channel++) {
		const sections = [
			[0, 5292],
			[5292, 7056],
			[7056, 29988],
			[29988, 31752],
			[31752, 37044],
		];
		const sectionRms = sections.map(([start, end]) => {
			let square = 0;
			for (let i = start; i < end; i++)
				square +=
					(decoded.readFloatLE(i * 8 + channel * 4) -
						expected.readFloatLE(i * 8 + channel * 4)) **
					2;
			return Math.sqrt(square / (end - start));
		});
		let bestLag = 0,
			bestCorrelation = -1,
			mixedMaximum = 0,
			earlySilencePeak = 0,
			lateSilencePeak = 0;
		for (let lag = -64; lag <= 64; lag++) {
			let cross = 0,
				energyActual = 0,
				energyExpected = 0;
			for (let i = 5600; i < 31000; i++) {
				const x = expected.readFloatLE(i * 8 + channel * 4),
					y = decoded.readFloatLE((i + lag) * 8 + channel * 4);
				cross += x * y;
				energyActual += y * y;
				energyExpected += x * x;
			}
			const correlation = cross / Math.sqrt(energyActual * energyExpected);
			if (correlation > bestCorrelation) {
				bestCorrelation = correlation;
				bestLag = lag;
			}
		}
		for (let i = 0; i < decoded.length / 8; i++) {
			const value = Math.abs(decoded.readFloatLE(i * 8 + channel * 4));
			if (i < 4700) earlySilencePeak = Math.max(earlySilencePeak, value);
			if (i >= 32634) lateSilencePeak = Math.max(lateSilencePeak, value);
			if (i < 37044)
				mixedMaximum = Math.max(
					mixedMaximum,
					Math.abs(
						mixedPcm.readFloatLE(i * 8 + channel * 4) -
							expected.readFloatLE(i * 8 + channel * 4),
					),
				);
		}
		channels.push({
			sectionRms,
			bestLagSamples: bestLag,
			bestCorrelation,
			mixedMaximum,
			earlySilencePeak,
			lateSilencePeak,
		});
	}
	return channels;
}
