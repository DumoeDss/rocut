import assert from "node:assert/strict";
import { test } from "node:test";
import {
	measureTemporalChange,
	temporalThresholds,
} from "./frost-encoded-time-metrics.mjs";
import {
	accepts,
	metric,
	thresholds as frameThresholds,
} from "./flame-wrap-export-metrics.mjs";

const width = 8;
const height = 6;
const rgb = (value) => new Uint8Array(width * height * 3).fill(value);
const input = (overrides = {}) => ({
	width,
	height,
	expectedFirst: rgb(60),
	expectedLast: rgb(100),
	actualFirst: rgb(60),
	actualLast: rgb(100),
	...overrides,
});

test("accepts correctly signed progress with independent byte expectations", () => {
	const result = measureTemporalChange(input());
	assert.equal(result.pixels, 48);
	assert.equal(result.channels, 144);
	assert.equal(result.expectedChangeMean, 40);
	assert.equal(result.signedChangeMean, 40);
	assert.equal(result.deltaErrorMean, 0);
	assert.equal(result.accepted, true);
});

test("rejects a frozen middle frame even if both frames are nonempty", () => {
	const frozen = rgb(80);
	const result = measureTemporalChange(
		input({ actualFirst: frozen, actualLast: frozen }),
	);
	assert.equal(result.identifiable, true);
	assert.equal(result.signedChangeMean, 0);
	assert.equal(result.deltaErrorMean, 40);
	assert.equal(result.accepted, false);
});

test("rejects tiny codec-like changes rather than treating nonidentity as motion", () => {
	const result = measureTemporalChange(
		input({ actualFirst: rgb(80), actualLast: rgb(82) }),
	);
	assert.equal(result.signedChangeMean, 2);
	assert.equal(result.accepted, false);
});

test("rejects reversed time and accepts correctly decreasing reference", () => {
	assert.equal(
		measureTemporalChange(
			input({ actualFirst: rgb(100), actualLast: rgb(60) }),
		).accepted,
		false,
	);
	const result = measureTemporalChange(
		input({
			expectedFirst: rgb(100),
			expectedLast: rgb(60),
			actualFirst: rgb(98),
			actualLast: rgb(62),
		}),
	);
	assert.equal(result.signedChangeMean, 36);
	assert.equal(result.deltaErrorMean, 4);
	assert.equal(result.accepted, true);
});

test("does not select channels from actual output or invent a weak reference", () => {
	const result = measureTemporalChange(
		input({ expectedLast: rgb(76), actualLast: rgb(240) }),
	);
	assert.equal(result.pixels, 0);
	assert.equal(result.channels, 0);
	assert.equal(result.signedChangeMean, null);
	assert.equal(result.identifiable, false);
	assert.equal(result.accepted, false);
});

test("requires the original minimum region size", () => {
	const expectedLast = rgb(60);
	for (let i = 0; i < 47 * 3; i++) expectedLast[i] = 100;
	const result = measureTemporalChange(
		input({ expectedLast, actualLast: expectedLast }),
	);
	assert.equal(result.pixels, 47);
	assert.equal(result.accepted, false);
	assert.equal(temporalThresholds.minimumPixels, 48);
});

test("checks malformed views, dimensions, and bounded allocation size", () => {
	for (const invalid of [
		{ actualFirst: [] },
		{ actualLast: new Uint8Array(1) },
		{ width: 0 },
		{ height: 0.5 },
		{ width: 1001, height: 1000 },
	]) {
		assert.throws(() => measureTemporalChange(input(invalid)));
	}
});

test("adds temporal sensitivity without rewriting the original per-frame gates", () => {
	const first = new Uint8Array(128 * 128 * 3).fill(60);
	const last = Uint8Array.from(first);
	for (let i = 0; i < 48 * 3; i++) last[i] = 100;
	const early = metric(last, first, first);
	const late = metric(last, last, first);
	assert(early.meanRgb <= frameThresholds.meanRgb);
	assert.equal(early.activePixels, 0);
	assert.equal(accepts(late), true);
	const result = measureTemporalChange({
		width: 128,
		height: 128,
		expectedFirst: first,
		expectedLast: last,
		actualFirst: last,
		actualLast: last,
	});
	assert.equal(result.identifiable, true);
	assert.equal(result.accepted, false);
});
