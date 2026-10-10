import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { bubbleHostAnimated, bubbleHostId, bubbleHostKnots, bubbleHostParams,
	bubbleHostSettings } from "./bubble-host-contract.mjs";

export const bubbleHostDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function chunk(kind, bytes) {
	let crc = 0xffffffff;
	for (const byte of Buffer.concat([Buffer.from(kind), bytes])) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const head = Buffer.alloc(4), tail = Buffer.alloc(4);
	head.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([head, Buffer.from(kind), bytes, tail]);
}
export function bubbleHostImage() {
	const { width, height } = bubbleHostSettings;
	const rows = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = y * (width * 4 + 1) + x * 4 + 1;
		rows.set([x % 256, y % 256, (x ^ y) % 256, (x + y) % 256], offset);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
export async function loadBubbleHostAuthor(modulePath) {
	assert.equal(basename(modulePath), "bubble.mjs");
	const files = await Promise.all(["bubble.mjs", "spatial.mjs"].map(async (name) => {
		const path = join(dirname(modulePath), name);
		return { path, sha256: bubbleHostDigest(await readFile(path)) };
	}));
	const helper = await import(pathToFileURL(modulePath).href);
	assert.equal(typeof helper.bubbleImage, "function");
	const author = (image, mode) => {
		assert(["static", "animated", "sixteen"].includes(mode));
		const shot = helper.bubbleImage({ image, settings: structuredClone(bubbleHostSettings),
			params: { ...bubbleHostParams }, knots: bubbleHostKnots(mode === "sixteen"),
			keyframes: mode === "animated" ? Object.fromEntries(Object.entries(bubbleHostAnimated)
				.map(([key, values]) => [key, values.map((value, index) => ({ time: index * 180000, value }))])) : {},
		});
		assert.equal(shot.effects[0].id, bubbleHostId);
		for (const [key, value] of Object.entries(bubbleHostParams)) assert.equal(shot.effects[0].params[key], value);
		assert.deepEqual(shot.source.resources, [image]);
		assert.equal(shot.effects[0].params.point0Time, 0);
		assert.equal(shot.effects[0].params.pointCount, mode === "sixteen" ? 16 : 2);
		if (mode === "animated") for (const channel of Object.values(shot.animations))
			assert.deepEqual(channel.keys.map((key) => key.time), [0, 180000]);
		return shot;
	};
	return { author, files };
}
