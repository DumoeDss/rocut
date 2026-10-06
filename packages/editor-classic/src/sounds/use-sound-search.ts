import { useEffect, useRef } from "react";
import { useSoundsStore } from "../editor/use-session-store";
import { useEditorHostServices } from "../editor/host/editor-host-context";
import { useEditorSession } from "../editor/session/editor-session-provider";
import { storesForSession } from "../editor/runtime/session-stores";
import { createSoundSearchRequest } from "./search-request";

export { SOUND_SEARCH_UNAVAILABLE_MESSAGE } from "./search-request";

export function useSoundSearch({
	query,
	commercialOnly,
}: {
	query: string;
	commercialOnly: boolean;
}) {
	const state = useSoundsStore();
	const { soundSearchEndpoint } = useEditorHostServices();
	const session = useEditorSession();
	const request = useRef<ReturnType<typeof createSoundSearchRequest> | null>(
		null,
	);
	const timer = useRef<{ cancel(): void } | null>(null);

	useEffect(() => {
		const owned = createSoundSearchRequest({
			store: storesForSession(session).sounds,
			endpoint: soundSearchEndpoint,
			query,
			commercialOnly,
		});
		request.current = owned;
		const timeout = session.resources.setTimeout({
			ms: query.trim() ? 300 : 100,
			handler: () => void owned.loadFirst(),
		});
		timer.current = timeout;
		return () => {
			timeout.cancel();
			owned.dispose();
			request.current = null;
		};
	}, [query, commercialOnly, soundSearchEndpoint, session]);

	return {
		results: query.trim() ? state.searchResults : state.topSoundEffects,
		isLoading: state.isSearching || state.isLoading,
		error: state.searchError,
		loadMore: () => request.current?.loadMore(),
		retry: () => {
			timer.current?.cancel();
			return state.hasLoaded
				? request.current?.loadMore()
				: request.current?.loadFirst();
		},
		hasNextPage: state.hasNextPage && !state.searchError,
		isLoadingMore: state.isLoadingMore,
		totalCount: state.totalCount,
	};
}
