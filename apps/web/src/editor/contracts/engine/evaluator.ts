import type {
	ProjectPatch,
	TransactionBatch,
	TransactionOperation,
	TransactionResult,
} from "..";
import { revisionOf } from "..";
import {
	canonicalOperationFingerprint,
	cloneTransactionValue,
	deepFreezeTransactionValue,
} from "./clone";
import {
	isValidAsset,
	isValidClip,
	isValidMarker,
	isValidProject,
	isValidTrack,
	validateTransactionDocument,
} from "./invariant";
import { evaluateBasePlacementPolicy } from "./placement";
import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionPlacementPolicy,
} from "./types";

const PROJECT_PATCH_KEYS = new Set([
	"name",
	"frameRate",
	"canvasWidth",
	"canvasHeight",
]);
const FRAME_RATE_KEYS = ["numerator", "denominator"] as const;

export type TransactionEvaluation =
	| {
			readonly accepted: true;
			readonly baseRevision: TransactionEngineDocument["revision"];
			readonly document: TransactionEngineDocument;
			readonly result: TransactionResult;
			readonly fingerprint: string;
			readonly replayed: boolean;
	  }
	| {
			readonly accepted: false;
			readonly baseRevision: TransactionEngineDocument["revision"];
			readonly issues: readonly TransactionEngineIssue[];
			readonly fingerprint?: string;
	  };

function issue(args: {
	readonly code: TransactionEngineIssue["code"];
	readonly message: string;
	readonly operationIndex?: number;
	readonly entityIds?: readonly string[];
	readonly expectedRevision?: TransactionEngineDocument["revision"];
	readonly actualRevision?: TransactionEngineDocument["revision"];
}): TransactionEngineIssue {
	return args;
}

function readProjectPatch(args: {
	readonly value: unknown;
	readonly operationIndex: number;
}):
	| { readonly valid: true; readonly patch: ProjectPatch }
	| { readonly valid: false; readonly issue: TransactionEngineIssue } {
	const { value, operationIndex } = args;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return {
			valid: false,
			issue: issue({
				code: "invalid-entity",
				message: "Project patch must be an object",
				operationIndex,
			}),
		};
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length === 0) {
		return {
			valid: false,
			issue: issue({
				code: "invalid-entity",
				message: "Project patch must not be empty",
				operationIndex,
			}),
		};
	}
	const patch: Record<string, unknown> = {};
	for (const key of keys) {
		if (typeof key !== "string" || !PROJECT_PATCH_KEYS.has(key)) {
			return {
				valid: false,
				issue: issue({
					code: "invalid-entity",
					message: `Project patch contains unsupported key ${String(key)}`,
					operationIndex,
				}),
			};
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			return {
				valid: false,
				issue: issue({
					code: "invalid-entity",
					message: "Project patch requires enumerable data properties",
					operationIndex,
				}),
			};
		}
		if (key !== "frameRate") {
			patch[key] = descriptor.value;
			continue;
		}
		const frameRate = descriptor.value;
		if (
			frameRate === null ||
			typeof frameRate !== "object" ||
			Array.isArray(frameRate)
		) {
			return {
				valid: false,
				issue: issue({
					code: "invalid-entity",
					message: "Project frame rate must be an object",
					operationIndex,
				}),
			};
		}
		const frameRateKeys = Reflect.ownKeys(frameRate);
		if (
			frameRateKeys.length !== FRAME_RATE_KEYS.length ||
			frameRateKeys.some(
				(frameRateKey) =>
					typeof frameRateKey !== "string" ||
					!FRAME_RATE_KEYS.some((expectedKey) => expectedKey === frameRateKey),
			)
		) {
			return {
				valid: false,
				issue: issue({
					code: "invalid-entity",
					message:
						"Project frame rate must contain only numerator and denominator",
					operationIndex,
				}),
			};
		}
		const normalizedFrameRate: Record<string, unknown> = {};
		for (const frameRateKey of FRAME_RATE_KEYS) {
			const frameRateDescriptor = Object.getOwnPropertyDescriptor(
				frameRate,
				frameRateKey,
			);
			if (
				!frameRateDescriptor?.enumerable ||
				!("value" in frameRateDescriptor)
			) {
				return {
					valid: false,
					issue: issue({
						code: "invalid-entity",
						message: "Project frame rate requires enumerable data properties",
						operationIndex,
					}),
				};
			}
			normalizedFrameRate[frameRateKey] = frameRateDescriptor.value;
		}
		patch.frameRate = normalizedFrameRate;
	}
	return { valid: true, patch: patch as ProjectPatch };
}

function entityExists(args: {
	readonly document: TransactionEngineDocument;
	readonly id: string;
}): boolean {
	const { document, id } = args;
	return (
		document.tracks.some((entry) => entry.id === id) ||
		document.clips.some((entry) => entry.id === id) ||
		document.assets.some((entry) => entry.id === id) ||
		document.markers.some((entry) => entry.id === id)
	);
}

function findProjectOperationIndex(
	operations: readonly TransactionOperation[],
): number {
	for (
		let operationIndex = 0;
		operationIndex < operations.length;
		operationIndex += 1
	) {
		const operation = operations[operationIndex];
		if (operation === null || typeof operation !== "object") continue;
		try {
			const kind = Object.getOwnPropertyDescriptor(operation, "kind");
			if (kind && "value" in kind && kind.value === "update-project") {
				return operationIndex;
			}
		} catch {
			// The canonicalization failure remains the authoritative structured issue.
		}
	}
	return -1;
}

function mutateOperations(args: {
	readonly document: TransactionEngineDocument;
	readonly operations: readonly TransactionOperation[];
}): {
	readonly document: TransactionEngineDocument;
	readonly createdIds: readonly string[];
	readonly changedIds: readonly string[];
	readonly issues: readonly TransactionEngineIssue[];
	readonly operationIndexByEntityId: ReadonlyMap<string, number>;
} {
	const tracks = new Map(
		args.document.tracks.map((entry) => [entry.id, entry]),
	);
	const clips = new Map(args.document.clips.map((entry) => [entry.id, entry]));
	const assets = new Map(
		args.document.assets.map((entry) => [entry.id, entry]),
	);
	const markers = new Map(
		args.document.markers.map((entry) => [entry.id, entry]),
	);
	let project = args.document.project;
	const createdIds: string[] = [];
	const changedIds: string[] = [];
	const issues: TransactionEngineIssue[] = [];
	const origins = new Map<string, number>();

	const currentDocument = (): TransactionEngineDocument => ({
		...args.document,
		project,
		tracks: [...tracks.values()],
		clips: [...clips.values()],
		assets: [...assets.values()],
		markers: [...markers.values()],
	});

	for (
		let operationIndex = 0;
		operationIndex < args.operations.length;
		operationIndex += 1
	) {
		const operation = args.operations[
			operationIndex
		] as TransactionOperation & {
			readonly kind: string;
		};
		const rawOperationKind = Reflect.get(operation, "kind");
		switch (operation.kind) {
			case "update-project": {
				if (project === null || project.id !== operation.projectId) {
					issues.push(
						issue({
							code: "not-found",
							message: `Project ${operation.projectId} not found`,
							operationIndex,
							entityIds: [operation.projectId],
						}),
					);
					break;
				}
				const parsed = readProjectPatch({
					value: operation.patch,
					operationIndex,
				});
				if (!parsed.valid) {
					issues.push(parsed.issue);
					break;
				}
				const updated = {
					...project,
					...parsed.patch,
					id: project.id,
				};
				if (!isValidProject(updated, project.id)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: `Invalid Project ${operation.projectId}`,
							operationIndex,
							entityIds: [operation.projectId],
						}),
					);
					break;
				}
				const frameRateChanged =
					updated.frameRate.numerator !== project.frameRate.numerator ||
					updated.frameRate.denominator !== project.frameRate.denominator;
				project = updated;
				changedIds.push(operation.projectId);
				if (frameRateChanged) {
					origins.set(operation.projectId, operationIndex);
				}
				break;
			}
			case "create-track": {
				if (!isValidTrack(operation.track)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: "Invalid track",
							operationIndex,
						}),
					);
					break;
				}
				if (
					entityExists({
						document: currentDocument(),
						id: operation.track.id,
					})
				) {
					issues.push(
						issue({
							code: "duplicate-id",
							message: `Entity ${operation.track.id} already exists`,
							operationIndex,
							entityIds: [operation.track.id],
						}),
					);
					break;
				}
				tracks.set(operation.track.id, operation.track);
				createdIds.push(operation.track.id);
				origins.set(operation.track.id, operationIndex);
				break;
			}
			case "update-track": {
				const existing = tracks.get(operation.trackId);
				if (!existing) {
					issues.push(
						issue({
							code: "not-found",
							message: `Track ${operation.trackId} not found`,
							operationIndex,
							entityIds: [operation.trackId],
						}),
					);
					break;
				}
				const updated = { ...existing, ...operation.patch };
				if (!isValidTrack(updated)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: `Invalid track ${operation.trackId}`,
							operationIndex,
							entityIds: [operation.trackId],
						}),
					);
					break;
				}
				tracks.set(operation.trackId, updated);
				changedIds.push(operation.trackId);
				origins.set(operation.trackId, operationIndex);
				break;
			}
			case "delete-track": {
				if (!tracks.has(operation.trackId)) {
					issues.push(
						issue({
							code: "not-found",
							message: `Track ${operation.trackId} not found`,
							operationIndex,
							entityIds: [operation.trackId],
						}),
					);
					break;
				}
				tracks.delete(operation.trackId);
				for (const [clipId, clip] of clips) {
					if (clip.trackId !== operation.trackId) continue;
					clips.delete(clipId);
					changedIds.push(clipId);
					origins.set(clipId, operationIndex);
				}
				changedIds.push(operation.trackId);
				origins.set(operation.trackId, operationIndex);
				break;
			}
			case "create-clip": {
				if (!isValidClip(operation.clip)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: "Invalid clip",
							operationIndex,
						}),
					);
					break;
				}
				if (
					entityExists({
						document: currentDocument(),
						id: operation.clip.id,
					})
				) {
					issues.push(
						issue({
							code: "duplicate-id",
							message: `Entity ${operation.clip.id} already exists`,
							operationIndex,
							entityIds: [operation.clip.id],
						}),
					);
					break;
				}
				if (!tracks.has(operation.clip.trackId)) {
					issues.push(
						issue({
							code: "missing-relation",
							message: `Track ${operation.clip.trackId} not found`,
							operationIndex,
							entityIds: [operation.clip.id, operation.clip.trackId],
						}),
					);
					break;
				}
				if (
					operation.clip.assetId !== undefined &&
					!assets.has(operation.clip.assetId)
				) {
					issues.push(
						issue({
							code: "missing-relation",
							message: `Asset ${operation.clip.assetId} not found`,
							operationIndex,
							entityIds: [operation.clip.id, operation.clip.assetId],
						}),
					);
					break;
				}
				clips.set(operation.clip.id, operation.clip);
				createdIds.push(operation.clip.id);
				origins.set(operation.clip.id, operationIndex);
				break;
			}
			case "update-clip": {
				const existing = clips.get(operation.clipId);
				if (!existing) {
					issues.push(
						issue({
							code: "not-found",
							message: `Clip ${operation.clipId} not found`,
							operationIndex,
							entityIds: [operation.clipId],
						}),
					);
					break;
				}
				const updated = { ...existing, ...operation.patch };
				if (!isValidClip(updated)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: `Invalid clip ${operation.clipId}`,
							operationIndex,
							entityIds: [operation.clipId],
						}),
					);
					break;
				}
				if (!tracks.has(updated.trackId)) {
					issues.push(
						issue({
							code: "missing-relation",
							message: `Track ${updated.trackId} not found`,
							operationIndex,
							entityIds: [operation.clipId, updated.trackId],
						}),
					);
					break;
				}
				if (updated.assetId !== undefined && !assets.has(updated.assetId)) {
					issues.push(
						issue({
							code: "missing-relation",
							message: `Asset ${updated.assetId} not found`,
							operationIndex,
							entityIds: [operation.clipId, updated.assetId],
						}),
					);
					break;
				}
				clips.set(operation.clipId, updated);
				changedIds.push(operation.clipId);
				origins.set(operation.clipId, operationIndex);
				break;
			}
			case "delete-clip": {
				if (!clips.has(operation.clipId)) {
					issues.push(
						issue({
							code: "not-found",
							message: `Clip ${operation.clipId} not found`,
							operationIndex,
							entityIds: [operation.clipId],
						}),
					);
					break;
				}
				clips.delete(operation.clipId);
				changedIds.push(operation.clipId);
				origins.set(operation.clipId, operationIndex);
				break;
			}
			case "create-asset": {
				if (!isValidAsset(operation.asset)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: "Invalid asset",
							operationIndex,
						}),
					);
					break;
				}
				if (
					entityExists({
						document: currentDocument(),
						id: operation.asset.id,
					})
				) {
					issues.push(
						issue({
							code: "duplicate-id",
							message: `Entity ${operation.asset.id} already exists`,
							operationIndex,
							entityIds: [operation.asset.id],
						}),
					);
					break;
				}
				assets.set(operation.asset.id, operation.asset);
				createdIds.push(operation.asset.id);
				origins.set(operation.asset.id, operationIndex);
				break;
			}
			case "delete-asset": {
				if (!assets.has(operation.assetId)) {
					issues.push(
						issue({
							code: "not-found",
							message: `Asset ${operation.assetId} not found`,
							operationIndex,
							entityIds: [operation.assetId],
						}),
					);
					break;
				}
				const referencing = [...clips.values()].filter(
					(clip) => clip.assetId === operation.assetId,
				);
				if (referencing.length > 0) {
					issues.push(
						issue({
							code: "missing-relation",
							message: `Asset ${operation.assetId} is still referenced`,
							operationIndex,
							entityIds: [
								operation.assetId,
								...referencing.map((clip) => clip.id),
							],
						}),
					);
					break;
				}
				assets.delete(operation.assetId);
				changedIds.push(operation.assetId);
				origins.set(operation.assetId, operationIndex);
				break;
			}
			case "create-marker": {
				if (!isValidMarker(operation.marker)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: "Invalid marker",
							operationIndex,
						}),
					);
					break;
				}
				if (
					entityExists({
						document: currentDocument(),
						id: operation.marker.id,
					})
				) {
					issues.push(
						issue({
							code: "duplicate-id",
							message: `Entity ${operation.marker.id} already exists`,
							operationIndex,
							entityIds: [operation.marker.id],
						}),
					);
					break;
				}
				markers.set(operation.marker.id, operation.marker);
				createdIds.push(operation.marker.id);
				origins.set(operation.marker.id, operationIndex);
				break;
			}
			case "update-marker": {
				const existing = markers.get(operation.markerId);
				if (!existing) {
					issues.push(
						issue({
							code: "not-found",
							message: `Marker ${operation.markerId} not found`,
							operationIndex,
							entityIds: [operation.markerId],
						}),
					);
					break;
				}
				const updated = { ...existing, ...operation.patch };
				if (!isValidMarker(updated)) {
					issues.push(
						issue({
							code: "invalid-entity",
							message: `Invalid marker ${operation.markerId}`,
							operationIndex,
							entityIds: [operation.markerId],
						}),
					);
					break;
				}
				markers.set(operation.markerId, updated);
				changedIds.push(operation.markerId);
				origins.set(operation.markerId, operationIndex);
				break;
			}
			case "delete-marker": {
				if (!markers.has(operation.markerId)) {
					issues.push(
						issue({
							code: "not-found",
							message: `Marker ${operation.markerId} not found`,
							operationIndex,
							entityIds: [operation.markerId],
						}),
					);
					break;
				}
				markers.delete(operation.markerId);
				changedIds.push(operation.markerId);
				origins.set(operation.markerId, operationIndex);
				break;
			}
			default:
				issues.push(
					issue({
						code: "unsupported-operation",
						message: `Unsupported operation ${String(rawOperationKind)}`,
						operationIndex,
					}),
				);
		}
	}

	return {
		document: currentDocument(),
		createdIds,
		changedIds,
		issues,
		operationIndexByEntityId: origins,
	};
}

export async function evaluateTransactionBatch(args: {
	readonly document: TransactionEngineDocument;
	readonly batch: TransactionBatch;
	readonly placementPolicies?: readonly TransactionPlacementPolicy[];
	readonly collectAllIssues?: boolean;
}): Promise<TransactionEvaluation> {
	const document = cloneTransactionValue(args.document);
	const baseRevision = document.revision;
	let fingerprint: string;
	let operations: readonly TransactionOperation[];
	try {
		fingerprint = canonicalOperationFingerprint(args.batch.operations);
		// Clone the complete operation array once. Per-operation or per-entity
		// cloning destroys aliases intentionally shared by patches in one atomic
		// batch and makes exact provider-private restoration impossible.
		operations = cloneTransactionValue(args.batch.operations);
	} catch {
		const projectOperationIndex = findProjectOperationIndex(
			args.batch.operations,
		);
		return {
			accepted: false,
			baseRevision,
			issues: [
				issue({
					code: "invalid-entity",
					message: "Operations are not canonically serializable",
					...(projectOperationIndex < 0
						? {}
						: { operationIndex: projectOperationIndex }),
				}),
			],
		};
	}

	const keyed =
		args.batch.idempotencyKey === undefined
			? undefined
			: document.idempotency.find(
					(entry) => entry.key === args.batch.idempotencyKey,
				);
	if (
		args.batch.idempotencyKey !== undefined &&
		(typeof args.batch.idempotencyKey !== "string" ||
			args.batch.idempotencyKey.length === 0)
	) {
		return {
			accepted: false,
			baseRevision,
			fingerprint,
			issues: [
				issue({
					code: "invalid-entity",
					message: "Idempotency key must be a non-empty string",
				}),
			],
		};
	}
	if (keyed) {
		if (keyed.fingerprint === fingerprint) {
			return {
				accepted: true,
				baseRevision,
				document,
				result: cloneTransactionValue(keyed.result),
				fingerprint,
				replayed: true,
			};
		}
		return {
			accepted: false,
			baseRevision,
			fingerprint,
			issues: [
				issue({
					code: "idempotency-conflict",
					message: `Idempotency key ${args.batch.idempotencyKey} was already used`,
				}),
			],
		};
	}

	const preflightIssues: TransactionEngineIssue[] = [];
	if (
		args.batch.expectedRevision !== undefined &&
		args.batch.expectedRevision !== baseRevision
	) {
		preflightIssues.push(
			issue({
				code: "expected-revision-conflict",
				message: `Expected revision ${args.batch.expectedRevision}, actual ${baseRevision}`,
				expectedRevision: args.batch.expectedRevision,
				actualRevision: baseRevision,
			}),
		);
		if (!args.collectAllIssues) {
			return {
				accepted: false,
				baseRevision,
				fingerprint,
				issues: preflightIssues,
			};
		}
	}
	if (args.batch.operations.length === 0) {
		preflightIssues.push(
			issue({
				code: "empty-batch",
				message: "Batch must contain at least one operation",
			}),
		);
	}

	const reduced = mutateOperations({
		document,
		operations,
	});
	const candidateRevision = revisionOf(Number(baseRevision) + 1);
	const candidate: TransactionEngineDocument = {
		...reduced.document,
		revision: candidateRevision,
	};
	const invariantIssues = validateTransactionDocument({
		projectId:
			candidate.project?.id ??
			args.document.project?.id ??
			"projectless-transaction-document",
		document: candidate,
	}).map((entry) =>
		issue({
			code: "invalid-entity",
			message: `${entry.path}: ${entry.message}`,
		}),
	);
	const placementContext = {
		document: candidate,
		batch: { ...args.batch, operations },
		operationIndexByEntityId: reduced.operationIndexByEntityId,
	};
	const placementIssues = evaluateBasePlacementPolicy(placementContext);
	const providerIssues: TransactionEngineIssue[] = [];
	for (const policy of args.placementPolicies ?? []) {
		const providerContext = deepFreezeTransactionValue(
			cloneTransactionValue(placementContext),
		);
		providerIssues.push(
			...cloneTransactionValue(await policy.evaluate(providerContext)),
		);
	}
	const issues = [
		...preflightIssues,
		...reduced.issues,
		...invariantIssues,
		...placementIssues,
		...providerIssues,
	];
	if (issues.length > 0) {
		return { accepted: false, baseRevision, fingerprint, issues };
	}
	return {
		accepted: true,
		baseRevision,
		document: candidate,
		result: {
			revision: candidateRevision,
			createdIds: reduced.createdIds,
			changedIds: reduced.changedIds,
		},
		fingerprint,
		replayed: false,
	};
}
