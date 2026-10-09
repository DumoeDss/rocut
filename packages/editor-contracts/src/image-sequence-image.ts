/** Binary IO envelope only. Rust owns encoded geometry admission and budgets. */
export function encodeImageSequenceImageRequest({
	mimeType,
	width,
	height,
	body,
}: {
	mimeType: string;
	width: number;
	height: number;
	body: ArrayBuffer;
}): Uint8Array {
	const header = new TextEncoder().encode(
		JSON.stringify({ mimeType, width, height }),
	);
	const packed = new Uint8Array(4 + header.byteLength + body.byteLength);
	new DataView(packed.buffer).setUint32(0, header.byteLength, true);
	packed.set(header, 4);
	packed.set(new Uint8Array(body), 4 + header.byteLength);
	return packed;
}
