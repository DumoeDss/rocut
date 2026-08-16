/**
 * The producer's pixel bridge: canvas RGBA (row-major, 4 bytes/pixel, no
 * padding) → the manager's RGB24 frame-stream shape (3 bytes/pixel, same
 * order). Extracted from the entry so the stride/channel math is unit-asserted
 * on a crafted buffer — synthetic frame fixtures cannot catch a stride bug
 * (any deterministic gradient satisfies a wrong-but-uniform drop), so the
 * proof lives here instead (review B-1's follow-up).
 */
export function rgbaToRgb24(args: {
	data: Uint8ClampedArray | Uint8Array;
	pixels: number;
}): Uint8Array {
	const out = new Uint8Array(args.pixels * 3);
	for (let p = 0, s = 0, d = 0; p < args.pixels; p += 1, s += 4, d += 3) {
		out[d] = args.data[s];
		out[d + 1] = args.data[s + 1];
		out[d + 2] = args.data[s + 2];
	}
	return out;
}
