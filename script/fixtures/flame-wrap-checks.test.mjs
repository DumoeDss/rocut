import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Offline acceptance checks over retained presentation bytes. These do not
// reproduce procedural fire, noise, ray searches or native phase arithmetic.
const receiptPath =
	process.env.FLAME_WRAP_GPU_RECEIPT ??
	"docs/evidence/flame-wrap-live-gpu.json";
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const artifactRoot = receipt.artifacts.replaceAll("\\", "/");
const frameBytes = readFileSync(`${artifactRoot}/frames.json`);
const report = JSON.parse(frameBytes);
const frame = (id) => {
	const result = report.frames.find((entry) => entry.id === id);
	assert.ok(result, `Missing frame ${id}`);
	return result;
};
const bytes = (entry) => Buffer.from(entry.actualBase64, "base64");
const source = (entry) => Buffer.from(entry.sourceBase64, "base64");
const digest = (value) => createHash("sha256").update(value).digest("hex");
function visibleRgbChanges(actual, baseline) {
	let changed = 0;
	for (let offset = 0; offset < actual.length; offset += 4)
		if (actual[offset + 3] > 16 && baseline[offset + 3] > 16)
			for (let channel = 0; channel < 3; channel++)
				changed += Number(
					Math.abs(actual[offset + channel] - baseline[offset + channel]) > 1,
				);
	return changed;
}
function changesWithPhase(images) {
	return new Set(images.map(digest)).size > 1;
}
function leakedBeyondDisplacement(entry, actual) {
	const baseline = source(entry);
	// Maximum displacement 2 px, plus one bilinear footprint pixel. This is
	// only a conservative support invariant, not a displacement pixel oracle.
	let leaked = 0;
	for (let y = 0; y < entry.height; y++)
		for (let x = 0; x < entry.width; x++) {
			if (!actual[(y * entry.width + x) * 4 + 3]) continue;
			let reachable = false;
			for (let dy = -3; dy <= 3; dy++)
				for (let dx = -3; dx <= 3; dx++) {
					const sx = x + dx,
						sy = y + dy;
					if (sx >= 0 && sy >= 0 && sx < entry.width && sy < entry.height)
						reachable ||= baseline[(sy * entry.width + sx) * 4 + 3] > 0;
				}
			leaked += Number(!reachable);
		}
	return leaked;
}

test("retained GPU frame bytes are bound to the receipt and its old frozen binary", () => {
	assert.equal(digest(frameBytes), receipt.rawReceiptSha256);
	assert.equal(report.frames.length, 29);
	assert.equal(receipt.loadedWasm[0].sha256, report.loadedWasm.sha256);
	for (const entry of report.frames) {
		assert.equal(bytes(entry).length, entry.width * entry.height * 4);
		assert.equal(source(entry).length, entry.width * entry.height * 4);
		assert.equal(entry.captureScope, "compositor-presentation-canvas");
		assert.equal(entry.nativeCaptured, false);
	}
});

test("retained refraction changes visible texture and rejects the no-op mutant", () => {
	const entry = frame("hole-refraction");
	assert.ok(visibleRgbChanges(bytes(entry), source(entry)) > 0);
	assert.equal(visibleRgbChanges(source(entry), source(entry)), 0);
});

test("reverse seek includes a distinct late phase and rejects a time-frozen mutant", () => {
	const early = bytes(frame("hole-flame"));
	const late = bytes(frame("hole-flame-seek-late"));
	assert.ok(changesWithPhase([early, late]));
	assert.deepEqual(bytes(frame("hole-flame-seek-back")), early);
	assert.equal(changesWithPhase([early, early]), false);
});

test("retained sparks vary across phases and reject a static sparkle stamp", () => {
	const images = report.frames
		.filter((entry) => entry.id.startsWith("hole-sparks-"))
		.map(bytes);
	assert.equal(images.length, 8);
	assert.ok(changesWithPhase(images));
	assert.equal(changesWithPhase(images.map(() => images[0])), false);
});

test("refraction obeys displacement support and rejects a distant alpha speck", () => {
	const entry = frame("hole-refraction");
	assert.equal(entry.dto.params.refraction, 2);
	assert.equal(leakedBeyondDisplacement(entry, bytes(entry)), 0);
	const poisoned = Buffer.from(bytes(entry));
	poisoned[3] = 255;
	assert.equal(leakedBeyondDisplacement(entry, poisoned), 1);
});
