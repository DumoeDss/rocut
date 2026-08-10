import type { OperationKind, TransactionOperation } from "..";
import { OPERATION_KINDS } from "..";
import { immutableDraftValue } from "./immutable";
import type { DraftReviewSummary } from "./types";

export interface DraftJournalCall {
	readonly operations: readonly TransactionOperation[];
}

function affectedEntityIds(operation: TransactionOperation): readonly string[] {
	switch (operation.kind) {
		case "create-track":
			return [operation.track.id];
		case "update-track":
		case "delete-track":
			return [operation.trackId];
		case "create-clip":
			return [operation.clip.id];
		case "update-clip":
		case "delete-clip":
			return [operation.clipId];
		case "create-asset":
			return [operation.asset.id];
		case "delete-asset":
			return [operation.assetId];
		case "create-marker":
			return [operation.marker.id];
		case "update-marker":
		case "delete-marker":
			return [operation.markerId];
	}
}

export function deriveDraftReview(
	journal: readonly DraftJournalCall[],
): DraftReviewSummary {
	const byKind = Object.fromEntries(
		OPERATION_KINDS.map((kind) => [kind, 0]),
	) as Record<OperationKind, number>;
	const entries: Array<{
		readonly callIndex: number;
		readonly operationIndex: number;
		readonly kind: OperationKind;
		readonly affectedEntityIds: readonly string[];
	}> = [];
	const allAffected = new Set<string>();
	journal.forEach((call, callIndex) => {
		call.operations.forEach((operation, operationIndex) => {
			const ids = affectedEntityIds(operation);
			byKind[operation.kind] += 1;
			for (const id of ids) allAffected.add(id);
			entries.push({
				callIndex,
				operationIndex,
				kind: operation.kind,
				affectedEntityIds: ids,
			});
		});
	});
	return immutableDraftValue({
		entries,
		affectedEntityIds: [...allAffected],
		counts: {
			calls: journal.length,
			operations: entries.length,
			byKind,
		},
	});
}
