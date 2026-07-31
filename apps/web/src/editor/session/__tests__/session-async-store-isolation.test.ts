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
	});
} else {
	await import("./wasm-test-mock");
	const { createSoundsStore } = await import("@/sounds/sounds-store");
	const { createStickersStore } = await import("@/stickers/stickers-store");
	const { createInMemoryHost } = await import("@/editor/ports/in-memory/host");
	const { editorForSession } =
		await import("@/editor/runtime/session-core-owner");
	const { createEditorSession } = await import("../create-session");
	type SavedSoundsData = import("@/sounds/types").SavedSoundsData;
	type SoundEffect = import("@/sounds/types").SoundEffect;
	type StickerBrowseResult = import("@/stickers").StickerBrowseResult;
	type StickerSearchResult = import("@/stickers").StickerSearchResult;
	type StickerStoreQueries =
		import("@/stickers/stickers-store").StickerStoreQueries;

	function deferred<Value>() {
		let resolve!: (value: Value) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<Value>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	const savedSound = (id: number) => ({
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

	describe("sounds request generations", () => {
		test("rejects stale, disposed and foreign request publication", async () => {
			let disposedA = false;
			const pendingA: Array<ReturnType<typeof deferred<SavedSoundsData>>> = [];
			const storageA = {
				loadSavedSounds: () => {
					const next = deferred<SavedSoundsData>();
					pendingA.push(next);
					return next.promise;
				},
				saveSoundEffect: async () => {},
				removeSavedSound: async () => {},
				clearSavedSounds: async () => {},
			};
			const a = createSoundsStore({
				isDisposed: () => disposedA,
				storage: storageA,
			});
			const b = createSoundsStore({ storage: storageA });
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
			const storage = {
				loadSavedSounds: () => {
					loadCalls += 1;
					return loadCalls === 1
						? staleLoad.promise
						: Promise.resolve({
								sounds: [...durable],
								lastModified: `load-${loadCalls}`,
							});
				},
				saveSoundEffect: async ({
					soundEffect: sound,
				}: {
					soundEffect: SoundEffect;
				}) => {
					durable = [savedSound(sound.id)];
				},
				removeSavedSound: async ({ soundId }: { soundId: number }) => {
					durable = durable.filter((sound) => sound.id !== soundId);
				},
				clearSavedSounds: async () => {
					durable = [];
				},
			};
			const store = createSoundsStore({ storage });
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
			const serializedStorage = {
				loadSavedSounds: async () => ({
					sounds: [...durable],
					lastModified: "serialized",
				}),
				saveSoundEffect: async ({
					soundEffect: sound,
				}: {
					soundEffect: SoundEffect;
				}) => {
					events.push("save:start");
					await saveGate.promise;
					durable = [savedSound(sound.id)];
					events.push("save:end");
				},
				removeSavedSound: async ({ soundId }: { soundId: number }) => {
					events.push("remove:start");
					await removeGate.promise;
					durable = durable.filter((sound) => sound.id !== soundId);
					events.push("remove:end");
				},
				clearSavedSounds: async () => {
					durable = [];
				},
			};
			const serialized = createSoundsStore({ storage: serializedStorage });
			const save = serialized
				.getState()
				.saveSoundEffect({ soundEffect: soundEffect(3) });
			const remove = serialized.getState().removeSavedSound({ soundId: 3 });
			await Promise.resolve();
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
			const session = await createEditorSession({
				host: createInMemoryHost({ projectId: "overlapping-sounds" }),
			});
			const editor = editorForSession(session);
			editor.timeline.insertElement = ({ element }) => {
				inserted.push(element.name);
			};
			const originalFetch = globalThis.fetch;
			const audioContextDescriptor = Object.getOwnPropertyDescriptor(
				globalThis,
				"AudioContext",
			);
			globalThis.fetch = Object.assign(
				async (input: string | URL | Request) => {
					const url = String(input);
					const pending = deferred<Response>();
					fetches.set(url, pending);
					return pending.promise;
				},
				{ preconnect: () => {} },
			) as typeof fetch;
			Object.defineProperty(globalThis, "AudioContext", {
				configurable: true,
				writable: true,
				value: class {
					async decodeAudioData() {
						return { duration: 1 };
					}
				},
			});

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
				if (audioContextDescriptor) {
					Object.defineProperty(
						globalThis,
						"AudioContext",
						audioContextDescriptor,
					);
				} else {
					Reflect.deleteProperty(globalThis, "AudioContext");
				}
				await session.dispose();
			}
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
