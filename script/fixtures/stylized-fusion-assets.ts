import { deflateSync } from "node:zlib";

// Deterministic test pixels and PCM generated locally.
function chunk(kind: string, bytes: Buffer) {
	const name = Buffer.from(kind),
		data = Buffer.concat([name, bytes]);
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const head = Buffer.alloc(4),
		tail = Buffer.alloc(4);
	head.writeUInt32BE(bytes.length);
	tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([head, data, tail]);
}
export function fusionImage(variant: "red" | "blue" | "logo") {
	const width = 640,
		height = 360,
		rows = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const p = y * (1 + width * 4) + 1 + x * 4;
			let rgba: number[];
			if (variant === "logo") {
				const d = Math.hypot(x - 320, y - 150);
				rgba =
					d < 95 && d > 42 ? [30, 220, 210, x < 320 ? 255 : 160] : [0, 0, 0, 0];
			} else {
				const inside = x > 90 && x < 550 && y > 40 && y < 255;
				const stripe = (x + y * 2) % 90 < 10;
				rgba = inside
					? variant === "red"
						? [235, stripe ? 190 : 70, 40, 255]
						: [35, stripe ? 210 : 95, 235, 255]
					: [16, 32, 48, 255];
			}
			for (let c = 0; c < 4; c++) rows[p + c] = rgba[c];
		}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
export function fusionAudio() {
	const rate = 48000,
		seconds = 10,
		channels = 2,
		frames = rate * seconds;
	const result = Buffer.alloc(44 + frames * channels * 2);
	result.write("RIFF", 0);
	result.writeUInt32LE(result.length - 8, 4);
	result.write("WAVEfmt ", 8);
	result.writeUInt32LE(16, 16);
	result.writeUInt16LE(1, 20);
	result.writeUInt16LE(channels, 22);
	result.writeUInt32LE(rate, 24);
	result.writeUInt32LE(rate * channels * 2, 28);
	result.writeUInt16LE(channels * 2, 32);
	result.writeUInt16LE(16, 34);
	result.write("data", 36);
	result.writeUInt32LE(result.length - 44, 40);
	for (let i = 0; i < frames; i++) {
		const t = i / rate,
			segment = Math.floor(t / 2),
			frequency = 220 + 110 * segment;
		const envelope = Math.min(1, (t % 2) * 25, (2 - (t % 2)) * 25);
		for (let channel = 0; channel < channels; channel++) {
			const value =
				Math.sin(2 * Math.PI * (frequency + channel * 55) * t) * 0.2 * envelope;
			result.writeInt16LE(
				Math.round(value * 32767),
				44 + (i * channels + channel) * 2,
			);
		}
	}
	return result;
}
