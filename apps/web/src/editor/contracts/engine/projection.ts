import type { TransactionBatch, TransactionResult } from "..";
import { cloneTransactionValue } from "./clone";
import type { TransactionEngineDocument } from "./types";

/**
 * Project the exact metadata-bearing document that a successful, non-replayed
 * evaluation would durably commit. Keeping this construction pure and shared
 * prevents preflight consumers from drifting from the engine's commit state.
 */
export function projectCommittedTransactionDocument(args: {
	readonly evaluatedDocument: TransactionEngineDocument;
	readonly batch: TransactionBatch;
	readonly result: TransactionResult;
	readonly fingerprint: string;
}): TransactionEngineDocument {
	const document = cloneTransactionValue(args.evaluatedDocument);
	if (args.batch.idempotencyKey === undefined) return document;
	return {
		...document,
		idempotency: [
			...document.idempotency,
			{
				key: args.batch.idempotencyKey,
				fingerprint: args.fingerprint,
				result: cloneTransactionValue(args.result),
			},
		],
	};
}
