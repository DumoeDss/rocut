import { expect, test } from "bun:test";
import { fitTimelineRange } from "../fit-range";

test("full project and a later selection fit into the same viewport", () => {
	const full = fitTimelineRange({ startSeconds: 0, endSeconds: 60, viewportWidth: 648 });
	const selection = fitTimelineRange({ startSeconds: 30, endSeconds: 40, viewportWidth: 648 });
	expect(full).toEqual({ zoom: 0.2, scrollLeft: 0 });
	expect(selection).toEqual({ zoom: 1.2, scrollLeft: 1776 });
	expect(30 * 50 * selection!.zoom - selection!.scrollLeft).toBe(24);
	expect(40 * 50 * selection!.zoom - selection!.scrollLeft).toBe(624);
});
test("invalid and zero-length ranges do not change the timeline view", () => {
	expect(fitTimelineRange({ startSeconds: 1, endSeconds: 1, viewportWidth: 648 })).toBeNull();
	expect(fitTimelineRange({ startSeconds: 0, endSeconds: Infinity, viewportWidth: 648 })).toBeNull();
});
