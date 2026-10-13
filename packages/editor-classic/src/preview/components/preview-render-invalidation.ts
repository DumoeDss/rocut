import type { SessionResourceLifecycle } from "../../editor/session/session-resources";

export interface PreviewRenderRequest<Tree> {
	controller: AbortController;
	tree: Tree;
	revision: number;
}

export function cancelStalePreviewRender<Tree>({
	request,
	tree,
	revision,
}: {
	request: PreviewRenderRequest<Tree> | null;
	tree: Tree | null;
	revision: number;
}): void {
	// A moving playback clock must not starve a render that takes more than one
	// frame interval. Only content invalidation cancels the single in-flight frame.
	if (request && (request.tree !== tree || request.revision !== revision)) {
		request.controller.abort();
	}
}

export function subscribePreviewRenderInvalidation<Tree>({
	getRequest,
	playback,
	rendererManager,
	activityLifecycle,
}: {
	getRequest: () => PreviewRenderRequest<Tree> | null;
	playback: { onSeek: (listener: () => void) => () => void };
	rendererManager: {
		getRenderTree: () => Tree | null;
		getPreviewRevision: () => number;
		subscribe: (listener: () => void) => () => void;
	};
	activityLifecycle: Pick<
		SessionResourceLifecycle,
		"subscribeActivityLifecycle"
	>;
}): () => void {
	const cancel = () => getRequest()?.controller.abort();
	const cancelIfStale = () =>
		cancelStalePreviewRender({
			request: getRequest(),
			tree: rendererManager.getRenderTree(),
			revision: rendererManager.getPreviewRevision(),
		});
	const detach = [
		playback.onSeek(cancel),
		rendererManager.subscribe(cancelIfStale),
		activityLifecycle.subscribeActivityLifecycle({ onSuspend: cancel }),
	];
	return () => {
		cancel();
		for (const unsubscribe of detach) unsubscribe();
	};
}
