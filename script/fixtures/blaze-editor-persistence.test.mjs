import { expect, test } from "bun:test";
import { blazeHostImage } from "./blaze-host-source";
import {
	assertBlazeEditorBytes,
	blazeEditorFirstOpen,
} from "./blaze-editor-persistence.mjs";

const thumbnail = `data:image/png;base64,${blazeHostImage().toString("base64")}`;
const createdAt = "2026-10-09T03:00:00.000Z",
	updatedAt = "2026-10-09T03:00:01.000Z";
const seed = {
	wrapperVersion: 1,
	record: {
		id: "project",
		schemaVersion: 32,
		data: {
			metadata: {
				id: "project",
				name: "Blaze",
				duration: 360000,
				createdAt,
				updatedAt: createdAt,
			},
			settings: {
				canvasSize: { width: 192, height: 128 },
				fps: { numerator: 30, denominator: 1 },
			},
			__opencutTransaction: { version: 1, revision: 1, idempotency: [] },
			scenes: [
				{
					id: "scene",
					tracks: [
						{
							id: "track",
							hidden: false,
							clips: [
								{
									id: "clip",
									params: { amount: 0.75, seed: 31415 },
									animations: { wind: [-0.5, 0.625] },
								},
							],
						},
					],
				},
			],
		},
	},
	summary: { id: "project", name: "Blaze", createdAt, updatedAt: createdAt },
};
const initialized = () => {
	const opened = structuredClone(seed);
	Object.assign(opened.record.data.metadata, { updatedAt, thumbnail });
	Object.assign(opened.record.data, {
		timelineViewState: { zoomLevel: 6.51, scrollLeft: 0, playheadTime: 0 },
	});
	opened.summary.updatedAt = updatedAt;
	return opened;
};

test("first normal open allows only exact new PNG/view initialization and synchronized updatedAt", () => {
	const result = blazeEditorFirstOpen(seed, initialized());
	expect(result.thumbnail.width).toBe(192);
	expect(result.thumbnail.height).toBe(128);
	expect(result.view).toEqual({
		zoomLevel: 6.51,
		scrollLeft: 0,
		playheadTime: 0,
	});
	expect(JSON.stringify(result)).not.toContain("data:image");
	expect(() => blazeEditorFirstOpen(initialized(), initialized())).toThrow();
});

test("first-open normalization rejects business, transaction, structure and unrelated metadata mutation", () => {
	for (const mutate of [
		(p) => {
			p.record.data.scenes[0].tracks[0].clips[0].params.amount = 0.5;
		},
		(p) => {
			p.record.data.scenes[0].tracks[0].clips[0].animations.wind[1] = 0.1;
		},
		(p) => {
			p.record.data.scenes[0].tracks[0].hidden = true;
		},
		(p) => {
			p.record.data.__opencutTransaction.revision++;
		},
		(p) => {
			p.record.data.__opencutTransaction.idempotency.push("unexpected");
		},
		(p) => {
			p.record.data.settings.fps.numerator = 24;
		},
		(p) => {
			p.record.data.metadata.name = "changed";
		},
		(p) => {
			p.record.data.metadata.duration++;
		},
		(p) => {
			p.record.data.metadata.createdAt = updatedAt;
		},
		(p) => {
			p.summary.name = "changed";
		},
		(p) => {
			p.wrapperVersion = 2;
		},
		(p) => {
			p.record.data.extra = true;
		},
	]) {
		const opened = initialized();
		mutate(opened);
		expect(() => blazeEditorFirstOpen(seed, opened)).toThrow();
	}
});

test("first-open thumbnail is canonical correctly-sized PNG and view has no preauthored seek", () => {
	for (const value of [
		undefined,
		"",
		"data:image/jpeg;base64,AA==",
		"data:image/png;base64,broken!",
		thumbnail + "!",
	]) {
		const opened = initialized();
		opened.record.data.metadata.thumbnail = value;
		expect(() => blazeEditorFirstOpen(seed, opened)).toThrow();
	}
	const wrong = initialized(),
		png = blazeHostImage();
	png.writeUInt32BE(640, 16);
	wrong.record.data.metadata.thumbnail = `data:image/png;base64,${png.toString("base64")}`;
	expect(() => blazeEditorFirstOpen(seed, wrong)).toThrow();
	for (const view of [
		undefined,
		[],
		{},
		{ zoomLevel: NaN, scrollLeft: 0, playheadTime: 0 },
		{ zoomLevel: 0, scrollLeft: 0, playheadTime: 0 },
		{ zoomLevel: 6.51, scrollLeft: 1, playheadTime: 0 },
		{ zoomLevel: 6.51, scrollLeft: 0, playheadTime: 4000 },
		{ zoomLevel: 6.51, scrollLeft: 0, playheadTime: 0, extra: true },
	]) {
		const opened = initialized();
		opened.record.data.timelineViewState = view;
		expect(() => blazeEditorFirstOpen(seed, opened)).toThrow();
	}
});

test("first-open timestamps require canonical monotonic and synchronized ISO values", () => {
	for (const value of [
		"invalid",
		"2026-10-08T03:00:00.000Z",
		"2026-10-09T03:00:01Z",
	]) {
		const opened = initialized();
		opened.record.data.metadata.updatedAt = value;
		opened.summary.updatedAt = value;
		expect(() => blazeEditorFirstOpen(seed, opened)).toThrow();
	}
	const mismatched = initialized();
	mismatched.summary.updatedAt = createdAt;
	expect(() => blazeEditorFirstOpen(seed, mismatched)).toThrow();
});

test("after a readonly baseline no metadata business or serialization-only change is accepted", () => {
	const bytes = Buffer.from(JSON.stringify(initialized()));
	expect(
		assertBlazeEditorBytes(bytes, Buffer.from(bytes), "reload").byteIdentical,
	).toBe(true);
	for (const mutate of [
		(p) => {
			p.record.data.metadata.updatedAt = "2026-10-09T03:00:02.000Z";
		},
		(p) => {
			p.record.data.metadata.thumbnail += "A";
		},
		(p) => {
			p.record.data.timelineViewState.zoomLevel++;
		},
		(p) => {
			p.record.data.timelineViewState.playheadTime = 4000;
		},
		(p) => {
			p.record.data.__opencutTransaction.revision++;
		},
		(p) => {
			p.record.data.scenes[0].tracks[0].clips[0].params.seed = 1;
		},
	]) {
		const changed = initialized();
		mutate(changed);
		expect(() =>
			assertBlazeEditorBytes(
				bytes,
				Buffer.from(JSON.stringify(changed)),
				"reopen",
			),
		).toThrow();
	}
	expect(() =>
		assertBlazeEditorBytes(
			bytes,
			Buffer.from(bytes.toString() + "\n"),
			"export",
		),
	).toThrow();
	expect(() =>
		assertBlazeEditorBytes(
			bytes,
			Buffer.from(JSON.stringify(initialized(), null, 2)),
			"reload",
		),
	).toThrow();
});
