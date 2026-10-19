import { TransactionError } from "@opencut/editor-contracts";
import type { OpenCutAssetCatalogEntry } from "./types";

/** Live restoration can enrich metadata; it cannot rewrite an immutable asset. */
export function mergeAssetCatalogs({
	committed,
	live,
}: {
	committed: readonly OpenCutAssetCatalogEntry[];
	live: readonly OpenCutAssetCatalogEntry[];
}): OpenCutAssetCatalogEntry[] {
	const merged = new Map(committed.map((asset) => [asset.id, { ...asset }]));
	for (const asset of live) {
		const previous = merged.get(asset.id);
		if (!previous) {
			merged.set(asset.id, { ...asset });
			continue;
		}
		if (
			previous.type !== asset.type ||
			(previous.sourceSha256 !== undefined &&
				asset.sourceSha256 !== undefined &&
				previous.sourceSha256 !== asset.sourceSha256)
		) {
			throw new TransactionError({
				code: "conflict",
				message: "Restored media does not match the committed asset identity",
			});
		}
		// In particular, do not silently add a newly learned sourceSha256 to an
		// old catalog. The public operation union intentionally has no update-asset.
	}
	return [...merged.values()];
}
