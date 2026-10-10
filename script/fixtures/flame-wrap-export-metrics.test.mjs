import assert from "node:assert/strict";
import test from "node:test";
import {
	accepts,
	frameIndex,
	metric,
	opaqueRgb,
	shiftRight,
} from "./flame-wrap-export-metrics.mjs";
const width = 16,
	height = 12;
const baseline = Buffer.alloc(width * height * 3, 20);
const early = Buffer.from(baseline),
	late = Buffer.from(baseline);
for (let y = 2; y < 10; y++)
	for (let x = 2; x < 14; x++)
		for (let c = 0; c < 3; c++) {
			early[(y * width + x) * 3 + c] = (x + y) % 2 ? 220 : 60;
			late[(y * width + x) * 3 + c] = (x + y) % 2 ? 60 : 220;
		}
test("bounded codec noise accepted; absent, shifted, and frozen effects rejected", () => {
	assert(
		accepts(
			metric(
				Buffer.from(early).map((v) => v + 2),
				early,
				baseline,
			),
		),
	);
	assert(!accepts(metric(baseline, early, baseline)));
	assert(!accepts(metric(shiftRight(early, width, height), early, baseline)));
	assert(!accepts(metric(early, late, baseline)));
});
test("timestamps map exactly rather than by capture array position", () => {
	assert.equal(frameIndex(80000, 20000), 12);
	assert.throws(() => frameIndex(80001, 20000));
});
test("opaque preview conversion refuses guessed transparency", () => {
	assert.deepEqual(
		opaqueRgb(Buffer.from([1, 2, 3, 255])),
		Buffer.from([1, 2, 3]),
	);
	assert.throws(() => opaqueRgb(Buffer.from([1, 2, 3, 0])));
});
