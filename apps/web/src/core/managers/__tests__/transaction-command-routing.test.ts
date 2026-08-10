/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Focused command harnesses intentionally supply narrowed EditorCore collaborators and branded media times. */
import { describe, expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import type { TProject } from "@/project/types";
import type { TScene } from "@/timeline";

await import("@/editor/session/__tests__/wasm-test-mock");
const {
	AddTrackCommand,
	BatchCommand,
	Command,
	DeleteElementsCommand,
	InsertElementCommand,
	RemoveMediaAssetCommand,
	TracksSnapshotCommand,
	UpdateElementsCommand,
	UpdateProjectSettingsCommand,
} = await import("@/commands");
const { CommandManager } = await import("@/core/managers/commands");
const { SelectionManager } = await import("@/core/managers/selection-manager");
const { TimelineManager } = await import("@/core/managers/timeline-manager");
const { buildElementFromMedia } = await import("@/timeline/element-utils");
const { SessionPersistenceCoordinator } = await import("@/editor/persistence");
const { cloneOpaque } = await import("@/editor/persistence/opaque-value");
const { ProjectMutationArbiter, SessionOpenCutTransactions } =
	await import("@/editor/transactions/opencut");
const { projectFixture, storeFixture, TEST_PROJECT_ID } =
	await import("@/editor/transactions/opencut/__tests__/fixture");

async function commandHarness(
	project = projectFixture(),
	assets: MediaAsset[] = [],
) {
	const fixture = await storeFixture(project);
	const arbiter = new ProjectMutationArbiter();
	const persistence = new SessionPersistenceCoordinator(fixture.store, arbiter);
	await persistence.loadProject({ id: TEST_PROJECT_ID });
	let liveProject = cloneOpaque(project);
	let liveScenes = cloneOpaque(project.scenes);
	let dirtySignals = 0;
	const failures: unknown[] = [];
	const editor = {} as EditorCore;
	Object.assign(editor, {
		persistence,
		project: {
			getActive: () => liveProject,
			getActiveOrNull: () => liveProject,
			setActiveProject: ({ project: next }: { project: TProject }) => {
				liveProject = cloneOpaque(next);
			},
			adoptCommittedProject: ({ project: next }: { project: TProject }) => {
				liveProject = cloneOpaque(next);
			},
		},
		scenes: {
			getScenes: () => liveScenes,
			getActiveScene: () =>
				liveScenes.find((scene) => scene.id === liveProject.currentSceneId)!,
			getActiveSceneOrNull: () =>
				liveScenes.find((scene) => scene.id === liveProject.currentSceneId) ??
				null,
			adoptCommittedScenes: ({ scenes }: { scenes: TScene[] }) => {
				liveScenes = cloneOpaque(scenes);
			},
		},
		media: { getAssets: () => assets },
		save: { markDirty: () => dirtySignals++ },
		reportPersistenceFailure: ({ error }: { error: unknown }) =>
			failures.push(error),
	});
	const selection = new SelectionManager(editor);
	Object.assign(editor, { selection });
	const transactions = new SessionOpenCutTransactions({
		persistence,
		arbiter,
		publish: (draft) => {
			liveProject = cloneOpaque(draft.project);
			liveScenes = cloneOpaque(draft.project.scenes);
		},
	});
	Object.assign(editor, { transactions });
	await transactions.open({ projectId: TEST_PROJECT_ID, assets });
	const command = new CommandManager(editor);
	Object.assign(editor, { command });
	const timeline = new TimelineManager(editor);
	Object.assign(editor, { timeline });
	command.registerReactor(({ editor: target }) => {
		const tracks = target.scenes.getActiveScene().tracks;
		const pruned = {
			...tracks,
			overlay: tracks.overlay.filter((track) => track.elements.length > 0),
			audio: tracks.audio.filter((track) => track.elements.length > 0),
		};
		if (
			pruned.overlay.length !== tracks.overlay.length ||
			pruned.audio.length !== tracks.audio.length
		) {
			target.timeline.updateTracks(pruned);
		}
	});
	return {
		fixture,
		editor,
		command,
		timeline,
		transactions,
		failures,
		getProject: () => liveProject,
		getScenes: () => liveScenes,
		getDirtySignals: () => dirtySignals,
	};
}

describe("transaction-routed command manager", () => {
	test("auto placement routes uploaded audio into one durable audio track", async () => {
		const asset: MediaAsset = {
			id: "audio-asset",
			name: "tone.wav",
			type: "audio",
			duration: 2,
			file: new File([], "tone.wav"),
		};
		const harness = await commandHarness(projectFixture(), [asset]);
		await harness.command.execute({
			command: new InsertElementCommand({
				placement: { mode: "auto" },
				element: buildElementFromMedia({
					mediaId: asset.id,
					mediaType: asset.type,
					name: asset.name,
					duration: 240_000 as never,
					startTime: 0 as never,
				}),
			}),
		});
		expect(harness.getScenes()[0].tracks.audio).toHaveLength(1);
		expect(harness.getScenes()[0].tracks.audio[0].elements).toHaveLength(1);
		expect(harness.fixture.getSaveCount()).toBe(1);
	});

	test("first image commits canvas and clip once while undo preserves historyless canvas ownership", async () => {
		const asset: MediaAsset = {
			id: "first-image",
			name: "first.png",
			type: "image",
			width: 320,
			height: 180,
			file: new File([], "first.png", { type: "image/png" }),
		};
		const harness = await commandHarness(projectFixture(), [asset]);
		let watchCount = 0;
		harness.transactions.watch(() => watchCount++);

		await harness.command.execute({
			command: new InsertElementCommand({
				placement: { mode: "auto" },
				element: buildElementFromMedia({
					mediaId: asset.id,
					mediaType: asset.type,
					name: asset.name,
					duration: 240_000 as never,
					startTime: 0 as never,
				}),
			}),
		});

		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(Number(await harness.transactions.revision())).toBe(1);
		expect(watchCount).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(
			harness.editor.selection.getSnapshot().selectedElements,
		).toHaveLength(1);
		expect(harness.getProject().settings.canvasSize).toEqual({
			width: 320,
			height: 180,
		});
		expect(harness.getProject().settings.originalCanvasSize).toEqual({
			width: 320,
			height: 180,
		});
		expect(await harness.transactions.project()).toMatchObject({
			canvasWidth: 320,
			canvasHeight: 180,
		});
		expect(
			harness.editor.persistence.readCachedProject({ id: TEST_PROJECT_ID })
				?.settings.canvasSize,
		).toEqual({ width: 320, height: 180 });
		const record = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(
			(record?.data as { settings: { canvasSize: unknown } }).settings
				.canvasSize,
		).toEqual({ width: 320, height: 180 });

		await harness.transactions.retire();
		await harness.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: [asset],
		});
		expect(await harness.transactions.project()).toMatchObject({
			canvasWidth: 320,
			canvasHeight: 180,
		});

		await harness.command.undo();
		expect(harness.fixture.getSaveCount()).toBe(2);
		expect(harness.getProject().settings.canvasSize).toEqual({
			width: 320,
			height: 180,
		});
		expect(harness.getProject().settings.originalCanvasSize).toEqual({
			width: 320,
			height: 180,
		});
		expect(harness.getScenes()[0].tracks.overlay).toHaveLength(0);
		expect(harness.editor.selection.getSnapshot().selectedElements).toEqual([]);
	});

	test("failed first-image save leaves every public and donor surface at the base canvas", async () => {
		const asset: MediaAsset = {
			id: "failed-image",
			name: "failed.png",
			type: "image",
			width: 320,
			height: 180,
			file: new File([], "failed.png", { type: "image/png" }),
		};
		const harness = await commandHarness(projectFixture(), [asset]);
		let watchCount = 0;
		harness.transactions.watch(() => watchCount++);
		harness.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});

		await expect(
			harness.command.execute({
				command: new InsertElementCommand({
					placement: { mode: "auto" },
					element: buildElementFromMedia({
						mediaId: asset.id,
						mediaType: asset.type,
						name: asset.name,
						duration: 240_000 as never,
						startTime: 0 as never,
					}),
				}),
			}),
		).rejects.toMatchObject({ code: "unavailable" });

		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(Number(await harness.transactions.revision())).toBe(0);
		expect(watchCount).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(harness.getProject().settings.canvasSize).toEqual({
			width: 1920,
			height: 1080,
		});
		expect(harness.getScenes()[0].tracks.overlay).toHaveLength(0);
		expect(await harness.transactions.project()).toMatchObject({
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		expect(
			harness.editor.persistence.readCachedProject({ id: TEST_PROJECT_ID })
				?.settings.canvasSize,
		).toEqual({ width: 1920, height: 1080 });
		const record = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(
			(record?.data as { settings: { canvasSize: unknown } }).settings
				.canvasSize,
		).toEqual({ width: 1920, height: 1080 });
	});

	test("settings patches classify per field and mixed public/private state commits in one record", async () => {
		const publicHarness = await commandHarness();
		await publicHarness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 1280, height: 720 },
			}),
		});
		expect(publicHarness.fixture.getSaveCount()).toBe(1);
		expect(await publicHarness.transactions.project()).toMatchObject({
			canvasWidth: 1280,
			canvasHeight: 720,
		});

		const mixedHarness = await commandHarness();
		await mixedHarness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 640, height: 360 },
				background: { type: "color", color: "#123456" },
			}),
		});
		expect(mixedHarness.fixture.getSaveCount()).toBe(1);
		expect(mixedHarness.getProject().settings.background).toEqual({
			type: "color",
			color: "#123456",
		});
		const mixedRecord = await mixedHarness.fixture.store.load({
			id: TEST_PROJECT_ID,
		});
		expect(
			(mixedRecord?.data as { settings: { background: unknown } }).settings
				.background,
		).toEqual({ type: "color", color: "#123456" });

		const privateHarness = await commandHarness();
		await privateHarness.command.execute({
			command: new UpdateProjectSettingsCommand({
				background: { type: "color", color: "#abcdef" },
			}),
		});
		expect(privateHarness.fixture.getSaveCount()).toBe(0);
		expect(Number(await privateHarness.transactions.revision())).toBe(0);
		expect(privateHarness.getDirtySignals()).toBe(1);
	});

	test("historyless public FPS work uses the engine and final-document placement rejects old-only grids", async () => {
		const systemHarness = await commandHarness();
		await systemHarness.command.executeSystem({
			command: new UpdateProjectSettingsCommand({
				fps: { numerator: 60, denominator: 1 },
			}),
		});
		expect(systemHarness.fixture.getSaveCount()).toBe(1);
		expect(Number(await systemHarness.transactions.revision())).toBe(1);
		expect(systemHarness.command.getHistoryCount()).toBe(0);
		expect(systemHarness.getProject().settings.fps).toEqual({
			numerator: 60,
			denominator: 1,
		});

		const placed = projectFixture();
		placed.scenes[0].tracks.overlay.push({
			id: "old-grid-track",
			name: "Old grid",
			type: "text",
			hidden: false,
			elements: [
				{
					id: "old-grid-clip",
					name: "Old grid clip",
					type: "text",
					startTime: 0 as never,
					duration: 4_000 as never,
					trimStart: 0 as never,
					trimEnd: 0 as never,
					params: { content: "old grid" },
				},
			],
		});
		const rejectedHarness = await commandHarness(placed);
		await expect(
			rejectedHarness.command.executeSystem({
				command: new UpdateProjectSettingsCommand({
					fps: { numerator: 24, denominator: 1 },
				}),
			}),
		).rejects.toMatchObject({ code: "validation" });
		expect(Number(await rejectedHarness.transactions.revision())).toBe(0);
		expect(rejectedHarness.command.getHistoryCount()).toBe(0);
		expect(rejectedHarness.getProject().settings.fps).toEqual({
			numerator: 30,
			denominator: 1,
		});
	});

	test("Batch commits once and undo/redo each commit once after durability", async () => {
		const harness = await commandHarness();
		const addTrack = new AddTrackCommand({ type: "text", index: 0 });
		const insert = new InsertElementCommand({
			placement: { mode: "explicit", trackId: addTrack.getTrackId() },
			element: {
				type: "text",
				name: "Caption",
				startTime: 0 as never,
				duration: 4_000 as never,
				trimStart: 0 as never,
				trimEnd: 0 as never,
				params: { content: "hello" },
			},
		});
		let watchCount = 0;
		harness.transactions.watch(() => watchCount++);
		await harness.command.execute({
			command: new BatchCommand([addTrack, insert]),
		});
		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(Number(await harness.transactions.revision())).toBe(1);
		expect(watchCount).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(harness.getScenes()[0].tracks.overlay[0].elements).toHaveLength(1);

		await harness.command.undo();
		expect(harness.fixture.getSaveCount()).toBe(2);
		expect(Number(await harness.transactions.revision())).toBe(2);
		expect(harness.command.canRedo()).toBe(true);
		expect(harness.getScenes()[0].tracks.overlay).toHaveLength(0);

		await harness.command.redo();
		expect(harness.fixture.getSaveCount()).toBe(3);
		expect(Number(await harness.transactions.revision())).toBe(3);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(harness.getScenes()[0].tracks.overlay[0].elements).toHaveLength(1);
	});

	test("mixed/private fake batches fail before mutation, save, revision, or history", async () => {
		const harness = await commandHarness();
		const addTrack = new AddTrackCommand({ type: "text" });
		const mixed = new BatchCommand([
			addTrack,
			new UpdateProjectSettingsCommand({
				background: { type: "color", color: "#ffffff" },
			}),
		]);
		expect(() => harness.command.execute({ command: mixed })).toThrow(
			"only directly registered transaction",
		);
		expect(harness.fixture.getSaveCount()).toBe(0);
		expect(Number(await harness.transactions.revision())).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(() =>
			harness.command.execute({
				command: new BatchCommand([
					new AddTrackCommand({ type: "text" }),
					new RemoveMediaAssetCommand({
						projectId: TEST_PROJECT_ID,
						assetId: "external-effect",
					}),
				]),
			}),
		).toThrow("only directly registered transaction");
		let unregisteredMutations = 0;
		class UnregisteredCommand extends Command {
			readonly routingClass = "unregistered" as never;

			execute() {
				unregisteredMutations += 1;
				return undefined;
			}
		}
		expect(() =>
			harness.command.execute({ command: new UnregisteredCommand() }),
		).toThrow("no routing registration");
		expect(unregisteredMutations).toBe(0);

		const before = cloneOpaque(harness.getScenes()[0].tracks);
		const privateAfter = cloneOpaque(before);
		privateAfter.main.muted = true;
		await expect(
			harness.command.execute({
				command: new TracksSnapshotCommand({
					before,
					after: privateAfter,
				}),
			}),
		).rejects.toThrow("non-empty");
		expect(harness.getScenes()[0].tracks.main.muted).toBe(false);
		expect(harness.fixture.getSaveCount()).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
	});

	test("a later failing Batch child discards preparation and leaves the queue usable", async () => {
		const harness = await commandHarness();
		class FailingTransactionCommand extends Command {
			readonly routingClass = "transaction" as const;

			execute(): undefined {
				throw new Error("prepared child failed");
			}
		}
		await expect(
			harness.command.execute({
				command: new BatchCommand([
					new AddTrackCommand({ type: "text" }),
					new FailingTransactionCommand(),
				]),
			}),
		).rejects.toThrow("prepared child failed");
		expect(harness.fixture.getSaveCount()).toBe(0);
		expect(Number(await harness.transactions.revision())).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(harness.getScenes()[0].tracks.overlay).toHaveLength(0);

		await harness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 1280, height: 720 },
			}),
		});
		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(Number(await harness.transactions.revision())).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
	});

	test("failed undo preserves live state and both history stacks", async () => {
		const harness = await commandHarness();
		const track = new AddTrackCommand({ type: "text" });
		await harness.command.execute({
			command: new BatchCommand([
				track,
				new InsertElementCommand({
					placement: { mode: "explicit", trackId: track.getTrackId() },
					element: {
						type: "text",
						name: "kept",
						startTime: 0 as never,
						duration: 4_000 as never,
						trimStart: 0 as never,
						trimEnd: 0 as never,
						params: { content: "kept" },
					},
				}),
			]),
		});
		const tracksBeforeFailure = cloneOpaque(harness.getScenes()[0].tracks);
		harness.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(harness.command.undo()).rejects.toMatchObject({
			code: "unavailable",
		});
		expect(harness.getScenes()[0].tracks).toEqual(tracksBeforeFailure);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(harness.command.canRedo()).toBe(false);
		expect(Number(await harness.transactions.revision())).toBe(1);
	});

	test("failed redo preserves the undone state and retries at the next revision", async () => {
		const harness = await commandHarness();
		await harness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 1280, height: 720 },
			}),
		});
		await harness.command.undo();
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(harness.command.canRedo()).toBe(true);
		expect(harness.getProject().settings.canvasSize.width).toBe(1920);
		harness.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(harness.command.redo()).rejects.toMatchObject({
			code: "unavailable",
		});
		expect(Number(await harness.transactions.revision())).toBe(2);
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(harness.command.canRedo()).toBe(true);
		expect(harness.getProject().settings.canvasSize.width).toBe(1920);

		await harness.command.redo();
		expect(Number(await harness.transactions.revision())).toBe(3);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(harness.command.canRedo()).toBe(false);
		expect(harness.getProject().settings.canvasSize.width).toBe(1280);
	});

	test("multi-child Batch, ripple, and empty-track reactor publish one root", async () => {
		const project = projectFixture();
		const textElement = (id: string, startTime: number) => ({
			id,
			name: id,
			type: "text" as const,
			startTime: startTime as never,
			duration: 4_000 as never,
			trimStart: 0 as never,
			trimEnd: 0 as never,
			params: { content: id },
		});
		project.scenes[0].tracks.overlay.push(
			{
				id: "remove-track",
				name: "Remove",
				type: "text",
				hidden: false,
				elements: [textElement("remove-clip", 0)],
			},
			{
				id: "ripple-track",
				name: "Ripple",
				type: "text",
				hidden: false,
				elements: [
					textElement("ripple-first", 0),
					textElement("ripple-second", 8_000),
				],
			},
		);
		const harness = await commandHarness(project);
		harness.command.isRippleEnabled = true;
		await harness.command.execute({
			command: new BatchCommand([
				new DeleteElementsCommand({
					elements: [{ trackId: "remove-track", elementId: "remove-clip" }],
				}),
				new DeleteElementsCommand({
					elements: [{ trackId: "ripple-track", elementId: "ripple-first" }],
				}),
			]),
		});
		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(Number(await harness.transactions.revision())).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(
			harness
				.getScenes()[0]
				.tracks.overlay.some((track) => track.id === "remove-track"),
		).toBe(false);
		expect(
			Number(harness.getScenes()[0].tracks.overlay[0].elements[0].startTime),
		).toBe(4_000);

		await harness.command.undo();
		expect(harness.fixture.getSaveCount()).toBe(2);
		expect(Number(await harness.transactions.revision())).toBe(2);
		expect(
			harness
				.getScenes()[0]
				.tracks.overlay.some((track) => track.id === "remove-track"),
		).toBe(true);
		expect(
			Number(
				harness
					.getScenes()[0]
					.tracks.overlay.find((track) => track.id === "ripple-track")!
					.elements[1].startTime,
			),
		).toBe(8_000);

		await harness.command.redo();
		expect(harness.fixture.getSaveCount()).toBe(3);
		expect(Number(await harness.transactions.revision())).toBe(3);
		expect(
			harness
				.getScenes()[0]
				.tracks.overlay.some((track) => track.id === "remove-track"),
		).toBe(false);
		expect(
			Number(harness.getScenes()[0].tracks.overlay[0].elements[0].startTime),
		).toBe(4_000);
	});

	test("a public clip update carries its provider-private sibling in the same record", async () => {
		const project = projectFixture();
		project.scenes[0].tracks.overlay.push({
			id: "text-track",
			name: "Text",
			type: "text",
			hidden: false,
			elements: [
				{
					id: "text-clip",
					name: "Text",
					type: "text",
					startTime: 0 as never,
					duration: 4_000 as never,
					trimStart: 0 as never,
					trimEnd: 0 as never,
					params: { content: "before" },
				},
			],
		});
		const harness = await commandHarness(project);
		await harness.command.execute({
			command: new UpdateElementsCommand({
				updates: [
					{
						trackId: "text-track",
						elementId: "text-clip",
						patch: {
							startTime: 4_000 as never,
							params: { content: "after" },
						},
					},
				],
			}),
		});
		const record = await harness.fixture.store.load({ id: TEST_PROJECT_ID });
		const stored = record?.data as {
			scenes: Array<{
				tracks: { overlay: Array<{ elements: Array<{ params: unknown }> }> };
			}>;
		};
		const element = stored.scenes[0].tracks.overlay[0].elements[0];
		expect(element.params).toEqual({ content: "after" });
		expect(harness.fixture.getSaveCount()).toBe(1);
	});

	test("N preview frames commit once, cancel commits zero, and failure retains overlay", async () => {
		const project = projectFixture();
		project.scenes[0].tracks.overlay.push({
			id: "text-track",
			name: "Text",
			type: "text",
			hidden: false,
			elements: [
				{
					id: "text-clip",
					name: "Text",
					type: "text",
					startTime: 0 as never,
					duration: 8_000 as never,
					trimStart: 0 as never,
					trimEnd: 0 as never,
					params: { content: "text" },
				},
			],
		});
		const harness = await commandHarness(project);
		let watchCount = 0;
		harness.transactions.watch(() => watchCount++);
		for (let frame = 1; frame <= 12; frame += 1) {
			harness.timeline.previewElements({
				updates: [
					{
						trackId: "text-track",
						elementId: "text-clip",
						updates: { startTime: (frame * 4_000) as never },
					},
				],
			});
		}
		expect(harness.fixture.getSaveCount()).toBe(0);
		expect(Number(await harness.transactions.revision())).toBe(0);
		expect(watchCount).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(await harness.timeline.commitPreview()).toBe(true);
		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(Number(await harness.transactions.revision())).toBe(1);
		expect(watchCount).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(harness.timeline.isPreviewActive()).toBe(false);

		harness.timeline.previewElements({
			updates: [
				{
					trackId: "text-track",
					elementId: "text-clip",
					updates: { startTime: 52_000 as never },
				},
			],
		});
		harness.timeline.discardPreview();
		expect(harness.fixture.getSaveCount()).toBe(1);

		harness.timeline.previewElements({
			updates: [
				{
					trackId: "text-track",
					elementId: "text-clip",
					updates: { startTime: 56_000 as never },
				},
			],
		});
		harness.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		expect(await harness.timeline.commitPreview()).toBe(false);
		expect(harness.timeline.isPreviewActive()).toBe(true);
		expect(Number(await harness.transactions.revision())).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
	});
});
