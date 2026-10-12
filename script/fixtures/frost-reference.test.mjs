import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cellRandom, capsuleAt, strengthAt, frameTicks, samplePremultiplied } from "./frost-reference-math.mjs";
import { CASES, FRAME_RATE, createReferenceFixture, referenceRgba, sourceRgba } from "./frost-reference-fixture.mjs";

test("reference frame floor uses integer rational ticks and preserves negative handles", () => {
	assert.equal(frameTicks(15999, FRAME_RATE), 12000);
	assert.equal(frameTicks(16000, FRAME_RATE), 16000);
	assert.equal(frameTicks(-1, FRAME_RATE), -1);
	assert.equal(frameTicks(4004, { numerator: 30000, denominator: 1001 }), 4004);
	assert.equal(frameTicks(4003, { numerator: 30000, denominator: 1001 }), 0);
	assert.throws(() => frameTicks(0.1, FRAME_RATE), /integer/);
	assert.throws(() => frameTicks(0, { numerator: 0, denominator: 1 }), /Positive/);
});
test("reference refuses native-rejected frame grids before negative bypass", () => {
	for (const rate of [
		{ numerator: 31, denominator: 1 },
		{ numerator: 30, denominator: 1002 },
		{ numerator: 120001, denominator: 1 },
	]) for (const ticks of [0, -1])
		assert.throws(() => frameTicks(ticks, rate), /bounded integral/);
});
test("manual stroke age and capsule plateau/skirt expectations", () => {
	const item = { time: 12000, strength: 0.8, from: [0.2, 0.5], to: [0.8, 0.5], radius: 0.2 };
	for (const [ticks, value] of [[11999, 0], [12000, 0.8], [20000, 0.8], [28000, 0.4], [36000, 0]])
		assert.equal(strengthAt(item, ticks, 8000, 16000), value);
	assert.equal(capsuleAt(0.5, 0.5, item, 48, 48), 1);
	assert.ok(Math.abs(capsuleAt(0.5, 0.66, item, 48, 48) - 0.5) < 1e-12);
	assert.equal(capsuleAt(0.5, 0.71, item, 48, 48), 0);
	assert.equal(strengthAt({ ...item, time: Number.MAX_SAFE_INTEGER - 100 }, Number.MAX_SAFE_INTEGER - 50, 50, 50), 0.8);
	assert.equal(cellRandom(0, 0, 0, 0), 0);
});
test("premultiplied interpolation suppresses hidden RGB and uses black out of bounds", () => {
	const source = new Uint8Array([255, 0, 0, 255, 0, 255, 255, 0]);
	assert.deepEqual(samplePremultiplied(source, 2, 1, 1, 0.5), [0.5, 0, 0, 0.5]);
	assert.deepEqual(samplePremultiplied(source, 2, 1, 0, 0.5), [0.5, 0, 0, 0.5]);
	assert.deepEqual(samplePremultiplied(source, 2, 1, -0.5, 0.5), [0, 0, 0, 0]);
});
const fixture = createReferenceFixture();
test("portable source and ten f64 expected cases match independently frozen pre-GPU pins", () => {
	const manifest = JSON.parse(readFileSync(new URL("../../docs/evidence/frost-optical-fixture-v2.json", import.meta.url), "utf8"));
	assert.equal(fixture.sourceSha256, manifest.sourceSha256);
	assert.deepEqual(Object.fromEntries(fixture.cases.map((item) => [item.id, item.expectedSha256])), manifest.expectedSha256);
	assert.equal(manifest.productionGpuExecuted, false);
	assert.equal(manifest.replacesHistoricalFixture, false);
	assert.equal(fixture.cases.length, 10);
});
test("authored alpha, poisoned holes and independent full-melt plateau stay exact", () => {
	const histogram = {};
	let plateau = 0, positive = 0;
	const full = fixture.cases.find((item) => item.id === "stamp-full").expected;
	for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
		const i = (y * 64 + x) * 4, alpha = fixture.source[i + 3];
		histogram[alpha] = (histogram[alpha] || 0) + 1;
		for (const item of fixture.cases.slice(0, 8)) {
			assert.equal(item.expected[i + 3], alpha);
			if (alpha === 0) assert.deepEqual(Array.from(item.expected.subarray(i, i + 4)), [0, 0, 0, 0]);
		}
		const distance = Math.hypot(x + 0.5 - Math.max(12.8, Math.min(51.2, x + 0.5)), y + 0.5 - 24);
		if (distance < 5.76 - 1e-6) {
			plateau++;
			if (alpha) {
				positive++;
				assert.deepEqual(full.subarray(i, i + 4), fixture.source.subarray(i, i + 4));
			}
		}
	}
	assert.deepEqual(histogram, { 0: 109, 96: 424, 255: 2539 });
	assert.equal(plateau, 568);
	assert.equal(positive, 459);
});
test("frozen time, recovery, seed, bypass and arbitrary seek order are distinguishable", () => {
	const hashes = Object.fromEntries(fixture.cases.map((item) => [item.id, item.expectedSha256]));
	assert.equal(hashes["static-ice"], hashes["before-stamp"]);
	assert.equal(hashes["static-ice"], hashes.recovered);
	assert.equal(hashes["stamp-full"], hashes["hold-end"]);
	assert.notEqual(hashes["static-ice"], hashes["seed-variant"]);
	assert.notEqual(hashes["stamp-full"], hashes["recover-half"]);
	assert.notEqual(hashes.restamped, hashes.recovered);
	assert.equal(hashes.neutral, fixture.sourceSha256);
	assert.equal(hashes["negative-handle"], fixture.sourceSha256);
	for (const index of [5, 2, 7, 0, 4, 2])
		assert.deepEqual(referenceRgba(CASES[index]), fixture.cases[index].expected);
	const source = sourceRgba(), before = source.slice();
	referenceRgba(CASES[2], source);
	assert.deepEqual(source, before);
	assert.throws(() => referenceRgba(CASES[0], new Uint8Array(4)), /Exact/);
});
