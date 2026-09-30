import { describe, expect, test } from "bun:test";
import { motionTextCueId, type MotionTextCue } from "@opencut/editor-contracts";
import {
	hasMotionTextLock,
	isMotionTextCueFieldLocked,
	isMotionTextCutBoundaryLocked,
	motionTextFieldState,
} from "../lock-state";

function cueWithLocks(locks: MotionTextCue["locks"]): MotionTextCue {
	return {
		id: motionTextCueId("cue:test"),
		text: "test",
		startTime: 0,
		duration: 1,
		interlude: false,
		gapBefore: false,
		impact: false,
		emphasis: [],
		segments: ["test"],
		locks,
		overrides: {},
	};
}

describe("motion-text lock state", () => {
	test("a full cue lock gates every editable cue field", () => {
		const cue = cueWithLocks([{ scope: "cue", key: "all" }]);
		for (const field of [
			"text",
			"timing",
			"preset",
			"font",
			"colors",
			"parameters",
		] as const) {
			expect(isMotionTextCueFieldLocked({ cue, field })).toBe(true);
		}
	});

	test("scoped locks only gate the controls they can invalidate", () => {
		const cue = cueWithLocks([
			{ scope: "preset-group", key: "layout" },
			{ scope: "parameter", key: "tracking" },
			{ scope: "cut", key: "cut:one" },
		]);
		expect(isMotionTextCueFieldLocked({ cue, field: "text" })).toBe(true);
		expect(isMotionTextCueFieldLocked({ cue, field: "timing" })).toBe(false);
		expect(isMotionTextCueFieldLocked({ cue, field: "preset" })).toBe(true);
		expect(isMotionTextCueFieldLocked({ cue, field: "font" })).toBe(false);
		expect(isMotionTextCueFieldLocked({ cue, field: "colors" })).toBe(false);
		expect(isMotionTextCueFieldLocked({ cue, field: "parameters" })).toBe(true);
		expect(
			hasMotionTextLock({ cue, scope: "preset-group", key: "layout" }),
		).toBe(true);
	});

	test("a boundary is gated only by a full or adjacent cut lock", () => {
		const cue = cueWithLocks([{ scope: "cut", key: "cut:two" }]);
		expect(
			isMotionTextCutBoundaryLocked({
				cue,
				cutId: "cut:one",
				nextCutId: "cut:two",
			}),
		).toBe(true);
		expect(
			isMotionTextCutBoundaryLocked({
				cue,
				cutId: "cut:three",
				nextCutId: "cut:four",
			}),
		).toBe(false);
	});

	test("field state distinguishes locked, local, and inherited values", () => {
		expect(motionTextFieldState({ locked: true, local: false })).toBe("Locked");
		expect(motionTextFieldState({ locked: false, local: true })).toBe("Local");
		expect(motionTextFieldState({ locked: false, local: false })).toBe(
			"Inherited",
		);
	});
});
