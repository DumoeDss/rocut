/**
 * The in-memory fake of the transaction contract.
 *
 * Implements all four interfaces (`TransactionRead`, `TransactionApply`,
 * `TransactionGetContext`, `TransactionWatch`) with plain `Map`s — no React,
 * Electron, or Host-port dependency. It is the reference target of the
 * conformance suite.
 */
import type {
	Asset,
	AssetId,
	Clip,
	ClipId,
	Marker,
	MarkerId,
	Project,
	ProjectId,
	Track,
	TrackId,
} from "../domain";
import type { OperationKind, TransactionOperation } from "../operations";
import { OPERATION_KINDS } from "../operations";
import type {
	Revision,
	TransactionBatch,
	TransactionResult,
} from "../transaction";
import { INITIAL_REVISION, revisionOf, TransactionError } from "../transaction";
import type {
	TransactionApply,
	TransactionGetContext,
	TransactionRead,
	TransactionWatch,
} from "../interfaces";

/** The combined interface returned by {@link createInMemoryTransactionStore}. */
export interface InMemoryTransactionStore
	extends TransactionRead,
		TransactionApply,
		TransactionGetContext,
		TransactionWatch {}

/** A stored entry in the idempotency cache. */
interface IdempotencyEntry {
	readonly key: string;
	readonly operations: readonly TransactionOperation[];
	readonly result: TransactionResult;
}

/**
 * Create a fresh in-memory transaction store with no React, Electron, or
 * Host-port dependency.
 *
 * The store maintains state in plain `Map`s, supports atomic batch apply,
 * idempotency-key dedup, monotonic revisions, watch subscribers, and
 * defensive cloning on every read.
 */
export function createInMemoryTransactionStore(): InMemoryTransactionStore {
	let revision: Revision = INITIAL_REVISION;
	const tracks = new Map<TrackId, Track>();
	const clips = new Map<ClipId, Clip>();
	const assets = new Map<AssetId, Asset>();
	const markers = new Map<MarkerId, Marker>();
	let project: Project | null = null;
	const watchers = new Set<(revision: Revision) => void>();
	const idempotencyCache = new Map<string, IdempotencyEntry>();

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	function deepClone<T>(value: T): T {
		return structuredClone(value);
	}

	function notifyWatchers(): void {
		for (const cb of watchers) {
			cb(revision);
		}
	}

	// -----------------------------------------------------------------------
	// Batch processing — validate + apply against working copies (atomicity)
	// -----------------------------------------------------------------------
	//
	// Operations within a batch can reference entities created by earlier
	// operations in the same batch (e.g., create-track then create-clip on it).
	// To support this while maintaining atomicity, we work on shallow copies of
	// the Maps, and only swap them in after every operation succeeds.

	/** Stable serialization for idempotency comparison (ignores key/provenance). */
	function serializeOps(ops: readonly TransactionOperation[]): string {
		return JSON.stringify(
			ops.map((op) => ({ ...op })),
		);
	}

	function processBatch(
		operations: readonly TransactionOperation[],
	): TransactionResult {
		// Working copies — mutated as operations apply, discarded on failure.
		const workTracks = new Map(tracks);
		const workClips = new Map(clips);
		const workAssets = new Map(assets);
		const workMarkers = new Map(markers);

		const createdIds: string[] = [];
		const changedIds: string[] = [];

		for (let i = 0; i < operations.length; i++) {
			const op = operations[i];
			switch (op.kind) {
				case "create-track": {
					if (workTracks.has(op.track.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Track ${op.track.id} already exists`,
							operationIndex: i,
						});
					}
					workTracks.set(op.track.id, deepClone(op.track));
					createdIds.push(op.track.id);
					break;
				}
				case "update-track": {
					const existing = workTracks.get(op.trackId);
					if (!existing) {
						throw new TransactionError({
							code: "not-found",
							message: `Track ${op.trackId} not found`,
							operationIndex: i,
						});
					}
					workTracks.set(op.trackId, deepClone({ ...existing, ...op.patch }));
					changedIds.push(op.trackId);
					break;
				}
				case "delete-track": {
					if (!workTracks.has(op.trackId)) {
						throw new TransactionError({
							code: "not-found",
							message: `Track ${op.trackId} not found`,
							operationIndex: i,
						});
					}
					workTracks.delete(op.trackId);
					// Cascade: remove clips on the deleted track
					for (const [clipId, clip] of workClips) {
						if (clip.trackId === op.trackId) {
							workClips.delete(clipId);
							changedIds.push(clipId);
						}
					}
					changedIds.push(op.trackId);
					break;
				}
				case "create-clip": {
					if (workClips.has(op.clip.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Clip ${op.clip.id} already exists`,
							operationIndex: i,
						});
					}
					if (!workTracks.has(op.clip.trackId)) {
						throw new TransactionError({
							code: "validation",
							message: `Clip references non-existent track ${op.clip.trackId}`,
							operationIndex: i,
						});
					}
					workClips.set(op.clip.id, deepClone(op.clip));
					createdIds.push(op.clip.id);
					break;
				}
				case "update-clip": {
					const existing = workClips.get(op.clipId);
					if (!existing) {
						throw new TransactionError({
							code: "not-found",
							message: `Clip ${op.clipId} not found`,
							operationIndex: i,
						});
					}
					workClips.set(op.clipId, deepClone({ ...existing, ...op.patch }));
					changedIds.push(op.clipId);
					break;
				}
				case "delete-clip": {
					if (!workClips.has(op.clipId)) {
						throw new TransactionError({
							code: "not-found",
							message: `Clip ${op.clipId} not found`,
							operationIndex: i,
						});
					}
					workClips.delete(op.clipId);
					changedIds.push(op.clipId);
					break;
				}
				case "create-asset": {
					if (workAssets.has(op.asset.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Asset ${op.asset.id} already exists`,
							operationIndex: i,
						});
					}
					workAssets.set(op.asset.id, deepClone(op.asset));
					createdIds.push(op.asset.id);
					break;
				}
				case "delete-asset": {
					if (!workAssets.has(op.assetId)) {
						throw new TransactionError({
							code: "not-found",
							message: `Asset ${op.assetId} not found`,
							operationIndex: i,
						});
					}
					workAssets.delete(op.assetId);
					changedIds.push(op.assetId);
					break;
				}
				case "create-marker": {
					if (workMarkers.has(op.marker.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Marker ${op.marker.id} already exists`,
							operationIndex: i,
						});
					}
					workMarkers.set(op.marker.id, deepClone(op.marker));
					createdIds.push(op.marker.id);
					break;
				}
				case "update-marker": {
					const existing = workMarkers.get(op.markerId);
					if (!existing) {
						throw new TransactionError({
							code: "not-found",
							message: `Marker ${op.markerId} not found`,
							operationIndex: i,
						});
					}
					workMarkers.set(op.markerId, deepClone({ ...existing, ...op.patch }));
					changedIds.push(op.markerId);
					break;
				}
				case "delete-marker": {
					if (!workMarkers.has(op.markerId)) {
						throw new TransactionError({
							code: "not-found",
							message: `Marker ${op.markerId} not found`,
							operationIndex: i,
						});
					}
					workMarkers.delete(op.markerId);
					changedIds.push(op.markerId);
					break;
				}
			}
		}

		// All operations succeeded — commit working copies to real state.
		// Map.set/clear on the existing Maps rather than reassignment, so the
		// read methods (which close over `tracks`, `clips`, etc.) see the update.
		tracks.clear();
		for (const [k, v] of workTracks) tracks.set(k, v);
		clips.clear();
		for (const [k, v] of workClips) clips.set(k, v);
		assets.clear();
		for (const [k, v] of workAssets) assets.set(k, v);
		markers.clear();
		for (const [k, v] of workMarkers) markers.set(k, v);

		revision = revisionOf(revision + 1);
		return { revision, createdIds, changedIds };
	}

	// -----------------------------------------------------------------------
	// Public interface
	// -----------------------------------------------------------------------

	const store: InMemoryTransactionStore = {
		// -- TransactionRead -----------------------------------------------
		async tracks(): Promise<readonly Track[]> {
			return deepClone([...tracks.values()]);
		},
		async clips(filter?: { trackId: TrackId }): Promise<readonly Clip[]> {
			const all = [...clips.values()];
			const filtered = filter
				? all.filter((c) => c.trackId === filter.trackId)
				: all;
			return deepClone(filtered);
		},
		async assets(): Promise<readonly Asset[]> {
			return deepClone([...assets.values()]);
		},
		async markers(): Promise<readonly Marker[]> {
			return deepClone([...markers.values()]);
		},
		async project(): Promise<Project | null> {
			return project === null ? null : deepClone(project);
		},
		async revision(): Promise<Revision> {
			return revision;
		},

		// -- TransactionApply ----------------------------------------------
		async apply(batch: TransactionBatch): Promise<TransactionResult> {
			// Idempotency check: same key + same ops = replay result
			if (batch.idempotencyKey !== undefined) {
				const existing = idempotencyCache.get(batch.idempotencyKey);
				if (existing) {
					if (
						serializeOps(existing.operations) !==
						serializeOps(batch.operations)
					) {
						throw new TransactionError({
							code: "duplicate",
							message: `Idempotency key "${batch.idempotencyKey}" was already used with different operations`,
						});
					}
					// Replay: return original result, no revision change, no watcher fire
					return existing.result;
				}
			}

			// Expected-revision check
			if (batch.expectedRevision !== undefined) {
				if (batch.expectedRevision !== revision) {
					throw new TransactionError({
						code: "conflict",
						message: `Expected revision ${batch.expectedRevision}, actual ${revision}`,
						expectedRevision: batch.expectedRevision,
						actualRevision: revision,
					});
				}
			}

			// Empty batch guard
			if (batch.operations.length === 0) {
				throw new TransactionError({
					code: "validation",
					message: "Batch must contain at least one operation",
				});
			}

			// Validate + commit all operations atomically (working-copy approach).
			// If any operation throws, the working copies are discarded and the
			// real state is untouched — revision does not increment.
			const result = processBatch(batch.operations);

			// Cache idempotency
			if (batch.idempotencyKey !== undefined) {
				idempotencyCache.set(batch.idempotencyKey, {
					key: batch.idempotencyKey,
					operations: batch.operations,
					result,
				});
			}

			// Notify watchers only on a real revision change
			notifyWatchers();

			return result;
		},

		// -- TransactionGetContext -----------------------------------------
		// revision() is inherited from the TransactionRead section above;
		// both interfaces share the same signature, so one method satisfies both.
		async capabilities(): Promise<Readonly<Record<string, boolean>>> {
			return Object.freeze({
				idempotency: true,
				expectedRevision: true,
				atomicBatch: true,
				defensiveClone: true,
			});
		},
		async supportedOperations(): Promise<readonly OperationKind[]> {
			return OPERATION_KINDS;
		},

		// -- TransactionWatch ----------------------------------------------
		watch(callback: (revision: Revision) => void): () => void {
			watchers.add(callback);
			return () => {
				watchers.delete(callback);
			};
		},
	};

	// Allow setting the project from outside (for test setup). Not part of the
	// public interface contract — it's a convenience on the fake.
	(store as InMemoryTransactionStore & {
		_setProject(p: Project): void;
	})._setProject = (p: Project) => {
		project = deepClone(p);
	};

	return store;
}
