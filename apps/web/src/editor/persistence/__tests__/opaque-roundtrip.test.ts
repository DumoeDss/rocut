/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- The fixture deliberately inspects opaque unknown payloads and uses compact sentinel helpers. */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_C5_COORDINATOR_ISOLATED !== "1") {
	test("C5 coordinator suite runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_C5_COORDINATOR_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated C5 coordinator suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");
	const { createEditorSession } =
		await import("@/editor/session/create-session");
	const { createInMemoryHost } = await import("@/editor/ports/in-memory/host");
	const { createInMemoryProjectStoreFixture, InMemoryProjectStore } =
		await import("@/editor/ports/in-memory");
	const { SessionPersistenceCoordinator } = await import("../index");

	type Raw = Record<string, unknown>;

	function rawProject(id: string): Raw {
		return {
			metadata: {
				id,
				name: "Original",
				duration: 100,
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				providerPrivateMetadata: new Map([["keep", "metadata"]]),
			},
			scenes: [
				{
					id: "scene-keep",
					name: "Scene keep",
					isMain: true,
					tracks: {
						overlay: [
							{
								id: "track-keep",
								name: "Track keep",
								type: "video",
								muted: false,
								hidden: false,
								providerPrivateTrack: { keep: "track" },
								elements: [
									{
										id: "clip-keep",
										name: "Clip keep",
										type: "video",
										mediaId: "media-keep",
										duration: 100,
										startTime: 0,
										trimStart: 0,
										trimEnd: 0,
										params: {},
										providerPrivateClip: { keep: "clip" },
									},
									{
										id: "clip-delete",
										name: "Clip delete",
										type: "video",
										mediaId: "media-delete",
										duration: 20,
										startTime: 0,
										trimStart: 0,
										trimEnd: 0,
										params: {},
										providerPrivateClip: { remove: true },
									},
								],
							},
							{
								id: "track-delete",
								name: "Track delete",
								type: "text",
								hidden: false,
								elements: [],
								providerPrivateTrack: { remove: true },
							},
						],
						main: {
							id: "main-track",
							name: "Main",
							type: "video",
							muted: false,
							hidden: false,
							elements: [],
						},
						audio: [],
					},
					bookmarks: [],
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
					providerPrivateScene: { keep: "scene" },
				},
				{
					id: "scene-delete",
					name: "Scene delete",
					isMain: false,
					tracks: {
						overlay: [],
						main: {
							id: "deleted-main",
							name: "Main",
							type: "video",
							muted: false,
							hidden: false,
							elements: [],
						},
						audio: [],
					},
					bookmarks: [],
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
					providerPrivateScene: { remove: true },
				},
			],
			currentSceneId: "scene-keep",
			settings: {
				fps: 30,
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000000" },
			},
			version: 31,
			providerPrivateProject: {
				keep: "project",
				when: new Date("2026-08-01T01:02:03.000Z"),
				bytes: new Uint8Array([7, 8, 9]),
			},
		};
	}

	async function seedProject(
		store: InstanceType<typeof InMemoryProjectStore>,
		id: string,
	) {
		await store.save({
			record: { id, schemaVersion: 31, data: rawProject(id) },
			summary: {
				id,
				name: "Original",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
			},
		});
	}

	async function createHarness(
		store: InstanceType<typeof InMemoryProjectStore>,
		projectId: string,
	) {
		const host = createInMemoryHost({ projectId, store });
		const session = await createEditorSession({ host });
		return {
			host,
			session,
			coordinator: new SessionPersistenceCoordinator(host.store!),
		};
	}

	describe("opaque full-recreation persistence", () => {
		test("known edits retain structured-clone sentinels at every supported level", async () => {
			const store = new InMemoryProjectStore();
			await seedProject(store, "p1");
			await store.saveAttachment({
				projectId: "p1",
				key: "media-keep",
				metadata: {
					id: "media-keep",
					name: "Old media",
					type: "video",
					providerPrivateMedia: { keep: "media" },
				},
				body: new Uint8Array([1, 2, 3]).buffer,
			});
			await store.saveLibraryRecord({
				namespace: "sounds",
				key: "user",
				schemaVersion: 1,
				data: {
					items: [{ id: "sound-1", name: "Old", providerPrivateItem: "keep" }],
					providerPrivateLibrary: new Set(["keep"]),
				},
			});

			const first = await createHarness(store, "p1");
			const project = (await first.coordinator.loadProject({ id: "p1" }))!;
			project.metadata.name = "Known project edit";
			project.scenes[0].name = "Known scene edit";
			project.scenes[0].tracks.overlay[0].name = "Known track edit";
			project.scenes[0].tracks.overlay[0].elements[0].name = "Known clip edit";
			await first.coordinator.saveProject({ project });

			const media = await first.coordinator.loadAttachment({
				projectId: "p1",
				key: "media-keep",
				decodeMetadata: (value: unknown) => {
					const raw = value as Raw;
					return { id: raw.id, name: raw.name, type: raw.type };
				},
			});
			await first.coordinator.saveAttachment({
				projectId: "p1",
				key: "media-keep",
				metadata: { ...media!.metadata, name: "Known media edit" },
				body: media!.body,
			});

			const library = await first.coordinator.loadLibraryRecord({
				namespace: "sounds",
				key: "user",
				decode: (value: unknown) => ({
					items: ((value as Raw).items as Raw[]).map((item) => ({
						id: item.id,
						name: item.name,
					})),
				}),
			});
			library!.data.items[0].name = "Known library edit";
			await first.coordinator.saveLibraryRecord({
				namespace: "sounds",
				key: "user",
				schemaVersion: 1,
				data: library!.data,
			});
			first.coordinator.destroy();
			await first.session.dispose();

			const second = await createHarness(store, "p1");
			const reopened = (await second.coordinator.loadProject({ id: "p1" }))!;
			expect(reopened.metadata.name).toBe("Known project edit");
			expect(reopened.scenes[0].name).toBe("Known scene edit");
			expect(reopened.scenes[0].tracks.overlay[0].name).toBe(
				"Known track edit",
			);
			expect(reopened.scenes[0].tracks.overlay[0].elements[0].name).toBe(
				"Known clip edit",
			);
			const raw = (await store.load({ id: "p1" }))!.data as Raw;
			expect(raw.providerPrivateProject).toEqual({
				keep: "project",
				when: new Date("2026-08-01T01:02:03.000Z"),
				bytes: new Uint8Array([7, 8, 9]),
			});
			expect((raw.metadata as Raw).providerPrivateMetadata).toEqual(
				new Map([["keep", "metadata"]]),
			);
			expect((raw.scenes as Raw[])[0].providerPrivateScene).toEqual({
				keep: "scene",
			});
			const rawTrack = (
				((raw.scenes as Raw[])[0].tracks as Raw).overlay as Raw[]
			)[0];
			expect(rawTrack.providerPrivateTrack).toEqual({ keep: "track" });
			expect((rawTrack.elements as Raw[])[0].providerPrivateClip).toEqual({
				keep: "clip",
			});
			const reopenedMedia = await store.loadAttachment({
				projectId: "p1",
				key: "media-keep",
			});
			expect(reopenedMedia?.metadata).toEqual({
				id: "media-keep",
				name: "Known media edit",
				type: "video",
				providerPrivateMedia: { keep: "media" },
			});
			expect(new Uint8Array(reopenedMedia!.body)).toEqual(
				new Uint8Array([1, 2, 3]),
			);
			const reopenedLibrary = await store.loadLibraryRecord({
				namespace: "sounds",
				key: "user",
			});
			expect(reopenedLibrary?.data).toEqual({
				items: [
					{
						id: "sound-1",
						name: "Known library edit",
						providerPrivateItem: "keep",
					},
				],
				providerPrivateLibrary: new Set(["keep"]),
			});
			second.coordinator.destroy();
			await second.session.dispose();
		});

		test("deleted identities lose private state and new identities never inherit it", async () => {
			const store = new InMemoryProjectStore();
			await seedProject(store, "p-delete");
			const harness = await createHarness(store, "p-delete");
			const project = (await harness.coordinator.loadProject({
				id: "p-delete",
			}))!;
			project.scenes = [project.scenes[0]];
			const [keepTrack] = project.scenes[0].tracks.overlay;
			if (keepTrack.type !== "video")
				throw new Error("fixture track changed type");
			keepTrack.elements = [
				keepTrack.elements[0],
				{ ...keepTrack.elements[0], id: "clip-new", name: "New clip" },
			];
			project.scenes[0].tracks.overlay = [
				keepTrack,
				{ ...keepTrack, id: "track-new", name: "New track", elements: [] },
			];
			await harness.coordinator.saveProject({ project });
			const stored = (await store.load({ id: "p-delete" }))!.data as Raw;
			const storedScenes = stored.scenes as Raw[];
			expect(storedScenes.map((scene) => scene.id)).toEqual(["scene-keep"]);
			const storedTracks = (storedScenes[0].tracks as Raw).overlay as Raw[];
			expect(storedTracks.map((track) => track.id)).toEqual([
				"track-keep",
				"track-new",
			]);
			expect(storedTracks[1].providerPrivateTrack).toBeUndefined();
			const clips = storedTracks[0].elements as Raw[];
			expect(clips.map((clip) => clip.id)).toEqual(["clip-keep", "clip-new"]);
			expect(clips[1].providerPrivateClip).toBeUndefined();

			await store.saveAttachment({
				projectId: "p-delete",
				key: "media",
				metadata: { id: "old", name: "Old", providerPrivateMedia: "remove" },
				body: new ArrayBuffer(0),
			});
			await harness.coordinator.loadAttachment({
				projectId: "p-delete",
				key: "media",
			});
			await harness.coordinator.saveAttachment({
				projectId: "p-delete",
				key: "media",
				metadata: { id: "replacement", name: "Replacement" },
				body: new ArrayBuffer(0),
			});
			expect(
				(await store.loadAttachment({ projectId: "p-delete", key: "media" }))
					?.metadata,
			).toEqual({ id: "replacement", name: "Replacement" });
			await harness.coordinator.removeAttachment({
				projectId: "p-delete",
				key: "media",
			});
			await harness.coordinator.saveAttachment({
				projectId: "p-delete",
				key: "media",
				metadata: { id: "new", name: "New" },
				body: new ArrayBuffer(0),
			});
			expect(
				(await store.loadAttachment({ projectId: "p-delete", key: "media" }))
					?.metadata,
			).toEqual({ id: "new", name: "New" });

			await store.saveLibraryRecord({
				namespace: "presets",
				key: "custom",
				schemaVersion: 1,
				data: {
					items: [
						{ id: "preset-old", name: "Old", providerPrivatePreset: "remove" },
					],
					providerPrivateLibrary: "keep",
				},
			});
			const presets = await harness.coordinator.loadLibraryRecord({
				namespace: "presets",
				key: "custom",
				decode: (value: unknown) => ({
					items: ((value as Raw).items as Raw[]).map((item) => ({
						id: item.id,
						name: item.name,
					})),
				}),
			});
			presets!.data.items = [{ id: "preset-new", name: "New" }];
			await harness.coordinator.saveLibraryRecord({
				namespace: "presets",
				key: "custom",
				schemaVersion: 1,
				data: presets!.data,
			});
			expect(
				(await store.loadLibraryRecord({ namespace: "presets", key: "custom" }))
					?.data,
			).toEqual({
				items: [{ id: "preset-new", name: "New" }],
				providerPrivateLibrary: "keep",
			});
			harness.coordinator.destroy();
			await harness.session.dispose();
		});
	});

	describe("session isolation, ordering and failure publication", () => {
		test("two complete sessions share commits but not snapshots, caches or listeners", async () => {
			const store = new InMemoryProjectStore();
			await seedProject(store, "shared");
			const a = await createHarness(store, "shared");
			const b = await createHarness(store, "shared");
			const projectA = (await a.coordinator.loadProject({ id: "shared" }))!;
			const projectB = (await b.coordinator.loadProject({ id: "shared" }))!;
			expect(projectA).not.toBe(projectB);
			projectA.metadata.name = "A committed";
			expect(
				b.coordinator.readCachedProject({ id: "shared" })?.metadata.name,
			).toBe("Original");
			const eventsA: string[] = [];
			const eventsB: string[] = [];
			a.coordinator.subscribe((event) => eventsA.push(event.key));
			b.coordinator.subscribe((event) => eventsB.push(event.key));
			await a.coordinator.saveProject({ project: projectA });
			expect(eventsA).toEqual(["shared"]);
			expect(eventsB).toEqual([]);
			expect(
				(await b.coordinator.loadProject({ id: "shared" }))?.metadata.name,
			).toBe("A committed");
			a.coordinator.destroy();
			b.coordinator.destroy();
			await a.session.dispose();
			await b.session.dispose();
		});

		test("same-key writes serialize, distinct keys progress, and failure publishes no success", async () => {
			const { store, control } = createInMemoryProjectStoreFixture();
			await seedProject(store, "p1");
			await seedProject(store, "p2");
			const harness = await createHarness(store, "p1");
			const p1 = (await harness.coordinator.loadProject({ id: "p1" }))!;
			const p2 = (await harness.coordinator.loadProject({ id: "p2" }))!;
			const pause = control.pauseNext({ operation: "save-project" });
			p1.metadata.name = "first";
			const first = harness.coordinator.saveProject({ project: p1 });
			await pause.entered;
			p2.metadata.name = "independent";
			await harness.coordinator.saveProject({ project: p2 });
			expect((await store.load({ id: "p2" }))?.data).toMatchObject({
				metadata: { name: "independent" },
			});
			const p1Second = structuredClone(p1);
			p1Second.metadata.name = "second";
			let secondSettled = false;
			const second = harness.coordinator
				.saveProject({ project: p1Second })
				.then(() => {
					secondSettled = true;
				});
			p1Second.metadata.name = "mutated after enqueue";
			await Promise.resolve();
			expect(secondSettled).toBe(false);
			pause.release();
			await Promise.all([first, second]);
			expect((await store.load({ id: "p1" }))?.data).toMatchObject({
				metadata: { name: "second" },
			});

			const events: string[] = [];
			harness.coordinator.subscribe((event) => events.push(event.key));
			const beforeFailure = (await harness.coordinator.loadProject({
				id: "p1",
			}))!;
			const failed = structuredClone(beforeFailure);
			failed.metadata.name = "must not publish";
			control.failNext({ operation: "save-project", code: "unavailable" });
			await expect(
				harness.coordinator.saveProject({ project: failed }),
			).rejects.toMatchObject({ code: "unavailable" });
			expect(events).toEqual([]);
			expect(
				harness.coordinator.readCachedProject({ id: "p1" })?.metadata.name,
			).toBe("second");
			expect((await store.load({ id: "p1" }))?.data).toMatchObject({
				metadata: { name: "second" },
			});
			harness.coordinator.destroy();
			await harness.session.dispose();
		});
	});
}
