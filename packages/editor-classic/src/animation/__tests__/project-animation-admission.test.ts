import { expect, test } from "bun:test";
import { collectProjectAnimationAdmissionIssues } from "../project-animation-admission";
import type { VideoElement } from "../../timeline/types";
import { mediaTime } from "../../wasm";

test("reopen diagnostics preserve malformed and out-of-bounds channels without aborting inspection", () => {
	const element: VideoElement = {
		id: "legacy-video",
		name: "Legacy",
		type: "video",
		mediaId: "media",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 100000 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
		params: {},
		animations: {
			opacity: {
				keys: [
					{
						id: "a",
						time: mediaTime({ ticks: 0 }),
						value: 2,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
				],
			},
			"transform.scaleX": {
				keys: [
					{
						id: "b",
						time: mediaTime({ ticks: 0 }),
						value: 1,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
				],
			},
		},
	};
	const malformed = structuredClone(element);
	malformed.id = "malformed";
	Reflect.set(malformed.animations?.opacity, "keys", [
		{ time: 0, value: 1, segmentToNext: "unknown" },
	]);
	const before = structuredClone(element);
	const malformedBefore = structuredClone(malformed);
	const issues = collectProjectAnimationAdmissionIssues({
		elements: [malformed, element],
	});
	expect(issues.find((issue) => issue.elementId === "legacy-video")?.kind).toBe(
		"rejected",
	);
	expect(issues.find((issue) => issue.elementId === "malformed")?.kind).toBe(
		"unresolved",
	);
	expect(element).toEqual(before);
	expect(malformed).toEqual(malformedBefore);
});
