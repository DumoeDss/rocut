/**
 * The adapter's own transaction target (S05 P3, design E7).
 *
 * Semantics are the published contract's, verbatim: idempotency before
 * revision, collisions before patch validation, atomic batches over working
 * copies, cascade deletes, monotonic revisions, watchers firing only on real
 * changes. The representation is this adapter's own: every entity lives as a
 * JSON string in a per-kind Map, so a read is a parse (defensive cloning for
 * free) and a write is a serialize -- the same alien discipline as the store,
 * applied to the in-memory contract surface.
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
	Revision,
	Track,
	TrackId,
} from "@opencut/editor-contracts";
import {
	INITIAL_REVISION,
	revisionOf,
	TransactionError,
} from "@opencut/editor-contracts";
import type {
	OperationKind,
	ProjectPatch,
	TransactionBatch,
	TransactionResult,
} from "@opencut/editor-contracts";
import { OPERATION_KINDS, validateFrameRate } from "@opencut/editor-contracts";
import type {
	TransactionApply,
	TransactionGetContext,
	TransactionRead,
	TransactionWatch,
} from "@opencut/editor-contracts";

/** The adapter's combined transaction target. */
export interface AlienTransactionTarget
	extends
		TransactionRead,
		TransactionApply,
		TransactionGetContext,
		TransactionWatch {}

const PROJECT_PATCH_KEYS = new Set([
	"name",
	"frameRate",
	"canvasWidth",
	"canvasHeight",
]);

function invalidPatch(message: string, operationIndex: number): never {
	throw new TransactionError({
		code: "validation",
		message,
		operationIndex,
	});
}

/**
 * The adapter's patch reader: object, non-empty, supported keys, enumerable
 * data properties, frameRate exactly numerator+denominator. The reference's
 * rules, re-derived from the contract rather than copied.
 */
function readProjectPatch(
	value: unknown,
	operationIndex: number,
): ProjectPatch {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return invalidPatch("Project patch must be an object", operationIndex);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length === 0) {
		return invalidPatch("Project patch must not be empty", operationIndex);
	}
	const patch: Record<string, unknown> = {};
	for (const key of keys) {
		if (typeof key !== "string" || !PROJECT_PATCH_KEYS.has(key)) {
			return invalidPatch(
				`Project patch contains unsupported key ${String(key)}`,
				operationIndex,
			);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			return invalidPatch(
				"Project patch requires enumerable data properties",
				operationIndex,
			);
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
			return invalidPatch(
				"Project frame rate must be an object",
				operationIndex,
			);
		}
		const frameKeys = Reflect.ownKeys(frameRate);
		if (
			frameKeys.length !== 2 ||
			!frameKeys.every(
				(frameKey) =>
					(frameKey === "numerator" || frameKey === "denominator") &&
					typeof frameKey === "string",
			)
		) {
			return invalidPatch(
				"Project frame rate must contain only numerator and denominator",
				operationIndex,
			);
		}
		const normalized: Record<string, unknown> = {};
		for (const frameKey of ["numerator", "denominator"] as const) {
			const descriptor2 = Object.getOwnPropertyDescriptor(frameRate, frameKey);
			if (!descriptor2?.enumerable || !("value" in descriptor2)) {
				return invalidPatch(
					"Project frame rate requires enumerable data properties",
					operationIndex,
				);
			}
			normalized[frameKey] = descriptor2.value;
		}
		patch.frameRate = normalized;
	}
	return patch as ProjectPatch;
}

function isValidProject(value: unknown, expectedId: ProjectId): value is Project {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const candidate = value as Readonly<Record<string, unknown>>;
	if (
		candidate.id !== expectedId ||
		typeof candidate.name !== "string" ||
		candidate.name.length === 0 ||
		typeof candidate.canvasWidth !== "number" ||
		!Number.isFinite(candidate.canvasWidth) ||
		candidate.canvasWidth <= 0 ||
		typeof candidate.canvasHeight !== "number" ||
		!Number.isFinite(candidate.canvasHeight) ||
		candidate.canvasHeight <= 0 ||
		candidate.frameRate === null ||
		typeof candidate.frameRate !== "object" ||
		Array.isArray(candidate.frameRate)
	) {
		return false;
	}
	const frameRate = candidate.frameRate as Readonly<Record<string, unknown>>;
	if (
		typeof frameRate.numerator !== "number" ||
		typeof frameRate.denominator !== "number"
	) {
		return false;
	}
	try {
		validateFrameRate({
			numerator: frameRate.numerator,
			denominator: frameRate.denominator,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * The adapter's canonical form for idempotency fingerprints: JSON with sorted
 * keys and tag-prefixed scalars. Same rules as the contract -- string keys,
 * enumerable data properties, finite numbers, no cycles, no functions or
 * symbols -- spelled this adapter's way.
 */
function canonicalText(value: unknown, seen: Set<object>): string {
	if (value === null) return "n:";
	if (value === undefined) return "u:";
	if (typeof value === "boolean") return `b:${value}`;
	if (typeof value === "string") return `s:${JSON.stringify(value)}`;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("numbers must be finite");
		}
		return `#:${Object.is(value, -0) ? "-0" : String(value)}`;
	}
	if (typeof value !== "object") {
		throw new Error(`unsupported value type ${typeof value}`);
	}
	if (seen.has(value)) throw new Error("cycles are not serializable");
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return `[${value.map((entry) => canonicalText(entry, seen)).join(",")}]`;
		}
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") {
				throw new Error("symbol keys are not serializable");
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new Error("properties must be enumerable data properties");
			}
		}
		const body = Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalText(Reflect.get(value, key), seen)}`,
			)
			.join(",");
		return `{${body}}`;
	} finally {
		seen.delete(value);
	}
}

export interface AlienTransactionOptions {
	/** Seed the target with a project (the suite's setup seam). */
	project?: Project;
}

export function createAlienTransactionTarget(
	options: AlienTransactionOptions = {},
): AlienTransactionTarget {
	let revision: Revision = INITIAL_REVISION;
	// The alien representation: JSON text per entity, per kind.
	const trackTexts = new Map<TrackId, string>();
	const clipTexts = new Map<ClipId, string>();
	const assetTexts = new Map<AssetId, string>();
	const markerTexts = new Map<MarkerId, string>();
	let projectText: string | null = options.project
		? JSON.stringify(options.project)
		: null;
	let projectId: ProjectId | null = options.project?.id ?? null;
	const watchers = new Set<(revision: Revision) => void>();
	const idempotencyFingerprints = new Map<string, {fingerprint: string; result: TransactionResult}>();

	function parse<T>(text: string): T {
		return JSON.parse(text) as T;
	}

	function processBatch(
		operations: readonly unknown[],
	): TransactionResult {
		const workTracks = new Map(trackTexts);
		const workClips = new Map(clipTexts);
		const workAssets = new Map(assetTexts);
		const workMarkers = new Map(markerTexts);
		let workProjectText = projectText;
		let workProjectId = projectId;

		const createdIds: string[] = [];
		const changedIds: string[] = [];

		for (let i = 0; i < operations.length; i++) {
			const op = operations[i] as {
				kind: string;
				projectId?: ProjectId;
				patch?: unknown;
				track?: Track;
				trackId?: TrackId;
				clip?: Clip;
				clipId?: ClipId;
				asset?: Asset;
				assetId?: AssetId;
				marker?: Marker;
				markerId?: MarkerId;
			};
			switch (op.kind) {
				case "update-project": {
					if (
						workProjectText === null ||
						workProjectId !== op.projectId
					) {
						throw new TransactionError({
							code: "not-found",
							message: `Project ${op.projectId} not found`,
							operationIndex: i,
						});
					}
					const patch = readProjectPatch(op.patch, i);
					const current = parse<Project>(workProjectText);
					const updated = { ...current, ...patch, id: current.id };
					if (!isValidProject(updated, current.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Invalid Project ${op.projectId}`,
							operationIndex: i,
						});
					}
					workProjectText = JSON.stringify(updated);
					changedIds.push(current.id);
					break;
				}
				case "create-track": {
					if (workTracks.has(op.track!.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Track ${op.track!.id} already exists`,
							operationIndex: i,
						});
					}
					workTracks.set(op.track!.id, JSON.stringify(op.track));
					createdIds.push(op.track!.id);
					break;
				}
				case "update-track": {
					const existing = workTracks.get(op.trackId!);
					if (existing === undefined) {
						throw new TransactionError({
							code: "not-found",
							message: `Track ${op.trackId} not found`,
							operationIndex: i,
						});
					}
					const patch = (op.patch ?? {}) as Record<string, unknown>;
					const merged = { ...parse<Track>(existing), ...patch };
					workTracks.set(op.trackId!, JSON.stringify(merged));
					changedIds.push(op.trackId!);
					break;
				}
				case "delete-track": {
					if (!workTracks.has(op.trackId!)) {
						throw new TransactionError({
							code: "not-found",
							message: `Track ${op.trackId} not found`,
							operationIndex: i,
						});
					}
					workTracks.delete(op.trackId!);
					for (const [clipId, clipText] of workClips) {
						if (parse<Clip>(clipText).trackId === op.trackId) {
							workClips.delete(clipId);
							changedIds.push(clipId);
						}
					}
					changedIds.push(op.trackId!);
					break;
				}
				case "create-clip": {
					if (workClips.has(op.clip!.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Clip ${op.clip!.id} already exists`,
							operationIndex: i,
						});
					}
					if (!workTracks.has(op.clip!.trackId)) {
						throw new TransactionError({
							code: "validation",
							message: `Clip references non-existent track ${op.clip!.trackId}`,
							operationIndex: i,
						});
					}
					workClips.set(op.clip!.id, JSON.stringify(op.clip));
					createdIds.push(op.clip!.id);
					break;
				}
				case "update-clip": {
					const existing = workClips.get(op.clipId!);
					if (existing === undefined) {
						throw new TransactionError({
							code: "not-found",
							message: `Clip ${op.clipId} not found`,
							operationIndex: i,
						});
					}
					const patch = (op.patch ?? {}) as Record<string, unknown>;
					const merged = { ...parse<Clip>(existing), ...patch };
					workClips.set(op.clipId!, JSON.stringify(merged));
					changedIds.push(op.clipId!);
					break;
				}
				case "delete-clip": {
					if (!workClips.has(op.clipId!)) {
						throw new TransactionError({
							code: "not-found",
							message: `Clip ${op.clipId} not found`,
							operationIndex: i,
						});
					}
					workClips.delete(op.clipId!);
					changedIds.push(op.clipId!);
					break;
				}
				case "create-asset": {
					if (workAssets.has(op.asset!.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Asset ${op.asset!.id} already exists`,
							operationIndex: i,
						});
					}
					workAssets.set(op.asset!.id, JSON.stringify(op.asset));
					createdIds.push(op.asset!.id);
					break;
				}
				case "delete-asset": {
					if (!workAssets.has(op.assetId!)) {
						throw new TransactionError({
							code: "not-found",
							message: `Asset ${op.assetId} not found`,
							operationIndex: i,
						});
					}
					workAssets.delete(op.assetId!);
					changedIds.push(op.assetId!);
					break;
				}
				case "create-marker": {
					if (workMarkers.has(op.marker!.id)) {
						throw new TransactionError({
							code: "validation",
							message: `Marker ${op.marker!.id} already exists`,
							operationIndex: i,
						});
					}
					workMarkers.set(op.marker!.id, JSON.stringify(op.marker));
					createdIds.push(op.marker!.id);
					break;
				}
				case "update-marker": {
					const existing = workMarkers.get(op.markerId!);
					if (existing === undefined) {
						throw new TransactionError({
							code: "not-found",
							message: `Marker ${op.markerId} not found`,
							operationIndex: i,
						});
					}
					const patch = (op.patch ?? {}) as Record<string, unknown>;
					const merged = { ...parse<Marker>(existing), ...patch };
					workMarkers.set(op.markerId!, JSON.stringify(merged));
					changedIds.push(op.markerId!);
					break;
				}
				case "delete-marker": {
					if (!workMarkers.has(op.markerId!)) {
						throw new TransactionError({
							code: "not-found",
							message: `Marker ${op.markerId} not found`,
							operationIndex: i,
						});
					}
					workMarkers.delete(op.markerId!);
					changedIds.push(op.markerId!);
					break;
				}
			}
		}

		trackTexts.clear();
		for (const [k, v] of workTracks) trackTexts.set(k, v);
		clipTexts.clear();
		for (const [k, v] of workClips) clipTexts.set(k, v);
		assetTexts.clear();
		for (const [k, v] of workAssets) assetTexts.set(k, v);
		markerTexts.clear();
		for (const [k, v] of workMarkers) markerTexts.set(k, v);
		projectText = workProjectText;
		projectId = workProjectId;

		revision = revisionOf(revision + 1);
		return { revision, createdIds, changedIds };
	}

	const target: AlienTransactionTarget = {
		async tracks(): Promise<readonly Track[]> {
			return [...trackTexts.values()].map((text) => parse<Track>(text));
		},
		async clips(filter?: { trackId: TrackId }): Promise<readonly Clip[]> {
			const all = [...clipTexts.values()].map((text) => parse<Clip>(text));
			return filter ? all.filter((c) => c.trackId === filter.trackId) : all;
		},
		async assets(): Promise<readonly Asset[]> {
			return [...assetTexts.values()].map((text) => parse<Asset>(text));
		},
		async markers(): Promise<readonly Marker[]> {
			return [...markerTexts.values()].map((text) => parse<Marker>(text));
		},
		async project(): Promise<Project | null> {
			return projectText === null ? null : parse<Project>(projectText);
		},
		async revision(): Promise<Revision> {
			return revision;
		},

		async apply(batch: TransactionBatch): Promise<TransactionResult> {
			let fingerprint: string | undefined;
			if (batch.idempotencyKey !== undefined) {
				try {
					fingerprint = canonicalText(batch.operations, new Set());
				} catch {
					throw new TransactionError({
						code: "validation",
						message: "Operations are not canonically serializable",
					});
				}
				const existing = idempotencyFingerprints.get(batch.idempotencyKey);
				if (existing) {
					if (existing.fingerprint !== fingerprint) {
						throw new TransactionError({
							code: "duplicate",
							message: `Idempotency key "${batch.idempotencyKey}" was already used with different operations`,
						});
					}
					return existing.result;
				}
			}

			if (batch.expectedRevision !== undefined && batch.expectedRevision !== revision) {
				throw new TransactionError({
					code: "conflict",
					message: `Expected revision ${batch.expectedRevision}, actual ${revision}`,
					expectedRevision: batch.expectedRevision,
					actualRevision: revision,
				});
			}

			if (batch.operations.length === 0) {
				throw new TransactionError({
					code: "validation",
					message: "Batch must contain at least one operation",
				});
			}

			const result = processBatch(batch.operations);

			if (batch.idempotencyKey !== undefined) {
				idempotencyFingerprints.set(batch.idempotencyKey, {
					fingerprint: fingerprint!,
					result,
				});
			}

			for (const watcher of watchers) watcher(revision);
			return result;
		},

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

		watch(callback: (revision: Revision) => void): () => void {
			watchers.add(callback);
			return () => {
				watchers.delete(callback);
			};
		},
	};

	return target;
}
