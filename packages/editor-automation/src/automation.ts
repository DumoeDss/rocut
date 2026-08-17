/**
 * The agent-facing automation integration layer (design §26.7 / D24).
 *
 * One composition, consumed by the CLI host verb and by any embedding
 * application: it opens the frozen S03 transaction engine over an injected
 * `ProjectStore` and binds the Draft orchestrator to it, exposing the four
 * frozen transaction interfaces (`TransactionRead`, `TransactionApply`,
 * `TransactionGetContext`, `TransactionWatch`) plus `drafts`. It invents no
 * semantics of its own — batching, expected revision, idempotency keys,
 * conflict policy and the error vocabulary are the engine's and the draft
 * manager's, passed through unchanged.
 *
 * Pure core + injected ports: persistence, clock and id generation arrive as
 * dependencies and nothing here reaches for a store, a timer or an
 * environment on its own. Wraps — never forks — the engine and the draft
 * subsystem, so the `vectors/drivers/` conformance drivers keep both callers
 * honest.
 */
import type { ProjectId, ProjectStore } from "@opencut/editor-ports";
import type { IdGenerator } from "@opencut/editor-ports";
import {
	bindNativeCommittedTransactionStateCapture,
	createTransactionNativeDocumentAdapter,
	openTransactionEngine,
} from "@opencut/editor-contracts/engine";
import type {
	TransactionDocumentAdapter,
	TransactionEngine,
	TransactionEngineOptionalFeatures,
	TransactionPlacementPolicy,
} from "@opencut/editor-contracts/engine";
import { createDraftEditingManager } from "@opencut/editor-contracts/draft";
import type {
	DraftEditingManager,
	DraftResourceRetentionPolicy,
} from "@opencut/editor-contracts/draft";
import type {
	TransactionApply,
	TransactionGetContext,
	TransactionRead,
	TransactionWatch,
} from "@opencut/editor-contracts";

/** Draft lifecycle host policy threaded into the Draft orchestrator. */
export interface AutomationDraftOptions {
	/** TTL value in `clock` units; requires `clock` on the automation. */
	readonly ttl?: number;
	readonly journalCallBound?: number;
	readonly journalOperationBound?: number;
	/** Retention gate run before a Draft applies; defaults to permissive. */
	readonly retentionPolicy?: DraftResourceRetentionPolicy;
}

export interface AutomationDependencies<FeatureName extends string = never> {
	/** Host-injected persistence. The one thing this layer must never own. */
	readonly store: ProjectStore;
	readonly projectId: ProjectId;
	/** Defaults to the native transaction document adapter. */
	readonly documentAdapter?: TransactionDocumentAdapter;
	/** Determinism seam for generated draft ids. */
	readonly ids?: IdGenerator;
	/** Host clock for the Draft TTL mechanism (the value is host policy). */
	readonly clock?: () => number;
	readonly placementPolicies?: readonly TransactionPlacementPolicy[];
	readonly optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>;
	readonly signal?: AbortSignal;
	readonly draft?: AutomationDraftOptions;
}

/**
 * The composed automation surface. The four transaction faces delegate to the
 * engine 1:1; `drafts` is the Draft orchestrator bound to the same engine.
 */
export interface AutomationApi<FeatureName extends string = never>
	extends TransactionRead,
		TransactionApply,
		TransactionGetContext,
		TransactionWatch {
	readonly projectId: ProjectId;
	readonly engine: TransactionEngine<FeatureName>;
	readonly drafts: DraftEditingManager;
	/**
	 * Open a Draft, defaulting the public id from the injected id generator
	 * (scope `draft-id`) when the caller does not care to name one.
	 */
	openDraft(args: {
		readonly id?: string;
		readonly approvalMode: "manual" | "auto";
	}): ReturnType<DraftEditingManager["open"]>;
}

/**
 * The default retention gate: every referenced asset is treated as retained.
 * Hosts with real asset lifecycles inject their own policy through
 * `draft.retentionPolicy`.
 */
export function permissiveDraftRetentionPolicy(): DraftResourceRetentionPolicy {
	return {
		async preflight({ referencedAssetIds }) {
			return {
				retained: true,
				evidence: {
					candidateAssetIds: referencedAssetIds,
					retainedAssets: referencedAssetIds.map((assetId) => ({
						assetId,
						projectOwned: true,
					})),
					missingAssetIds: [],
				},
			};
		},
	};
}

export async function createAutomation<FeatureName extends string = never>(
	deps: AutomationDependencies<FeatureName>,
): Promise<AutomationApi<FeatureName>> {
	const engine = await openTransactionEngine<FeatureName>({
		store: deps.store,
		projectId: deps.projectId,
		documentAdapter:
			deps.documentAdapter ?? createTransactionNativeDocumentAdapter(),
		placementPolicies: deps.placementPolicies,
		optionalFeatures: deps.optionalFeatures,
		signal: deps.signal,
	});
	const committedState = bindNativeCommittedTransactionStateCapture(engine);
	if (committedState === undefined) {
		throw new Error(
			"Automation requires the native committed-state capture; wrap engines must supply one explicitly",
		);
	}
	const drafts = createDraftEditingManager({
		engine,
		committedState,
		retentionPolicy:
			deps.draft?.retentionPolicy ?? permissiveDraftRetentionPolicy(),
		placementPolicies: deps.placementPolicies,
		...(deps.clock === undefined ? {} : { clock: deps.clock }),
		...(deps.draft?.ttl === undefined ? {} : { draftTtl: deps.draft.ttl }),
		...(deps.draft?.journalCallBound === undefined
			? {}
			: { journalCallBound: deps.draft.journalCallBound }),
		...(deps.draft?.journalOperationBound === undefined
			? {}
			: { journalOperationBound: deps.draft.journalOperationBound }),
	});

	const api: AutomationApi<FeatureName> = {
		projectId: deps.projectId,
		engine,
		drafts,
		tracks: () => engine.tracks(),
		clips: (filter) => engine.clips(filter),
		assets: () => engine.assets(),
		markers: () => engine.markers(),
		project: () => engine.project(),
		revision: () => engine.revision(),
		apply: (batch) => engine.apply(batch),
		capabilities: () => engine.capabilities(),
		supportedOperations: () => engine.supportedOperations(),
		watch: (callback) => engine.watch(callback),
		openDraft(args) {
			return drafts.open({
				id:
					args.id ??
					deps.ids?.next({ scope: "draft-id" }) ??
					`draft-${Math.random().toString(36).slice(2, 10)}`,
				approvalMode: args.approvalMode,
			});
		},
	};
	return Object.freeze(api);
}
