import { expect, test } from "bun:test";
import { createSoundsStore } from "../sounds-store";
import {
	createSoundSearchRequest,
	SOUND_SEARCH_UNAVAILABLE_MESSAGE,
} from "../search-request";

const payload = (name: string) => ({
	results: [{ id: name.length, name }],
	count: 100,
	next: "more",
});
const response = ({
	name,
	next = "more",
}: {
	name: string;
	next?: string | null;
}) => Response.json({ ...payload(name), next });
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("initial search and appended pages share filter, size and query without duplicate requests", async () => {
	const store = createSoundsStore();
	const urls: URL[] = [];
	const pending = deferred<Response>();
	const search = createSoundSearchRequest({
		store,
		endpoint: "/sounds?provider=test",
		query: "  thunder & wind  ",
		commercialOnly: false,
		fetchPage: async (input) => {
			urls.push(new URL(String(input), "http://test.invalid"));
			return urls.length === 1 ? response({ name: "first" }) : pending.promise;
		},
	});
	await search.loadMore();
	expect(urls).toHaveLength(0);
	await search.loadFirst();
	const more = search.loadMore();
	await search.loadMore();
	expect(urls).toHaveLength(2);
	pending.resolve(response({ name: "second", next: null }));
	await more;
	expect(urls.map((url) => Object.fromEntries(url.searchParams))).toEqual(
		[1, 2].map((page) => ({
			provider: "test",
			type: "effects",
			page: String(page),
			page_size: "50",
			commercial_only: "false",
			sort: "score",
			q: "thunder & wind",
		})),
	);
	expect(store.getState().searchResults.map((sound) => sound.name)).toEqual([
		"first",
		"second",
	]);
	expect(store.getState().currentPage).toBe(2);
	expect(store.getState().hasNextPage).toBe(false);
	search.dispose();
});

test("popular pages use the same commercial filter and order and whitespace is not a search", async () => {
	const store = createSoundsStore();
	const urls: URL[] = [];
	const search = createSoundSearchRequest({
		store,
		endpoint: "/sounds",
		query: "  ",
		commercialOnly: true,
		fetchPage: async (input) => {
			urls.push(new URL(String(input), "http://test.invalid"));
			return response({ name: String(urls.length) });
		},
	});
	await search.loadFirst();
	await search.loadMore();
	expect(urls.map((url) => Object.fromEntries(url.searchParams))).toEqual(
		[1, 2].map((page) => ({
			type: "effects",
			page: String(page),
			page_size: "50",
			commercial_only: "true",
			sort: "downloads",
		})),
	);
	expect(store.getState().topSoundEffects.map((sound) => sound.name)).toEqual([
		"1",
		"2",
	]);
	expect(store.getState().searchResults).toEqual([]);
});

test("changing filter or endpoint for the same query clears old results and rejects old decoded pages", async () => {
	const store = createSoundsStore();
	const json = deferred<ReturnType<typeof payload>>();
	let aborted = false;
	let requests = 0;
	const old = createSoundSearchRequest({
		store,
		endpoint: "/old",
		query: "rain",
		commercialOnly: false,
		fetchPage: async (_input, init) => {
			init?.signal?.addEventListener("abort", () => {
				aborted = true;
			});
			requests++;
			if (requests === 1) return response({ name: "noncommercial" });
			const value = response({ name: "unused" });
			value.json = () => json.promise;
			return value;
		},
	});
	await old.loadFirst();
	const loading = old.loadMore();
	await Promise.resolve();
	old.dispose();
	expect(aborted).toBe(true);
	const fresh = createSoundSearchRequest({
		store,
		endpoint: "/new",
		query: "rain",
		commercialOnly: true,
		fetchPage: async () => response({ name: "commercial", next: null }),
	});
	expect(store.getState().searchResults).toEqual([]);
	await fresh.loadFirst();
	json.resolve(payload("stale noncommercial"));
	await loading;
	expect(store.getState().searchResults.map((sound) => sound.name)).toEqual([
		"commercial",
	]);
	expect(store.getState().currentPage).toBe(1);
	expect(store.getState().isLoadingMore).toBe(false);
});

test("failed pagination preserves rows and retries the same page without advancing", async () => {
	const store = createSoundsStore();
	let calls = 0;
	const pages: string[] = [];
	const search = createSoundSearchRequest({
		store,
		endpoint: "/sounds",
		query: "rain",
		commercialOnly: true,
		fetchPage: async (input) => {
			pages.push(
				new URL(String(input), "http://test.invalid").searchParams.get("page")!,
			);
			return ++calls === 2
				? new Response(null, { status: 503 })
				: response({ name: String(calls) });
		},
	});
	await search.loadFirst();
	await search.loadMore();
	expect(store.getState().searchResults.map((sound) => sound.name)).toEqual([
		"1",
	]);
	expect(store.getState().searchError).toContain("503");
	expect(store.getState().currentPage).toBe(1);
	await search.loadMore();
	expect(pages).toEqual(["1", "2", "2"]);
	expect(store.getState().searchError).toBeNull();
	expect(store.getState().searchResults.map((sound) => sound.name)).toEqual([
		"1",
		"3",
	]);
});

test("unavailable service performs no request and leaves no stale spinner or pagination", async () => {
	const store = createSoundsStore();
	store.setState({
		isSearching: true,
		isLoadingMore: true,
		currentPage: 4,
		hasNextPage: true,
	});
	const search = createSoundSearchRequest({
		store,
		query: "rain",
		commercialOnly: true,
		fetchPage: async () => {
			throw new Error("must not fetch");
		},
	});
	await search.loadFirst();
	await search.loadMore();
	expect(store.getState().searchError).toBe(SOUND_SEARCH_UNAVAILABLE_MESSAGE);
	expect(store.getState().isSearching).toBe(false);
	expect(store.getState().isLoadingMore).toBe(false);
	expect(store.getState().hasNextPage).toBe(false);
});

test("empty results finish once; disposed or invalidated requests cannot publish", async () => {
	let disposed = false;
	const store = createSoundsStore({ isDisposed: () => disposed });
	const pending = deferred<Response>();
	const search = createSoundSearchRequest({
		store,
		endpoint: "/sounds",
		query: "none",
		commercialOnly: true,
		fetchPage: async () => pending.promise,
	});
	const loading = search.loadFirst();
	disposed = true;
	pending.resolve(response({ name: "too late" }));
	await loading;
	expect(store.getState().searchResults).toEqual([]);
	disposed = false;
	const empty = createSoundSearchRequest({
		store,
		endpoint: "/sounds",
		query: "none",
		commercialOnly: true,
		fetchPage: async () => Response.json({ results: [], count: 0, next: null }),
	});
	await empty.loadFirst();
	expect(store.getState().hasLoaded).toBe(true);
	expect(store.getState().isSearching).toBe(false);
	expect(store.getState().hasNextPage).toBe(false);
});
