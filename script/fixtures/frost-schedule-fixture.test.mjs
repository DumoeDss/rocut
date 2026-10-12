import assert from "node:assert/strict";
import test from "node:test";
import { createScheduleFixture, scheduleReference, SEEK_TICKS, TICKS, sha256 } from "./frost-schedule-fixture.mjs";
import { sourceRgba } from "./frost-reference-fixture.mjs";

test("opaque schedule fixture preserves optical constants and original alpha oracle", () => {
	const original = sourceRgba(), oldHash = sha256(original), fixture = createScheduleFixture();
	assert(original.some((value, index) => index % 4 === 3 && value !== 255));
	assert(fixture.source.every((value, index) => index % 4 !== 3 || value === 255));
	assert.deepEqual(TICKS, Array.from({ length: 13 }, (_, index) => index * 4000));
	assert.equal(fixture.parameters.amount, 0.8);
	assert.equal(fixture.parameters.coverage, 0.9);
	assert.equal(fixture.parameters.seed, 17);
	assert.equal(fixture.parameters.blur, 0.025);
	assert.equal(fixture.parameters.refraction, 0.035);
	assert.equal(fixture.parameters.tintStrength, 0.35);
	assert.equal(fixture.parameters.holdTicks, 8000);
	assert.equal(fixture.parameters.recoveryTicks, 16000);
	assert.equal(fixture.parameters.stroke0TimeTicks, 12001);
	assert.equal(sha256(sourceRgba()), oldHash);
});

test("preselected independent stamp/recovery pairs identify and reject frozen schedule", () => {
	const fixture = createScheduleFixture();
	for (const pair of fixture.pairs) {
		assert.equal(pair.identity.identifiable, true, pair.id);
		assert.equal(pair.identity.accepted, true, pair.id);
		assert(pair.identity.pixels >= 48);
		assert(pair.identity.expectedChangeMean > 16);
		assert.equal(pair.freeze.accepted, false);
		assert.equal(pair.freeze.signedChangeMean, 0);
	}
	assert.deepEqual(fixture.gates, { meanRgb: 4, activeRgb: 6, activePixels: 48,
		activeDelta: 16, timestamp: 0.0011, minimumPixels: 48, visibleDelta: 16,
		minimumSignedChange: 8, maximumDeltaError: 12 });
});

test("independent absolute schedule references survive reverse/repeated seek", () => {
	const fixture = createScheduleFixture();
	for (const ticks of SEEK_TICKS) {
		assert.equal(sha256(scheduleReference(ticks, fixture.source)), fixture.frames.find(frame => frame.ticks === ticks).sha256);
	}
	assert.equal(fixture.frames[0].sha256, fixture.frames[3].sha256);
	assert.notEqual(fixture.frames[3].sha256, fixture.frames[4].sha256);
});
