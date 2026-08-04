import { useEffect } from "react";
import { useSoundsStore } from "@/editor/use-session-store";
import { useEditorHostServices } from "@/editor/host/editor-host-context";
import { useEditorSession } from "@/editor/session/editor-session-provider";

/**
 * Shown when the host has no sound-search endpoint. Stated rather than
 * discovered: against a static build with an SPA fallback, requesting a missing
 * API route returns `index.html` with HTTP 200, so letting the fetch "fail
 * naturally" surfaces a JSON parse error instead of a usable diagnostic.
 */
export const SOUND_SEARCH_UNAVAILABLE_MESSAGE =
	"Sound search requires a server endpoint, which this host does not provide.";

export function useSoundSearch({
	query,
	commercialOnly,
}: {
	query: string;
	commercialOnly: boolean;
}) {
	const {
		searchResults,
		isSearching,
		searchError,
		lastSearchQuery,
		currentPage,
		hasNextPage,
		isLoadingMore,
		totalCount,
		setSearchResults,
		setSearching,
		setSearchError,
		setLastSearchQuery,
		setCurrentPage,
		setHasNextPage,
		setTotalCount,
		setLoadingMore,
		appendSearchResults,
		appendTopSounds,
		resetPagination,
		beginRequest,
		canPublishRequest,
	} = useSoundsStore();
	const { soundSearchEndpoint } = useEditorHostServices();
	const { resources } = useEditorSession();

	const loadMore = async () => {
		if (isLoadingMore || !hasNextPage) return;
		if (!soundSearchEndpoint) return;
		const token = beginRequest({ channel: "loadMore" });

		try {
			setLoadingMore({ loading: true });
			const nextPage = currentPage + 1;

			const searchParams = new URLSearchParams({
				page: nextPage.toString(),
				type: "effects",
			});

			if (query.trim()) {
				searchParams.set("q", query);
			}

			searchParams.set("commercial_only", commercialOnly.toString());
			const response = await fetch(
				`${soundSearchEndpoint}?${searchParams.toString()}`,
			);
			if (!canPublishRequest({ token })) return;

			if (response.ok) {
				const data = await response.json();
				if (!canPublishRequest({ token })) return;

				if (query.trim()) {
					appendSearchResults(data.results);
				} else {
					appendTopSounds(data.results);
				}

				setCurrentPage({ page: nextPage });
				setHasNextPage({ hasNext: !!data.next });
				setTotalCount({ count: data.count });
			} else {
				setSearchError({ error: `Load more failed: ${response.status}` });
			}
		} catch (err) {
			if (!canPublishRequest({ token })) return;
			setSearchError({
				error: err instanceof Error ? err.message : "Load more failed",
			});
		} finally {
			if (canPublishRequest({ token })) setLoadingMore({ loading: false });
		}
	};

	useEffect(() => {
		if (!query.trim()) {
			beginRequest({ channel: "search" });
			setSearchResults({ results: [] });
			setSearchError({ error: null });
			setLastSearchQuery({ query: "" });
			return;
		}

		if (!soundSearchEndpoint) {
			beginRequest({ channel: "search" });
			setSearchResults({ results: [] });
			setSearchError({ error: SOUND_SEARCH_UNAVAILABLE_MESSAGE });
			return;
		}

		if (query === lastSearchQuery && searchResults.length > 0) {
			return;
		}

		let ignore = false;
		const token = beginRequest({ channel: "search" });

		const timeoutHandle = resources.setTimeout({
			ms: 300,
			handler: async () => {
				try {
					setSearching({ searching: true });
					setSearchError({ error: null });
					resetPagination();

					const response = await fetch(
						`${soundSearchEndpoint}?q=${encodeURIComponent(query)}&type=effects&page=1`,
					);

					if (!ignore && canPublishRequest({ token })) {
						if (response.ok) {
							const data = await response.json();
							if (ignore || !canPublishRequest({ token })) return;
							setSearchResults({ results: data.results });
							setLastSearchQuery({ query: query });
							setHasNextPage({ hasNext: !!data.next });
							setTotalCount({ count: data.count });
							setCurrentPage({ page: 1 });
						} else {
							setSearchError({ error: `Search failed: ${response.status}` });
						}
					}
				} catch (err) {
					if (!ignore && canPublishRequest({ token })) {
						setSearchError({
							error: err instanceof Error ? err.message : "Search failed",
						});
					}
				} finally {
					if (!ignore && canPublishRequest({ token })) {
						setSearching({ searching: false });
					}
				}
			},
		});

		return () => {
			timeoutHandle.cancel();
			ignore = true;
		};
	}, [
		query,
		soundSearchEndpoint,
		lastSearchQuery,
		searchResults.length,
		setSearchResults,
		setSearching,
		setSearchError,
		setLastSearchQuery,
		setCurrentPage,
		setHasNextPage,
		setTotalCount,
		resetPagination,
		beginRequest,
		canPublishRequest,
		resources,
	]);

	return {
		results: searchResults,
		isLoading: isSearching,
		error: searchError,
		loadMore,
		hasNextPage,
		isLoadingMore,
		totalCount,
	};
}
