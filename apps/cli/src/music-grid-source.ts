import { createHash } from "node:crypto";
import type { MusicGridSourceAvailabilityProbe } from "@opencut/editor-contracts";
import type { ProjectStore } from "@opencut/editor-ports";

export function musicGridStoredSourceProbe({
	store,
	projectId,
}: {
	store: Pick<ProjectStore, "loadAttachment">;
	projectId: string;
}): MusicGridSourceAvailabilityProbe {
	return async ({ assetId, sourceSha256 }) => {
		try {
			const attachment = await store.loadAttachment({
				projectId,
				key: assetId,
			});
			if (!attachment) return "unavailable";
			return createHash("sha256")
				.update(new Uint8Array(attachment.body))
				.digest("hex") === sourceSha256
				? "available"
				: "unavailable";
		} catch {
			return "unknown";
		}
	};
}
