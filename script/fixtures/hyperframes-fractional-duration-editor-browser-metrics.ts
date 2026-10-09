export function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw Error(message);
}

/** Byte geometry plus numerical error against the independent native oracle. */
export function compare(buffer: AudioBuffer, expected: DataView) {
	check(
		buffer.length * 8 === expected.byteLength,
		"Independent PCM and production lengths differ",
	);
	const pcm = new Float32Array(buffer.length * 2);
	let maximum = 0,
		square = 0;
	for (let i = 0; i < buffer.length; i++)
		for (let c = 0; c < 2; c++) {
			const value = buffer.getChannelData(c)[i],
				delta = value - expected.getFloat32(i * 8 + c * 4, true);
			pcm[i * 2 + c] = value;
			maximum = Math.max(maximum, Math.abs(delta));
			square += delta * delta;
		}
	return { pcm, maximum, rms: Math.sqrt(square / (buffer.length * 2)) };
}
