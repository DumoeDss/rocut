import { expect, test } from "bun:test";
import { createOpenCutProjectRecord } from "../../../transactions";
import { SessionPersistenceCoordinator } from "../session-persistence-coordinator";
import type { ProjectStore } from "@opencut/editor-ports";

test("native export capture uses live unsaved clips and retains opaque persisted fields without IO", async () => {
	const { record } = createOpenCutProjectRecord({
		projectId: "export-source" as never,
		name: "source",
		now: () => new Date("2026-01-01T00:00:00.000Z"),
	});
	const raw = JSON.parse(JSON.stringify(record.data));
	delete raw.scenes[0].bookmarks;
	raw.scenes[0].createdAt = "2026-01-01T00:00:00Z";
	raw.scenes[0].tracks.main.elements = [
		{
			id: "clip",
			name: "old clip",
			type: "text",
			startTime: 0,
			duration: 120000,
			trimStart: 0,
			trimEnd: 0,
			params: { text: "old" },
			hiddenProviderField: { owner: "persisted" },
		},
	];
	let reads = 0,
		saves = 0;
	const persistence = new SessionPersistenceCoordinator({
		load: async () => {
			reads++;
			return { ...record, data: raw };
		},
		save: async () => {
			saves++;
		},
	} as unknown as ProjectStore);
	const live = (await persistence.loadProject({ id: record.id }))!;
	const before = JSON.stringify(raw);
	live.scenes[0].tracks.main.elements[0].name = "unsaved live clip";
	(live.scenes[0].tracks.main.elements[0] as any).params.text =
		"unsaved rendered text";
	live.motionTextSequences = [{ id: "live-sequence", revision: 3 }] as never;
	const snapshot = persistence.captureNativeExportSourceData({
		project: live,
	}) as typeof raw;
	expect(snapshot.scenes[0].tracks.main.elements[0].name).toBe(
		"unsaved live clip",
	);
	expect(snapshot.scenes[0].tracks.main.elements[0].params.text).toBe(
		"unsaved rendered text",
	);
	expect(
		snapshot.scenes[0].tracks.main.elements[0].hiddenProviderField,
	).toEqual({ owner: "persisted" });
	expect(snapshot.scenes[0].bookmarks).toEqual([]);
	expect(snapshot.scenes[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
	expect(snapshot.motionTextSequences[0].revision).toBe(3);
	expect(JSON.stringify(raw)).toBe(before);
	expect(reads).toBe(1);
	expect(saves).toBe(0);
	(snapshot as any).scenes[0].tracks.main.elements[0].name = "detached";
	expect(live.scenes[0].tracks.main.elements[0].name).toBe("unsaved live clip");
});
