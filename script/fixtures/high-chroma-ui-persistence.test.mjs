import { describe, expect, test } from "bun:test";
import {
	assertHighChromaUiExportBytes,
	validateHighChromaUiFirstOpen,
} from "./high-chroma-ui-persistence.mjs";
import { editorImage } from "./droplets-editor-scene";

const png = editorImage();
const thumbnail = `data:image/png;base64,${png.toString("base64")}`;
const createdAt = "2026-10-09T02:57:38.133Z";
const updatedAt = "2026-10-09T02:57:41.636Z";
const seed = {
	wrapperVersion: 1,
	record: {
		id: "project",
		schemaVersion: 32,
		data: {
			metadata: {
				id: "project",
				name: "Fixture",
				duration: 24000,
				createdAt,
				updatedAt: createdAt,
			},
			__opencutTransaction: { version: 1, revision: 1, idempotency: [] },
			scenes: [
				{
					id: "scene",
					tracks: [
						{
							id: "track",
							hidden: false,
							clips: [{ id: "clip", duration: 24000, params: { amount: 1 } }],
						},
					],
				},
			],
			settings: {
				canvasSize: { width: 640, height: 360 },
				fps: { numerator: 30, denominator: 1 },
			},
		},
	},
	summary: { id: "project", name: "Fixture", createdAt, updatedAt: createdAt },
};
function initialized() {
	const opened = structuredClone(seed);
	Object.assign(opened.record.data.metadata, { thumbnail, updatedAt });
	Object.assign(opened.record.data, {
		timelineViewState: { zoomLevel: 6.51, scrollLeft: 0, playheadTime: 0 },
	});
	opened.summary.updatedAt = updatedAt;
	return opened;
}

describe("new UI project's first-open persistence boundary", () => {
	test("only exact initialization metadata can precede the export baseline", () => {
		const result = validateHighChromaUiFirstOpen(seed, initialized());
		expect(result.changes.map((change) => change.pointer)).toEqual([
			"/record/data/metadata/thumbnail",
			"/record/data/metadata/updatedAt",
			"/record/data/timelineViewState",
			"/summary/updatedAt",
		]);
		expect(result.thumbnail.bytes).toBe(png.length);
		expect(result.thumbnail.width).toBe(640);
		expect(result.thumbnail.height).toBe(360);
		expect(result.changes[0].after).toHaveProperty("sha256");
		expect(JSON.stringify(result)).not.toContain("data:image");
	});

	test("business, revision, structural or unrelated metadata changes are rejected", () => {
		for (const mutate of [
			(p) => (p.record.data.scenes[0].tracks[0].clips[0].params.amount = 0.5),
			(p) => (p.record.data.scenes[0].tracks[0].clips[0].duration = 28000),
			(p) => (p.record.data.scenes[0].tracks[0].hidden = true),
			(p) => (p.record.data.__opencutTransaction.revision = 2),
			(p) => p.record.data.__opencutTransaction.idempotency.push("unexpected"),
			(p) => (p.record.data.settings.fps.numerator = 24),
			(p) => (p.record.data.metadata.name = "Changed"),
			(p) => (p.record.data.metadata.duration = 28000),
			(p) => (p.record.data.metadata.createdAt = updatedAt),
			(p) => (p.summary.name = "Changed"),
			(p) => (p.wrapperVersion = 2),
			(p) => (p.record.data.extra = true),
		]) {
			const opened = initialized();
			mutate(opened);
			expect(() => validateHighChromaUiFirstOpen(seed, opened)).toThrow();
		}
	});

	test("thumbnail must be a new canonical correctly-sized PNG", () => {
		for (const value of [
			undefined,
			"",
			"data:image/jpeg;base64,AA==",
			"data:image/png;base64,broken!",
			thumbnail + "!",
		]) {
			const opened = initialized();
			opened.record.data.metadata.thumbnail = value;
			expect(() => validateHighChromaUiFirstOpen(seed, opened)).toThrow();
		}
		const wrongDimensions = initialized();
		const wrongPng = Buffer.from(png);
		wrongPng.writeUInt32BE(192, 16);
		wrongDimensions.record.data.metadata.thumbnail = `data:image/png;base64,${wrongPng.toString("base64")}`;
		expect(() =>
			validateHighChromaUiFirstOpen(seed, wrongDimensions),
		).toThrow();
		expect(() =>
			validateHighChromaUiFirstOpen(initialized(), initialized()),
		).toThrow();
	});

	test("timeline initialization has only finite zoom and untouched zero scroll/playhead", () => {
		for (const value of [
			undefined,
			[],
			{},
			{ zoomLevel: NaN, scrollLeft: 0, playheadTime: 0 },
			{ zoomLevel: 0, scrollLeft: 0, playheadTime: 0 },
			{ zoomLevel: 6.51, scrollLeft: 1, playheadTime: 0 },
			{ zoomLevel: 6.51, scrollLeft: 0, playheadTime: 4000 },
			{ zoomLevel: 6.51, scrollLeft: 0, playheadTime: 0, selection: [] },
		]) {
			const opened = initialized();
			opened.record.data.timelineViewState = value;
			expect(() => validateHighChromaUiFirstOpen(seed, opened)).toThrow();
		}
	});

	test("updatedAt is synchronized, ISO-serialized and never moves backwards", () => {
		for (const value of [
			"not-a-time",
			"2026-10-08T02:57:38.133Z",
			"2026-10-09T02:57:41Z",
		]) {
			const opened = initialized();
			opened.record.data.metadata.updatedAt = value;
			opened.summary.updatedAt = value;
			expect(() => validateHighChromaUiFirstOpen(seed, opened)).toThrow();
		}
		const different = initialized();
		different.summary.updatedAt = createdAt;
		expect(() => validateHighChromaUiFirstOpen(seed, different)).toThrow();
	});

	test("after baseline no metadata, business or even serialization-only change is permitted", () => {
		const initial = initialized();
		const baseline = Buffer.from(JSON.stringify(initial));
		expect(
			assertHighChromaUiExportBytes(baseline, Buffer.from(baseline))
				.byteIdentical,
		).toBe(true);
		for (const mutate of [
			(p) => (p.record.data.metadata.updatedAt = "2026-10-09T02:58:00.000Z"),
			(p) => (p.record.data.timelineViewState.zoomLevel = 7),
			(p) => (p.record.data.metadata.thumbnail = thumbnail + "A"),
			(p) => (p.record.data.__opencutTransaction.revision = 2),
		]) {
			const current = initialized();
			mutate(current);
			expect(() =>
				assertHighChromaUiExportBytes(
					baseline,
					Buffer.from(JSON.stringify(current)),
				),
			).toThrow();
		}
		expect(() =>
			assertHighChromaUiExportBytes(
				baseline,
				Buffer.from(JSON.stringify(initial) + "\n"),
			),
		).toThrow();
	});
});
