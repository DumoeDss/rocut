/**
 * Transaction types — revision, batch, result, and structured errors.
 *
 * A batch is all-or-nothing: if any operation fails, the entire batch is
 * rejected, the revision does not increment, and no entity is created or
 * modified. A successful apply returns a {@link TransactionResult} with the new
 * revision, changed IDs, and created IDs.
 */
import type { TransactionOperation } from "./operations";

// ---------------------------------------------------------------------------
// Revision — branded monotonic integer
// ---------------------------------------------------------------------------

declare const __revisionBrand: unique symbol;

/**
 * A monotonic revision number, starting at 0 and incrementing by exactly 1 per
 * successful `apply`. Branded so `number` is not assignable to `Revision`
 * without the constructor.
 */
export type Revision = number & { readonly [__revisionBrand]: true };

/**
 * Construct a {@link Revision} from a plain number.
 * @internal
 */
export function revisionOf(value: number): Revision {
	return value as Revision;
}

/** The initial revision before any apply. */
export const INITIAL_REVISION = revisionOf(0);

// ---------------------------------------------------------------------------
// TransactionBatch — the atomic unit of mutation
// ---------------------------------------------------------------------------

/**
 * A batch of operations submitted atomically via `apply`.
 */
export interface TransactionBatch {
	/** The operations to apply, in order. Must be non-empty. */
	readonly operations: readonly TransactionOperation[];
	/**
	 * When supplied, the batch is rejected with code `"conflict"` if the current
	 * revision does not match. Enables optimistic concurrency for concurrent
	 * Drafts (T2) and agent scripts (T4).
	 */
	readonly expectedRevision?: Revision;
	/**
	 * When supplied, the engine deduplicates applies with the same key. A second
	 * apply with the same key and the same operations returns the original result
	 * without modifying state. A second apply with the same key but different
	 * operations is rejected with code `"duplicate"`.
	 */
	readonly idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// TransactionResult — the outcome of a successful apply
// ---------------------------------------------------------------------------

/**
 * The result of a successful `apply`. Contains the new revision and the IDs of
 * entities changed or created by the batch, so callers can observe what the
 * batch produced without re-reading.
 */
export interface TransactionResult {
	/** The revision after this apply. */
	readonly revision: Revision;
	/** IDs of entities created by this batch. */
	readonly createdIds: readonly string[];
	/** IDs of entities modified or deleted by this batch. */
	readonly changedIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

/**
 * The closed set of transaction error codes. Each code names a distinct failure
 * mode; the union is exhaustive so a consumer can switch over it without a
 * default branch.
 */
export type TransactionErrorCode =
	| "conflict"
	| "validation"
	| "not-found"
	| "duplicate"
	| "unsupported";

/**
 * A structured transaction failure. Extends `Error` so it integrates with
 * existing error-handling patterns, but carries a stable `code` field and
 * revision details where applicable.
 *
 * Modelled on `ProjectStoreError` from S02: a stable failure shape with a code,
 * an operation context, and revision details where relevant.
 */
export class TransactionError extends Error {
	readonly code: TransactionErrorCode;
	/** Which operation in the batch failed (0-indexed), if applicable. */
	readonly operationIndex?: number;
	/** The revision the caller expected, for a `"conflict"` code. */
	readonly expectedRevision?: Revision;
	/** The actual revision at the time of failure, for a `"conflict"` code. */
	readonly actualRevision?: Revision;

	constructor(args: {
		code: TransactionErrorCode;
		message: string;
		operationIndex?: number;
		expectedRevision?: Revision;
		actualRevision?: Revision;
	}) {
		super(args.message);
		this.name = "TransactionError";
		this.code = args.code;
		this.operationIndex = args.operationIndex;
		this.expectedRevision = args.expectedRevision;
		this.actualRevision = args.actualRevision;
	}
}
