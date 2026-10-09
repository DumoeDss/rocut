import { expect, test } from "bun:test";
import { encodeImageSequenceImageRequest } from "../image-sequence-image";

test("binary image admission envelope preserves encoded bytes after the little-endian UTF-8 header", () => {
	const bytes = new Uint8Array([0, 255, 137, 80, 78, 71, 0, 128]);
	const packed = encodeImageSequenceImageRequest({
		mimeType: "image/png",
		width: 2,
		height: 1,
		body: bytes.buffer,
	});
	const length = new DataView(packed.buffer).getUint32(0, true);
	const header = new TextDecoder("utf-8", { fatal: true }).decode(
		packed.subarray(4, 4 + length),
	);
	expect(JSON.parse(header)).toEqual({
		mimeType: "image/png",
		width: 2,
		height: 1,
	});
	expect(packed.length).toBe(
		4 + new TextEncoder().encode(header).length + bytes.length,
	);
	expect(packed.subarray(4 + length)).toEqual(bytes);
	packed[packed.length - 1] = 5;
	expect(bytes[bytes.length - 1]).toBe(128);
});
