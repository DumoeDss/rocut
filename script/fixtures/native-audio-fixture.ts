/** Synthetic IEEE float WAV. No downloads, microphones, or user media. */
export function nativeAudioWav({ seconds = 2, sampleRate = 48000, channels = 2, sample }: {
	seconds?: number; sampleRate?: number; channels?: number; sample: (frame: number, channel: number) => number;
}): Buffer {
	const frames = Math.round(seconds * sampleRate), body = Buffer.alloc(44 + frames * channels * 4);
	body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVEfmt ", 8);
	body.writeUInt32LE(16, 16); body.writeUInt16LE(3, 20); body.writeUInt16LE(channels, 22);
	body.writeUInt32LE(sampleRate, 24); body.writeUInt32LE(sampleRate * channels * 4, 28);
	body.writeUInt16LE(channels * 4, 32); body.writeUInt16LE(32, 34);
	body.write("data", 36); body.writeUInt32LE(frames * channels * 4, 40);
	for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) body.writeFloatLE(sample(i, c), 44 + (i * channels + c) * 4);
	return body;
}

export const nativeSineWav = (frequency: number) => nativeAudioWav({
	sample: (i, c) => Math.sin(i * frequency * 2 * Math.PI / 48000) * (c ? 0.2 : 0.4),
});

/** Independent waveform measurements, not FFmpeg filter/formula snapshots. */
export function pcmFrequency(pcm: Buffer, sampleRate: number, channel = 0): number {
	const first = 1000, last = pcm.length / 8 - 1000;
	let crossings = 0;
	for (let i = first + 1; i < last; i++) if (pcm.readFloatLE((i - 1) * 8 + channel * 4) <= 0
		&& pcm.readFloatLE(i * 8 + channel * 4) > 0) crossings++;
	return crossings * sampleRate / (last - first);
}
