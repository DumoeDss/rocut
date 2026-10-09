import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./probe-droplets-evidence.mjs";

export async function saveDropletsJson(directory, name, value) {
	const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
	await writeFile(join(directory, name), bytes, { flag: "wx" });
	return { filename: name, bytes: bytes.length, sha256: sha256(bytes) };
}

export function decodeFrame(value, expectedBytes) {
	assert(
		typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
		"Invalid RGBA base64",
	);
	assert(
		value.length <= Math.ceil(expectedBytes / 3) * 4,
		"RGBA base64 exceeds expected size",
	);
	const bytes = Buffer.from(value, "base64");
	assert.equal(bytes.length, expectedBytes, "RGBA byte length mismatch");
	assert.equal(bytes.toString("base64"), value, "Non-canonical RGBA base64");
	return bytes;
}

/** Save raw raster frames, not a codec artifact or an export verdict. */
export async function saveDropletsFrames(directory, value) {
	assert(value && typeof value === "object", "Invalid raw frames object");
	assert(
		Number.isInteger(value.width) && value.width > 0 && value.width <= 4096,
		"Invalid frame width",
	);
	assert(
		Number.isInteger(value.height) && value.height > 0 && value.height <= 4096,
		"Invalid frame height",
	);
	assert(
		Array.isArray(value.frames) && value.frames.length === 6,
		"Expected six raw frames",
	);
	assert(
		Array.isArray(value.ticks) && value.ticks.length === 6,
		"Expected six declared ticks",
	);
	assert(
		Number.isInteger(value.rate?.numerator) &&
			value.rate.numerator > 0 &&
			Number.isInteger(value.rate?.denominator) &&
			value.rate.denominator > 0,
		"Invalid frame rate",
	);
	const expectedBytes = value.width * value.height * 4;
	const source = decodeFrame(value.source, expectedBytes);
	const decoded = value.frames.map((frame, index) => {
		assert(Number.isSafeInteger(frame.ticks), "Invalid frame tick");
		assert.equal(
			frame.ticks,
			value.ticks[index],
			"Frame tick differs from declaration",
		);
		return {
			ticks: frame.ticks,
			pixels: decodeFrame(frame.rgba, expectedBytes),
		};
	});
	assert(new Set(value.ticks).size === 6, "Duplicate raw frame times");
	await writeFile(join(directory, "source.rgba"), source, { flag: "wx" });
	const frames = [];
	for (const [index, frame] of decoded.entries()) {
		const filename = `frame-${String(index).padStart(2, "0")}.rgba`;
		await writeFile(join(directory, filename), frame.pixels, { flag: "wx" });
		frames.push({
			filename,
			ticks: frame.ticks,
			bytes: frame.pixels.length,
			sha256: sha256(frame.pixels),
		});
	}
	const metadata = {
		kind: "raw-rgba-raster-frames",
		codecVerified: false,
		width: value.width,
		height: value.height,
		rate: value.rate,
		params: value.params,
		source: {
			filename: "source.rgba",
			bytes: source.length,
			sha256: sha256(source),
		},
		frames,
	};
	return {
		...metadata,
		manifest: await saveDropletsJson(directory, "raw-frames.json", metadata),
	};
}
