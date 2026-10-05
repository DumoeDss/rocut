import { describe, expect, test } from "bun:test";
import { changedReviewFields } from "../draft-review-diff";

describe("draft review presentation differences", () => {
	test("shows nested lyric and color edits, additions and deletions without mutating either snapshot", () => {
		const before = {
			cues: [{ text: "旧歌词", colors: { foreground: "#FFF" }, extra: true }],
		};
		const after = {
			cues: [
				{ text: "新歌词", colors: { foreground: "#0F0" }, duration: 120000 },
			],
		};
		expect(changedReviewFields({ before, after })).toEqual([
			{ path: "cues.0.text", before: "旧歌词", after: "新歌词" },
			{ path: "cues.0.colors.foreground", before: "#FFF", after: "#0F0" },
			{ path: "cues.0.extra", before: true, after: undefined },
			{ path: "cues.0.duration", before: undefined, after: 120000 },
		]);
		expect(before.cues[0].text).toBe("旧歌词");
		expect(after.cues[0].text).toBe("新歌词");
	});
	test("keeps complete resolved plans for expansion and does not silently drop a type change", () => {
		const before = {
			sequence: { resolvedPlan: { cuts: [{ text: "old" }] } },
			value: [],
		};
		const after = {
			sequence: { resolvedPlan: { cuts: [{ text: "new" }] } },
			value: {},
		};
		const fields = changedReviewFields({ before, after });
		expect(fields).toHaveLength(2);
		expect(fields[0]).toEqual({
			path: "sequence.resolvedPlan",
			before: before.sequence.resolvedPlan,
			after: after.sequence.resolvedPlan,
		});
		expect(fields[1]).toEqual({ path: "value", before: [], after: {} });
		expect(
			changedReviewFields({ before, after: structuredClone(before) }),
		).toEqual([]);
	});
});
