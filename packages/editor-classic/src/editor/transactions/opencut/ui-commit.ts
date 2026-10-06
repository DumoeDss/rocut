import type {
	Revision,
	TransactionBatch,
	TransactionResult,
} from "@opencut/editor-contracts";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import type { OpenCutProjectDraft } from "./types";

export interface PreparedOpenCutUiCommit<Payload> {
	readonly draft: OpenCutProjectDraft;
	readonly operations: TransactionBatch["operations"];
	readonly payload: Payload;
}

export interface OpenCutUiCommitSummary<Payload> {
	readonly transaction: TransactionResult;
	readonly payload: Payload;
}

export interface OpenCutUiCommitResult<
	Payload,
> extends OpenCutUiCommitSummary<Payload> {
	readonly committedDraft: OpenCutProjectDraft;
}

interface UiCommitPreparation<Payload> {
	/** Checked inside the mutation arbiter, never just before queueing. */
	readonly expectedRevision?: Revision;
	readonly baseDraft: () => OpenCutProjectDraft;
	readonly prepare: (args: {
		readonly draft: OpenCutProjectDraft;
		readonly baseRevision: Revision;
		readonly baseDocument: TransactionEngineDocument;
	}) => PreparedOpenCutUiCommit<Payload>;
}

export interface OpenCutUiCommitWithDraft<
	Payload,
> extends UiCommitPreparation<Payload> {
	readonly returnCommittedDraft?: true;
	readonly finalize?: (result: OpenCutUiCommitResult<Payload>) => void;
}

export interface OpenCutUiCommitWithoutDraft<
	Payload,
> extends UiCommitPreparation<Payload> {
	readonly returnCommittedDraft: false;
	readonly finalize?: (result: OpenCutUiCommitSummary<Payload>) => void;
}
