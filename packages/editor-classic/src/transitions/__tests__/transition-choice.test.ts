import { describe, expect, test } from "bun:test";
import {
	clipId,
	mediaTime,
	revisionOf,
	trackId,
} from "@opencut/editor-contracts";
import { projectFixture } from "../../editor/transactions/opencut/__tests__/fixture";
import { projectOpenCutDraft } from "../../editor/transactions/opencut/projection";
import { inspectTransitionChoice } from "../transition-choice";

const t = (ticks: number) => mediaTime({ ticks });
function fixture() {
	const document = projectOpenCutDraft(
		{
			project: projectFixture(),
			assetCatalog: [
				{ id: "source", name: "source", type: "video", duration: 8 },
			],
		},
		{ revision: revisionOf(0), idempotency: [] },
	);
	const assetId = document.assets[0].id;
	document.clips.push(
		{
			id: clipId("left"),
			trackId: trackId("main-track"),
			assetId,
			startTime: t(0),
			duration: t(360000),
			trimStart: t(0),
			trimEnd: t(600000),
		},
		{
			id: clipId("right"),
			trackId: trackId("main-track"),
			assetId,
			startTime: t(360000),
			duration: t(240000),
			trimStart: t(600000),
			trimEnd: t(120000),
		},
	);
	return document;
}
function inspect({
	document = fixture(),
	durationFrames = 30,
}: { document?: ReturnType<typeof fixture>; durationFrames?: number } = {}) {
	return inspectTransitionChoice({
		document,
		incomingId: "right",
		outgoingId: "left",
		durationFrames,
	});
}

describe("transition authoring preflight uses the commit graph", () => {
	test("validates actual seconds-to-ticks metadata without changing the document", () => {
		const document = fixture(),
			before = structuredClone(document);
		expect(inspect({ document }).valid).toBe(true);
		expect(document).toEqual(before);
	});
	test("updates a relation instead of appending a duplicate", () => {
		const document = fixture();
		document.clips[1].transitionIn = {
			kind: "cross-dissolve",
			outgoingClipId: clipId("left"),
			durationFrames: 30,
		};
		expect(inspect({ document, durationFrames: 16 }).valid).toBe(true);
		expect(document.clips[1].transitionIn.durationFrames).toBe(30);
	});
	test("rejects fractional, empty, short and unsafe frame counts", () => {
		for (const frames of [NaN, -1, 0, 1, 1.5, Infinity, 4294967296]) {
			expect(inspect({ durationFrames: frames })).toEqual({
				valid: false,
				message: "Enter a whole number of at least 2 frames.",
			});
		}
	});
	test("explains missing incoming and outgoing footage", () => {
		const document = fixture();
		document.clips[1].trimStart = t(0);
		expect(inspect({ document }).message).toContain("before its cut");
		document.clips[1].trimStart = t(600000);
		document.clips[0].trimStart = t(600000);
		expect(inspect({ document }).message).toContain("after its cut");
	});
	test("explains adjacency, frame alignment and clip duration", () => {
		const document = fixture();
		document.clips[1].startTime = t(364000);
		expect(inspect({ document }).message).toContain("end exactly");
		document.clips[0].duration = t(360001);
		document.clips[1].startTime = t(360001);
		expect(inspect({ document }).message).toContain("Align the cut");
		expect(inspect({ durationFrames: 400 }).valid).toBe(false);
	});
	test("preserves explicit frame holds and supports image sources", () => {
		const document = fixture();
		document.clips[1].trimStart = t(0);
		document.clips[1].freezeFrame = t(240000);
		expect(inspect({ document }).valid).toBe(true);
		document.assets[0].kind = "image";
		expect(inspect({ document }).valid).toBe(true);
	});
	test("detects existing overlapping transition windows across the complete graph", () => {
		const document = fixture();
		document.assets[0].kind = "image";
		document.clips[1].duration = t(80000);
		document.clips.push({
			...document.clips[1],
			id: clipId("third"),
			startTime: t(440000),
			duration: t(360000),
			transitionIn: {
				kind: "cross-dissolve",
				outgoingClipId: clipId("right"),
				durationFrames: 30,
			},
		});
		expect(inspect({ document }).message).toContain("overlaps another");
		expect(inspect({ document, durationFrames: 2 }).valid).toBe(true);
	});
	test("reports removed clips and unavailable source without throwing", () => {
		const document = fixture();
		document.assets.length = 0;
		expect(inspect({ document }).message).toContain(
			"source media is unavailable",
		);
		document.clips.length = 0;
		expect(inspect({ document }).message).toContain("no longer available");
	});
});
