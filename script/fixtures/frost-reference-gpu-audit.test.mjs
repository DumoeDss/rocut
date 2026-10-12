import test from "node:test";
import assert from "node:assert/strict";
import { auditFrostReferenceCapture } from "./frost-reference-gpu-audit.mjs";
import { createReferenceFixture } from "./frost-reference-fixture.mjs";

const fixture = createReferenceFixture();
function input() {
	return {
		source: fixture.source.slice(),
		canonicalSource: fixture.source.slice(),
		records: fixture.cases.map((item) => {
			if (["neutral", "negative-handle"].includes(item.id))
				return {
					id: item.id,
					passCount: 0,
					fixtureRgba: fixture.source.slice(),
				};
			return {
				id: item.id,
				passCount: 1,
				...Object.fromEntries(
					[
						"nativeRgba",
						"canonicalNativeRgba",
						"defaultCanvasRgba",
						"diagnosticCanvasRgba",
						"rawCanvasRgba",
						"readbackCanvasRgba",
					].map((field) => [field, item.expected.slice()]),
				),
			};
		}),
	};
}
const record = (value, id) => value.records.find((r) => r.id === id);
const rejected = (value, pattern) => {
	const result = auditFrostReferenceCapture(value);
	assert.equal(result.ok, false);
	assert(
		result.failures.some((f) => pattern.test(f.check)),
		JSON.stringify(result.failures),
	);
	return result;
};
test("exact independent CPU references pass arbitrary case order without claiming GPU execution", () => {
	const value = input();
	value.records.reverse();
	const result = auditFrostReferenceCapture(value);
	assert(result.ok);
	assert.equal(result.allmetrics.length, 57);
	assert.match(result.scope, /not evidence of runtime/);
});
test("changed source hash is rejected even when caller supplies matching invented expected", () => {
	const value = input();
	value.source[0] ^= 1;
	value.expected = value.records;
	rejected(value, /sourceHash/);
});
test("all active alpha leaks are audited, not only first error", () => {
	const value = input();
	record(value, "static-ice").nativeRgba[3]++;
	record(value, "seed-variant").rawCanvasRgba[3]++;
	const result = rejected(value, /AlphaExact/);
	assert(result.failures.some((f) => f.id === "seed-variant"));
});
test("one opaque full-melt plateau pixel fails exact invariant even inside mean gate", () => {
	const value = input();
	const i = (24 * 64 + 20) * 4;
	assert.equal(value.source[i + 3], 255);
	record(value, "stamp-full").nativeRgba[i] ^= 1;
	rejected(value, /PlateauExact/);
});
test("canonical production pair one-byte mismatch fails even at hidden alpha zero", () => {
	const value = input();
	const i = value.source.findIndex((v, i) => i % 4 === 3 && v === 0) - 3;
	record(value, "static-ice").diagnosticCanvasRgba[i] = 1;
	rejected(value, /defaultEquals/);
});
for (const id of ["negative-handle", "neutral"])
	test(`${id} must preserve poisoned hidden authored RGB exactly`, () => {
		const value = input();
		const i = value.source.findIndex((v, i) => i % 4 === 3 && v === 0) - 3;
		record(value, id).fixtureRgba[i] = 0;
		rejected(value, /bypassPoisonExact/);
	});
test("duplicate and missing cases are both reported", () => {
	const value = input();
	value.records[1] = value.records[0];
	const result = rejected(value, /duplicateCase/);
	assert(result.failures.some((f) => f.check === "missingCase"));
});
test("incorrect native pixel, even outside plateau, fails fixed maximum gate", () => {
	const value = input();
	record(value, "static-ice").nativeRgba[0] =
		(record(value, "static-ice").nativeRgba[0] + 50) % 256;
	rejected(value, /nativeReference/);
});
test("seed output swap is rejected without trusting caller identity", () => {
	const value = input();
	record(value, "seed-variant").nativeRgba = record(
		value,
		"static-ice",
	).nativeRgba.slice();
	rejected(value, /nativeReference|Distinguishable/);
});
test("time output swaps fail reference and exact absolute-time equivalence", () => {
	const value = input();
	record(value, "stamp-full").nativeRgba = record(
		value,
		"recover-half",
	).nativeRgba.slice();
	rejected(value, /nativeReference|Equivalence|PlateauExact/);
});
test("canonical opaque byte change is rejected independently of premultiplied tolerance", () => {
	const value = input();
	const i = value.source.findIndex((v, i) => i % 4 === 3 && v === 255) - 3;
	value.canonicalSource[i] ^= 1;
	rejected(value, /canonicalOpaqueExact/);
});
test("transparent native RGB poison is rejected even though premultiplied error is zero", () => {
	const value = input();
	const i = value.source.findIndex((v, i) => i % 4 === 3 && v === 0) - 3;
	record(value, "static-ice").canonicalNativeRgba[i] = 1;
	rejected(value, /HolesZero/);
});
