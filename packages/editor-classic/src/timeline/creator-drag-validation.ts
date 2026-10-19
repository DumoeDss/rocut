import type { CreatorWorkspaceSnapshot } from "../editor/surface/creator-workspace-types";
import type { MediaDragData } from "./drag";

export function validateCreatorDrag({
	dragData,
	snapshot,
	projectId,
	sceneId,
}: {
	dragData: MediaDragData;
	snapshot: CreatorWorkspaceSnapshot;
	projectId: string | undefined;
	sceneId: string | undefined;
}): boolean {
	const source = dragData.creator;
	if (!source) return false;
	const version = snapshot.assets
		.find((asset) => asset.id === source.assetId)
		?.versions.find((candidate) => candidate.id === source.versionId);
	return Boolean(
		snapshot.capabilities?.placeVersion &&
		snapshot.projectId === source.projectId &&
		projectId === source.nativeProjectId &&
		sceneId === source.sceneId &&
		version &&
		version.sha256 === source.sha256 &&
		version.mediaType === dragData.mediaType &&
		version.status !== "pending" &&
		version.status !== "failed",
	);
}
