import { expect, test } from "bun:test";
import { sameImagePreprocessStructure } from "./image-preprocess-identity";

test("strict JSON structure preserves full fields, values and array order", () => {
	const left = { resource: { sha256: "a", attachmentKey: "x" }, roi: { x: 1 }, flameAt: [1, 2] };
	expect(sameImagePreprocessStructure({ left, right: { flameAt: [1, 2], roi: { x: 1 }, resource: { attachmentKey: "x", sha256: "a" } } })).toBe(true);
	for (const right of [
		{ ...left, resource: { ...left.resource, sha256: "b" } },
		{ ...left, roi: { x: 2 } },
		{ ...left, flameAt: [2, 1] },
		{ ...left, unknown: 1 },
	]) expect(sameImagePreprocessStructure({ left, right })).toBe(false);
	for (const invalid of [NaN, Infinity, undefined, () => {}, new Date(), new Map(), Array(2)])
		expect(sameImagePreprocessStructure({ left: invalid, right: invalid })).toBe(false);
});
