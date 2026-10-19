/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- The branded commit token and private orchestration helpers remain inside this concrete donor router. */
import type {
	Asset,
	Clip,
	Marker,
	Project,
	Revision,
	Track,
	TrackId,
	TransactionBatch,
	TransactionResult,
} from "@opencut/editor-contracts";
import { revisionOf } from "@opencut/editor-contracts";
import {
	openTransactionEngine,
	type TransactionDryRunOutcome,
	type TransactionEngine,
	type TransactionEngineCapabilities,
	type TransactionEngineDocument,
	type TransactionValidationOutcome,
} from "@opencut/editor-contracts/engine";
import type { SessionPersistenceCoordinator } from "../../persistence";
import type {
	ProjectId as PortProjectId,
	ProjectRecord,
} from "@opencut/editor-ports";
import type { MediaAsset } from "../../../media/types";
import { createOpenCutTransactionDocumentAdapter } from "./adapter";
import { mergeAssetCatalogs } from "./asset-catalog";
import { ProjectMutationArbiter } from "./arbiter";
import { openCutMediaPolicy } from "./media-policy";
import {
	assertNativeTrackLocks,
	openCutTrackLockPolicy,
} from "./track-lock-policy";
import {
	openCutEditingPolicy,
	validateDocumentEditing,
} from "./editing-policy";
import { cloneOpenCutDraft, projectOpenCutDraft } from "./projection";
import type {
	OpenCutUiCommitResult,
	OpenCutUiCommitSummary,
	OpenCutUiCommitWithDraft,
	OpenCutUiCommitWithoutDraft,
} from "./ui-commit";
export type {
	OpenCutUiCommitResult,
	PreparedOpenCutUiCommit,
} from "./ui-commit";
import {
	assetCatalogFromMedia,
	type OpenCutCommitToken,
	type OpenCutProjectDraft,
} from "./types";

interface ActiveOpenCutRouter {
	readonly projectId: PortProjectId;
	engine: TransactionEngine;
	pendingLegacyRecord: ProjectRecord | null;
	readonly adapter: ReturnType<typeof createOpenCutTransactionDocumentAdapter>;
	engineUnsubscribe: (() => void) | null;
	disposed: boolean;
}

function commitToken(): OpenCutCommitToken {
	const random = globalThis.crypto?.randomUUID?.();
	const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `opencut-ui:${random ?? fallback}` as OpenCutCommitToken;
}

export class SessionOpenCutTransactions {
	private active: ActiveOpenCutRouter | null = null;
	private readonly watchers = new Set<(revision: Revision) => void>();
	private readonly unsubscribeProjectRecords: () => void;
	private disposed = false;

	constructor(
		private readonly options: {
			readonly persistence: SessionPersistenceCoordinator;
			readonly arbiter: ProjectMutationArbiter;
			readonly publish: (draft: OpenCutProjectDraft) => void;
		},
	) {
		this.unsubscribeProjectRecords =
			options.persistence.subscribeProjectRecords((record, publication) => {
				const active = this.active;
				if (active && !active.disposed && active.projectId === record.id) {
					// The subscription gives this callback its own isolated record.
					active.adapter.adoptCommittedRecord(record, { takeOwnership: true });
					// Every publication invalidates the prior pending rebase. A later
					// external load must never resurrect an older local saved record.
					active.pendingLegacyRecord = publication?.legacySave ? record : null;
				}
			});
	}

	async open({
		projectId,
		assets,
	}: {
		projectId: string;
		assets: readonly MediaAsset[];
	}): Promise<void> {
		this.assertAlive();
		await this.retire();
		await this.options.arbiter.run({
			projectId,
			operation: async () => {
				const portProjectId = projectId as PortProjectId;
				const record = await this.options.persistence.store.load({
					id: portProjectId,
				});
				if (!record) throw new Error(`Project ${projectId} no longer exists`);
				const adapter = createOpenCutTransactionDocumentAdapter({
					validateEditing: validateDocumentEditing,
					initialRecord: record,
					initialAssets: assetCatalogFromMedia(assets),
				});
				const engine = await openTransactionEngine({
					store: this.options.persistence.store,
					projectId: portProjectId,
					documentAdapter: adapter,
					placementPolicies: [
						openCutMediaPolicy,
						openCutEditingPolicy,
						openCutTrackLockPolicy,
					],
					normalizeOperationFingerprint,
				});
				const active: ActiveOpenCutRouter = {
					projectId: portProjectId,
					engine,
					pendingLegacyRecord: null,
					adapter,
					engineUnsubscribe: null,
					disposed: false,
				};
				active.engineUnsubscribe = engine.watch((revision) => {
					for (const watcher of [...this.watchers]) {
						try {
							watcher(revision);
						} catch {
							// Transaction observers cannot poison a durable commit.
						}
					}
				});
				this.active = active;
			},
		});
	}

	commitUi<Payload>(
		options: OpenCutUiCommitWithoutDraft<Payload>,
	): Promise<OpenCutUiCommitSummary<Payload>>;
	commitUi<Payload>(
		options: OpenCutUiCommitWithDraft<Payload>,
	): Promise<OpenCutUiCommitResult<Payload>>;
	async commitUi<Payload>(
		options:
			| OpenCutUiCommitWithDraft<Payload>
			| OpenCutUiCommitWithoutDraft<Payload>,
	): Promise<OpenCutUiCommitSummary<Payload> | OpenCutUiCommitResult<Payload>> {
		const { baseDraft, prepare } = options;
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: async () => {
				this.assertCurrent(active);
				await this.synchronizeLegacySave(active);
				const revision = await active.engine.revision();
				if (
					options.expectedRevision !== undefined &&
					options.expectedRevision !== revision
				) {
					throw new Error("revision-conflict");
				}
				const baseDocument = await this.readDocument(active.engine, revision);
				const draft = cloneOpenCutDraft(baseDraft());
				draft.assetCatalog = mergeAssetCatalogs({
					committed: active.adapter.currentAssetCatalog(),
					live: draft.assetCatalog,
				});
				const prepared = prepare({
					draft,
					baseRevision: revision,
					baseDocument,
				});
				const token = commitToken();
				assertNativeTrackLocks({
					before: active.adapter.currentDraft().project,
					after: prepared.draft.project,
				});
				const projectedDocument = projectOpenCutDraft(prepared.draft, {
					revision: revisionOf(Number(revision) + 1),
					idempotency: [],
					sequenceOwnership: "borrow",
				});
				active.adapter.stage({
					token,
					baseRevision: revision,
					previousRecordDigest: active.adapter.currentRecordDigest(),
					draft: prepared.draft,
					projectedDocument,
				});
				try {
					const transaction = await active.engine.apply({
						operations: prepared.operations,
						expectedRevision: revision,
						idempotencyKey: token,
					});
					const receipt = active.adapter.consumeReceipt();
					if (!receipt || receipt.token !== token) {
						throw new Error(
							"The durable OpenCut publication receipt is missing",
						);
					}
					await this.adoptAndPublish(
						active,
						receipt.record,
						receipt.draft,
						options.returnCommittedDraft === false,
					);
					if (options.returnCommittedDraft === false) {
						const committed = { transaction, payload: prepared.payload };
						options.finalize?.(committed);
						return committed;
					}
					const committed = {
						transaction,
						payload: prepared.payload,
						// consumeReceipt transferred this isolated draft; publication
						// already received a separate copy in adoptAndPublish.
						committedDraft: receipt.draft,
					};
					options.finalize?.(committed);
					return committed;
				} finally {
					active.adapter.clear(token);
				}
			},
		});
	}

	apply(batch: TransactionBatch): Promise<TransactionResult> {
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: async () => {
				this.assertCurrent(active);
				await this.synchronizeLegacySave(active);
				try {
					const result = await active.engine.apply(batch);
					const receipt = active.adapter.consumeReceipt();
					if (receipt) {
						await this.adoptAndPublish(
							active,
							receipt.record,
							receipt.draft,
							true,
						);
					}
					return result;
				} catch (error) {
					active.adapter.consumeReceipt();
					throw error;
				}
			},
		});
	}

	validate(batch: TransactionBatch): Promise<TransactionValidationOutcome> {
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: async () => {
				await this.synchronizeLegacySave(active);
				return active.engine.validate(batch);
			},
		});
	}

	dryRun(batch: TransactionBatch): Promise<TransactionDryRunOutcome> {
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: async () => {
				await this.synchronizeLegacySave(active);
				return active.engine.dryRun(batch);
			},
		});
	}

	tracks(): Promise<readonly Track[]> {
		return this.readSynchronized((engine) => engine.tracks());
	}

	clips(filter?: { trackId: TrackId }): Promise<readonly Clip[]> {
		return this.readSynchronized((engine) => engine.clips(filter));
	}

	assets(): Promise<readonly Asset[]> {
		return this.readSynchronized((engine) => engine.assets());
	}

	markers(): Promise<readonly Marker[]> {
		return this.readSynchronized((engine) => engine.markers());
	}

	motionTextSequences() {
		return this.readSynchronized(
			(engine) => engine.motionTextSequences?.() ?? Promise.resolve([]),
		);
	}

	project(): Promise<Project | null> {
		return this.readSynchronized((engine) => engine.project());
	}

	revision(): Promise<Revision> {
		return this.readSynchronized((engine) => engine.revision());
	}

	capabilities(): Promise<TransactionEngineCapabilities> {
		return this.requireActive().engine.capabilities();
	}

	supportedOperations() {
		return this.requireActive().engine.supportedOperations();
	}

	watch(callback: (revision: Revision) => void): () => void {
		this.assertAlive();
		this.watchers.add(callback);
		return () => this.watchers.delete(callback);
	}

	async retire(): Promise<void> {
		const active = this.active;
		this.active = null;
		if (!active) return;
		active.disposed = true;
		active.engineUnsubscribe?.();
		active.engineUnsubscribe = null;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		await this.retire();
		this.disposed = true;
		this.unsubscribeProjectRecords();
		this.watchers.clear();
	}

	isOpenFor(projectId: string): boolean {
		return this.active?.projectId === projectId && !this.active.disposed;
	}

	private async adoptAndPublish(
		active: ActiveOpenCutRouter,
		record: ProjectRecord,
		draft: OpenCutProjectDraft,
		takeDraftOwnership: boolean,
	): Promise<void> {
		this.assertCurrent(active);
		await this.options.persistence.adoptCommittedProjectRecord({
			record,
			returnProject: false,
			// The consumed receipt relinquished this record to the router.
			takeOwnership: true,
		});
		// The synchronous record subscription already adopted this durable record,
		// just as it does for ordinary saves. Do not copy and invalidate it twice.
		// A consumed receipt is private. Transfer it when the caller requests no
		// result draft; the default API still isolates publication from its result.
		this.options.publish(takeDraftOwnership ? draft : cloneOpenCutDraft(draft));
	}

	private readSynchronized<T>(
		read: (engine: TransactionEngine) => Promise<T>,
	): Promise<T> {
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: async () => {
				await this.synchronizeLegacySave(active);
				return read(active.engine);
			},
		});
	}

	private async synchronizeLegacySave(
		active: ActiveOpenCutRouter,
	): Promise<void> {
		this.assertCurrent(active);
		const record = active.pendingLegacyRecord;
		if (!record) return;
		// Only a successful session-local legacy save may rebase this owner.
		// Decode that exact durable publication, never a fresh external store read.
		// The envelope retains revision and idempotency; command undo/redo is owned
		// by CommandManager, not this serialization engine.
		const store = new Proxy(this.options.persistence.store, {
			get(target, key) {
				if (key === "load") return async () => record;
				const value = Reflect.get(target, key, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const engine = await openTransactionEngine({
			store,
			projectId: active.projectId,
			documentAdapter: active.adapter,
			placementPolicies: [openCutMediaPolicy, openCutEditingPolicy],
			normalizeOperationFingerprint,
		});
		this.assertCurrent(active);
		active.engineUnsubscribe?.();
		active.engine = engine;
		active.pendingLegacyRecord = null;
		active.engineUnsubscribe = engine.watch((revision) => {
			for (const watcher of [...this.watchers]) {
				try {
					watcher(revision);
				} catch {
					/* Observers cannot poison a durable commit. */
				}
			}
		});
	}

	private async readDocument(
		engine: TransactionEngine,
		revision: Revision,
	): Promise<TransactionEngineDocument> {
		const [project, tracks, clips, assets, markers, motionTextSequences] =
			await Promise.all([
				engine.project(),
				engine.tracks(),
				engine.clips(),
				engine.assets(),
				engine.markers(),
				engine.motionTextSequences?.() ?? Promise.resolve([]),
			]);
		return {
			project,
			tracks,
			clips,
			assets,
			markers,
			motionTextSequences,
			revision,
			idempotency: [],
		};
	}

	private requireActive(): ActiveOpenCutRouter {
		this.assertAlive();
		const active = this.active;
		if (!active || active.disposed)
			throw new Error("No OpenCut transaction router is open");
		return active;
	}

	private assertCurrent(active: ActiveOpenCutRouter): void {
		if (this.active !== active || active.disposed) {
			throw new Error("The OpenCut transaction router was retired");
		}
	}

	private assertAlive(): void {
		if (this.disposed)
			throw new Error("OpenCut transaction facade has been disposed");
	}
}
import { normalizeOperationFingerprint } from "opencut-wasm";
