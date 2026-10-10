import assert from "node:assert/strict";
import { test } from "node:test";
import {
	INK_EXPORT_VIDEO_POLICY,
	INK_EXPORT_VIDEO_FRAME_PAYLOAD_BYTES,
	INK_EXPORT_VIDEO_CONTAINER_BYTES,
	INK_EXPORT_VIDEO_MAX_BYTES,
	validateInkExportVideoSize,
} from "./mv-ink-export-video-policy.mjs";
import {
	INK_EXPORT_VIDEO_MAX_BYTES as browserMaximum,
	validateInkExportVideoSize as browserValidator,
} from "./mv-ink-export-video.ts";
import { validateInkExportSavedStat } from "./mv-ink-export-video-download.mjs";

test("Ink fixed-film transport capacity is derived and identical on browser and host", () => {
	assert(Object.isFrozen(INK_EXPORT_VIDEO_POLICY));
	assert.equal(INK_EXPORT_VIDEO_FRAME_PAYLOAD_BYTES, 1920 * 1080 * 4 * 421);
	assert.equal(
		INK_EXPORT_VIDEO_CONTAINER_BYTES,
		421 * 64 * 1024 + 4 * 1024 * 1024,
	);
	assert.equal(INK_EXPORT_VIDEO_MAX_BYTES, 3_523_727_360);
	assert.equal(browserMaximum, INK_EXPORT_VIDEO_MAX_BYTES);
	assert.equal(browserValidator, validateInkExportVideoSize);
	for (const size of [256 * 1024 * 1024 + 1, INK_EXPORT_VIDEO_MAX_BYTES]) {
		assert.doesNotThrow(() => browserValidator(size));
		assert.doesNotThrow(() =>
			validateInkExportSavedStat({ isFile: () => true, size }),
		);
	}
});
test("Ink browser and host reject invalid lengths and oversized stat before stream allocation", () => {
	for (const size of [
		0,
		3,
		-1,
		1.5,
		NaN,
		Infinity,
		INK_EXPORT_VIDEO_MAX_BYTES + 1,
	]) {
		assert.throws(() => browserValidator(size));
		assert.throws(() =>
			validateInkExportSavedStat({ isFile: () => true, size }),
		);
	}
	assert.throws(() =>
		validateInkExportSavedStat({ isFile: () => false, size: 4 }),
	);
});
