/** Lossless container only: no timing rounding, padding, resampling or mixing. */
export function hyperframesFloatWav(pcm: Buffer, frames: number, maxBytes: number): Buffer {
	if (!Number.isSafeInteger(frames) || frames < 1 || pcm.length !== frames * 8 ||
		!Number.isSafeInteger(maxBytes) || pcm.length + 44 > maxBytes || pcm.length > 0xffffffff - 36)
		throw Error("Native loop PCM disagrees with Rust WAV geometry");
	for (let byte = 0; byte < pcm.length; byte += 4)
		if (!Number.isFinite(pcm.readFloatLE(byte))) throw Error("Nonfinite native loop source PCM");
	const header = Buffer.alloc(44);
	header.write("RIFF", 0); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22);
	header.writeUInt32LE(48000, 24); header.writeUInt32LE(48000 * 8, 28);
	header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34);
	header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}
