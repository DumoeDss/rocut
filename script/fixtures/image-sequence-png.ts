import { deflateSync } from "node:zlib";

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++)
			value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}

function chunk({ type, body }: { type: string; body: Uint8Array }): Buffer {
	const bytes = Buffer.alloc(body.byteLength + 12);
	bytes.writeUInt32BE(body.byteLength, 0);
	bytes.write(type, 4, 4, "ascii");
	bytes.set(body, 8);
	bytes.writeUInt32BE(
		crc32(bytes.subarray(4, 8 + body.byteLength)),
		8 + body.byteLength,
	);
	return bytes;
}

/** Negative controls can declare a larger header without allocating larger pixels. */
export function imageSequencePngWithHeader({
	ordinal = 0,
	width,
	height,
}: {
	ordinal?: number;
	width: number;
	height: number;
}): Uint8Array<ArrayBuffer> {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6; // 8-bit RGBA; no interlace, standard compression and filtering.
	const scanline = new Uint8Array([
		0,
		ordinal & 255,
		(ordinal >>> 8) & 255,
		7,
		255,
		13,
		23,
		(ordinal >>> 16) & 255,
		128,
	]);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk({ type: "IHDR", body: header }),
		chunk({ type: "IDAT", body: deflateSync(scanline) }),
		chunk({ type: "IEND", body: new Uint8Array() }),
	]);
}

/** Real, tiny 2×1 RGBA PNG. Every tested ordinal has distinct encoded pixels. */
export function imageSequencePng(ordinal: number): Uint8Array<ArrayBuffer> {
	return imageSequencePngWithHeader({ ordinal, width: 2, height: 1 });
}
