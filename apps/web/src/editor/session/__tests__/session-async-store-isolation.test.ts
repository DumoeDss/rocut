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
	type SavedSoundsData = import("@/sounds/types").SavedSoundsData;
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
			searches[2].resolve(browseResult("stale-search"));
			await staleSearch;
			browses[0].resolve(browseResult("current-browse"));
			await currentBrowse;
			expect(a.getState().browseContent?.sections[0]?.id).toBe(
				"current-browse",
			);

			const staleBrowse = a.getState().browseStickers();
			const currentSearch = a
				.getState()
				.searchStickers({ query: "search-last" });
			browses[1].resolve(browseResult("stale-browse"));
			await staleBrowse;
			searches[3].resolve(browseResult("current-search"));
			await currentSearch;
			expect(a.getState().browseContent?.sections[0]?.id).toBe(
				"current-search",
			);

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
