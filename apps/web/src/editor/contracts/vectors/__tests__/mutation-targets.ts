/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Deliberately non-conforming wrappers reshape results the contract types forbid; that is the point of the matrix. */
/**
 * Deliberately non-conforming targets, and one deliberately different but
 * conforming one (design D4).
 *
 * Each wrapper breaks exactly one promise of the contract. The matrix asserts
 * the exact set of vector ids each one fails — not "at least one" — so a
 * wrapper that fails everything for the wrong reason is caught as well.
 */
import type {
	Revision,
	TransactionBatch,
	TransactionResult,
} from "../..";
import type { VectorTarget, VectorTargetFactory } from "../runner";
import { createInMemoryVectorTargetFactory } from "../drivers/in-memory";
import { createDurableVectorTargetFactory } from "../drivers/durable";

type Mutate = (target: VectorTarget) => VectorTarget;

function base(target: VectorTarget): VectorTarget {
	return {
		tracks: (...args) => target.tracks(...args),
		clips: (...args) => target.clips(...args),
		assets: (...args) => target.assets(...args),
		markers: (...args) => target.markers(...args),
		project: () => target.project(),
		revision: () => target.revision(),
		capabilities: () => target.capabilities(),
		supportedOperations: () => target.supportedOperations(),
		watch: (callback) => target.watch(callback),
		apply: (batch) => target.apply(batch),
		...(target.validate && { validate: (batch) => target.validate?.(batch) }),
	} as VectorTarget;
}

function wrapFactory(args: {
	readonly name: string;
	readonly inner: VectorTargetFactory;
	readonly mutate: Mutate;
}): VectorTargetFactory {
	const { inner, mutate } = args;
	return {
		name: args.name,
		...(inner.openSeeded && {
			openSeeded: async (options) => {
				const handle = await inner.openSeeded!(options);
				return { ...handle, target: mutate(handle.target) };
			},
		}),
		openRelative: async (options) => {
			const handle = await inner.openRelative(options);
			return { ...handle, target: mutate(handle.target) };
		},
	};
}

/** Returns a revision the target no longer holds. */
export function staleRevisionTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "mutation/stale-revision",
		inner: createInMemoryVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			wrapped.apply = async (batch: TransactionBatch) => {
				const before = await target.revision();
				const result = await target.apply(batch);
				return { ...result, revision: before };
			};
			return wrapped;
		},
	});
}

/** Commits each operation on its own, so a failing batch leaves debris. */
export function nonAtomicBatchTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "mutation/non-atomic-batch",
		inner: createInMemoryVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			wrapped.apply = async (batch: TransactionBatch) => {
				let last: TransactionResult | null = null;
				for (const operation of batch.operations) {
					last = await target.apply({
						operations: [operation],
						...(batch.expectedRevision !== undefined && {
							expectedRevision: batch.expectedRevision,
						}),
						...(batch.idempotencyKey !== undefined && {
							idempotencyKey: `${batch.idempotencyKey}:${batch.operations.indexOf(operation)}`,
						}),
					});
				}
				if (!last) return target.apply(batch);
				return last;
			};
			return wrapped;
		},
	});
}

/** Ignores the idempotency key, so replays mutate and reuse is accepted. */
export function idempotencyIgnoringTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "mutation/idempotency-ignored",
		inner: createInMemoryVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			wrapped.apply = (batch: TransactionBatch) =>
				target.apply({
					operations: batch.operations,
					...(batch.expectedRevision !== undefined && {
						expectedRevision: batch.expectedRevision,
					}),
				});
			return wrapped;
		},
	});
}

/** Notifies watchers even when the apply was rejected. */
export function watcherOnRejectionTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "mutation/watcher-on-rejection",
		inner: createInMemoryVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			const watchers = new Set<(revision: Revision) => void>();
			wrapped.watch = (callback) => {
				watchers.add(callback);
				const release = target.watch(callback);
				return () => {
					watchers.delete(callback);
					release();
				};
			};
			wrapped.apply = async (batch: TransactionBatch) => {
				try {
					return await target.apply(batch);
				} catch (error) {
					const revision = await target.revision();
					for (const watcher of watchers) watcher(revision);
					throw error;
				}
			};
			return wrapped;
		},
	});
}

/** Hands back the same object on every read, so a caller can corrupt it. */
export function unclonedReadTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "mutation/uncloned-read",
		inner: createInMemoryVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			const cache = new Map<string, Record<string, unknown>>();
			const share = <Value extends { readonly id: string }>(
				kind: string,
				values: readonly Value[],
			): readonly Value[] =>
				values.map((value) => {
					const key = `${kind}:${String(value.id)}`;
					const existing = cache.get(key);
					if (existing) return existing as unknown as Value;
					const shared = { ...value } as unknown as Record<string, unknown>;
					cache.set(key, shared);
					return shared as unknown as Value;
				});
			wrapped.tracks = async () => share("track", await target.tracks());
			wrapped.clips = async (filter) => share("clip", await target.clips(filter));
			wrapped.assets = async () => share("asset", await target.assets());
			wrapped.markers = async () => share("marker", await target.markers());
			// A commit refreshes what reads expose, so this wrapper breaks exactly
			// one promise — defensive copying — rather than also freezing the
			// document, which would fail vectors for an unrelated reason.
			wrapped.apply = async (batch) => {
				try {
					return await target.apply(batch);
				} finally {
					cache.clear();
				}
			};
			return wrapped;
		},
	});
}

const PLACEMENT_ISSUE_CODES = new Set([
	"collision",
	"lane-incompatible",
	"non-positive-duration",
	"timebase-misaligned",
	"source-out-of-bounds",
]);

/** Waives the base placement rules when reporting validation issues. */
export function placementWaivingTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "mutation/placement-waived",
		inner: createDurableVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			wrapped.validate = async (batch: TransactionBatch) => {
				const outcome = await target.validate!(batch);
				if (outcome.valid) return outcome;
				const issues = outcome.issues.filter(
					(issue) => !PLACEMENT_ISSUE_CODES.has(String(issue.code)),
				);
				return issues.length === 0
					? { valid: true, baseRevision: outcome.baseRevision, issues: [] }
					: { valid: false, baseRevision: outcome.baseRevision, issues };
			};
			return wrapped;
		},
	});
}

/**
 * Conforming, but shaped differently: identities come back in another order,
 * results and entities carry extra optional fields, and every call resolves on
 * a later microtask. The corpus must accept all of it.
 */
export function conformingVariantTarget(): VectorTargetFactory {
	return wrapFactory({
		name: "conforming-variant",
		inner: createInMemoryVectorTargetFactory(),
		mutate: (target) => {
			const wrapped = base(target);
			const decorate = <Value extends object>(
				values: readonly Value[],
			): readonly Value[] =>
				[...values]
					.reverse()
					.map((value) => ({ ...value, providerNote: "variant" }));
			wrapped.tracks = async () => decorate(await target.tracks());
			wrapped.clips = async (filter) => decorate(await target.clips(filter));
			wrapped.assets = async () => decorate(await target.assets());
			wrapped.markers = async () => decorate(await target.markers());
			wrapped.project = async () => {
				const project = await target.project();
				return project === null
					? null
					: ({ ...project, providerNote: "variant" } as typeof project);
			};
			wrapped.apply = async (batch: TransactionBatch) => {
				await Promise.resolve();
				const result = await target.apply(batch);
				return {
					...result,
					createdIds: [...result.createdIds].reverse(),
					changedIds: [...result.changedIds].reverse(),
					variantWarnings: [],
				} as TransactionResult;
			};
			return wrapped;
		},
	});
}
