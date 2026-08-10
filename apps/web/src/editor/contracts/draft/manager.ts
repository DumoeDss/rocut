import type { Revision, TransactionBatch, TransactionOperation } from "..";
import { revisionOf } from "..";
import type { TransactionEngine, TransactionEngineDocument } from "../engine";
import { evaluateTransactionBatch } from "../engine";
import { bindNativeCommittedTransactionStateCapture } from "../engine/engine";
import { projectCommittedTransactionDocument } from "../engine/projection";
import { classifyDraftRuntimeOperation } from "./classification";
import {
	cloneDraftValue,
	deepFreezeDraftValue,
	immutableDraftErrorEvidence,
	immutableDraftValue,
} from "./immutable";
import {
	hasSameDraftContent,
	hasSameDraftReadableContent,
	hasSameDraftTransactionDocument,
	planDraftCompensatingOperations,
	referencedDraftAssetIds,
} from "./inverse";
import { deriveDraftReview } from "./review";
import type { DraftJournalCall } from "./review";
import type {
	CreateDraftEditingManagerOptions,
	DraftApplicationReceipt,
	DraftApprovalError,
	DraftApprovalOutcome,
	DraftCallError,
	DraftCallOutcome,
	DraftCommittedStateCapture,
	DraftCommittedStateError,
	DraftContentSnapshot,
	DraftEditingManager,
	DraftEditingSession,
	DraftId,
	DraftInvalidStateError,
	DraftLifecycleState,
	DraftOpenError,
	DraftOpenOutcome,
	DraftRejectionOutcome,
	DraftResourceRetentionEvidence,
	DraftSnapshot,
	DraftToolCall,
} from "./types";

const DEFAULT_SNAPSHOT_ATTEMPTS = 3;
const DRAFT_INCARNATION_BYTES = 16;

function draftIdOf(value: string): DraftId {
	return value as DraftId;
}

function encodeDraftId(value: string): string {
	let encoded = "";
	for (let index = 0; index < value.length; index += 1) {
		encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
	}
	return encoded;
}

function createDraftIncarnationId(): string {
	if (typeof globalThis.crypto?.getRandomValues !== "function") {
		throw new Error("Draft editing requires Web Crypto random values");
	}
	const bytes = globalThis.crypto.getRandomValues(
		new Uint8Array(DRAFT_INCARNATION_BYTES),
	);
	return [...bytes]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

function contentFromDocument(
	document: TransactionEngineDocument,
): DraftContentSnapshot {
	return {
		project: document.project,
		tracks: document.tracks,
		clips: document.clips,
		assets: document.assets,
		markers: document.markers,
		revision: document.revision,
	};
}

function workingDocumentFromContent(
	content: DraftContentSnapshot,
): TransactionEngineDocument {
	return {
		...cloneDraftValue(content),
		idempotency: [],
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error && error.message.length > 0
		? error.message
		: "Draft operation failed";
}

export type DraftSnapshotAcquisitionOutcome =
	| { readonly captured: true; readonly snapshot: DraftContentSnapshot }
	| { readonly captured: false; readonly error: DraftOpenError };

type DraftCommittedSnapshotAcquisitionOutcome =
	| {
			readonly captured: true;
			readonly snapshot: DraftContentSnapshot;
			readonly committedDocument: TransactionEngineDocument;
	  }
	| { readonly captured: false; readonly error: DraftOpenError };

function committedStateError(args: {
	readonly reason: DraftCommittedStateError["reason"];
	readonly message: string;
}): DraftCommittedStateError {
	return immutableDraftValue({
		kind: "committed-state-unavailable" as const,
		reason: args.reason,
		message: args.message,
	});
}

function bindCommittedStatePort(
	port: DraftCommittedStateCapture | undefined,
): DraftCommittedStateCapture | undefined {
	if (port === undefined) return undefined;
	let capture: DraftCommittedStateCapture["capture"];
	try {
		capture = port.capture;
	} catch {
		return undefined;
	}
	if (typeof capture !== "function") return undefined;
	return Object.freeze({
		capture: () => Reflect.apply(capture, port, []),
	});
}

async function acquireDraftCommittedSnapshot(
	engine: TransactionEngine,
	attempts: number,
	committedState: DraftCommittedStateCapture | undefined,
): Promise<DraftCommittedSnapshotAcquisitionOutcome> {
	if (committedState === undefined) {
		return {
			captured: false,
			error: committedStateError({
				reason: "missing-capability",
				message:
					"Draft editing requires an exact committed-state capability; public engine wrappers must supply it explicitly",
			}),
		};
	}

	let before: Revision | undefined;
	let after: Revision | undefined;
	let capabilityFailure: DraftCommittedStateError | undefined;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		let visible: DraftContentSnapshot;
		try {
			before = await engine.revision();
			visible = {
				project: await engine.project(),
				tracks: await engine.tracks(),
				clips: await engine.clips(),
				assets: await engine.assets(),
				markers: await engine.markers(),
				revision: before,
			};
		} catch (error) {
			return {
				captured: false,
				error: immutableDraftValue({
					kind: "snapshot-read-failed" as const,
					message: messageOf(error),
				}),
			};
		}

		let committedDocument: TransactionEngineDocument;
		try {
			committedDocument = cloneDraftValue(await committedState.capture());
		} catch (error) {
			capabilityFailure = committedStateError({
				reason: "capture-failed",
				message: messageOf(error),
			});
			continue;
		}

		try {
			after = await engine.revision();
		} catch (error) {
			return {
				captured: false,
				error: immutableDraftValue({
					kind: "snapshot-read-failed" as const,
					message: messageOf(error),
				}),
			};
		}
		if (before !== after) continue;

		try {
			if (
				committedDocument.revision !== before ||
				!hasSameDraftReadableContent(
					contentFromDocument(committedDocument),
					visible,
				)
			) {
				capabilityFailure = committedStateError({
					reason: "state-mismatch",
					message:
						"Committed-state capture did not match the wrapped engine's public snapshot",
				});
				continue;
			}
		} catch {
			capabilityFailure = committedStateError({
				reason: "state-mismatch",
				message: "Committed-state capture returned an invalid document",
			});
			continue;
		}

		const snapshot = immutableDraftValue(
			contentFromDocument(committedDocument),
		);
		return {
			captured: true,
			snapshot,
			committedDocument: cloneDraftValue(committedDocument),
		};
	}

	if (capabilityFailure !== undefined) {
		return { captured: false, error: capabilityFailure };
	}
	if (before === undefined || after === undefined) {
		return {
			captured: false,
			error: immutableDraftValue({
				kind: "snapshot-read-failed" as const,
				message: "Draft snapshot acquisition did not execute",
			}),
		};
	}
	return {
		captured: false,
		error: immutableDraftValue({
			kind: "snapshot-busy" as const,
			attempts,
			expectedRevision: before,
			actualRevision: after,
			message: `Project changed during all ${attempts} snapshot attempts`,
		}),
	};
}

export async function acquireDraftContentSnapshot(
	engine: TransactionEngine,
	attempts = DEFAULT_SNAPSHOT_ATTEMPTS,
	committedState?: DraftCommittedStateCapture,
): Promise<DraftSnapshotAcquisitionOutcome> {
	const nativeCommittedState =
		bindNativeCommittedTransactionStateCapture(engine);
	const acquired = await acquireDraftCommittedSnapshot(
		engine,
		attempts,
		bindCommittedStatePort(nativeCommittedState ?? committedState),
	);
	return acquired.captured
		? { captured: true, snapshot: acquired.snapshot }
		: acquired;
}

function invalidState(args: {
	readonly action: DraftInvalidStateError["action"];
	readonly state: DraftLifecycleState;
}): DraftInvalidStateError {
	return immutableDraftValue({
		kind: "invalid-state" as const,
		action: args.action,
		state: args.state,
		message: `Cannot ${args.action} a Draft in state ${args.state}`,
	});
}

function createDraftSession(args: {
	readonly id: DraftId;
	readonly encodedId: string;
	readonly incarnationId: string;
	readonly approvalMode: "manual" | "auto";
	readonly base: DraftContentSnapshot;
	readonly committedBase: TransactionEngineDocument;
	readonly options: CreateDraftEditingManagerOptions<string>;
}): DraftEditingSession {
	const { id, approvalMode, options } = args;
	const base = immutableDraftValue(args.base);
	const committedBase = cloneDraftValue(args.committedBase);
	const idempotencyNamespace = `draft:${args.encodedId}:base:${Number(base.revision)}:incarnation:${args.incarnationId}`;
	let working = workingDocumentFromContent(base);
	const journal: DraftJournalCall[] = [];
	let state: DraftLifecycleState = "editing";
	let queue: Promise<void> = Promise.resolve();
	let terminalApproval: DraftApprovalOutcome | undefined;

	function enqueue<Result>(action: () => Promise<Result>): Promise<Result> {
		const result = queue.then(action, action);
		queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	function snapshot(): DraftSnapshot {
		return immutableDraftValue({
			id,
			approvalMode,
			state,
			baseRevision: base.revision,
			base,
			working: contentFromDocument(working),
			acceptedCallCount: journal.length,
			acceptedOperationCount: journal.reduce(
				(total, call) => total + call.operations.length,
				0,
			),
		});
	}

	function callFailure(error: DraftCallError): DraftCallOutcome {
		return immutableDraftValue({
			accepted: false as const,
			snapshot: snapshot(),
			error,
		});
	}

	function draftApprovalFailure(
		draftError: DraftApprovalError,
	): DraftApprovalOutcome {
		return immutableDraftValue({ applied: false as const, state, draftError });
	}

	async function applyJournal(): Promise<DraftApprovalOutcome> {
		state = "applying";
		const approvalCapture = await acquireDraftCommittedSnapshot(
			options.engine,
			options.snapshotAttempts ?? DEFAULT_SNAPSHOT_ATTEMPTS,
			options.committedState,
		);
		if (!approvalCapture.captured) {
			const captureError: DraftCommittedStateError =
				approvalCapture.error.kind === "committed-state-unavailable"
					? approvalCapture.error
					: committedStateError({
							reason:
								approvalCapture.error.kind === "snapshot-busy"
									? "state-mismatch"
									: "capture-failed",
							message: `Draft approval could not prove committed state: ${approvalCapture.error.message}`,
						});
			state = "conflicted";
			terminalApproval = draftApprovalFailure(captureError);
			return terminalApproval;
		}
		if (
			approvalCapture.committedDocument.revision === base.revision &&
			!hasSameDraftTransactionDocument(
				approvalCapture.committedDocument,
				committedBase,
			)
		) {
			state = "conflicted";
			terminalApproval = draftApprovalFailure(
				committedStateError({
					reason: "state-mismatch",
					message:
						"Committed state changed without a revision change; Draft approval failed closed",
				}),
			);
			return terminalApproval;
		}
		// Clone the flattened journal as one graph so aliases deliberately shared
		// by operations in the same accepted call survive final approval.
		const operations = cloneDraftValue(
			journal.flatMap((call) => call.operations),
		);
		const review = deriveDraftReview(journal);
		const candidate = immutableDraftValue(contentFromDocument(working));
		const referencedAssetIds = referencedDraftAssetIds(candidate);
		let retention;
		try {
			retention = await options.retentionPolicy.preflight({
				draftId: id,
				candidate,
				referencedAssetIds,
			});
		} catch (error) {
			const evidence: DraftResourceRetentionEvidence = immutableDraftValue({
				candidateAssetIds: referencedAssetIds,
				retainedAssets: [],
				missingAssetIds: referencedAssetIds,
			});
			state = "conflicted";
			terminalApproval = draftApprovalFailure({
				kind: "retention-failed",
				reason: "policy-failed",
				message: messageOf(error),
				evidence,
			});
			return terminalApproval;
		}
		if (!retention.retained) {
			state = "conflicted";
			terminalApproval = draftApprovalFailure({
				kind: "retention-failed",
				reason: retention.reason,
				message: retention.message,
				evidence: retention.evidence,
			});
			return terminalApproval;
		}

		const forwardBatch: TransactionBatch = immutableDraftValue({
			operations,
			expectedRevision: base.revision,
			idempotencyKey: `${idempotencyNamespace}:apply`,
		});
		const expectedAppliedRevision = revisionOf(Number(base.revision) + 1);
		const undoIdempotencyKey = `${idempotencyNamespace}:undo`;
		let compensatingOperations: readonly TransactionOperation[];
		try {
			const forwardEvaluation = await evaluateTransactionBatch({
				document: cloneDraftValue(committedBase),
				batch: forwardBatch,
				collectAllIssues: true,
			});
			if (!forwardEvaluation.accepted || forwardEvaluation.replayed) {
				throw new Error(
					"Draft forward projection did not produce a new accepted transaction",
				);
			}
			if (
				forwardEvaluation.result.revision !== expectedAppliedRevision ||
				!hasSameDraftContent(
					contentFromDocument(forwardEvaluation.document),
					candidate,
				)
			) {
				throw new Error(
					"Draft forward projection did not match the accepted candidate",
				);
			}
			const projectedCommitted = projectCommittedTransactionDocument({
				evaluatedDocument: forwardEvaluation.document,
				batch: forwardBatch,
				result: forwardEvaluation.result,
				fingerprint: forwardEvaluation.fingerprint,
			});
			compensatingOperations = planDraftCompensatingOperations({
				base,
				candidate,
				operations,
			});
			const compensationPreflight = await evaluateTransactionBatch({
				document: projectedCommitted,
				batch: {
					operations: compensatingOperations,
					expectedRevision: expectedAppliedRevision,
					idempotencyKey: undoIdempotencyKey,
				},
				placementPolicies: options.placementPolicies,
				collectAllIssues: true,
			});
			if (!compensationPreflight.accepted) {
				state = "conflicted";
				terminalApproval = draftApprovalFailure({
					kind: "compensation-rejected",
					issues: compensationPreflight.issues,
					message: "Draft compensation was rejected before the forward apply",
				});
				return terminalApproval;
			}
			if (
				!hasSameDraftContent(
					contentFromDocument(compensationPreflight.document),
					base,
				)
			) {
				state = "conflicted";
				terminalApproval = draftApprovalFailure({
					kind: "compensation-failed",
					message: "Draft compensation did not restore the captured base",
				});
				return terminalApproval;
			}
		} catch (error) {
			state = "conflicted";
			terminalApproval = draftApprovalFailure({
				kind: "compensation-failed",
				message: messageOf(error),
			});
			return terminalApproval;
		}
		try {
			const forwardResult = await options.engine.apply(forwardBatch);
			if (forwardResult.revision !== expectedAppliedRevision) {
				state = "conflicted";
				terminalApproval = draftApprovalFailure({
					kind: "unexpected-applied-revision",
					expectedRevision: expectedAppliedRevision,
					actualRevision: forwardResult.revision,
					message: `Draft apply returned revision ${forwardResult.revision}; expected ${expectedAppliedRevision}`,
				});
				return terminalApproval;
			}
			const receipt: DraftApplicationReceipt = immutableDraftValue({
				origin: { kind: "draft" as const, draftId: id },
				approvalMode,
				baseRevision: base.revision,
				appliedRevision: forwardResult.revision,
				review,
				forwardBatch,
				forwardResult,
				retentionEvidence: retention.evidence,
				undoPlan: {
					kind: "compensating-transaction" as const,
					batch: {
						operations: compensatingOperations,
						expectedRevision: forwardResult.revision,
						idempotencyKey: undoIdempotencyKey,
					},
				},
			});
			state = "applied";
			terminalApproval = Object.freeze({
				applied: true as const,
				state: "applied" as const,
				receipt,
			});
			return terminalApproval;
		} catch (engineError) {
			state = "conflicted";
			terminalApproval = Object.freeze({
				applied: false as const,
				state: "conflicted" as const,
				engineError: immutableDraftErrorEvidence(engineError),
			});
			return terminalApproval;
		}
	}

	async function stageAction(call: DraftToolCall): Promise<DraftCallOutcome> {
		if (state !== "editing")
			return callFailure(invalidState({ action: "stage", state }));
		const rawOperations = Reflect.get(call as object, "operations");
		if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
			return callFailure({
				kind: "empty-call",
				message: "Draft calls must contain operations",
			});
		}
		const operations: TransactionOperation[] = [];
		for (
			let operationIndex = 0;
			operationIndex < rawOperations.length;
			operationIndex += 1
		) {
			const classified = classifyDraftRuntimeOperation(
				rawOperations[operationIndex],
			);
			if (classified.handling === "immediate") {
				return callFailure({
					kind: "immediate-operation-required",
					operationIndex,
					immediateKind: classified.kind,
					message: `${classified.kind} must run outside a rejectable Draft`,
				});
			}
			if (classified.handling === "unsupported") {
				return callFailure({
					kind: "unsupported-draft-operation",
					operationIndex,
					operationKind: classified.kind,
					message: `Unsupported Draft operation ${classified.kind}`,
				});
			}
			operations.push(classified.operation);
		}

		let evaluated;
		try {
			evaluated = await evaluateTransactionBatch({
				document: cloneDraftValue(working),
				batch: { operations },
				placementPolicies: options.placementPolicies,
				collectAllIssues: true,
			});
		} catch (error) {
			return callFailure({
				kind: "evaluation-failed",
				message: messageOf(error),
			});
		}
		if (!evaluated.accepted) {
			return callFailure({
				kind: "evaluation-rejected",
				issues: evaluated.issues,
				message: "Draft call was rejected by transaction evaluation",
			});
		}
		working = cloneDraftValue(evaluated.document);
		journal.push(immutableDraftValue({ operations }));
		const application =
			approvalMode === "auto" ? await applyJournal() : undefined;
		const accepted = {
			accepted: true as const,
			snapshot: snapshot(),
			review: deriveDraftReview(journal),
			...(application === undefined ? {} : { application }),
		};
		return deepFreezeDraftValue(accepted);
	}

	const session: DraftEditingSession = {
		id,
		approvalMode,
		snapshot,
		stage(call) {
			return enqueue(() => stageAction(call));
		},
		review() {
			return deriveDraftReview(journal);
		},
		approve() {
			return enqueue(async () => {
				if (approvalMode !== "manual") {
					return draftApprovalFailure({
						kind: "mode-incompatible",
						expectedMode: "manual",
						actualMode: approvalMode,
						message: "Auto Drafts approve only through stage",
					});
				}
				if (state === "applied" && terminalApproval?.applied)
					return terminalApproval;
				if (state !== "editing") {
					return draftApprovalFailure(
						invalidState({ action: "approve", state }),
					);
				}
				if (journal.length === 0) {
					return draftApprovalFailure({
						kind: "empty-draft",
						message: "Cannot approve an empty Draft",
					});
				}
				return applyJournal();
			});
		},
		reject() {
			return enqueue(async (): Promise<DraftRejectionOutcome> => {
				if (state !== "editing") {
					return immutableDraftValue({
						rejected: false as const,
						snapshot: snapshot(),
						error: invalidState({ action: "reject", state }),
					});
				}
				state = "rejected";
				return immutableDraftValue({
					rejected: true as const,
					snapshot: snapshot(),
				});
			});
		},
	};
	return Object.freeze(session);
}

export function createDraftEditingManager<FeatureName extends string = never>(
	options: CreateDraftEditingManagerOptions<FeatureName>,
): DraftEditingManager {
	const snapshotAttempts =
		options.snapshotAttempts ?? DEFAULT_SNAPSHOT_ATTEMPTS;
	if (!Number.isInteger(snapshotAttempts) || snapshotAttempts <= 0) {
		throw new TypeError("snapshotAttempts must be a positive integer");
	}
	const nativeCommittedState = bindNativeCommittedTransactionStateCapture(
		options.engine,
	);
	const committedState = bindCommittedStatePort(
		nativeCommittedState ?? options.committedState,
	);
	const frozenOptions: CreateDraftEditingManagerOptions<string> = {
		engine: options.engine,
		...(committedState === undefined ? {} : { committedState }),
		retentionPolicy: options.retentionPolicy,
		placementPolicies: Object.freeze([...(options.placementPolicies ?? [])]),
		snapshotAttempts,
	};
	const usedIds = new Set<string>();

	return Object.freeze({
		async open(input: {
			readonly id: string;
			readonly approvalMode: "manual" | "auto";
		}): Promise<DraftOpenOutcome> {
			if (typeof input.id !== "string" || input.id.trim().length === 0) {
				return {
					opened: false,
					error: immutableDraftValue({
						kind: "invalid-draft-id",
						message: "Draft id must be a non-empty string",
					}),
				};
			}
			if (input.approvalMode !== "manual" && input.approvalMode !== "auto") {
				return {
					opened: false,
					error: immutableDraftValue({
						kind: "invalid-approval-mode",
						approvalMode: String(input.approvalMode),
						message: "Draft approval mode must be manual or auto",
					}),
				};
			}
			if (usedIds.has(input.id)) {
				return {
					opened: false,
					error: immutableDraftValue({
						kind: "duplicate-draft-id",
						draftId: input.id,
						message: `Draft id ${input.id} is already in use`,
					}),
				};
			}
			// UTF-16 code-unit hex is total over every JavaScript string and
			// injective, including lone surrogates. Construct the complete key
			// identity before reserving the public id so an environment failure
			// (for example unavailable Web Crypto) cannot poison this manager.
			const encodedId = encodeDraftId(input.id);
			const incarnationId = createDraftIncarnationId();
			usedIds.add(input.id);
			const acquired = await acquireDraftCommittedSnapshot(
				options.engine,
				snapshotAttempts,
				committedState,
			);
			if (!acquired.captured) {
				usedIds.delete(input.id);
				return { opened: false, error: acquired.error };
			}
			return {
				opened: true,
				session: createDraftSession({
					id: draftIdOf(input.id),
					encodedId,
					incarnationId,
					approvalMode: input.approvalMode,
					base: acquired.snapshot,
					committedBase: acquired.committedDocument,
					options: frozenOptions,
				}),
			};
		},
	});
}
