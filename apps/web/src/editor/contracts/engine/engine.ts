import type {
	OperationKind,
	Revision,
	TrackId,
	TransactionBatch,
	TransactionResult,
} from "..";
import { OPERATION_KINDS, TransactionError } from "..";
import type { ProjectId, ProjectRecord, ProjectStore } from "@/editor/ports";
import { ProjectStoreError } from "@/editor/ports";
import {
	assertDecodedTransactionDocument,
	assertEncodedTransactionDocument,
	normalizeDecodeFailure,
} from "./adapter";
import type { TransactionDocumentAdapter } from "./adapter";
import { cloneTransactionValue } from "./clone";
import { evaluateTransactionBatch } from "./evaluator";
import { transactionDocumentInvariantIssue } from "./invariant";
import { TRANSACTION_ENGINE_BASE_FEATURES } from "./types";
import type {
	TransactionDryRunOutcome,
	TransactionEngine,
	TransactionEngineCapabilities,
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionEngineOptionalFeatures,
	TransactionPlacementPolicy,
	TransactionValidationOutcome,
} from "./types";

export interface OpenTransactionEngineOptions<
	FeatureName extends string = never,
> {
	readonly store: ProjectStore;
	readonly projectId: ProjectId;
	readonly documentAdapter: TransactionDocumentAdapter;
	readonly placementPolicies?: readonly TransactionPlacementPolicy[];
	readonly optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>;
	readonly signal?: AbortSignal;
}

function assertOptionalFeatureNames(
	features: Readonly<Record<string, boolean>> | undefined,
): void {
	if (!features) return;
	const reserved = new Set<string>(TRANSACTION_ENGINE_BASE_FEATURES);
	for (const key of Object.keys(features)) {
		if (reserved.has(key)) {
			throw new TypeError(
				`Optional feature ${key} collides with a base feature`,
			);
		}
	}
}

function hasTransactionEngineCapabilities<FeatureName extends string>(args: {
	readonly capabilities: Readonly<Record<string, boolean>>;
	readonly optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>;
}): args is {
	readonly capabilities: TransactionEngineCapabilities<FeatureName>;
	readonly optionalFeatures?: TransactionEngineOptionalFeatures<FeatureName>;
} {
	for (const key of TRANSACTION_ENGINE_BASE_FEATURES) {
		if (typeof args.capabilities[key] !== "boolean") return false;
	}
	for (const key of Object.keys(args.optionalFeatures ?? {})) {
		if (typeof args.capabilities[key] !== "boolean") return false;
	}
	return true;
}

function issueToError(issue: TransactionEngineIssue): TransactionError {
	const code =
		issue.code === "expected-revision-conflict"
			? "conflict"
			: issue.code === "idempotency-conflict"
				? "duplicate"
				: issue.code === "not-found"
					? "not-found"
					: issue.code === "unsupported-operation"
						? "unsupported"
						: "validation";
	return new TransactionError({
		code,
		message: issue.message,
		operationIndex: issue.operationIndex,
		expectedRevision: issue.expectedRevision,
		actualRevision: issue.actualRevision,
	});
}

function saveAdapterFailure(projectId: ProjectId): ProjectStoreError {
	return new ProjectStoreError({
		code: "corrupt",
		operation: "save-project",
		scope: { kind: "project", projectId },
		message: "The transaction adapter could not encode a valid replacement",
	});
}

export async function openTransactionEngine<FeatureName extends string = never>(
	options: OpenTransactionEngineOptions<FeatureName>,
): Promise<TransactionEngine<FeatureName>> {
	assertOptionalFeatureNames(options.optionalFeatures);
	const record = await options.store.load({
		id: options.projectId,
		signal: options.signal,
	});
	if (!record) {
		throw new ProjectStoreError({
			code: "unavailable",
			operation: "load-project",
			scope: { kind: "project", projectId: options.projectId },
			message: "The requested project does not exist",
		});
	}

	let committed: TransactionEngineDocument;
	try {
		committed = options.documentAdapter.decode({
			projectId: options.projectId,
			record,
		});
		assertDecodedTransactionDocument({
			projectId: options.projectId,
			record,
			document: committed,
		});
		committed = cloneTransactionValue(committed);
	} catch (error) {
		throw normalizeDecodeFailure({ projectId: options.projectId, error });
	}

	let committedRecord: ProjectRecord = cloneTransactionValue(record);
	let queue: Promise<void> = Promise.resolve();
	const watchers = new Set<(revision: Revision) => void>();

	function enqueue<Result>(action: () => Promise<Result>): Promise<Result> {
		const result = queue.then(action, action);
		queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	function notify(revision: Revision): void {
		for (const watcher of [...watchers]) {
			try {
				watcher(revision);
			} catch {
				// A subscriber cannot roll back or poison an already durable commit.
			}
		}
	}

	const capabilityCheck = {
		capabilities: Object.freeze<Record<string, boolean>>({
			...(options.optionalFeatures ?? {}),
			"atomic-batch": true,
			"expected-revision": true,
			"durable-revision": true,
			"durable-idempotency": true,
			validation: true,
			"dry-run": true,
			"placement-policy": true,
			"cross-engine-cas": false,
		}),
		optionalFeatures: options.optionalFeatures,
	};
	if (!hasTransactionEngineCapabilities(capabilityCheck)) {
		throw new TypeError("Transaction engine capabilities are invalid");
	}
	const { capabilities } = capabilityCheck;

	const engine: TransactionEngine<FeatureName> = {
		async tracks() {
			return cloneTransactionValue(committed.tracks);
		},
		async clips(filter?: { trackId: TrackId }) {
			const clips = filter
				? committed.clips.filter((clip) => clip.trackId === filter.trackId)
				: committed.clips;
			return cloneTransactionValue(clips);
		},
		async assets() {
			return cloneTransactionValue(committed.assets);
		},
		async markers() {
			return cloneTransactionValue(committed.markers);
		},
		async project() {
			return committed.project === null
				? null
				: cloneTransactionValue(committed.project);
		},
		async revision() {
			return committed.revision;
		},
		async capabilities() {
			return capabilities;
		},
		async supportedOperations(): Promise<readonly OperationKind[]> {
			return [...OPERATION_KINDS];
		},
		watch(callback) {
			watchers.add(callback);
			let subscribed = true;
			return () => {
				if (!subscribed) return;
				subscribed = false;
				watchers.delete(callback);
			};
		},
		apply(batch: TransactionBatch): Promise<TransactionResult> {
			return enqueue(async () => {
				const evaluated = await evaluateTransactionBatch({
					document: committed,
					batch,
					placementPolicies: options.placementPolicies,
				});
				if (!evaluated.accepted) throw issueToError(evaluated.issues[0]);
				if (evaluated.replayed) return cloneTransactionValue(evaluated.result);

				const candidate: TransactionEngineDocument = {
					...evaluated.document,
					idempotency:
						batch.idempotencyKey === undefined
							? evaluated.document.idempotency
							: [
									...evaluated.document.idempotency,
									{
										key: batch.idempotencyKey,
										fingerprint: evaluated.fingerprint,
										result: cloneTransactionValue(evaluated.result),
									},
								],
				};
				const candidateIssue = transactionDocumentInvariantIssue({
					projectId: options.projectId,
					document: candidate,
				});
				if (candidateIssue) {
					throw new TransactionError({
						code: "validation",
						message: `${candidateIssue.path}: ${candidateIssue.message}`,
					});
				}
				let encoded;
				try {
					encoded = options.documentAdapter.encode({
						projectId: options.projectId,
						previousRecord: committedRecord,
						document: cloneTransactionValue(candidate),
					});
					assertEncodedTransactionDocument({
						projectId: options.projectId,
						encoded,
						documentAdapter: options.documentAdapter,
					});
				} catch (error) {
					if (error instanceof ProjectStoreError) throw error;
					throw saveAdapterFailure(options.projectId);
				}
				await options.store.save({
					record: encoded.record,
					summary: encoded.summary,
					signal: options.signal,
				});
				committed = cloneTransactionValue(candidate);
				committedRecord = cloneTransactionValue(encoded.record);
				notify(committed.revision);
				return cloneTransactionValue(evaluated.result);
			});
		},
		validate(batch): Promise<TransactionValidationOutcome> {
			return enqueue(async () => {
				const evaluated = await evaluateTransactionBatch({
					document: committed,
					batch,
					placementPolicies: options.placementPolicies,
					collectAllIssues: true,
				});
				return evaluated.accepted
					? { valid: true, baseRevision: evaluated.baseRevision, issues: [] }
					: {
							valid: false,
							baseRevision: evaluated.baseRevision,
							issues: cloneTransactionValue(evaluated.issues),
						};
			});
		},
		dryRun(batch): Promise<TransactionDryRunOutcome> {
			return enqueue(async () => {
				const evaluated = await evaluateTransactionBatch({
					document: committed,
					batch,
					placementPolicies: options.placementPolicies,
				});
				return evaluated.accepted
					? {
							accepted: true,
							baseRevision: evaluated.baseRevision,
							result: cloneTransactionValue(evaluated.result),
							replayed: evaluated.replayed,
						}
					: {
							accepted: false,
							baseRevision: evaluated.baseRevision,
							issues: cloneTransactionValue(evaluated.issues),
						};
			});
		},
	};

	return engine;
}
