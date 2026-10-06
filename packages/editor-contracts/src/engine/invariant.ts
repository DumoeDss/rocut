import type { Asset, Clip, Marker, Project, Track } from "..";
import { validateFrameRate } from "..";
import { isClipEditing } from "../editing";
import type { MotionTextClipContent, MotionTextSequence } from "../motion-text";
import { validateMotionTextSequence } from "../motion-text";
import type { ProjectId } from "@opencut/editor-ports";
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
	projectId: string,
): value is Project {
	if (!isRecord(value) || !isRecord(value.frameRate)) return false;
	if (value.sceneState !== undefined && !isSceneState(value.sceneState))
		return false;
	if (value.background !== undefined && !isProjectBackground(value.background))
		return false;
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
		(value.sceneId === undefined || isNonEmptyString(value.sceneId)) &&
		["video", "audio", "text", "graphic", "effect"].includes(
			String(value.kind),
		) &&
		isNonEmptyString(value.name) &&
		typeof value.hidden === "boolean" &&
		(value.muted === undefined ||
			(typeof value.muted === "boolean" &&
				(value.kind === "video" || value.kind === "audio")))
	);
}

function isValidAdjustment(value: unknown): boolean {
	return (
		isRecord(value) &&
		Reflect.ownKeys(value).length === 5 &&
		["exposure", "contrast", "saturation", "temperature", "tint"].every(
			(key) => typeof value[key] === "number" && Number.isFinite(value[key]),
		)
	);
}

function isValidTransitionIn(value: unknown): boolean {
	return (
		isRecord(value) &&
		Reflect.ownKeys(value).length === 3 &&
		value.kind === "cross-dissolve" &&
		isNonEmptyString(value.outgoingClipId) &&
		typeof value.durationFrames === "number" &&
		Number.isInteger(value.durationFrames) &&
		value.durationFrames >= 2 &&
		value.durationFrames <= 0xffff_ffff
	);
}

function isValidRetime(value: unknown): boolean {
	return (
		isRecord(value) &&
		Reflect.ownKeys(value).every(
			(key) => key === "rate" || key === "maintainPitch",
		) &&
		typeof value.rate === "number" &&
		Number.isFinite(value.rate) &&
		value.rate >= 0.01 &&
		value.rate <= 5 &&
		(value.maintainPitch === undefined ||
			typeof value.maintainPitch === "boolean")
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
		(value.freezeFrame === undefined ||
			(isNonNegativeInteger(value.freezeFrame) &&
				Number.isSafeInteger(value.freezeFrame))) &&
		(value.adjustment === undefined || isValidAdjustment(value.adjustment)) &&
		(value.retime === undefined || isValidRetime(value.retime)) &&
		(value.transitionIn === undefined ||
			isValidTransitionIn(value.transitionIn)) &&
		(value.assetId === undefined || isNonEmptyString(value.assetId)) &&
		(value.sourceComponent === undefined ||
			value.sourceComponent === "audio") &&
		(value.content === undefined ||
			isValidMotionTextClipContent(value.content)) &&
		(value.editing === undefined || isClipEditing(value.editing))
	);
}

function isValidMotionTextClipContent(
	value: unknown,
): value is MotionTextClipContent {
	return (
		isRecord(value) &&
		Reflect.ownKeys(value).length === 2 &&
		value.kind === "motion-text" &&
		isNonEmptyString(value.sequenceId)
	);
}

export function isValidMotionTextSequence(
	value: unknown,
): value is MotionTextSequence {
	return validateMotionTextSequence({ value }).length === 0;
}

export function isValidAsset(value: unknown): value is Asset {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		["image", "video", "audio"].includes(String(value.kind)) &&
		isNonEmptyString(value.name) &&
		(value.duration === undefined || isNonNegativeInteger(value.duration)) &&
		(value.hasAudio === undefined || typeof value.hasAudio === "boolean") &&
		(value.width === undefined || isPositiveNumber(value.width)) &&
		(value.height === undefined || isPositiveNumber(value.height))
	);
}

export function isValidMarker(value: unknown): value is Marker {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		(value.sceneId === undefined || isNonEmptyString(value.sceneId)) &&
		isNonNegativeInteger(value.time) &&
		(value.note === undefined || typeof value.note === "string") &&
		(value.color === undefined || typeof value.color === "string")
	);
}

function isSceneState(value: unknown): boolean {
	return (
		isRecord(value) &&
		Object.keys(value).length === 2 &&
		isNonEmptyString(value.currentSceneId) &&
		Array.isArray(value.scenes) &&
		value.scenes.length > 0 &&
		value.scenes.every(
			(scene) =>
				isRecord(scene) &&
				Object.keys(scene).length === 4 &&
				isNonEmptyString(scene.id) &&
				isNonEmptyString(scene.name) &&
				typeof scene.isMain === "boolean" &&
				isNonEmptyString(scene.mainTrackId),
		)
	);
}

function isProjectBackground(value: unknown): boolean {
	if (!isRecord(value) || Object.keys(value).length !== 2) return false;
	return (
		(value.type === "color" && typeof value.color === "string") ||
		(value.type === "blur" &&
			typeof value.blurIntensity === "number" &&
			Number.isFinite(value.blurIntensity))
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
		document.motionTextSequences !== undefined &&
		!Array.isArray(document.motionTextSequences)
	) {
		issues.push(
			invalid("motionTextSequences", "motionTextSequences must be an array"),
		);
	} else if (Array.isArray(document.motionTextSequences)) {
		document.motionTextSequences.forEach((value, index) => {
			for (const sequenceIssue of validateMotionTextSequence({ value })) {
				issues.push(
					invalid(
						`motionTextSequences[${index}].${sequenceIssue.path}`,
						sequenceIssue.message,
					),
				);
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
		document.markers.every(isValidMarker) &&
		(document.motionTextSequences === undefined ||
			(Array.isArray(document.motionTextSequences) &&
				document.motionTextSequences.every(isValidMotionTextSequence)))
	) {
		const motionTextSequences = document.motionTextSequences ?? [];
		const ids = new Set<string>();
		for (const entity of [
			...document.tracks,
			...document.clips,
			...document.assets,
			...document.markers,
			...motionTextSequences,
		]) {
			if (ids.has(entity.id)) {
				issues.push(invalid("entities", `Duplicate entity id ${entity.id}`));
			}
			ids.add(entity.id);
		}
		const trackIds = new Set(document.tracks.map((track) => track.id));
		const assetIds = new Set(document.assets.map((asset) => asset.id));
		const sequenceIds = new Set(
			motionTextSequences.map((sequence) => sequence.id),
		);
		for (const clip of document.clips) {
			if (clip.retime !== undefined) {
				const source = document.assets.find(
					(asset) => asset.id === clip.assetId,
				);
				const lane = document.tracks.find((track) => track.id === clip.trackId);
				if (
					clip.content !== undefined ||
					!(
						source?.kind === "video" ||
						source?.kind === "audio" ||
						(clip.assetId === undefined && lane?.kind === "audio")
					)
				) {
					issues.push(
						invalid(
							`clips.${clip.id}.retime`,
							"Playback rate requires a video or audio source",
						),
					);
				}
			}
			if (clip.transitionIn !== undefined) {
				const outgoing = document.clips.find(
					(candidate) => candidate.id === clip.transitionIn?.outgoingClipId,
				);
				if (!outgoing)
					issues.push(
						invalid(
							`clips.${clip.id}.transitionIn`,
							"Transition references a missing outgoing clip",
						),
					);
			}
			if (
				clip.adjustment !== undefined &&
				(clip.assetId !== undefined ||
					clip.content !== undefined ||
					document.tracks.find((track) => track.id === clip.trackId)?.kind !==
						"effect")
			) {
				issues.push(
					invalid(
						`clips.${clip.id}.adjustment`,
						"Color adjustment requires an effect track and no asset or content",
					),
				);
			}
			if (clip.sourceComponent !== undefined) {
				const source = document.assets.find(
					(asset) => asset.id === clip.assetId,
				);
				if (
					!source ||
					source.kind !== "video" ||
					source.hasAudio === false ||
					clip.content !== undefined ||
					clip.adjustment !== undefined ||
					clip.freezeFrame !== undefined ||
					clip.transitionIn !== undefined
				) {
					issues.push(
						invalid(
							`clips.${clip.id}.sourceComponent`,
							"Audio component requires a video asset not known to be silent and no picture-only settings",
						),
					);
				}
			}
			if (clip.freezeFrame !== undefined) {
				const source = document.assets.find(
					(asset) => asset.id === clip.assetId,
				);
				if (
					source?.kind !== "video" ||
					clip.content !== undefined ||
					(source.duration !== undefined && clip.freezeFrame >= source.duration)
				) {
					issues.push(
						invalid(
							`clips.${clip.id}.freezeFrame`,
							"Frame hold requires a video asset and a tick inside its source duration",
						),
					);
				}
			}
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
			if (
				clip.content?.kind === "motion-text" &&
				!sequenceIds.has(clip.content.sequenceId)
			) {
				issues.push(
					invalid(
						`clips.${clip.id}.content.sequenceId`,
						"Motion-text clip references a missing sequence",
					),
				);
			}
		}
		for (const sequence of motionTextSequences) {
			const referencedAssetIds = [
				sequence.audioBinding?.assetId,
				...sequence.fonts
					.filter((font) => font.source === "project")
					.map((font) => font.assetId),
			].filter((assetId): assetId is NonNullable<typeof assetId> =>
				Boolean(assetId),
			);
			for (const referencedAssetId of referencedAssetIds) {
				if (assetIds.has(referencedAssetId)) continue;
				issues.push(
					invalid(
						`motionTextSequences.${sequence.id}.assets`,
						`Motion-text sequence references missing asset ${referencedAssetId}`,
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
