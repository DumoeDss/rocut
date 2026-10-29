import { useEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import type { CreatorAssetVersion } from "./creator-workspace-types";
import { useCreatorWorkspace } from "./creator-workspace-context";
import { creatorVideoPoster, idlePoster } from "./creator-video-posters";

const emptySubscribe = () => () => {};
const emptySnapshot = () => idlePoster;

export function useCreatorVideoPoster(assetId: string, version: CreatorAssetVersion | undefined,
	root: RefObject<HTMLElement | null>, enabled = true) {
	const { bridge, snapshot } = useCreatorWorkspace();
	const projectId = snapshot?.projectId;
	const resource = useMemo(() => bridge && projectId && version?.mediaType === "video" && version.sha256 && /^[a-f0-9]{64}$/i.test(version.sha256)
		? creatorVideoPoster(bridge, projectId, assetId, version.id, version.sha256) : undefined,
		[bridge, projectId, assetId, version?.id, version?.sha256, version?.mediaType]);
	const state = useSyncExternalStore(resource?.subscribe ?? emptySubscribe, resource?.getSnapshot ?? emptySnapshot, emptySnapshot);
	useEffect(() => {
		if (!resource || !enabled || version?.posterUrl || version?.status === "failed" || !root.current) return;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			resource.request();
		});
		observer.observe(root.current);
		return () => observer.disconnect();
	}, [resource, enabled, version?.posterUrl, version?.status, root]);
	return { state, supported: !!resource, retry: () => resource?.request(true) };
}
