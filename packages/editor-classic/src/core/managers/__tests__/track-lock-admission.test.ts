import { expect, test } from "bun:test";
import {
	clipId,
	mediaTime,
	trackId,
	type TransactionOperation,
} from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import {
	projectFixture,
	TEST_PROJECT_ID,
} from "../../../editor/transactions/opencut/__tests__/fixture";
import { trackLockValidator } from "../../../editor/transactions/opencut/track-lock-runtime";
import { cloneOpaque } from "../../../editor/persistence/opaque-value";
import { decodeProject } from "../../../editor/persistence/project-codec";
import { buildTextElement } from "../../../timeline/element-utils";
import { ToggleTrackLockCommand } from "../../../commands/timeline/track/toggle-track-lock";
import { DeleteElementsCommand } from "../../../commands/timeline/element/delete-elements";
import { UpdateElementsCommand } from "../../../commands/timeline/element/update-elements";
import { TracksSnapshotCommand } from "../../../commands/timeline/tracks-snapshot";
import { assertMediaRemovalUnlocked } from "../../../editor/transactions/opencut/track-lock-policy";

const nativeAvailable = typeof trackLockValidator() === "function";
const nativeTest = test.skipIf(!nativeAvailable);
if (process.env.ROCUT_TEST_WASM_DIRECTORY && !nativeAvailable)
	throw new Error(
		"The explicitly selected WASM must provide track lock admission",
	);

function projectWithText() {
	const project = projectFixture();
	const element = buildTextElement({
		raw: { name: "Locked title", duration: mediaTime({ ticks: 120_000 }) },
		startTime: mediaTime({ ticks: 0 }),
	});
	if (element.type !== "text") throw new Error("Expected text fixture");
	project.scenes[0].tracks.overlay.push({
		id: "title-track",
		name: "Title",
		type: "text",
		hidden: false,
		elements: [{ ...element, id: "title" }],
	});
	return project;
}

async function lockedHarness() {
	const harness = await commandHarness(projectWithText());
	await harness.command.execute({
		command: new ToggleTrackLockCommand("title-track"),
	});
	return harness;
}

nativeTest(
	"UI lock persists, survives reopen, and supports separate undo and redo",
	async () => {
		const harness = await lockedHarness();
		const saved = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		if (!saved || typeof saved.data !== "object" || saved.data === null)
			throw new Error("Missing saved project");
		expect(Reflect.get(saved.data, "__opencutTransaction")).toMatchObject({
			version: 2,
		});
		expect(decodeProject(saved.data).scenes[0].tracks.overlay[0].locked).toBe(
			true,
		);
		expect(
			(await harness.transactions.tracks()).find(
				(track) => track.id === "title-track",
			)?.locked,
		).toBe(true);
		await harness.command.undo();
		expect(harness.getScenes()[0].tracks.overlay[0].locked).not.toBe(true);
		const undone = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		if (!undone || typeof undone.data !== "object" || undone.data === null)
			throw new Error("Missing project after undo");
		expect(
			decodeProject(undone.data).scenes[0].tracks.overlay[0].locked,
		).not.toBe(true);
		expect(Reflect.get(undone.data, "__opencutTransaction")).toMatchObject({
			version: 2,
		});
		await harness.command.redo();
		expect(harness.getScenes()[0].tracks.overlay[0].locked).toBe(true);
		const reopened = await harness.editor.persistence.loadProject({
			id: TEST_PROJECT_ID,
		});
		expect(reopened?.scenes[0].tracks.overlay[0].locked).toBe(true);
	},
);

nativeTest(
	"UI deletion, updates and snapshot replacement reject atomically",
	async () => {
		const harness = await lockedHarness();
		const before = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		const revision = await harness.transactions.revision();
		const tracks = cloneOpaque(harness.getScenes()[0].tracks);
		const removed = { ...tracks, overlay: [] };
		for (const command of [
			new DeleteElementsCommand({
				elements: [{ trackId: "title-track", elementId: "title" }],
			}),
			new UpdateElementsCommand({
				updates: [
					{
						trackId: "title-track",
						elementId: "title",
						patch: { startTime: mediaTime({ ticks: 120_000 }) },
					},
				],
			}),
			new TracksSnapshotCommand({ before: tracks, after: removed }),
		]) {
			await expect(harness.command.execute({ command })).rejects.toThrow(
				"locked",
			);
			expect(await harness.fixture.store.load({ id: TEST_PROJECT_ID })).toEqual(
				before,
			);
			expect(await harness.transactions.revision()).toBe(revision);
			expect(harness.getScenes()[0].tracks.overlay[0]).toEqual(
				tracks.overlay[0],
			);
		}
	},
);

nativeTest(
	"Agent validate, dry-run and apply share native admission, including unlock-and-edit",
	async () => {
		const harness = await lockedHarness();
		const before = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		const batches: TransactionOperation[][] = [
			[{ kind: "delete-clip", clipId: clipId("title") }],
			[{ kind: "delete-track", trackId: trackId("title-track") }],
			[
				{
					kind: "update-clip",
					clipId: clipId("title"),
					patch: { startTime: mediaTime({ ticks: 120_000 }) },
				},
			],
			[
				{
					kind: "update-track",
					trackId: trackId("title-track"),
					patch: { locked: false },
				},
				{ kind: "delete-clip", clipId: clipId("title") },
			],
		];
		for (const operations of batches) {
			const batch = { operations };
			expect((await harness.transactions.validate(batch)).valid).toBe(false);
			expect((await harness.transactions.dryRun(batch)).accepted).toBe(false);
			await expect(harness.transactions.apply(batch)).rejects.toThrow();
			expect(await harness.fixture.store.load({ id: TEST_PROJECT_ID })).toEqual(
				before,
			);
		}
		await harness.transactions.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("title-track"),
					patch: { hidden: true },
				},
			],
		});
		expect(harness.getScenes()[0].tracks.overlay[0].hidden).toBe(true);
		await harness.transactions.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("title-track"),
					patch: { locked: false },
				},
			],
		});
		await harness.transactions.apply({
			operations: [{ kind: "delete-clip", clipId: clipId("title") }],
		});
		expect(await harness.transactions.clips()).toHaveLength(0);
	},
);

nativeTest("legacy bulk saves cannot overwrite locked content", async () => {
	const harness = await lockedHarness();
	const before = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
	const project = cloneOpaque(harness.getProject());
	project.scenes[0].tracks.overlay[0].elements = [];
	await expect(
		harness.editor.persistence.saveProject({ project }),
	).rejects.toThrow("locked");
	expect(await harness.fixture.store.load({ id: TEST_PROJECT_ID })).toEqual(
		before,
	);
});

nativeTest(
	"empty locked lanes survive unrelated edits and remain after explicit unlock",
	async () => {
		const project = projectWithText();
		project.scenes[0].tracks.overlay.push({
			id: "empty-track",
			name: "Empty",
			type: "text",
			hidden: false,
			elements: [],
		});
		const harness = await commandHarness(project);
		await harness.command.execute({
			command: new ToggleTrackLockCommand("empty-track"),
		});
		await harness.transactions.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "Main renamed" },
				},
			],
		});
		expect(
			harness
				.getScenes()[0]
				.tracks.overlay.find((track) => track.id === "empty-track")?.locked,
		).toBe(true);
		await harness.command.execute({
			command: new ToggleTrackLockCommand("empty-track"),
		});
		expect(
			harness
				.getScenes()[0]
				.tracks.overlay.find((track) => track.id === "empty-track")?.locked,
		).toBe(false);
	},
);

nativeTest(
	"attachment removal is rejected before deletion when a locked clip references it",
	() => {
		const project = projectFixture();
		project.scenes[0].tracks.main.locked = true;
		project.scenes[0].tracks.main.elements.push({
			id: "video",
			type: "video",
			name: "video",
			mediaId: "media",
			startTime: mediaTime({ ticks: 0 }),
			duration: mediaTime({ ticks: 120_000 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
			params: {},
		});
		expect(() =>
			assertMediaRemovalUnlocked({ project, assetIds: ["media"] }),
		).toThrow("locked");
		expect(() =>
			assertMediaRemovalUnlocked({ project, assetIds: ["unrelated"] }),
		).not.toThrow();
	},
);
