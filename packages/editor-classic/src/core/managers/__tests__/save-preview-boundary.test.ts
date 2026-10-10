/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Narrow local autosave wiring harness. */
import { expect, test } from "bun:test";
import type { EditorCore } from "../..";
await import("../../../editor/session/__tests__/wasm-test-mock");
const { TimelineManager } = await import("../timeline-manager");
const { SaveManager } = await import("../save-manager");
const { projectFixture } = await import("../../../editor/transactions/opencut/__tests__/fixture");
const { mediaTime } = await import("../../../wasm");

function setup() {
	let project = projectFixture();
	project.scenes[0].tracks.audio.push({ id: "audio", name: "Audio", type: "audio", muted: false,
		elements: [{ id: "clip", name: "Tone", type: "audio", sourceType: "upload", mediaId: "tone",
			startTime: mediaTime({ ticks: 0 }), duration: mediaTime({ ticks: 240000 }),
			trimStart: mediaTime({ ticks: 0 }), trimEnd: mediaTime({ ticks: 0 }), params: { volume: 0, muted: false } }] });
	let bytes = JSON.stringify(project), saves = 0;
	const listeners = new Set<() => void>();
	const timers = new Set<() => void>();
	const editor = {
		resources: { setTimeout: ({ handler }: { handler: () => void }) => {
			timers.add(handler);
			return { cancel: () => { timers.delete(handler); } };
		} },
		scenes: {
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => { listeners.delete(listener); };
			},
			getActiveSceneOrNull: () => project.scenes[0],
			updateSceneTracks: ({ tracks }: { tracks: typeof project.scenes[0]["tracks"] }) => {
				project = { ...project, scenes: [{ ...project.scenes[0], tracks }] };
				for (const listener of listeners) listener();
			},
		},
		project: {
			getActive: () => project,
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: async () => {
				saves++;
				project = { ...project, metadata: { ...project.metadata, updatedAt: new Date(saves) } };
				bytes = JSON.stringify(project);
			},
		},
		command: { execute: async () => { throw new Error("native validation rejected candidate"); } },
	} as unknown as EditorCore;
	const timeline = new TimelineManager(editor);
	Object.assign(editor, { timeline });
	const save = new SaveManager({ editor });
	Object.assign(editor, { save });
	save.start();
	return { timeline, save, project: () => project, bytes: () => bytes, saves: () => saves,
		drain: async () => {
			for (const timer of [...timers]) { timers.delete(timer); timer(); }
			await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
		} };
}

test("preview, failed commit and discard never schedule an unchanged-project autosave", async () => {
	const h = setup(), before = h.bytes();
	const track = h.project().scenes[0].tracks.audio[0];
	const element = track.elements[0];
	expect(element).toBeDefined();
	h.timeline.previewElements({ updates: [{ trackId: track.id, elementId: element.id, updates: { name: "invalid draft" } }] });
	await h.drain();
	expect(h.saves()).toBe(0);
	expect(h.save.getIsDirty()).toBe(false);
	expect(await h.timeline.commitPreview()).toBe(false);
	h.timeline.discardPreview();
	await h.drain();
	expect(h.saves()).toBe(0);
	expect(h.bytes()).toBe(before);
	expect(h.save.getIsDirty()).toBe(false);
	h.save.stop();
});

test("committed track and scene notifications still save, while explicit view/thumbnail dirtiness remains supported", async () => {
	const h = setup();
	const tracks = structuredClone(h.project().scenes[0].tracks);
	tracks.main.name = "committed track";
	h.timeline.updateTracks(tracks);
	await h.drain();
	expect(h.saves()).toBe(1);
	expect(JSON.parse(h.bytes()).scenes[0].tracks.main.name).toBe("committed track");
	// User view state and thumbnails are explicitly marked dirty by ProjectManager.
	h.save.markDirty();
	await h.drain();
	expect(h.saves()).toBe(2);
	h.save.publishAlreadyDurable(() => h.timeline.updateTracks(tracks));
	await h.drain();
	expect(h.saves()).toBe(2);
	h.save.stop();
});

test("discard cannot create an autosave, and cannot cancel an already pending legitimate save", async () => {
	const h = setup();
	const track = h.project().scenes[0].tracks.audio[0];
	const preview = () => h.timeline.previewElements({ updates: [{ trackId: track.id,
		elementId: track.elements[0].id, updates: { name: "uncommitted" } }] });
	preview();
	expect(await h.timeline.commitPreview()).toBe(false);
	h.timeline.discardPreview();
	await h.drain();
	expect(h.saves()).toBe(0);
	h.save.markDirty();
	preview();
	h.timeline.discardPreview();
	await h.drain();
	expect(h.saves()).toBe(1);
	h.save.stop();
});

test("stopping observation removes the committed-scene subscription", async () => {
	const h = setup();
	h.save.stop();
	h.timeline.updateTracks(structuredClone(h.project().scenes[0].tracks));
	await h.drain();
	expect(h.saves()).toBe(0);
	expect(h.save.getIsDirty()).toBe(false);
});
