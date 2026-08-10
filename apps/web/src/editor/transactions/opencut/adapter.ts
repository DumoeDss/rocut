/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- This is the concrete donor/opaque translation boundary; its private mapping helpers are not public APIs. */
import type { Asset, Clip, Marker, Track } from "@/editor/contracts";
import { revisionOf } from "@/editor/contracts";
import type {
	TransactionDocumentAdapter,
	TransactionEngineDocument,
	TransactionIdempotencyEntry,
} from "@/editor/contracts/engine";
import type {
	ProjectId as PortProjectId,
	ProjectRecord,
	ProjectSummary,
} from "@/editor/ports";
import { cloneOpaque } from "@/editor/persistence/opaque-value";
import {
	decodeProject,
	encodeProject,
} from "@/editor/persistence/project-codec";
import type { TProject } from "@/project/types";
import type {
	Bookmark,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
} from "@/timeline";
import {
	OPEN_CUT_MARKER_ID_KEY,
	cloneOpenCutDraft,
	ensureDraftMarkerIds,
	projectOpenCutDraft,
	publicDocumentsEqual,
} from "./projection";
import type {
	EncodedOpenCutPublicationReceipt,
	OpenCutAssetCatalogEntry,
	OpenCutCommitToken,
	OpenCutProjectDraft,
	StagedOpenCutCandidate,
} from "./types";

const ENVELOPE_KEY = "__opencutTransaction";
const ENVELOPE_VERSION = 1;

interface OpenCutTransactionEnvelope {
	readonly version: typeof ENVELOPE_VERSION;
	readonly revision: number;
	readonly idempotency: readonly TransactionIdempotencyEntry[];
	readonly assetCatalog: readonly OpenCutAssetCatalogEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEnvelope(data: unknown): OpenCutTransactionEnvelope | null {
	if (!isRecord(data)) return null;
	const raw = data[ENVELOPE_KEY];
	if (!isRecord(raw)) return null;
	if (
		raw.version !== ENVELOPE_VERSION ||
		typeof raw.revision !== "number" ||
		!Number.isInteger(raw.revision) ||
		raw.revision < 0 ||
		!Array.isArray(raw.idempotency) ||
		!Array.isArray(raw.assetCatalog)
	) {
		throw new Error("Invalid OpenCut transaction envelope");
	}
	return raw as unknown as OpenCutTransactionEnvelope;
}

function canonical(value: unknown, seen = new Set<object>()): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return `string:${JSON.stringify(value)}`;
	if (typeof value === "number")
		return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
	if (typeof value === "boolean") return `boolean:${String(value)}`;
	if (typeof value !== "object") return `${typeof value}:${String(value)}`;
	if (seen.has(value))
		throw new TypeError("Opaque project records must not contain cycles");
	seen.add(value);
	try {
		if (value instanceof Date) return `date:${value.toISOString()}`;
		if (Array.isArray(value))
			return `array:[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
		return `object:{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], seen)}`,
			)
			.join(",")}}`;
	} finally {
		seen.delete(value);
	}
}

export function digestProjectRecord(record: ProjectRecord): string {
	return canonical({
		id: record.id,
		schemaVersion: record.schemaVersion,
		data: record.data,
	});
}

function summaryFor(project: TProject): ProjectSummary {
	return {
		id: project.metadata.id as PortProjectId,
		name: project.metadata.name,
		createdAt: project.metadata.createdAt.toISOString(),
		updatedAt: project.metadata.updatedAt.toISOString(),
	};
}

function donorTrackById(project: TProject): Map<string, TimelineTrack> {
	const found = new Map<string, TimelineTrack>();
	for (const scene of project.scenes) {
		for (const track of [
			...scene.tracks.overlay,
			scene.tracks.main,
			...scene.tracks.audio,
		]) {
			found.set(track.id, track);
		}
	}
	return found;
}

function donorElementById(project: TProject): Map<string, TimelineElement> {
	const found = new Map<string, TimelineElement>();
	for (const track of donorTrackById(project).values()) {
		for (const element of track.elements) found.set(element.id, element);
	}
	return found;
}

function newTrack(track: Track): TimelineTrack {
	const base = {
		id: track.id,
		name: track.name,
		type: track.kind,
		elements: [],
	};
	if (track.kind === "audio") return { ...base, type: "audio", muted: false };
	if (track.kind === "video")
		return { ...base, type: "video", muted: false, hidden: track.hidden };
	return { ...base, type: track.kind, hidden: track.hidden } as TimelineTrack;
}

function overlayTrack(
	track: Track,
	previous: TimelineTrack | undefined,
): TimelineTrack {
	const base = previous ?? newTrack(track);
	return {
		...base,
		id: track.id,
		name: track.name,
		type: track.kind,
		...("hidden" in base && { hidden: track.hidden }),
	} as TimelineTrack;
}

function assetById(document: TransactionEngineDocument): Map<string, Asset> {
	return new Map(document.assets.map((asset) => [asset.id, asset]));
}

function newElement(clip: Clip, asset: Asset | undefined): TimelineElement {
	const base = {
		id: clip.id,
		name: asset?.name ?? clip.id,
		startTime: clip.startTime,
		duration: clip.duration,
		trimStart: clip.trimStart,
		trimEnd: clip.trimEnd,
		...(asset?.duration !== undefined && { sourceDuration: asset.duration }),
		params: {},
	};
	if (asset?.kind === "audio") {
		return {
			...base,
			type: "audio",
			sourceType: "upload",
			mediaId: asset.id,
		} as unknown as TimelineElement;
	}
	if (asset?.kind === "image")
		return {
			...base,
			type: "image",
			mediaId: asset.id,
		} as unknown as TimelineElement;
	if (asset?.kind === "video")
		return {
			...base,
			type: "video",
			mediaId: asset.id,
		} as unknown as TimelineElement;
	return {
		...base,
		type: "text",
		params: { content: clip.id },
	} as unknown as TimelineElement;
}

function overlayElement(
	clip: Clip,
	previous: TimelineElement | undefined,
	asset: Asset | undefined,
): TimelineElement {
	const base = previous ?? newElement(clip, asset);
	const next = {
		...base,
		id: clip.id,
		startTime: clip.startTime,
		duration: clip.duration,
		trimStart: clip.trimStart,
		trimEnd: clip.trimEnd,
	} as unknown as TimelineElement & { mediaId?: string };
	if (clip.assetId !== undefined) next.mediaId = clip.assetId;
	return next;
}

function overlayMarkers(
	current: readonly Bookmark[],
	markers: readonly Marker[],
): Bookmark[] {
	const byId = new Map(
		current.map((bookmark, index) => [
			(bookmark as Bookmark & { [OPEN_CUT_MARKER_ID_KEY]?: string })[
				OPEN_CUT_MARKER_ID_KEY
			] ?? `marker:${index}`,
			bookmark,
		]),
	);
	return markers.map(
		(marker) =>
			({
				...(byId.get(marker.id) ?? {}),
				time: marker.time as unknown as Bookmark["time"],
				...(marker.note !== undefined && { note: marker.note }),
				...(marker.color !== undefined && { color: marker.color }),
				[OPEN_CUT_MARKER_ID_KEY]: marker.id,
			}) as Bookmark,
	);
}

function applyPublicDocument({
	base,
	document,
}: {
	base: OpenCutProjectDraft;
	document: TransactionEngineDocument;
}): OpenCutProjectDraft {
	if (!document.project)
		throw new Error("OpenCut projects require transaction project metadata");
	const project = cloneOpaque(base.project);
	project.metadata = { ...project.metadata, name: document.project.name };
	project.settings = {
		...project.settings,
		fps: cloneOpaque(document.project.frameRate) as TProject["settings"]["fps"],
		canvasSize: {
			width: document.project.canvasWidth,
			height: document.project.canvasHeight,
		},
	};
	const activeScene = project.scenes.find(
		(scene) => scene.id === project.currentSceneId,
	);
	if (!activeScene) throw new Error("OpenCut project has no active scene");

	const previousTracks = donorTrackById(project);
	const previousElements = donorElementById(project);
	const assets = assetById(document);
	const tracks = new Map<string, TimelineTrack>(
		document.tracks.map((track) => [
			track.id,
			overlayTrack(track, previousTracks.get(track.id)),
		]),
	);
	for (const track of tracks.values()) {
		track.elements = document.clips
			.filter((clip) => String(clip.trackId) === track.id)
			.map((clip) =>
				overlayElement(
					clip,
					previousElements.get(clip.id),
					clip.assetId ? assets.get(clip.assetId) : undefined,
				),
			) as TimelineTrack["elements"];
	}
	const previousMainId = activeScene.tracks.main.id;
	const main = tracks.get(previousMainId);
	if (!main || main.type !== "video")
		throw new Error("The canonical main track cannot be removed or retyped");
	activeScene.tracks = {
		main,
		overlay: document.tracks
			.filter((track) => track.id !== previousMainId && track.kind !== "audio")
			.map((track) => tracks.get(track.id))
			.filter(
				(track): track is SceneTracks["overlay"][number] =>
					track !== undefined && track.type !== "audio",
			),
		audio: document.tracks
			.filter((track) => track.kind === "audio")
			.map((track) => tracks.get(track.id))
			.filter(
				(track): track is SceneTracks["audio"][number] =>
					track?.type === "audio",
			),
	};
	activeScene.bookmarks = overlayMarkers(
		activeScene.bookmarks,
		document.markers,
	);
	return {
		project,
		assetCatalog: document.assets.map((asset) => ({
			id: asset.id,
			name: asset.name,
			type: asset.kind,
			...(asset.duration !== undefined && {
				duration: asset.duration / 120_000,
			}),
			...(asset.width !== undefined && { width: asset.width }),
			...(asset.height !== undefined && { height: asset.height }),
		})),
	};
}

export interface OpenCutTransactionDocumentAdapter extends TransactionDocumentAdapter {
	stage(candidate: StagedOpenCutCandidate): void;
	clear(token: OpenCutCommitToken): void;
	consumeReceipt(): EncodedOpenCutPublicationReceipt | null;
	currentRecordDigest(): string;
	adoptCommittedRecord(record: ProjectRecord): void;
}

export function createOpenCutTransactionDocumentAdapter({
	initialRecord,
	initialAssets,
}: {
	initialRecord: ProjectRecord;
	initialAssets: readonly OpenCutAssetCatalogEntry[];
}): OpenCutTransactionDocumentAdapter {
	let latestRecord = cloneOpaque(initialRecord);
	let latestReceipt: EncodedOpenCutPublicationReceipt | null = null;
	const staged = new Map<OpenCutCommitToken, StagedOpenCutCandidate>();

	function decodeDraft(record: ProjectRecord): OpenCutProjectDraft {
		const envelope = readEnvelope(record.data);
		const draft = {
			project: decodeProject(cloneOpaque(record.data)),
			assetCatalog: [...cloneOpaque(envelope?.assetCatalog ?? initialAssets)],
		};
		ensureDraftMarkerIds(draft);
		return draft;
	}

	function encodedRecord(
		projectId: PortProjectId,
		previousRecord: ProjectRecord,
		draft: OpenCutProjectDraft,
		document: TransactionEngineDocument,
	): ProjectRecord {
		const retained = previousRecord.data;
		const knownProject = encodeProject({ project: draft.project, retained });
		if (!isRecord(knownProject))
			throw new Error("Encoded OpenCut project must be an object");
		return {
			id: projectId,
			schemaVersion: previousRecord.schemaVersion,
			data: {
				...knownProject,
				[ENVELOPE_KEY]: {
					version: ENVELOPE_VERSION,
					revision: document.revision,
					idempotency: cloneOpaque(document.idempotency),
					assetCatalog: cloneOpaque(draft.assetCatalog),
				} satisfies OpenCutTransactionEnvelope,
			},
		};
	}

	return {
		decode({ projectId, record }) {
			if (record.id !== projectId) throw new Error("Project identity mismatch");
			const envelope = readEnvelope(record.data);
			return projectOpenCutDraft(decodeDraft(record), {
				revision: revisionOf(envelope?.revision ?? 0),
				idempotency: cloneOpaque(envelope?.idempotency ?? []),
			});
		},
		encode({ projectId, previousRecord, document }) {
			const baseRecord =
				latestRecord.id === projectId ? latestRecord : previousRecord;
			const lastKey = document.idempotency.at(-1)?.key;
			const token = lastKey as OpenCutCommitToken | undefined;
			const registered = token ? staged.get(token) : undefined;
			if (!registered && staged.size > 0) {
				throw new Error("Staged OpenCut candidate token mismatch");
			}
			let draft: OpenCutProjectDraft;
			if (registered) {
				if (
					registered.baseRevision + 1 !== document.revision ||
					registered.previousRecordDigest !== digestProjectRecord(baseRecord) ||
					!publicDocumentsEqual(registered.projectedDocument, document)
				) {
					throw new Error("Staged OpenCut candidate binding mismatch");
				}
				draft = cloneOpenCutDraft(registered.draft);
				const reprojected = projectOpenCutDraft(draft, {
					revision: document.revision,
					idempotency: document.idempotency,
				});
				if (!publicDocumentsEqual(reprojected, document)) {
					throw new Error("Staged OpenCut candidate projection mismatch");
				}
			} else {
				draft = applyPublicDocument({
					base: decodeDraft(baseRecord),
					document,
				});
			}
			const record = encodedRecord(projectId, baseRecord, draft, document);
			latestReceipt = {
				token: registered?.token ?? null,
				record: cloneOpaque(record),
				draft: cloneOpenCutDraft(draft),
			};
			return { record, summary: summaryFor(draft.project) };
		},
		stage(candidate) {
			if (staged.has(candidate.token))
				throw new Error("Duplicate OpenCut commit token");
			staged.set(candidate.token, cloneOpaque(candidate));
		},
		clear(token) {
			staged.delete(token);
			if (latestReceipt?.token === token) latestReceipt = null;
		},
		consumeReceipt() {
			const receipt = latestReceipt;
			latestReceipt = null;
			return receipt ? cloneOpaque(receipt) : null;
		},
		currentRecordDigest() {
			return digestProjectRecord(latestRecord);
		},
		adoptCommittedRecord(record) {
			latestRecord = cloneOpaque(record);
		},
	};
}

export const OPEN_CUT_TRANSACTION_ENVELOPE_KEY = ENVELOPE_KEY;
