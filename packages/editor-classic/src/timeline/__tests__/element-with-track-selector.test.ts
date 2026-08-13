import { describe, expect, test } from "bun:test";
import type { EditorCore } from "../../core";
import type { TimelineElement, TimelineTrack } from "../types";
import { selectElementWithTrackTuple } from "../element-with-track-selector";

describe("element-with-track selector snapshot stability", () => {
	test("a non-empty selection returns shallow-stable members across reads", () => {
		const track = { id: "track-a" } as TimelineTrack;
		const element = { id: "element-a" } as TimelineElement;
		const editor = {
			timeline: {
				getElementsWithTracks: () => [{ track, element }],
			},
		} as unknown as EditorCore;
		const elements = [{ trackId: track.id, elementId: element.id }];

		const first = selectElementWithTrackTuple({ editor, elements });
		const second = selectElementWithTrackTuple({ editor, elements });

		expect(first).not.toBe(second);
		expect(first.every((value, index) => Object.is(value, second[index]))).toBe(
			true,
		);
		expect(first).toEqual([track, element]);
	});
});
