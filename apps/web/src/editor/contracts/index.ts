/**
 * The transaction contract — a Host-neutral typed surface for querying and
 * modifying project content.
 *
 * This is the single entry point. Import from `@/editor/contracts` (or the
 * relative equivalent) — never from individual modules.
 *
 * The contract wires nothing. Commands keep committing exactly as they do today.
 * T1/T3 connect the real engine behind these types at the seam.
 */
export type {
	// MediaTime
	MediaTime,
	// FrameRate
	FrameRate,
	// Branded IDs
	TrackId,
	ClipId,
	AssetId,
	MarkerId,
	ProjectId,
	// Entity interfaces
	TrackKind,
	AssetKind,
	Project,
	Track,
	Clip,
	Asset,
	Marker,
} from "./domain";

export {
	// MediaTime
	TICKS_PER_SECOND,
	mediaTime,
	ticksOf,
	// FrameRate
	validateFrameRate,
	frameRate,
	// Branded ID constructors
	trackId,
	clipId,
	assetId,
	markerId,
	projectId,
} from "./domain";

export type {
	ProjectPatch,
	UpdateProjectOperation,
	TransactionOperation,
	OperationKind,
} from "./operations";
export { OPERATION_KINDS } from "./operations";

export type {
	Revision,
	TransactionBatch,
	TransactionResult,
	TransactionErrorCode,
} from "./transaction";
export { TransactionError, revisionOf, INITIAL_REVISION } from "./transaction";

export type {
	TransactionRead,
	TransactionApply,
	TransactionGetContext,
	TransactionWatch,
} from "./interfaces";

export { createInMemoryTransactionStore } from "./in-memory";
export type { InMemoryTransactionStore } from "./in-memory";

export {
	runTransactionConformance,
	formatConformanceReport,
} from "./conformance";
export type {
	ConformanceReport,
	ConformanceCaseResult,
	ConformanceStatus,
} from "./conformance";
