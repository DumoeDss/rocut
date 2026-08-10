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
} from "@/editor/contracts";
import { revisionOf } from "@/editor/contracts";
import {
	openTransactionEngine,
	type TransactionDryRunOutcome,
	type TransactionEngine,
	type TransactionEngineCapabilities,
	type TransactionEngineDocument,
	type TransactionValidationOutcome,
} from "@/editor/contracts/engine";
import type { SessionPersistenceCoordinator } from "@/editor/persistence";
import type { ProjectId as PortProjectId, ProjectRecord } from "@/editor/ports";
import type { MediaAsset } from "@/media/types";
import { createOpenCutTransactionDocumentAdapter } from "./adapter";
import { ProjectMutationArbiter } from "./arbiter";
import { cloneOpenCutDraft, projectOpenCutDraft } from "./projection";
import {
	assetCatalogFromMedia,
	type OpenCutAssetCatalogEntry,
	type OpenCutCommitToken,
	type OpenCutProjectDraft,
} from "./types";

export interface PreparedOpenCutUiCommit<Payload> {
	readonly draft: OpenCutProjectDraft;
	readonly operations: TransactionBatch["operations"];
	readonly payload: Payload;
}

export interface OpenCutUiCommitResult<Payload> {
	readonly transaction: TransactionResult;
	readonly payload: Payload;
	readonly committedDraft: OpenCutProjectDraft;
}

interface ActiveOpenCutRouter {
	readonly projectId: PortProjectId;
	readonly engine: TransactionEngine;
	readonly adapter: ReturnType<typeof createOpenCutTransactionDocumentAdapter>;
	engineUnsubscribe: (() => void) | null;
	disposed: boolean;
}

function commitToken(): OpenCutCommitToken {
	const random = globalThis.crypto?.randomUUID?.();
	const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `opencut-ui:${random ?? fallback}` as OpenCutCommitToken;
}

function mergeAssetCatalogs({
	committed,
	live,
}: {
	committed: readonly OpenCutAssetCatalogEntry[];
	live: readonly OpenCutAssetCatalogEntry[];
}): OpenCutAssetCatalogEntry[] {
	const merged = new Map(
		committed.map((asset) => [asset.id, { ...asset }] as const),
	);
	for (const asset of live) merged.set(asset.id, { ...asset });
	return [...merged.values()];
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
			options.persistence.subscribeProjectRecords((record) => {
				const active = this.active;
				if (active && !active.disposed && active.projectId === record.id) {
					active.adapter.adoptCommittedRecord(record);
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
					initialRecord: record,
					initialAssets: assetCatalogFromMedia(assets),
				});
				const engine = await openTransactionEngine({
					store: this.options.persistence.store,
					projectId: portProjectId,
					documentAdapter: adapter,
				});
				const active: ActiveOpenCutRouter = {
					projectId: portProjectId,
					engine,
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

	async commitUi<Payload>({
		baseDraft,
		prepare,
		finalize,
	}: {
		baseDraft: () => OpenCutProjectDraft;
		prepare: (args: {
			readonly draft: OpenCutProjectDraft;
			readonly baseRevision: Revision;
			readonly baseDocument: TransactionEngineDocument;
		}) => PreparedOpenCutUiCommit<Payload>;
		finalize?: (result: OpenCutUiCommitResult<Payload>) => void;
	}): Promise<OpenCutUiCommitResult<Payload>> {
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: async () => {
				this.assertCurrent(active);
				const revision = await active.engine.revision();
				const baseDocument = await this.readDocument(active.engine, revision);
				const draft = cloneOpenCutDraft(baseDraft());
				const committedDraft = active.adapter.currentDraft();
				draft.assetCatalog = mergeAssetCatalogs({
					committed: committedDraft.assetCatalog,
					live: draft.assetCatalog,
				});
				const prepared = prepare({
					draft,
					baseRevision: revision,
					baseDocument,
				});
				const token = commitToken();
				const projectedDocument = projectOpenCutDraft(prepared.draft, {
					revision: revisionOf(Number(revision) + 1),
					idempotency: [],
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
					await this.adoptAndPublish(active, receipt.record, receipt.draft);
					const committed = {
						transaction,
						payload: prepared.payload,
						committedDraft: cloneOpenCutDraft(receipt.draft),
					};
					finalize?.(committed);
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
				try {
					const result = await active.engine.apply(batch);
					const receipt = active.adapter.consumeReceipt();
					if (receipt) {
						await this.adoptAndPublish(active, receipt.record, receipt.draft);
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
			operation: () => active.engine.validate(batch),
		});
	}

	dryRun(batch: TransactionBatch): Promise<TransactionDryRunOutcome> {
		const active = this.requireActive();
		return this.options.arbiter.run({
			projectId: active.projectId,
			operation: () => active.engine.dryRun(batch),
		});
	}

	tracks(): Promise<readonly Track[]> {
		return this.requireActive().engine.tracks();
	}

	clips(filter?: { trackId: TrackId }): Promise<readonly Clip[]> {
		return this.requireActive().engine.clips(filter);
	}

	assets(): Promise<readonly Asset[]> {
		return this.requireActive().engine.assets();
	}

	markers(): Promise<readonly Marker[]> {
		return this.requireActive().engine.markers();
	}

	project(): Promise<Project | null> {
		return this.requireActive().engine.project();
	}

	revision(): Promise<Revision> {
		return this.requireActive().engine.revision();
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
	): Promise<void> {
		this.assertCurrent(active);
		await this.options.persistence.adoptCommittedProjectRecord({ record });
		active.adapter.adoptCommittedRecord(record);
		this.options.publish(cloneOpenCutDraft(draft));
	}

	private async readDocument(
		engine: TransactionEngine,
		revision: Revision,
	): Promise<TransactionEngineDocument> {
		const [project, tracks, clips, assets, markers] = await Promise.all([
			engine.project(),
			engine.tracks(),
			engine.clips(),
			engine.assets(),
			engine.markers(),
		]);
		return {
			project,
			tracks,
			clips,
			assets,
			markers,
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
