import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
	const header = Buffer.from(type, "ascii"),
		length = Buffer.alloc(4),
		checksum = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length);
	checksum.writeUInt32BE(crc32(Buffer.concat([header, bytes])));
	return Buffer.concat([length, header, bytes, checksum]);
}

/** Lossless PNG packaging of already-captured RGBA bytes; no filtering or color conversion. */
export function blazePipelinePng(bytes, width, height) {
	assert(
		Number.isSafeInteger(width) &&
			width > 0 &&
			Number.isSafeInteger(height) &&
			height > 0,
	);
	assert.equal(bytes.length, width * height * 4);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	const rows = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++)
		Buffer.from(bytes.subarray(y * width * 4, (y + 1) * width * 4)).copy(
			rows,
			y * (width * 4 + 1) + 1,
		);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
