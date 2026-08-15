/**
 * Fixture factories: the adapter's answers to the conformance suites' seams
 * (S05 P3, design E7).
 *
 * Every factory here is third-party-shaped: it opens the PUBLISHED engine over
 * the adapter's own alien store, supplies its own committed-state capture for
 * the Draft suite (built from public engine reads, because the native capture
 * binder is not reachable through the declared entries -- that gap is one of
 * this change's recorded findings), and presents its own vectors target
 * factory. Nothing imports a reference implementation.
 */
import type { ProjectId, ProjectRecord, ProjectSummary } from "@opencut/editor-ports";

import type { Project, Revision, TransactionBatch, TransactionOperation } from "@opencut/editor-contracts";
import { mediaTime, projectId } from "@opencut/editor-contracts";
import {
	canonicalOperationFingerprint,
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	openTransactionEngine,
} from "@opencut/editor-contracts/engine";
import type {
	TransactionEngine,
	TransactionEngineConformanceFactory,
	TransactionEngineConformancePause,
	TransactionEngineDocument,
	TransactionIdempotencyEntry,
} from "@opencut/editor-contracts/engine";
import {
	createDraftEditingManager,
	createInMemoryDraftResourceRetentionPolicy,
} from "@opencut/editor-contracts/draft";
import type {
	DraftEditingConformanceFactory,
	DraftCommittedStateCapture,
} from "@opencut/editor-contracts/draft";
import type {
	VectorSeedDocument,
	VectorTargetFactory,
	VectorTargetHandle,
} from "@opencut/editor-contracts/vectors";

import { AlienProjectStore } from "./alien-store";

const ENGINE_PROJECT_ID = "alien-engine-project";
/**
 * The Draft suite's sample operations address the project by this exact id
 * (the suite predates configurable fixture ids); the fixture must open it.
 */
const DRAFT_PROJECT_ID = "draft-project";
const VECTOR_PROJECT_ID = "alien-vector-project";

function alienProject(id: string, name: string): Project {
	return {
		id: projectId(id),
		name,
		frameRate: { numerator: 30, denominator: 1 },
		canvasWidth: 1920,
		canvasHeight: 1080,
	};
}

/**
 * The adapter's committed-state capture: the engine's public reads, assembled
 * into the document shape the Draft manager verifies -- plus an idempotency
 * ledger THIS adapter maintains. The engine's public surface exposes no
 * idempotency read (no `engine.idempotency()`, and `dryRun` returns no
 * document), so a third party cannot read the ledger back; what it CAN do is
 * observe every keyed apply through its own seam and record the entries with
 * the published fingerprint function. Placement policies inspect that
 * ledger, so a capture without one fails the policy-bearing cases -- the
 * adapter's answer is recording, not guessing.
 */
function alienCommittedStateCapture(
	engine: TransactionEngine,
	committedLedger: readonly TransactionIdempotencyEntry[],
): DraftCommittedStateCapture {
	return {
		capture: async (): Promise<TransactionEngineDocument> => ({
			project: await engine.project(),
			tracks: await engine.tracks(),
			clips: await engine.clips(),
			assets: await engine.assets(),
			markers: await engine.markers(),
			revision: await engine.revision(),
			idempotency: [...committedLedger],
		}),
	};
}

/** Count saves by wrapping the store's save, leaving the store otherwise intact. */
function countSaves(store: AlienProjectStore): {
	saveCount(): number;
	resetSaveCount(): void;
} {
	let saves = 0;
	const originalSave = store.save.bind(store);
	store.save = async (args: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> => {
		saves += 1;
		return originalSave(args);
	};
	return {
		saveCount: () => saves,
		resetSaveCount: () => {
			saves = 0;
		},
	};
}

/**
 * The contract-profile batch composer: the T0 leg runs the unchanged
 * transaction suite, whose samples predate placement policy. This adapter-side
 * composer makes those samples placement-valid without touching the suite --
 * the same liberty the reference fixture takes, written our way.
 */
async function placementCompatibleContractBatch<
	FeatureName extends string,
>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly batch: TransactionBatch;
}): Promise<TransactionBatch> {
	const { engine, batch } = args;
	const trackEnds = new Map<string, number>();
	for (const existing of await engine.clips()) {
		trackEnds.set(
			existing.trackId,
			Math.max(
				trackEnds.get(existing.trackId) ?? 0,
				Number(existing.startTime) + Number(existing.duration),
			),
		);
	}
	return {
		...batch,
		operations: batch.operations.map((operation) => {
			if (operation.kind === "create-track") {
				return {
					...operation,
					track: { ...operation.track, kind: "graphic" as const },
				};
			}
			if (operation.kind !== "create-clip") return operation;
			const start = Math.max(
				Number(operation.clip.startTime),
				trackEnds.get(operation.clip.trackId) ?? 0,
			);
			trackEnds.set(
				operation.clip.trackId,
				start + Number(operation.clip.duration),
			);
			return {
				...operation,
				clip: {
					...operation.clip,
					startTime: mediaTime({ ticks: start }),
				},
			};
		}),
	};
}

function composeContractProfile<FeatureName extends string>(
	engine: TransactionEngine<FeatureName>,
): TransactionEngine<FeatureName> {
	return new Proxy(engine, {
		get(target, property) {
			if (property === "apply") {
				return async (batch: TransactionBatch) =>
					target.apply(
						await placementCompatibleContractBatch({ engine: target, batch }),
					);
			}
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** The engine-suite factory: published engine over a private alien store. */
export function createAlienEngineFactory(): TransactionEngineConformanceFactory {
	return async (options = {}) => {
		const store = new AlienProjectStore();
		const seed = createTransactionNativeProjectSeed({
			projectId: ENGINE_PROJECT_ID as ProjectId,
			project: alienProject(ENGINE_PROJECT_ID, "Alien engine conformance"),
			opaque: options.opaque,
		});
		await store.save({ record: seed.record, summary: seed.summary });
		const { saveCount } = countSaves(store);
		const adapter = createTransactionNativeDocumentAdapter({
			now: () => "2026-01-02T00:00:00.000Z",
		});
		const open = async (): Promise<TransactionEngine> => {
			const opened = await openTransactionEngine({
				store,
				projectId: ENGINE_PROJECT_ID as ProjectId,
				documentAdapter: adapter,
				placementPolicies: options.placementPolicies,
				optionalFeatures: options.optionalFeatures,
			});
			return options.profile === "contract"
				? composeContractProfile(opened)
				: opened;
		};
		const engine = await open();
		return {
			engine,
			reopen: open,
			async readPersistedRecord(): Promise<ProjectRecord> {
				const loaded = await store.load({ id: ENGINE_PROJECT_ID as ProjectId });
				if (!loaded) throw new Error("alien store lost the persisted record");
				return loaded;
			},
			saveCount,
			failNextSave: () =>
				store.fixtureControl.failNext({
					operation: "save-project",
					code: "quota-exceeded",
				}),
			pauseNextSave: (): TransactionEngineConformancePause =>
				store.fixtureControl.pauseNext({ operation: "save-project" }),
		};
	};
}

/**
 * The apply-counting, revision-scripting proxy the Draft suite's seams need.
 * `onApply` fires before the call (attempts count even when they fail);
 * `onApplied` fires only after a successful commit, carrying the batch and
 * result so the committed-ledger recorder sees exactly what the engine
 * committed.
 */
function bindEngine<FeatureName extends string>(args: {
	readonly engine: TransactionEngine<FeatureName>;
	readonly revisions?: readonly Revision[];
	readonly onApply: () => void;
	readonly onApplied?: (
		batch: TransactionBatch,
		result: Awaited<ReturnType<TransactionEngine["apply"]>>,
	) => void;
}): TransactionEngine<FeatureName> {
	const revisions = [...(args.revisions ?? [])];
	return new Proxy(args.engine, {
		get(target, property) {
			if (property === "revision" && revisions.length > 0) {
				return async () => revisions.shift() ?? target.revision();
			}
			if (property === "apply") {
				return async (batch: TransactionBatch) => {
					args.onApply();
					const result = await target.apply(batch);
					args.onApplied?.(batch, result);
					return result;
				};
			}
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** The Draft-suite factory: manager over the published engine + own capture. */
export function createAlienDraftFactory(): DraftEditingConformanceFactory {
	return async (options = {}) => {
		const store = new AlienProjectStore();
		const seed = createTransactionNativeProjectSeed({
			projectId: DRAFT_PROJECT_ID as ProjectId,
			project: alienProject(DRAFT_PROJECT_ID, "Alien draft conformance"),
		});
		await store.save({ record: seed.record, summary: seed.summary });
		const { saveCount, resetSaveCount } = countSaves(store);
		const rawEngine = await openTransactionEngine({
			store,
			projectId: DRAFT_PROJECT_ID as ProjectId,
			documentAdapter: createTransactionNativeDocumentAdapter(),
			placementPolicies: options.placementPolicies,
			optionalFeatures: options.optionalFeatures,
		});
		const committedLedger: TransactionIdempotencyEntry[] = [];
		const committedState = alienCommittedStateCapture(rawEngine, committedLedger);
		if (options.seedOperations && options.seedOperations.length > 0) {
			await rawEngine.apply({ operations: options.seedOperations });
			// The suite counts saves from the fixture's opening, not from seeding.
			resetSaveCount();
		}
		let applies = 0;
		let watches = 0;
		rawEngine.watch(() => {
			watches += 1;
		});
		const engine = bindEngine({
			engine: rawEngine,
			revisions: options.snapshotRevisionSequence,
			onApply: () => {
				applies += 1;
			},
			onApplied: (batch, result) => {
				if (batch.idempotencyKey === undefined) return;
				committedLedger.push({
					key: batch.idempotencyKey,
					fingerprint: canonicalOperationFingerprint(batch.operations),
					result,
				});
			},
		});
		const retention = createInMemoryDraftResourceRetentionPolicy({
			retainedAssetIds: options.retainedAssetIds,
		});
		const manager = createDraftEditingManager({
			engine,
			committedState,
			retentionPolicy: retention,
			placementPolicies: options.placementPolicies,
			snapshotAttempts: options.snapshotAttempts,
		});
		return {
			manager,
			engine,
			retention,
			saveCount,
			applyCount: () => applies,
			watchCount: () => watches,
		};
	};
}

/** The vectors-suite target factory: published engine over an alien store. */
export function createAlienVectorTargetFactory(): VectorTargetFactory {
	const open = async (args: {
		readonly document?: VectorSeedDocument;
	}): Promise<VectorTargetHandle> => {
		const store = new AlienProjectStore();
		const projectId = (args.document?.project?.id ??
			VECTOR_PROJECT_ID) as string;
		const seed = createTransactionNativeProjectSeed({
			projectId: projectId as ProjectId,
			project: (args.document?.project ??
				alienProject(VECTOR_PROJECT_ID, "Alien vector project")) as Project,
		});
		await store.save({ record: seed.record, summary: seed.summary });
		const engine = await openTransactionEngine({
			store,
			projectId: projectId as ProjectId,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
		if (args.document) {
			// Wire-safe published data becomes branded contract values at this
			// seam — the same cast the published durable driver makes.
			const operations = [
				...args.document.tracks.map((track) => ({
					kind: "create-track" as const,
					track,
				})),
				...args.document.assets.map((asset) => ({
					kind: "create-asset" as const,
					asset,
				})),
				...args.document.clips.map((clip) => ({
					kind: "create-clip" as const,
					clip,
				})),
				...args.document.markers.map((marker) => ({
					kind: "create-marker" as const,
					marker,
				})),
			] as unknown as readonly TransactionOperation[];
			if (operations.length > 0) await engine.apply({ operations });
		}
		return { target: engine };
	};
	return {
		name: "alien-store-transaction-engine",
		openSeeded: ({ document }) => open({ document }),
		openRelative: () => open({}),
	};
}
