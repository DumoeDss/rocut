import assert from "node:assert/strict";
import test from "node:test";
import {
	parseOverallTimeout,
	DEFAULT_OVERALL_TIMEOUT_MS,
} from "./multishot-mv-options.mjs";

test("overall fixture observation retains its original default", () => {
	assert.equal(DEFAULT_OVERALL_TIMEOUT_MS, 900000);
	assert.equal(parseOverallTimeout([]), 900000);
	assert.equal(parseOverallTimeout(["--trace-audio"]), 900000);
});
test("explicit bounded integer budgets support equals and separate arguments", () => {
	for (const value of [60000, 900000, 1800000, 3600000]) {
		assert.equal(parseOverallTimeout([`--overall-timeout-ms=${value}`]), value);
		assert.equal(
			parseOverallTimeout(["--overall-timeout-ms", String(value)]),
			value,
		);
	}
	const argumentsList = [
		"--trace-audio",
		"--overall-timeout-ms=1800000",
		"--trace-audio-inner",
	];
	const before = [...argumentsList];
	assert.equal(parseOverallTimeout(argumentsList), 1800000);
	assert.deepEqual(argumentsList, before);
});
test("invalid syntax, unsafe numbers and out-of-range budgets fail immediately", () => {
	for (const value of [
		"",
		" ",
		"60000.0",
		"1e6",
		"NaN",
		"Infinity",
		"-1",
		"59999",
		"3600001",
		"9007199254740993",
		"1800000ms",
	])
		assert.throws(() => parseOverallTimeout([`--overall-timeout-ms=${value}`]));
	assert.throws(() => parseOverallTimeout(["--overall-timeout-ms"]));
	assert.throws(() =>
		parseOverallTimeout(["--overall-timeout-ms", "--trace-audio"]),
	);
});
test("multiple overall-budget declarations are rejected", () => {
	assert.throws(() =>
		parseOverallTimeout([
			"--overall-timeout-ms=900000",
			"--overall-timeout-ms=900000",
		]),
	);
	assert.throws(() =>
		parseOverallTimeout([
			"--overall-timeout-ms",
			"1800000",
			"--overall-timeout-ms=900000",
		]),
	);
});
