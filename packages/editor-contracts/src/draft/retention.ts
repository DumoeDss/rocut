import type { AssetId } from "..";
import type {
	DraftResourceRetentionPolicy,
	DraftRetentionPreflightOutcome,
} from "./types";
import { immutableDraftValue } from "./immutable";

export interface InMemoryDraftRetentionOptions {
	readonly retainedAssetIds?: readonly AssetId[];
	readonly failWith?: string;
}

export interface InMemoryDraftResourceRetentionPolicy extends DraftResourceRetentionPolicy {
	setRetainedAssetIds(assetIds: readonly AssetId[]): void;
	failNext(message?: string): void;
	preflightCount(): number;
}

export function createInMemoryDraftResourceRetentionPolicy(
	options: InMemoryDraftRetentionOptions = {},
): InMemoryDraftResourceRetentionPolicy {
	let retained = new Set<string>(options.retainedAssetIds ?? []);
	let nextFailure = options.failWith;
	let calls = 0;
	return {
		setRetainedAssetIds(assetIds) {
			retained = new Set(assetIds);
		},
		failNext(message = "Retention policy unavailable") {
			nextFailure = message;
		},
		preflightCount() {
			return calls;
		},
		async preflight({
			referencedAssetIds,
		}): Promise<DraftRetentionPreflightOutcome> {
			calls += 1;
			const candidateAssetIds = [...new Set(referencedAssetIds)];
			const retainedAssets = candidateAssetIds
				.filter((assetId) => retained.has(assetId))
				.map((assetId) => ({ assetId, projectOwned: true as const }));
			const missingAssetIds = candidateAssetIds.filter(
				(assetId) => !retained.has(assetId),
			);
			const evidence = immutableDraftValue({
				candidateAssetIds,
				retainedAssets,
				missingAssetIds,
			});
			if (nextFailure !== undefined) {
				const message = nextFailure;
				nextFailure = undefined;
				return Object.freeze({
					retained: false as const,
					reason: "policy-failed" as const,
					message,
					evidence,
				});
			}
			if (missingAssetIds.length > 0) {
				return Object.freeze({
					retained: false as const,
					reason: "missing-assets" as const,
					message: "Referenced assets are not retained by the project",
					evidence,
				});
			}
			return Object.freeze({ retained: true as const, evidence });
		},
	};
}
