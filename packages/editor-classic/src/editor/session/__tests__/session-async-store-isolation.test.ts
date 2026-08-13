import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED !== "1") {
	test("session async-store suite runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated async-store suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	}, 15_000);
} else {
	await import("./wasm-test-mock");
	const { createSoundsStore } = await import("../../../sounds/sounds-store");
	const { createCustomPresetsStore } =
		await import("../../../timeline/components/graph-editor/custom-presets-store");
	const { createStickersStore } = await import("../../../stickers/stickers-store");
	const { createInMemoryHost } = await import("@opencut/editor-ports/in-memory/host");
	const { C6TestAudioBuffer, C6TestAudioContext } =
		await import("./c6-test-audio-context");
	const {
		InMemoryProjectStore,
		InMemoryProjectStoreControl,
		RecordingDiagnostics,
	} = await import("@opencut/editor-ports/in-memory");
	const { SessionPersistenceCoordinator } =
		await import("../../persistence");
	const { storesForSession } = await import("../../runtime/session-stores");
	const { editorForSession } =
		await import("../../runtime/session-core-owner");
	const { createEditorSession } = await import("../create-session");
	type SavedSoundsData = import("../../../sounds/types").SavedSoundsData;
	type SavedSound = import("../../../sounds/types").SavedSound;
	type SoundEffect = import("../../../sounds/types").SoundEffect;
	type EasingPreset =
		import("../../../timeline/components/graph-editor/easing-presets").EasingPreset;
	type StickerBrowseResult = import("../../../stickers").StickerBrowseResult;
	type StickerSearchResult = import("../../../stickers").StickerSearchResult;
	type StickerStoreQueries =
		import("../../../stickers/stickers-store").StickerStoreQueries;
	type FakeSavedSoundsMutationArgs = {
		mutate: (
			current: SavedSound[] | null,
		) => SavedSound[] | Promise<SavedSound[]>;
	};
	type FakeCustomPresetMutationArgs = {
		mutate: (
			current: EasingPreset[] | null,
		) => EasingPreset[] | Promise<EasingPreset[]>;
	};

	function deferred<Value>() {
		let resolve!: (value: Value) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<Value>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	const savedSound = (id: number): SavedSound => ({
		id,
		name: `sound-${id}`,
		username: "tester",
		duration: 1,
		tags: [],
		license: "cc0",
		savedAt: new Date(0).toISOString(),
	});
	const soundEffect = (id: number): SoundEffect => ({
		id,
		name: `sound-${id}`,
		description: "",
		url: `https://example.test/sound-${id}`,
		previewUrl: `https://example.test/sound-${id}.mp3`,
		duration: 1,
		filesize: 8,
		type: "mp3",
		channels: 2,
		bitrate: 128,
		bitdepth: 16,
		samplerate: 44_100,
		username: "tester",
		tags: [],
		license: "cc0",
		created: "2026-07-31",
		downloads: 0,
		rating: 0,
		ratingCount: 0,
	});
	const customPreset = ({
		id,
		value,
	}: {
		id: string;
		value: EasingPreset["value"];
	}): EasingPreset => ({
		id,
		label: id,
		value,
		isCustom: true,
	});
	function createDelayedPresetPersistence(initial: EasingPreset[]) {
		const staleLoad = deferred<{ data: EasingPreset[] } | null>();
		let durable = [...initial];
		let loadCalls = 0;
		return {
			staleLoad,
			staleSnapshot: [...initial],
			readDurable: () => [...durable],
			persistence: {
				loadLibraryRecord: () => {
					loadCalls += 1;
					return loadCalls === 1
						? staleLoad.promise
						: Promise.resolve({ data: [...durable] });
				},
				mutateLibraryRecord: async ({
					mutate,
				}: FakeCustomPresetMutationArgs) => {
					const next = await mutate([...durable]);
					durable = next;
					return [...next];
				},
			},
		};
	}
	async function createSharedLibrarySessions() {
		const control = new InMemoryProjectStoreControl();
		const durable = new InMemoryProjectStore({ control });
		const host = createInMemoryHost({
			projectId: "shared-library-concurrency",
			store: durable,
		});
		const sessionA = await createEditorSession({ host });
		const sessionB = await createEditorSession({ host });
		return {
			control,
			durable,
			sessionA,
			sessionB,
			storesA: storesForSession(sessionA),
			storesB: storesForSession(sessionB),
			async dispose() {
				await sessionA.dispose();
				await sessionB.dispose();
			},
		};
	}

	describe("sounds request generations", () => {
		test("rejects stale, disposed and foreign request publication", async () => {
			let disposedA = false;
			const pendingA: Array<ReturnType<typeof deferred<SavedSoundsData>>> = [];
			const persistenceA = {
				loadLibraryRecord: () => {
					const next = deferred<SavedSoundsData>();
					pendingA.push(next);
					return next.promise.then((data) => ({
						namespace: "saved-sounds",
						key: "user-sounds",
						schemaVersion: 1,
						data: data.sounds,
					}));
				},
				mutateLibraryRecord: async ({ mutate }: FakeSavedSoundsMutationArgs) =>
					mutate(null),
				clearLibraryNamespace: async () => {},
			};
			const a = createSoundsStore({
				isDisposed: () => disposedA,
				getPersistence: () => persistenceA,
			});
			const b = createSoundsStore({ getPersistence: () => persistenceA });
			const foreign = a.getState().beginRequest({ channel: "search" });
			expect(b.getState().canPublishRequest({ token: foreign })).toBe(false);
			const loadMoreToken = a.getState().beginRequest({ channel: "loadMore" });
			const deferredJson = deferred<{ results: number[] }>();
			const parseThenPublish = deferredJson.promise.then(() =>
				a.getState().canPublishRequest({ token: loadMoreToken }),
			);
			a.getState().beginRequest({ channel: "search" });
			deferredJson.resolve({ results: [1] });
			expect(await parseThenPublish).toBe(false);

			const first = a.getState().loadSavedSounds();
			const second = a.getState().loadSavedSounds();
			pendingA[1].resolve({ sounds: [savedSound(2)], lastModified: "new" });
			await second;
			pendingA[0].resolve({ sounds: [savedSound(1)], lastModified: "old" });
			await first;
			expect(a.getState().savedSounds.map((sound) => sound.id)).toEqual([2]);

			a.setState({ isSavedSoundsLoaded: false });
			const disposedRequest = a.getState().loadSavedSounds();
			disposedA = true;
			pendingA[2].resolve({
				sounds: [savedSound(3)],
				lastModified: "disposed",
			});
			await disposedRequest;
			expect(a.getState().savedSounds.map((sound) => sound.id)).toEqual([2]);
		});

		test("saved loads and serialized mutations keep loading and storage reconciled", async () => {
			const staleLoad = deferred<SavedSoundsData>();
			let durable = [savedSound(2)];
			let loadCalls = 0;
			const persistence = {
				loadLibraryRecord: () => {
					loadCalls += 1;
					const value =
						loadCalls === 1
							? staleLoad.promise
							: Promise.resolve({
									sounds: [...durable],
									lastModified: `load-${loadCalls}`,
								});
					return value.then((data) => ({
						namespace: "saved-sounds",
						key: "user-sounds",
						schemaVersion: 1,
						data: data.sounds,
					}));
				},
				mutateLibraryRecord: async ({
					mutate,
				}: FakeSavedSoundsMutationArgs) => {
					const next = await mutate([...durable]);
					durable = next;
					return next;
				},
				clearLibraryNamespace: async () => {
					durable = [];
				},
			};
			const store = createSoundsStore({ getPersistence: () => persistence });
			const loading = store.getState().loadSavedSounds();
			expect(store.getState().isLoadingSavedSounds).toBe(true);
			await store.getState().saveSoundEffect({ soundEffect: soundEffect(2) });
			expect(store.getState()).toMatchObject({
				isLoadingSavedSounds: false,
				isSavedSoundsLoaded: true,
			});
			expect(store.getState().savedSounds.map((sound) => sound.id)).toEqual([
				2,
			]);
			staleLoad.resolve({
				sounds: [savedSound(1)],
				lastModified: "stale",
			});
			await loading;
			expect(store.getState()).toMatchObject({
				isLoadingSavedSounds: false,
				isSavedSoundsLoaded: true,
			});
			expect(store.getState().savedSounds.map((sound) => sound.id)).toEqual([
				2,
			]);

			const saveGate = deferred<void>();
			const removeGate = deferred<void>();
			const events: string[] = [];
			let mutationCalls = 0;
			const firstMutationStarted = deferred<void>();
			const serializedPersistence = {
				loadLibraryRecord: async () => ({
					namespace: "saved-sounds",
					key: "user-sounds",
					schemaVersion: 1,
					data: [...durable],
				}),
				mutateLibraryRecord: async ({
					mutate,
				}: FakeSavedSoundsMutationArgs) => {
					const next = await mutate([...durable]);
					const isRemove = mutationCalls++ > 0;
					events.push(isRemove ? "remove:start" : "save:start");
					if (!isRemove) firstMutationStarted.resolve();
					await (isRemove ? removeGate.promise : saveGate.promise);
					durable = next;
					events.push(isRemove ? "remove:end" : "save:end");
					return next;
				},
				clearLibraryNamespace: async () => {
					durable = [];
				},
			};
			const serialized = createSoundsStore({
				getPersistence: () => serializedPersistence,
			});
			const save = serialized
				.getState()
				.saveSoundEffect({ soundEffect: soundEffect(3) });
			const remove = serialized.getState().removeSavedSound({ soundId: 3 });
			await firstMutationStarted.promise;
			expect(events).toEqual(["save:start"]);
			removeGate.resolve();
			expect(events).toEqual(["save:start"]);
			saveGate.resolve();
			await Promise.all([save, remove]);
			expect(events).toEqual([
				"save:start",
				"save:end",
				"remove:start",
				"remove:end",
			]);
			expect(serialized.getState().savedSounds).toEqual(durable);
			expect(serialized.getState()).toMatchObject({
				isLoadingSavedSounds: false,
				isSavedSoundsLoaded: true,
			});
		});

		test("overlapping timeline commands all insert until their store is disposed", async () => {
			let disposed = false;
			const store = createSoundsStore({ isDisposed: () => disposed });
			const fetches = new Map<string, ReturnType<typeof deferred<Response>>>();
			const inserted: string[] = [];
			const host = createInMemoryHost({ projectId: "overlapping-sounds" });
			const createAudioContext = host.runtimeResources.createAudioContext.bind(
				host.runtimeResources,
			);
			host.runtimeResources.createAudioContext = (args) => {
				const handle = createAudioContext(args);
				return {
					...handle,
					context: new C6TestAudioContext(),
				};
			};
			const session = await createEditorSession({
				host,
			});
			const editor = editorForSession(session);
			editor.timeline.insertElement = ({ element }) => {
				inserted.push(element.name);
			};
			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(
				async (input: string | URL | Request) => {
					const url = String(input);
					const pending = deferred<Response>();
					fetches.set(url, pending);
					return pending.promise;
				},
				{ preconnect: () => {} },
			) as typeof fetch;

			try {
				const first = store
					.getState()
					.addSoundToTimeline({ sound: soundEffect(1), editor });
				const second = store
					.getState()
					.addSoundToTimeline({ sound: soundEffect(2), editor });
				fetches
					.get("https://example.test/sound-2.mp3")!
					.resolve(new Response(new ArrayBuffer(8)));
				fetches
					.get("https://example.test/sound-1.mp3")!
					.resolve(new Response(new ArrayBuffer(8)));
				expect(await Promise.all([first, second])).toEqual([true, true]);
				expect(inserted.toSorted()).toEqual(["sound-1", "sound-2"]);

				const late = store
					.getState()
					.addSoundToTimeline({ sound: soundEffect(3), editor });
				disposed = true;
				fetches
					.get("https://example.test/sound-3.mp3")!
					.resolve(new Response(new ArrayBuffer(8)));
				expect(await late).toBe(false);
				expect(inserted.toSorted()).toEqual(["sound-1", "sound-2"]);
			} finally {
				globalThis.fetch = originalFetch;
				await session.dispose();
			}
		});

		test("a delayed sound decode cannot publish across suspend and a resumed generation inserts freshly", async () => {
			const store = createSoundsStore();
			const inserted: string[] = [];
			const decodeEntered = deferred<void>();
			const heldDecode = deferred<AudioBuffer>();
			class HeldDecodeAudioContext extends C6TestAudioContext {
				// eslint-disable-next-line opencut/prefer-object-params -- implements the Web Audio API
				override async decodeAudioData(
					_audioData: ArrayBuffer,
					_successCallback?: DecodeSuccessCallback | null,
					_errorCallback?: DecodeErrorCallback | null,
				): Promise<AudioBuffer> {
					decodeEntered.resolve();
					return heldDecode.promise;
				}
			}

			const host = createInMemoryHost({ projectId: "sound-audio-generation" });
			const createAudioContext = host.runtimeResources.createAudioContext.bind(
				host.runtimeResources,
			);
			let audioContextCount = 0;
			host.runtimeResources.createAudioContext = (args) => {
				const handle = createAudioContext(args);
				const context =
					audioContextCount++ === 0
						? new HeldDecodeAudioContext()
						: new C6TestAudioContext();
				return { ...handle, context };
			};
			const session = await createEditorSession({ host });
			const editor = editorForSession(session);
			editor.timeline.insertElement = ({ element }) => {
				inserted.push(element.name);
			};
			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(
				async () => new Response(new ArrayBuffer(8)),
				{ preconnect: () => {} },
			) as typeof fetch;

			try {
				const stale = store
					.getState()
					.addSoundToTimeline({ sound: soundEffect(51), editor });
				await decodeEntered.promise;
				await session.suspend();
				heldDecode.resolve(new C6TestAudioBuffer());
				expect(await stale).toBe(false);
				expect(inserted).toEqual([]);

				await session.resume();
				expect(
					await store
						.getState()
						.addSoundToTimeline({ sound: soundEffect(52), editor }),
				).toBe(true);
				expect(inserted).toEqual(["sound-52"]);
			} finally {
				globalThis.fetch = originalFetch;
				heldDecode.resolve(new C6TestAudioBuffer());
				await session.dispose();
			}
		});
	});

	describe("session-owned durable libraries", () => {
		test("an older preset load cannot overwrite a later successful save", async () => {
			const fixture = createDelayedPresetPersistence([]);
			const store = createCustomPresetsStore({
				getPersistence: () => fixture.persistence,
			});

			const olderLoad = store.getState().load();
			await store.getState().savePreset({ value: [0.15, 0.25, 0.35, 0.45] });
			const committed = fixture.readDurable();
			expect(committed).toHaveLength(1);
			expect(store.getState().presets).toEqual(committed);

			fixture.staleLoad.resolve({ data: fixture.staleSnapshot });
			await olderLoad;
			expect(store.getState().presets).toEqual(committed);
			expect(store.getState().hasLoaded).toBe(true);

			await store.getState().load();
			expect(store.getState().presets).toEqual(committed);
		});

		test("an older preset load cannot restore a preset removed later", async () => {
			const removed = customPreset({
				id: "remove-me",
				value: [0.1, 0.2, 0.3, 0.4],
			});
			const kept = customPreset({
				id: "keep-me",
				value: [0.5, 0.6, 0.7, 0.8],
			});
			const fixture = createDelayedPresetPersistence([removed, kept]);
			const store = createCustomPresetsStore({
				getPersistence: () => fixture.persistence,
			});

			const olderLoad = store.getState().load();
			await store.getState().removePreset({ id: removed.id });
			expect(fixture.readDurable()).toEqual([kept]);
			expect(store.getState().presets).toEqual([kept]);

			fixture.staleLoad.resolve({ data: fixture.staleSnapshot });
			await olderLoad;
			expect(store.getState().presets).toEqual([kept]);

			await store.getState().load();
			expect(store.getState().presets).toEqual([kept]);
		});

		test("two complete sessions preserve concurrent saved-sound updates and reload the union", async () => {
			const shared = await createSharedLibrarySessions();
			const paused = shared.control.pauseNext({
				operation: "save-library-record",
			});
			try {
				const first = shared.storesA.sounds
					.getState()
					.saveSoundEffect({ soundEffect: soundEffect(201) });
				await paused.entered;
				const second = shared.storesB.sounds
					.getState()
					.saveSoundEffect({ soundEffect: soundEffect(202) });
				paused.release();
				await Promise.all([first, second]);

				shared.storesA.sounds.setState({ isSavedSoundsLoaded: false });
				shared.storesB.sounds.setState({ isSavedSoundsLoaded: false });
				await Promise.all([
					shared.storesA.sounds.getState().loadSavedSounds(),
					shared.storesB.sounds.getState().loadSavedSounds(),
				]);
				const expected = [201, 202];
				expect(
					shared.storesA.sounds
						.getState()
						.savedSounds.map(({ id }) => id)
						.toSorted(),
				).toEqual(expected);
				expect(
					shared.storesB.sounds
						.getState()
						.savedSounds.map(({ id }) => id)
						.toSorted(),
				).toEqual(expected);
			} finally {
				paused.release();
				await shared.dispose();
			}
		});

		test("two complete sessions preserve concurrent custom presets and reload the union", async () => {
			const shared = await createSharedLibrarySessions();
			const paused = shared.control.pauseNext({
				operation: "save-library-record",
			});
			const firstValue = [0.11, 0.22, 0.33, 0.44] as const;
			const secondValue = [0.55, 0.66, 0.77, 0.88] as const;
			try {
				const first = shared.storesA.customPresets
					.getState()
					.savePreset({ value: [...firstValue] });
				await paused.entered;
				const second = shared.storesB.customPresets
					.getState()
					.savePreset({ value: [...secondValue] });
				paused.release();
				await Promise.all([first, second]);

				await Promise.all([
					shared.storesA.customPresets.getState().load(),
					shared.storesB.customPresets.getState().load(),
				]);
				const expected = [firstValue.join(","), secondValue.join(",")];
				for (const stores of [shared.storesA, shared.storesB]) {
					expect(
						stores.customPresets
							.getState()
							.presets.map(({ value }) => value.join(","))
							.toSorted(),
					).toEqual(expected);
				}
			} finally {
				paused.release();
				await shared.dispose();
			}
		});

		test("a failed shared library mutation does not poison either session's next update", async () => {
			const shared = await createSharedLibrarySessions();
			try {
				shared.control.failNext({
					operation: "save-library-record",
					code: "quota-exceeded",
				});
				const failedSound = shared.storesA.sounds
					.getState()
					.saveSoundEffect({ soundEffect: soundEffect(301) });
				const recoveredSound = shared.storesB.sounds
					.getState()
					.saveSoundEffect({ soundEffect: soundEffect(302) });
				await expect(failedSound).rejects.toThrow("quota-exceeded");
				await recoveredSound;

				shared.control.failNext({
					operation: "save-library-record",
					code: "conflict",
				});
				const failedPreset = shared.storesA.customPresets
					.getState()
					.savePreset({ value: [0.1, 0.2, 0.3, 0.4] });
				const recoveredPreset = shared.storesB.customPresets
					.getState()
					.savePreset({ value: [0.5, 0.6, 0.7, 0.8] });
				await expect(failedPreset).rejects.toThrow("conflict");
				await recoveredPreset;

				shared.storesA.sounds.setState({ isSavedSoundsLoaded: false });
				shared.storesB.sounds.setState({ isSavedSoundsLoaded: false });
				await Promise.all([
					shared.storesA.sounds.getState().loadSavedSounds(),
					shared.storesB.sounds.getState().loadSavedSounds(),
					shared.storesA.customPresets.getState().load(),
					shared.storesB.customPresets.getState().load(),
				]);
				for (const stores of [shared.storesA, shared.storesB]) {
					expect(
						stores.sounds.getState().savedSounds.map(({ id }) => id),
					).toEqual([302]);
					expect(
						stores.customPresets.getState().presets.map(({ value }) => value),
					).toEqual([[0.5, 0.6, 0.7, 0.8]]);
				}
			} finally {
				await shared.dispose();
			}
		});

		test("a paused saved-sound mutation does not lock the preset namespace", async () => {
			const shared = await createSharedLibrarySessions();
			const paused = shared.control.pauseNext({
				operation: "save-library-record",
			});
			let soundMutation: Promise<void> | undefined;
			let presetMutation: Promise<void> | undefined;
			try {
				soundMutation = shared.storesA.sounds
					.getState()
					.saveSoundEffect({ soundEffect: soundEffect(401) });
				await paused.entered;
				presetMutation = shared.storesB.customPresets
					.getState()
					.savePreset({ value: [0.4, 0.3, 0.2, 0.1] });
				const outcome = await Promise.race([
					presetMutation.then(() => "preset-committed" as const),
					Bun.sleep(1_000).then(() => "blocked" as const),
				]);
				expect(outcome).toBe("preset-committed");
			} finally {
				paused.release();
				await Promise.allSettled(
					[soundMutation, presetMutation].filter(
						(value): value is Promise<void> => value !== undefined,
					),
				);
				await shared.dispose();
			}
		});

		test("custom presets share committed durability but not live StoreApi state", async () => {
			const durable = new InMemoryProjectStore();
			const coordinatorA = new SessionPersistenceCoordinator(durable);
			const coordinatorB = new SessionPersistenceCoordinator(durable);
			const a = createCustomPresetsStore({
				getPersistence: () => coordinatorA,
			});
			const b = createCustomPresetsStore({
				getPersistence: () => coordinatorB,
			});

			const first = a.getState().savePreset({ value: [0.1, 0.2, 0.3, 0.4] });
			const second = a.getState().savePreset({ value: [0.2, 0.3, 0.4, 0.5] });
			await Promise.all([first, second]);
			expect(a.getState().presets).toHaveLength(2);
			expect(b.getState().presets).toEqual([]);

			await b.getState().load();
			expect(b.getState().presets.map((preset) => preset.value)).toEqual([
				[0.1, 0.2, 0.3, 0.4],
				[0.2, 0.3, 0.4, 0.5],
			]);
			expect(b).not.toBe(a);

			const soundsA = createSoundsStore({
				getPersistence: () => coordinatorA,
			});
			const soundsB = createSoundsStore({
				getPersistence: () => coordinatorB,
			});
			await soundsA
				.getState()
				.saveSoundEffect({ soundEffect: soundEffect(41) });
			expect(soundsA.getState().savedSounds.map((sound) => sound.id)).toEqual([
				41,
			]);
			expect(soundsB.getState().savedSounds).toEqual([]);
			await soundsB.getState().loadSavedSounds();
			expect(soundsB.getState().savedSounds.map((sound) => sound.id)).toEqual([
				41,
			]);
			const events: string[] = [];
			coordinatorA.subscribe((event) =>
				events.push(`${event.kind}:${event.key}`),
			);
			await soundsA.getState().clearSavedSounds();
			expect(
				await durable.loadLibraryRecord({
					namespace: "saved-sounds",
					key: "user-sounds",
				}),
			).toBeNull();
			expect(
				await durable.loadLibraryRecord({
					namespace: "graph-editor-presets",
					key: "user-presets",
				}),
			).not.toBeNull();
			expect(events).toContain("clear:saved-sounds");
			coordinatorA.destroy();
			coordinatorB.destroy();
		});

		test("library failures reject, stay visible, and report no payload", async () => {
			const reports: unknown[] = [];
			const secret = "SECRET-SAVED-SOUND-PAYLOAD";
			const persistence = {
				loadLibraryRecord: async () => null,
				mutateLibraryRecord: async () => {
					throw Object.assign(new Error(secret), { code: "quota-exceeded" });
				},
				clearLibraryNamespace: async () => {},
			};
			const store = createSoundsStore({
				getPersistence: () => persistence,
				reportPersistenceFailure: (failure) => reports.push(failure),
			});

			await expect(
				store.getState().saveSoundEffect({ soundEffect: soundEffect(99) }),
			).rejects.toThrow(secret);
			expect(store.getState().savedSounds).toEqual([]);
			expect(store.getState().savedSoundsError).toMatch(/retry/i);
			expect(JSON.stringify(reports)).not.toContain(secret);
			expect(reports).toEqual([
				{
					library: "saved-sounds",
					operation: "save",
					code: "quota-exceeded",
				},
			]);

			const presetReports: unknown[] = [];
			const presetStore = createCustomPresetsStore({
				getPersistence: () => ({
					loadLibraryRecord: async () => ({
						namespace: "graph-editor-presets",
						key: "user-presets",
						schemaVersion: 1,
						data: [],
					}),
					mutateLibraryRecord: async () => {
						throw Object.assign(new Error(secret), { code: "conflict" });
					},
				}),
				reportPersistenceFailure: (failure) => presetReports.push(failure),
			});
			await expect(
				presetStore.getState().savePreset({ value: [0.1, 0.2, 0.3, 0.4] }),
			).rejects.toThrow(secret);
			expect(presetStore.getState().presets).toEqual([]);
			expect(presetStore.getState().error).toMatch(/retry/i);
			expect(JSON.stringify(presetReports)).not.toContain(secret);
			expect(presetReports).toEqual([
				{
					library: "graph-editor-presets",
					operation: "save",
					code: "conflict",
				},
			]);
		});

		test("library failures reach the owning session diagnostics channel", async () => {
			const control = new InMemoryProjectStoreControl();
			const durable = new InMemoryProjectStore({ control });
			const host = createInMemoryHost({ store: durable });
			if (!(host.diagnostics instanceof RecordingDiagnostics)) {
				throw new Error("in-memory Host diagnostics are not inspectable");
			}
			const session = await createEditorSession({ host });

			try {
				const stores = storesForSession(session);
				control.failNext({
					operation: "save-library-record",
					code: "quota-exceeded",
				});
				await expect(
					stores.sounds
						.getState()
						.saveSoundEffect({ soundEffect: soundEffect(100) }),
				).rejects.toThrow("quota-exceeded");
				expect(stores.sounds.getState().savedSounds).toEqual([]);
				expect(stores.sounds.getState().savedSoundsError).toMatch(/retry/i);

				control.failNext({
					operation: "save-library-record",
					code: "conflict",
				});
				await expect(
					stores.customPresets
						.getState()
						.savePreset({ value: [0.1, 0.2, 0.3, 0.4] }),
				).rejects.toThrow("conflict");
				expect(stores.customPresets.getState().presets).toEqual([]);
				expect(stores.customPresets.getState().error).toMatch(/retry/i);

				expect(host.diagnostics.logs.slice(-2)).toEqual([
					{
						level: "error",
						message: "Durable editor library operation failed",
						context: {
							library: "saved-sounds",
							operation: "save",
							code: "quota-exceeded",
						},
					},
					{
						level: "error",
						message: "Durable editor library operation failed",
						context: {
							library: "graph-editor-presets",
							operation: "save",
							code: "conflict",
						},
					},
				]);
			} finally {
				await session.dispose();
			}
		});

		test("namespace clear waits for prior records and does not block another library", async () => {
			const control = new InMemoryProjectStoreControl();
			const durable = new InMemoryProjectStore({ control });
			const coordinator = new SessionPersistenceCoordinator(durable);
			const paused = control.pauseNext({ operation: "save-library-record" });
			const saveSound = coordinator.saveLibraryRecord({
				namespace: "saved-sounds",
				key: "user-sounds",
				schemaVersion: 1,
				data: { sounds: [savedSound(7)] },
			});
			await paused.entered;
			const clearSounds = coordinator.clearLibraryNamespace({
				namespace: "saved-sounds",
			});
			await coordinator.saveLibraryRecord({
				namespace: "graph-editor-presets",
				key: "user-presets",
				schemaVersion: 1,
				data: { presets: [] },
			});
			expect(
				await durable.loadLibraryRecord({
					namespace: "graph-editor-presets",
					key: "user-presets",
				}),
			).not.toBeNull();
			paused.release();
			await Promise.all([saveSound, clearSounds]);
			expect(
				await durable.loadLibraryRecord({
					namespace: "saved-sounds",
					key: "user-sounds",
				}),
			).toBeNull();
			coordinator.destroy();
		});
	});

	function browseResult(id: string): StickerBrowseResult {
		return {
			sections: [{ id, items: [], layout: "grid" }],
		};
	}

	describe("stickers request generations", () => {
		test("publishes only the newest request in its owning live store", async () => {
			let disposedA = false;
			const searches: Array<ReturnType<typeof deferred<StickerBrowseResult>>> =
				[];
			const browses: Array<ReturnType<typeof deferred<StickerBrowseResult>>> =
				[];
			const emptySearch: StickerSearchResult = {
				items: [],
				total: 0,
				hasMore: false,
			};
			const queries: StickerStoreQueries = {
				searchAll: async () => {
					const next = deferred<StickerBrowseResult>();
					searches.push(next);
					return next.promise;
				},
				searchStickers: async () => emptySearch,
				browseAll: async () => {
					const next = deferred<StickerBrowseResult>();
					browses.push(next);
					return next.promise;
				},
				browseCategory: async () => browseResult("category"),
			};
			const a = createStickersStore({ isDisposed: () => disposedA, queries });
			const b = createStickersStore({ queries });

			const oldRequest = a.getState().searchStickers({ query: "old" });
			const newRequest = a.getState().searchStickers({ query: "new" });
			searches[1].resolve(browseResult("new"));
			await newRequest;
			searches[0].resolve(browseResult("old"));
			await oldRequest;
			expect(a.getState().browseContent?.sections[0]?.id).toBe("new");
			expect(b.getState().browseContent).toBeNull();

			const staleSearch = a
				.getState()
				.searchStickers({ query: "search-first" });
			const currentBrowse = a.getState().browseStickers();
			expect(a.getState()).toMatchObject({
				viewMode: "browse",
				isSearching: false,
				isBrowsing: true,
			});
			searches[2].resolve(browseResult("stale-search"));
			await staleSearch;
			expect(a.getState()).toMatchObject({
				viewMode: "browse",
				isSearching: false,
				isBrowsing: true,
			});
			browses[0].resolve(browseResult("current-browse"));
			await currentBrowse;
			expect(a.getState().browseContent?.sections[0]?.id).toBe(
				"current-browse",
			);
			expect(a.getState()).toMatchObject({
				viewMode: "browse",
				isSearching: false,
				isBrowsing: false,
			});

			const staleBrowse = a.getState().browseStickers();
			const currentSearch = a
				.getState()
				.searchStickers({ query: "search-last" });
			expect(a.getState()).toMatchObject({
				viewMode: "search",
				isSearching: true,
				isBrowsing: false,
			});
			browses[1].resolve(browseResult("stale-browse"));
			await staleBrowse;
			expect(a.getState()).toMatchObject({
				viewMode: "search",
				isSearching: true,
				isBrowsing: false,
			});
			searches[3].resolve(browseResult("current-search"));
			await currentSearch;
			expect(a.getState().browseContent?.sections[0]?.id).toBe(
				"current-search",
			);
			expect(a.getState()).toMatchObject({
				viewMode: "search",
				isSearching: false,
				isBrowsing: false,
			});

			const disposedRequest = a
				.getState()
				.searchStickers({ query: "disposed" });
			disposedA = true;
			searches[4].resolve(browseResult("disposed"));
			await disposedRequest;
			expect(a.getState().browseContent?.sections[0]?.id).toBe(
				"current-search",
			);
		});
	});
}
