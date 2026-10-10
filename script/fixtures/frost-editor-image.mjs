import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

export function imageBytes(width, height) {
	const rows = Buffer.alloc(height * (width * 4 + 1));
	let cutout = 0,
		hole = 0,
		opaque = 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const body =
				((x - width * 0.5) / (width * 0.39)) ** 2 +
					((y - height * 0.53) / (height * 0.4)) ** 2 <
				1;
			const opening =
				((x - width * 0.48) / (width * 0.12)) ** 2 +
					((y - height * 0.5) / (height * 0.14)) ** 2 <
				1;
			const alpha = body && !opening ? 255 : 0;
			rows.set(
				[220, 95 + (x % 90), 40 + (y % 90), alpha],
				y * (width * 4 + 1) + x * 4 + 1,
			);
			if (alpha) opaque++;
			else if (opening) hole++;
			else cutout++;
		}
	assert(cutout > 0 && hole > 0 && opaque > 0);
	function chunk(type, bytes) {
		let crc = 0xffffffff;
		for (const byte of Buffer.concat([Buffer.from(type), bytes])) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++)
				crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		const head = Buffer.alloc(4),
			tail = Buffer.alloc(4);
		head.writeUInt32BE(bytes.length);
		tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
		return Buffer.concat([head, Buffer.from(type), bytes, tail]);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return {
		bytes: Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk("IHDR", header),
			chunk("IDAT", deflateSync(rows)),
			chunk("IEND", Buffer.alloc(0)),
		]),
		alphaFixture: {
			width,
			height,
			opaque,
			hole,
			cutout,
			shape: "elliptical nonrectangular cutout with interior elliptical hole",
		},
	};
}
