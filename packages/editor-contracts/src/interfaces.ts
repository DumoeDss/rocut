/**
 * The four typed transaction interfaces.
 *
 * - {@link TransactionRead}: query the project content snapshot.
 * - {@link TransactionApply}: submit atomic batches of operations.
 * - {@link TransactionGetContext}: probe context metadata.
 * - {@link TransactionWatch}: subscribe to revision changes.
 *
 * The three data interfaces (`read`, `apply`, `getContext`) share a consistent
 * `Promise`-returning shape. `watch` is callback-based, matching S02's
 * `session.watch` pattern.
 */
import type { Asset, Clip, Marker, Project, Track } from "./domain";
import type { TrackId } from "./domain";
import type {
	OperationKind,
} from "./operations";
import type {
	Revision,
	TransactionBatch,
	TransactionResult,
} from "./transaction";

/**
 * Query the current project content snapshot.
 *
 * Every method returns a `Promise` to allow store-backed implementations that
 * may be async. Results are defensively cloned: mutating a returned value does
 * not alter the contract's internal state.
 */
export interface TransactionRead {
	/** All tracks on the timeline. */
	tracks(): Promise<readonly Track[]>;
	/** All clips, optionally filtered by track. */
	clips(filter?: { trackId: TrackId }): Promise<readonly Clip[]>;
	/** All media assets. */
	assets(): Promise<readonly Asset[]>;
	/** All markers/bookmarks. */
	markers(): Promise<readonly Marker[]>;
	/** The project metadata. */
	project(): Promise<Project | null>;
	/** The current revision. */
	revision(): Promise<Revision>;
}

/**
 * Submit atomic batches of operations.
 *
 * A batch is all-or-nothing: if any operation fails, the entire batch is
 * rejected, the revision does not increment, and no entity is created or
 * modified. A successful apply returns a {@link TransactionResult}.
 */
export interface TransactionApply {
	apply(batch: TransactionBatch): Promise<TransactionResult>;
}

/**
 * Probe transaction metadata.
 *
 * Returns `Promise` (ruling A3 = async) for consistency with `read`/`apply` and
 * to allow implementations that probe external state.
 */
export interface TransactionGetContext {
	/** The current revision. */
	revision(): Promise<Revision>;
	/**
	 * Optional-behaviour capabilities. An implementation may report which
	 * features it supports beyond the base contract.
	 */
	capabilities(): Promise<Readonly<Record<string, boolean>>>;
	/** The set of operation kinds this implementation supports. */
	supportedOperations(): Promise<readonly OperationKind[]>;
}

/**
 * Subscribe to revision changes.
 *
 * Different from S02's `session.watch` (which is over the session lifecycle
 * snapshot). The subscription fires only on a revision change — not on an
 * idempotency dedup replay or a rejection.
 */
export interface TransactionWatch {
	/**
	 * Register a callback that fires when the revision changes.
	 * @returns an unsubscribe handle.
	 */
	watch(callback: (revision: Revision) => void): () => void;
}
