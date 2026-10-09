import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeFrame, saveDropletsJson } from "./probe-droplets-artifacts.mjs";
import { sha256 } from "./probe-droplets-evidence.mjs";

export const dropletsCodecThresholds = Object.freeze({
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportMinimumActivePixels: 64,
	exportTimestampSeconds: 0.0011,
});
export function validateDropletsMedia(value) {
	assert(value && typeof value === "object", "Missing pipeline media metadata");
	for (const dimension of [value.width, value.height])
		assert(
			Number.isInteger(dimension) && dimension > 0 && dimension <= 4096,
			"Invalid media dimensions",
		);
	assert.equal(value.frames, 6, "Expected six encoded frames");
	assert.equal(value.fps, 30, "Expected 30 fps");
	assert.equal(value.codec, "vp9", "Expected VP9");
	assert(
		typeof value.mimeType === "string" &&
			value.mimeType.startsWith("video/webm"),
		"Expected WebM media type",
	);
	assert(
		typeof value.reference === "string" && value.reference.length > 0,
		"Missing reference provenance",
	);
	for (const [key, expected] of Object.entries(dropletsCodecThresholds))
		assert.equal(
			value.thresholds?.[key],
			expected,
			`Threshold changed: ${key}`,
		);
	for (const ticks of [value.timelineTicks, value.localTicks]) {
		assert(
			Array.isArray(ticks) && ticks.length === value.frames,
			"Wrong tick count",
		);
		assert(ticks.every(Number.isSafeInteger), "Invalid frame ticks");
		for (let index = 1; index < ticks.length; index++)
			assert.equal(
				ticks[index] - ticks[index - 1],
				120000 / value.fps,
				"Frame ticks not in codec order",
			);
	}
	const offset = value.timelineTicks[0] - value.localTicks[0];
	assert(
		value.timelineTicks.every(
			(tick, i) => tick - value.localTicks[i] === offset,
		),
		"Clip-local offset changed",
	);
	assert(
		Array.isArray(value.paramsPerFrame) &&
			value.paramsPerFrame.length === value.frames,
		"Wrong parameter frame count",
	);
	for (const params of value.paramsPerFrame)
		assert(
			params &&
				typeof params === "object" &&
				Object.keys(params).length > 0 &&
				Object.values(params).every(Number.isFinite),
			"Invalid per-frame parameters",
		);
	return value;
}

export async function saveDropletsPipeline(directory, value) {
	validateDropletsMedia(value);
	const stride = value.width * value.height * 4;
	const expected = decodeFrame(value.expected, stride * value.frames);
	const baseline = decodeFrame(value.baseline, stride);
	for (const pixels of [expected, baseline])
		for (let offset = 3; offset < pixels.length; offset += 4)
			assert.equal(
				pixels[offset],
				255,
				"Codec references must already be composited on opaque background",
			);
	assert(
		typeof value.video === "string" && value.video.length < 128 * 1024 * 1024,
		"Invalid encoded video size",
	);
	const video = Buffer.from(value.video, "base64");
	assert(
		video.length > 0 && video.toString("base64") === value.video,
		"Invalid encoded video base64",
	);
	const mediaFiles = {};
	for (const [kind, name, bytes] of [
		["video", "production.webm", video],
		["expected", "expected.rgba", expected],
		["baseline", "baseline.rgba", baseline],
	]) {
		await writeFile(join(directory, name), bytes, { flag: "wx" });
		mediaFiles[kind] = {
			filename: name,
			bytes: bytes.length,
			sha256: sha256(bytes),
		};
	}
	const declaration = Object.fromEntries(
		Object.entries(value).filter(
			([key]) => !["video", "expected", "baseline"].includes(key),
		),
	);
	const metadata = {
		...declaration,
		kind: "production-vp9-webm",
		independentDecodeVerified: false,
		files: mediaFiles,
	};
	return {
		...metadata,
		manifest: await saveDropletsJson(directory, "media.json", metadata),
	};
}
