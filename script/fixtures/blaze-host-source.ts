import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { blazeSource } from "./blaze-cases";
import {
	blazeHostAnimated,
	blazeHostId,
	blazeHostParams,
	blazeHostSettings,
	type BlazeHostResource,
	type BlazeHostShot,
} from "./blaze-host-contract";

export const blazeHostDigest = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");

function chunk(kind: string, bytes: Buffer) {
	const data = Buffer.concat([Buffer.from(kind), bytes]);
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

export function blazeHostImage() {
	const { width, height } = blazeHostSettings;
	const pixels = blazeSource({ width, height });
	const rows = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++)
		rows.set(
			pixels.subarray(y * width * 4, (y + 1) * width * 4),
			y * (1 + width * 4) + 1,
		);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

export async function loadBlazeHostAuthor(modulePath: string) {
	assert.equal(basename(modulePath), "blaze.mjs");
	const files = await Promise.all(
		["blaze.mjs", "spatial.mjs"].map(async (file) => {
			const path = join(dirname(modulePath), file);
			return { path, sha256: blazeHostDigest(await readFile(path)) };
		}),
	);
	const helper = await import(pathToFileURL(modulePath).href);
	assert.equal(typeof helper.blazeImage, "function");
	const author = (
		image: BlazeHostResource,
		animated: boolean,
	): BlazeHostShot => {
		const shot = helper.blazeImage({
			image: structuredClone(image),
			settings: structuredClone(blazeHostSettings),
			params: { ...blazeHostParams },
			keyframes: animated
				? Object.fromEntries(
						Object.entries(blazeHostAnimated).map(([key, values]) => [
							key,
							values.map((value, index) => ({ time: index * 24000, value })),
						]),
					)
				: {},
		}) as BlazeHostShot;
		assert.deepEqual(shot.effects, [
			{
				id: blazeHostId,
				type: "blaze",
				enabled: true,
				params: blazeHostParams,
			},
		]);
		assert.equal(shot.source.seed, blazeHostSettings.seed);
		assert.notEqual(shot.source.seed, shot.effects[0].params.seed);
		assert.deepEqual(shot.source.resources, [image]);
		return shot;
	};
	return { author, files };
}
