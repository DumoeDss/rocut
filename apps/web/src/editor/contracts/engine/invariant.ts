import type { Asset, Clip, Marker, Project, Track } from "..";
import { validateFrameRate } from "..";
import type { ProjectId } from "@/editor/ports";
import type {
	TransactionEngineDocument,
	TransactionIdempotencyEntry,
} from "./types";

export interface TransactionDocumentInvariantIssue {
	readonly path: string;
	readonly message: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isValidProject(
	value: unknown,
	projectId: ProjectId,
): value is Project {
	if (!isRecord(value) || !isRecord(value.frameRate)) return false;
	if (
		!isNonEmptyString(value.id) ||
		value.id !== projectId ||
		!isNonEmptyString(value.name) ||
		!isPositiveNumber(value.canvasWidth) ||
		!isPositiveNumber(value.canvasHeight) ||
		typeof value.frameRate.numerator !== "number" ||
		!Number.isInteger(value.frameRate.numerator) ||
		typeof value.frameRate.denominator !== "number" ||
		!Number.isInteger(value.frameRate.denominator)
	) {
		return false;
	}
	try {
		validateFrameRate({
			numerator: value.frameRate.numerator,
			denominator: value.frameRate.denominator,
		});
		return true;
	} catch {
		return false;
	}
}

export function isValidTrack(value: unknown): value is Track {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		["video", "audio", "text", "graphic", "effect"].includes(
			String(value.kind),
		) &&
		isNonEmptyString(value.name) &&
		typeof value.hidden === "boolean"
	);
}

export function isValidClip(value: unknown): value is Clip {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.trackId) &&
		isNonNegativeInteger(value.startTime) &&
		isNonNegativeInteger(value.duration) &&
		isNonNegativeInteger(value.trimStart) &&
		isNonNegativeInteger(value.trimEnd) &&
		(value.assetId === undefined || isNonEmptyString(value.assetId))
	);
}

export function isValidAsset(value: unknown): value is Asset {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		["image", "video", "audio"].includes(String(value.kind)) &&
		isNonEmptyString(value.name) &&
		(value.duration === undefined || isNonNegativeInteger(value.duration)) &&
		(value.width === undefined || isPositiveNumber(value.width)) &&
		(value.height === undefined || isPositiveNumber(value.height))
	);
}

export function isValidMarker(value: unknown): value is Marker {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonNegativeInteger(value.time) &&
		(value.note === undefined || typeof value.note === "string") &&
		(value.color === undefined || typeof value.color === "string")
	);
}

function isValidIdempotencyEntry(
	value: unknown,
	revision: number,
): value is TransactionIdempotencyEntry {
	if (!isRecord(value) || !isRecord(value.result)) return false;
	return (
		isNonEmptyString(value.key) &&
		typeof value.fingerprint === "string" &&
		isNonNegativeInteger(value.result.revision) &&
		value.result.revision <= revision &&
		Array.isArray(value.result.createdIds) &&
		value.result.createdIds.every(isNonEmptyString) &&
		Array.isArray(value.result.changedIds) &&
		value.result.changedIds.every(isNonEmptyString)
	);
}

function invalid(
	...[path, message]: readonly [string, string]
): TransactionDocumentInvariantIssue {
	return { path, message };
}

export function validateTransactionDocument(args: {
	readonly projectId: ProjectId;
	readonly document: unknown;
}): readonly TransactionDocumentInvariantIssue[] {
	const { document, projectId } = args;
	if (!isRecord(document)) {
		return [invalid("document", "Transaction document must be an object")];
	}
	const issues: TransactionDocumentInvariantIssue[] = [];
	if (
		document.project !== null &&
		!isValidProject(document.project, projectId)
	) {
		issues.push(invalid("project", "Project metadata is invalid"));
	}
	if (!isNonNegativeInteger(document.revision)) {
		issues.push(invalid("revision", "Revision must be a non-negative integer"));
	}

	const collections = [
		["tracks", document.tracks, isValidTrack],
		["clips", document.clips, isValidClip],
		["assets", document.assets, isValidAsset],
		["markers", document.markers, isValidMarker],
	] as const;
	for (const [name, values, predicate] of collections) {
		if (!Array.isArray(values)) {
			issues.push(invalid(name, `${name} must be an array`));
			continue;
		}
		values.forEach((value, index) => {
			if (!predicate(value)) {
				issues.push(invalid(`${name}[${index}]`, `Invalid ${name} entity`));
			}
		});
	}

	if (
		Array.isArray(document.tracks) &&
		Array.isArray(document.clips) &&
		Array.isArray(document.assets) &&
		Array.isArray(document.markers) &&
		document.tracks.every(isValidTrack) &&
		document.clips.every(isValidClip) &&
		document.assets.every(isValidAsset) &&
		document.markers.every(isValidMarker)
	) {
		const ids = new Set<string>();
		for (const entity of [
			...document.tracks,
			...document.clips,
			...document.assets,
			...document.markers,
		]) {
			if (ids.has(entity.id)) {
				issues.push(invalid("entities", `Duplicate entity id ${entity.id}`));
			}
			ids.add(entity.id);
		}
		const trackIds = new Set(document.tracks.map((track) => track.id));
		const assetIds = new Set(document.assets.map((asset) => asset.id));
		for (const clip of document.clips) {
			if (!trackIds.has(clip.trackId)) {
				issues.push(
					invalid(
						`clips.${clip.id}.trackId`,
						"Clip references a missing track",
					),
				);
			}
			if (clip.assetId !== undefined && !assetIds.has(clip.assetId)) {
				issues.push(
					invalid(
						`clips.${clip.id}.assetId`,
						"Clip references a missing asset",
					),
				);
			}
		}
	}

	if (!Array.isArray(document.idempotency)) {
		issues.push(invalid("idempotency", "Idempotency ledger must be an array"));
	} else if (isNonNegativeInteger(document.revision)) {
		const revision = document.revision;
		const keys = new Set<string>();
		document.idempotency.forEach((entry, index) => {
			if (!isValidIdempotencyEntry(entry, revision)) {
				issues.push(
					invalid(`idempotency[${index}]`, "Invalid idempotency entry"),
				);
				return;
			}
			if (keys.has(entry.key)) {
				issues.push(
					invalid(`idempotency[${index}].key`, "Duplicate idempotency key"),
				);
			}
			keys.add(entry.key);
		});
	}

	return issues;
}

export function isTransactionEngineDocument(args: {
	readonly projectId: ProjectId;
	readonly document: unknown;
}): args is {
	readonly projectId: ProjectId;
	readonly document: TransactionEngineDocument;
} {
	return validateTransactionDocument(args).length === 0;
}

export function transactionDocumentInvariantIssue(args: {
	readonly projectId: ProjectId;
	readonly document: TransactionEngineDocument;
}): TransactionDocumentInvariantIssue | undefined {
	return validateTransactionDocument(args)[0];
}
