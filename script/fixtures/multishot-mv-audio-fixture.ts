import { nativeAudioWav } from "./native-audio-fixture";

/** Local synthetic music, never a microphone recording or downloaded media. */
export function multishotAudio() {
	const music = nativeAudioWav({
		seconds: 6,
		sampleRate: 48000,
		sample: (i, c) => {
			const t = i / 48000,
				note = [220, 293.6648, 349.2282][
					Math.min(2, Math.floor((t + 0.1) / 2))
				];
			return (
				(Math.sin(t * note * Math.PI * 2) * 0.22 +
					Math.sin(t * (note * 1.503 + 7) * Math.PI * 2) * 0.055) *
				(c ? -0.65 : 1)
			);
		},
	});
	const ordinary = nativeAudioWav({
		seconds: 4.25,
		sampleRate: 48000,
		sample: (i, c) => {
			const t = i / 48000;
			return (
				(Math.sin(t * 713 * Math.PI * 2) * 0.028 +
					Math.sin(t * 1091 * Math.PI * 2) * 0.009) *
				(c ? 0.7 : 1)
			);
		},
	});
	// Independent authored-clock oracle from the original WAVs. No production
	// gain, collection, scheduling, frame-to-sample or mixer helper is imported.
	const expected = Buffer.alloc(288000 * 8);
	const sourceGain = 10 ** (-6 / 20);
	for (let i = 0; i < 288000; i++)
		for (let c = 0; c < 2; c++) {
			let value = 0;
			if (i >= 9600 && i < 278400)
				value +=
					Math.fround(music.readFloatLE(44 + ((i - 4800) * 2 + c) * 4) * 0.5) *
					sourceGain;
			if (i >= 48000 && i < 240000)
				value += ordinary.readFloatLE(44 + ((i - 42000) * 2 + c) * 4);
			expected.writeFloatLE(value, (i * 2 + c) * 4);
		}
	return { music, ordinary, expected };
}
