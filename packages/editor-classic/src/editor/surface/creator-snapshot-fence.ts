import type { CreatorWorkspaceSnapshot } from "./creator-workspace-types";

/** A bridge instance represents one fixed project, and revisions cannot regress. */
export function createCreatorSnapshotFence() {
	let accepted: CreatorWorkspaceSnapshot | null = null;
	return (next: CreatorWorkspaceSnapshot) => {
		if (!/^\d+$/.test(next.revision)) return false;
		if (
			accepted &&
			(next.projectId !== accepted.projectId ||
				BigInt(next.revision) < BigInt(accepted.revision))
		)
			return false;
		accepted = next;
		return true;
	};
}
