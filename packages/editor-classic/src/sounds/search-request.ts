import type { StoreApi } from "zustand/vanilla";
import type { SoundsStore } from "./sounds-store";
import type { SoundEffect } from "./types";

export const SOUND_SEARCH_UNAVAILABLE_MESSAGE =
	"Online sounds are not configured for this host. You can still import audio from Media or use Saved sounds.";

/** One mounted query/filter/endpoint owns both its first page and pagination. */
export function createSoundSearchRequest({
	store,
	endpoint,
	query,
	commercialOnly,
	fetchPage = fetch,
}: {
	store: Pick<StoreApi<SoundsStore>, "getState" | "setState">;
	endpoint?: string;
	query: string;
	commercialOnly: boolean;
	fetchPage?: typeof fetch;
}) {
	const search = query.trim();
	let disposed = false;
	let ready = false;
	let pending = false;
	let abort: AbortController | undefined;
	let token = store.getState().beginRequest({ channel: "search" });
	const current = () =>
		!disposed && store.getState().canPublishRequest({ token });
	const reset = () => {
		store.setState({
			searchResults: [],
			topSoundEffects: [],
			isSearching: !!endpoint && !!search,
			isLoading: !!endpoint && !search,
			isLoadingMore: false,
			searchError: endpoint ? null : SOUND_SEARCH_UNAVAILABLE_MESSAGE,
			error: endpoint ? null : SOUND_SEARCH_UNAVAILABLE_MESSAGE,
			hasLoaded: false,
			currentPage: 1,
			hasNextPage: false,
			totalCount: 0,
		});
	};
	reset();

	const request = async ({ append }: { append: boolean }) => {
		if (!endpoint || !current() || pending) return;
		if (append && (!ready || !store.getState().hasNextPage)) return;
		if (!append) {
			ready = false;
			token = store.getState().beginRequest({ channel: "search" });
			reset();
		}
		pending = true;
		abort = new AbortController();
		const page = append ? store.getState().currentPage + 1 : 1;
		store.setState({ searchError: null, error: null, isLoadingMore: append });
		try {
			// Preserve host query parameters; all pages use identical filter/sort/size.
			const url = new URL(
				endpoint,
				typeof location === "undefined"
					? "http://sound-search.invalid"
					: location.href,
			);
			url.searchParams.set("type", "effects");
			url.searchParams.set("page", String(page));
			url.searchParams.set("page_size", "50");
			url.searchParams.set("commercial_only", String(commercialOnly));
			url.searchParams.set("sort", search ? "score" : "downloads");
			if (search) url.searchParams.set("q", search);
			else url.searchParams.delete("q");
			const target =
				/^[a-z][a-z\d+.-]*:/iu.test(endpoint) || endpoint.startsWith("//")
					? url.href
					: `${url.pathname}${url.search}${url.hash}`;
			const response = await fetchPage(target, { signal: abort.signal });
			if (!current()) return;
			if (!response.ok)
				throw new Error(`Sound search failed (${response.status}).`);
			const data: {
				results: SoundEffect[];
				next: string | null;
				count: number;
			} = await response.json();
			if (!current()) return;
			if (!Array.isArray(data.results) || !Number.isFinite(data.count)) {
				throw new Error("Sound search returned an invalid response.");
			}
			const state = store.getState();
			const results = append
				? [
						...(search ? state.searchResults : state.topSoundEffects),
						...data.results,
					]
				: data.results;
			store.setState({
				...(search ? { searchResults: results } : { topSoundEffects: results }),
				lastSearchQuery: search,
				hasLoaded: true,
				currentPage: page,
				hasNextPage: !!data.next,
				totalCount: data.count,
			});
			ready = true;
		} catch (error) {
			if (current()) {
				const message =
					error instanceof Error ? error.message : "Sound search failed.";
				store.setState({ searchError: message, error: message });
			}
		} finally {
			pending = false;
			abort = undefined;
			if (current())
				store.setState({
					isSearching: false,
					isLoading: false,
					isLoadingMore: false,
				});
		}
	};

	return {
		loadFirst: () => request({ append: false }),
		loadMore: () => request({ append: true }),
		dispose: () => {
			disposed = true;
			abort?.abort();
		},
	};
}
