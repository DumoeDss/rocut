/** Independent fixed-input oracle. Never derive expected timing/gain from a
 * browser observation, metadata receipt, native mapper, or compiled driver. */
export function pinnedAudioExpected(frame: number) {
	if (frame < 5 || frame >= 13) return [];
	return [
		{
			sourceTime: (9 + (frame - 5) * 2) / 30,
			playbackRate: 2,
			volume: 0.4 + (frame - 5) / 100,
			toneFrequency: 1,
			audioStreamIndex: 0,
		},
	];
}

/** Independent source PCM window energy after the expected gain. This proves
 * nonzero mixable input, not final export decoding or wall-clock playback. */
export function pinnedAudioExpectedRms({
	wav,
	frame,
}: {
	wav: Buffer;
	frame: number;
}) {
	const expected = pinnedAudioExpected(frame)[0];
	if (!expected) return 0;
	const start = Math.round(expected.sourceTime * 48000);
	let sum = 0;
	for (let sample = 0; sample < 1600; sample++) {
		const index = start + sample * 2;
		for (let channel = 0; channel < 2; channel++) {
			const value =
				wav.readFloatLE(44 + (index * 2 + channel) * 4) * expected.volume;
			sum += value * value;
		}
	}
	return Math.sqrt(sum / 3200);
}

/** Expected stereo RMS for the known 0.4/-0.2 sine, after native volume.
 * Speed/time-stretch changes phase, not the amplitude expectation. */
export function pinnedAudioMixedRms(frame: number) {
	return Math.sqrt(0.05) * (pinnedAudioExpected(frame)[0]?.volume ?? 0);
}

export function pinnedAudioPcmFrameRms({
	pcm,
	frameOffset,
}: {
	pcm: Buffer;
	frameOffset: number;
}) {
	let sum = 0;
	for (let sample = 0; sample < 1600; sample++)
		for (let channel = 0; channel < 2; channel++) {
			const value = pcm.readFloatLE(
				((frameOffset * 1600 + sample) * 2 + channel) * 4,
			);
			if (!Number.isFinite(value)) throw Error("Non-finite mixed PCM");
			sum += value * value;
		}
	return Math.sqrt(sum / 3200);
}
