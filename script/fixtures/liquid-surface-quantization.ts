/** Test-only reference for an RGBA8 straight texture presented through an
 * RGBA8 premultiplied canvas, then read as straight ImageData. This cannot
 * replace a raw-texture oracle: premultiplication irreversibly loses RGB bits.
 */
export function liquidSurfaceQuantizedReference(
	raw: Uint8Array | Uint8ClampedArray,
) {
	if (raw.length % 4 !== 0) throw Error("Expected complete RGBA pixels");
	const result = new Uint8ClampedArray(raw.length);
	for (let i = 0; i < raw.length; i += 4) {
		const alpha = raw[i + 3];
		result[i + 3] = alpha;
		if (alpha === 0) continue;
		for (let c = 0; c < 3; c++) {
			const premultiplied = Math.round((raw[i + c] * alpha) / 255);
			result[i + c] = Math.round((premultiplied * 255) / alpha);
		}
	}
	return result;
}
