/** Actual native upload helper, not a test bitmap or image URL fallback. Typed
 * views share the one admitted upload buffer; no extra pixel-array copy. */
export async function createHeartNativeUploadBitmap({
	bytes,
	width,
	height,
}: {
	bytes: Uint8Array;
	width: number;
	height: number;
}) {
	if (
		!(bytes.buffer instanceof ArrayBuffer) ||
		!Number.isSafeInteger(width) ||
		width <= 0 ||
		!Number.isSafeInteger(height) ||
		height <= 0 ||
		bytes.byteLength !== width * height * 4
	)
		throw Error("Heart native upload binary shape mismatch");
	const view = new Uint8ClampedArray(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	);
	return createImageBitmap(
		new ImageData(view, width, height, { colorSpace: "srgb" }),
	);
}
