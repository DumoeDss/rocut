import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
	const p = a + b - c,
		pa = Math.abs(p - a),
		pb = Math.abs(p - b),
		pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG straight-alpha decode only; this is not a browser 2D canonicalization claim. */
export function decodeBlazeEditorSourcePng(png) {
	assert(Buffer.isBuffer(png));
	assert.deepEqual(
		png.subarray(0, 8),
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	);
	let cursor = 8,
		width,
		height,
		ended = false;
	const compressed = [];
	while (cursor < png.length) {
		assert(cursor + 12 <= png.length);
		const length = png.readUInt32BE(cursor),
			type = png.subarray(cursor + 4, cursor + 8).toString("ascii"),
			end = cursor + 12 + length;
		assert(end <= png.length);
		const data = png.subarray(cursor + 8, end - 4);
		assert.equal(
			crc32(png.subarray(cursor + 4, end - 4)),
			png.readUInt32BE(end - 4),
		);
		if (type === "IHDR") {
			assert.equal(cursor, 8);
			assert.equal(length, 13);
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			assert.equal(width, 192);
			assert.equal(height, 128);
			assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0]);
		} else if (type === "IDAT") compressed.push(data);
		else if (type === "IEND") {
			assert.equal(length, 0);
			assert.equal(end, png.length);
			ended = true;
		} else throw Error(`Unexpected source PNG chunk: ${type}`);
		cursor = end;
	}
	assert(ended && width && height && compressed.length);
	const stride = width * 4,
		raw = inflateSync(Buffer.concat(compressed), {
			maxOutputLength: height * (stride + 1),
		}),
		pixels = new Uint8ClampedArray(width * height * 4);
	assert.equal(raw.length, height * (stride + 1));
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		assert(filter <= 4);
		for (let x = 0; x < stride; x++) {
			const index = y * stride + x,
				left = x >= 4 ? pixels[index - 4] : 0,
				up = y ? pixels[index - stride] : 0,
				corner = y && x >= 4 ? pixels[index - stride - 4] : 0;
			const prediction = [
				0,
				left,
				up,
				Math.floor((left + up) / 2),
				paeth(left, up, corner),
			][filter];
			pixels[index] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
		}
	}
	return { width, height, pixels };
}

/** CPU sensitivity probe, not a substitute for the runtime independent image decode. */
export function modelBlazeEditorPremultiplication(pixels) {
	const output = new Uint8ClampedArray(pixels.length);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		const alpha = pixels[offset + 3];
		output[offset + 3] = alpha;
		if (alpha)
			for (let channel = 0; channel < 3; channel++)
				output[offset + channel] = Math.round(
					(Math.round((pixels[offset + channel] * alpha) / 255) * 255) / alpha,
				);
	}
	return output;
}
