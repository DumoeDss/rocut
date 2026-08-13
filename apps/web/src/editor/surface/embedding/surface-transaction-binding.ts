import {
	OPERATION_KINDS,
	type TransactionApply,
	type TransactionBatch,
	type TransactionResult,
} from "@/editor/contracts";
import {
	isValidAsset,
	isValidClip,
	isValidMarker,
	isValidProject,
	isValidTrack,
} from "@/editor/contracts/engine/invariant";

import type { SurfaceCommitBinding } from "./types";

export class SurfaceCommitAdapterError extends Error {
	readonly code = "invalid-transaction-batch" as const;

	constructor() {
		super("Surface commit requires a non-empty T0 transaction batch.");
		this.name = "SurfaceCommitAdapterError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const operationKinds = new Set<string>(OPERATION_KINDS);
const trackPatchKeys = new Set(["kind", "name", "hidden"]);
const clipPatchKeys = new Set([
	"trackId",
	"startTime",
	"duration",
	"trimStart",
	"trimEnd",
	"assetId",
]);
const markerPatchKeys = new Set(["time", "note", "color"]);
const projectPatchKeys = new Set([
	"name",
	"frameRate",
	"canvasWidth",
	"canvasHeight",
]);

const trackPatchBase = {
	id: "surface-validation-track",
	kind: "video",
	name: "Surface validation track",
	hidden: false,
};
const clipPatchBase = {
	id: "surface-validation-clip",
	trackId: "surface-validation-track",
	startTime: 0,
	duration: 1,
	trimStart: 0,
	trimEnd: 0,
};
const markerPatchBase = {
	id: "surface-validation-marker",
	time: 0,
};
const projectPatchBase = {
	id: "surface-validation-project",
	name: "Surface validation project",
	frameRate: { numerator: 30, denominator: 1 },
	canvasWidth: 1,
	canvasHeight: 1,
};

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function readPatch({
	value,
	keys,
	requireNonEmpty = false,
}: {
	value: unknown;
	keys: ReadonlySet<string>;
	requireNonEmpty?: boolean;
}): Record<string, unknown> | null {
	if (!isRecord(value)) return null;
	const ownKeys = Reflect.ownKeys(value);
	if (requireNonEmpty && ownKeys.length === 0) return null;
	const patch: Record<string, unknown> = {};
	for (const key of ownKeys) {
		if (typeof key !== "string" || !keys.has(key)) return null;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) return null;
		patch[key] = descriptor.value;
	}
	return patch;
}

function isTrackPatch(value: unknown): boolean {
	const patch = readPatch({ value, keys: trackPatchKeys });
	return (
		patch !== null &&
		(patch.kind === undefined || typeof patch.kind === "string") &&
		isValidTrack({ ...trackPatchBase, ...patch })
	);
}

function isClipPatch(value: unknown): boolean {
	const patch = readPatch({ value, keys: clipPatchKeys });
	return patch !== null && isValidClip({ ...clipPatchBase, ...patch });
}

function isMarkerPatch(value: unknown): boolean {
	const patch = readPatch({ value, keys: markerPatchKeys });
	return patch !== null && isValidMarker({ ...markerPatchBase, ...patch });
}

function isProjectPatch(value: unknown): boolean {
	const patch = readPatch({
		value,
		keys: projectPatchKeys,
		requireNonEmpty: true,
	});
	return (
		patch !== null &&
		isValidProject({ ...projectPatchBase, ...patch }, projectPatchBase.id)
	);
}

function hasRequiredOperationPayload(
	operation: Record<string, unknown>,
): boolean {
	if (
		!isNonEmptyString(operation.kind) ||
		!operationKinds.has(operation.kind)
	) {
		return false;
	}

	switch (operation.kind) {
		case "create-track":
			return (
				isRecord(operation.track) &&
				typeof operation.track.kind === "string" &&
				isValidTrack(operation.track)
			);
		case "update-track":
			return (
				isNonEmptyString(operation.trackId) && isTrackPatch(operation.patch)
			);
		case "delete-track":
			return isNonEmptyString(operation.trackId);
		case "create-clip":
			return isValidClip(operation.clip);
		case "update-clip":
			return isNonEmptyString(operation.clipId) && isClipPatch(operation.patch);
		case "delete-clip":
			return isNonEmptyString(operation.clipId);
		case "create-asset":
			return (
				isRecord(operation.asset) &&
				typeof operation.asset.kind === "string" &&
				isValidAsset(operation.asset)
			);
		case "delete-asset":
			return isNonEmptyString(operation.assetId);
		case "create-marker":
			return isValidMarker(operation.marker);
		case "update-marker":
			return (
				isNonEmptyString(operation.markerId) && isMarkerPatch(operation.patch)
			);
		case "delete-marker":
			return isNonEmptyString(operation.markerId);
		case "update-project":
			return (
				isNonEmptyString(operation.projectId) && isProjectPatch(operation.patch)
			);
	}
	return false;
}

function isTransactionBatch(value: unknown): value is TransactionBatch {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.operations) || value.operations.length === 0) {
		return false;
	}
	if (
		!value.operations.every(
			(operation) =>
				isRecord(operation) && hasRequiredOperationPayload(operation),
		)
	) {
		return false;
	}
	if (
		value.expectedRevision !== undefined &&
		(typeof value.expectedRevision !== "number" ||
			!Number.isInteger(value.expectedRevision) ||
			value.expectedRevision < 0)
	) {
		return false;
	}
	if (
		value.idempotencyKey !== undefined &&
		(typeof value.idempotencyKey !== "string" ||
			value.idempotencyKey.length === 0)
	) {
		return false;
	}
	return true;
}

export function createSurfaceCommitBinding({
	apply,
	onError,
}: {
	apply: TransactionApply;
	onError: (error: Error) => void;
}): SurfaceCommitBinding {
	function report(reason: unknown): void {
		onError(
			reason instanceof Error
				? reason
				: new Error("Surface transaction apply failed.", { cause: reason }),
		);
	}

	return {
		commit({ edit }): void {
			if (!isTransactionBatch(edit)) {
				report(new SurfaceCommitAdapterError());
				return;
			}
			// Preserve R0's synchronous `void` public shape while observing exactly one
			// invocation of T0's asynchronous apply seam.
			let result: Promise<TransactionResult>;
			try {
				result = apply.apply(edit);
			} catch (reason) {
				report(reason);
				return;
			}
			void result.catch(report);
		},
	};
}
