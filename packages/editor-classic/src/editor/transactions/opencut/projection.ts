/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- This is the concrete donor/opaque projection boundary; its small pure mappers intentionally mirror array callback signatures. */
import type {
	Asset,
	Clip,
	Marker,
	MotionTextSequence,
	Project,
	ProjectPatch,
	Track,
	TransactionOperation,
} from "@opencut/editor-contracts";
import {
	assetId,
	clipId,
	markerId,
	projectId,
	trackId,
} from "@opencut/editor-contracts";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import { canonicalOperationFingerprint } from "@opencut/editor-contracts/engine";
import type {
	Bookmark,
	TimelineElement,
	TimelineTrack,
} from "../../../timeline/types";
import { cloneOpaque } from "../../persistence/opaque-value";
import { projectionValuesEqual } from "./projection-value-equality";
import { projectEditingState } from "./editing-state";
import { projectTrackOrder } from "./scene-state";
import type { OpenCutAssetCatalogEntry, OpenCutProjectDraft } from "./types";

const MARKER_ID_KEY = "__opencutTransactionMarkerId";

type BookmarkWithMarkerId = Bookmark & { [MARKER_ID_KEY]?: string };

function contractTime(value: number) {
	// The standalone contract and donor brands share the fixed 120,000 tick rate.
	return value as Clip["startTime"];
}

function markerIdentity(
	sceneId: string,
	bookmark: Bookmark,
	index: number,
): string {
	const stored = (bookmark as BookmarkWithMarkerId)[MARKER_ID_KEY];
	return stored ?? `${sceneId}:marker:${index}`;
}

export function ensureDraftMarkerIds(draft: OpenCutProjectDraft): void {
	for (const scene of draft.project.scenes) {
		scene.bookmarks = scene.bookmarks.map((bookmark, index) => ({
			...bookmark,
			[MARKER_ID_KEY]: markerIdentity(scene.id, bookmark, index),
		}));
	}
}

function projectProjection(draft: OpenCutProjectDraft): Project {
	const { project } = draft;
	return {
		id: projectId(project.metadata.id),
		name: project.metadata.name,
		frameRate: {
			numerator: project.settings.fps.numerator,
			denominator: project.settings.fps.denominator,
		},
		canvasWidth: project.settings.canvasSize.width,
		canvasHeight: project.settings.canvasSize.height,
		background:
			project.settings.background.type === "blur"
				? {
						type: "blur",
						blurIntensity: project.settings.background.blurIntensity,
					}
				: { type: "color", color: project.settings.background.color },
		sceneState: {
			currentSceneId: project.currentSceneId,
			scenes: project.scenes.map((scene) => ({
				id: scene.id,
				name: scene.name,
				isMain: scene.isMain,
				mainTrackId: trackId(scene.tracks.main.id),
			})),
		},
	};
}

function allTracks(draft: OpenCutProjectDraft): TimelineTrack[] {
	return draft.project.scenes.flatMap((scene) => [
		...scene.tracks.overlay,
		scene.tracks.main,
		...scene.tracks.audio,
	]);
}

function trackProjection(track: TimelineTrack): Track {
	return {
		id: trackId(track.id),
		kind: track.type,
		name: track.name,
		...("muted" in track &&
			track.muted !== undefined && { muted: track.muted }),
		hidden:
			"hidden" in track && typeof track.hidden === "boolean"
				? track.hidden
				: false,
	};
}

function elementAssetId(element: TimelineElement): string | undefined {
	if ("mediaId" in element) return element.mediaId;
	return undefined;
}

function clipProjection(
	track: TimelineTrack,
	element: TimelineElement,
	assets: readonly OpenCutAssetCatalogEntry[],
): Clip {
	const mediaId = elementAssetId(element);
	return {
		id: clipId(element.id),
		trackId: trackId(track.id),
		startTime: contractTime(element.startTime),
		duration: contractTime(element.duration),
		trimStart: contractTime(element.trimStart),
		trimEnd: contractTime(element.trimEnd),
		editing: projectEditingState(element),
		...(mediaId !== undefined && { assetId: assetId(mediaId) }),
		...(element.type === "audio" &&
			assets.some(
				(asset) => asset.id === mediaId && asset.type === "video",
			) && {
				sourceComponent: "audio" as const,
			}),
		...((element.type === "video" || element.type === "audio") &&
			element.retime !== undefined && { retime: { ...element.retime } }),
		...((element.type === "video" || element.type === "image") &&
			element.transitionIn !== undefined && {
				transitionIn: {
					...element.transitionIn,
					outgoingClipId: clipId(element.transitionIn.outgoingClipId),
				},
			}),
		...(element.type === "video" &&
			element.freezeFrame !== undefined && {
				freezeFrame: contractTime(element.freezeFrame),
			}),
		...(element.type === "effect" &&
			element.adjustment !== undefined && {
				adjustment: { ...element.adjustment },
			}),
		...(element.type === "motion-text" && {
			content: {
				kind: "motion-text" as const,
				sequenceId: element.sequenceId as MotionTextSequence["id"],
			},
		}),
	};
}

function assetProjection(asset: OpenCutAssetCatalogEntry): Asset {
	return {
		id: assetId(asset.id),
		kind: asset.type,
		name: asset.name,
		...(asset.duration !== undefined && {
			duration: contractTime(Math.round(asset.duration * 120_000)),
		}),
		...(asset.width !== undefined && { width: asset.width }),
		...(asset.height !== undefined && { height: asset.height }),
		...(asset.hasAudio !== undefined && { hasAudio: asset.hasAudio }),
	};
}

function markerProjection(
	sceneId: string,
	bookmark: Bookmark,
	index: number,
): Marker {
	return {
		id: markerId(markerIdentity(sceneId, bookmark, index)),
		sceneId,
		time: contractTime(bookmark.time),
		...(bookmark.note !== undefined && { note: bookmark.note }),
		...(bookmark.color !== undefined && { color: bookmark.color }),
	};
}

export function projectOpenCutDraft(
	draft: OpenCutProjectDraft,
	metadata: {
		readonly revision: TransactionEngineDocument["revision"];
		readonly idempotency: TransactionEngineDocument["idempotency"];
		/** Internal read-only lifetime, or immediately followed by owned staging. */
		readonly sequenceOwnership?: "borrow";
	},
): TransactionEngineDocument {
	const tracks = allTracks(draft);
	const sceneByTrack = new Map(
		draft.project.scenes.flatMap((scene) =>
			[...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].map(
				(track) => [track.id, scene.id] as const,
			),
		),
	);
	return {
		project: projectProjection(draft),
		tracks: tracks.map((track) => ({
			...trackProjection(track),
			sceneId: sceneByTrack.get(track.id),
		})),
		clips: tracks.flatMap((track) =>
			track.elements.map((element) =>
				clipProjection(track, element, draft.assetCatalog),
			),
		),
		assets: draft.assetCatalog.map(assetProjection),
		markers: draft.project.scenes.flatMap((scene) =>
			scene.bookmarks.map((bookmark, index) =>
				markerProjection(scene.id, bookmark, index),
			),
		),
		motionTextSequences:
			metadata.sequenceOwnership === "borrow"
				? draft.project.motionTextSequences
				: cloneOpaque(draft.project.motionTextSequences),
		revision: metadata.revision,
		idempotency: metadata.idempotency,
	};
}

function same(left: unknown, right: unknown): boolean {
	return projectionValuesEqual({ left, right });
}

function changedPatch<Value extends object>(
	before: Value,
	after: Value,
	keys: readonly (keyof Value)[],
): Partial<Value> {
	const patch: Partial<Value> = {};
	const previous = before as Readonly<Record<keyof Value, unknown>>;
	const current = after as Readonly<Record<keyof Value, unknown>>;
	for (const key of keys) {
		if (!same(previous[key], current[key])) patch[key] = after[key];
	}
	return patch;
}

function mapById<Value extends { readonly id: string }>(
	values: readonly Value[],
) {
	return new Map(values.map((value) => [value.id, value]));
}

function sortedIds(values: Iterable<string>): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}

export class OpenCutProjectionError extends Error {
	constructor(
		readonly code: "empty" | "unrepresentable",
		message: string,
	) {
		super(message);
		this.name = "OpenCutProjectionError";
	}
}

export function diffOpenCutProjection({
	before,
	after,
}: {
	before: TransactionEngineDocument;
	after: TransactionEngineDocument;
}): TransactionOperation[] {
	if (
		!before.project ||
		!after.project ||
		before.project.id !== after.project.id
	) {
		throw new OpenCutProjectionError(
			"unrepresentable",
			"The selected OpenCut project identity cannot change inside a transaction",
		);
	}
	const beforeTracks = mapById(before.tracks);
	const afterTracks = mapById(after.tracks);
	const beforeClips = mapById(before.clips);
	const afterClips = mapById(after.clips);
	const beforeAssets = mapById(before.assets);
	const afterAssets = mapById(after.assets);
	const beforeMarkers = mapById(before.markers);
	const afterMarkers = mapById(after.markers);
	const beforeMotionTextSequences = mapById(before.motionTextSequences ?? []);
	const afterMotionTextSequences = mapById(after.motionTextSequences ?? []);
	const operations: TransactionOperation[] = [];
	const projectPatch = changedPatch(before.project, after.project, [
		"name",
		"frameRate",
		"canvasWidth",
		"canvasHeight",
		"sceneState",
		"background",
	]) as ProjectPatch;
	if (Object.keys(projectPatch).length > 0) {
		operations.push({
			kind: "update-project",
			projectId: before.project.id,
			patch: projectPatch,
		});
	}

	for (const id of sortedIds(beforeClips.keys())) {
		if (!afterClips.has(id))
			operations.push({ kind: "delete-clip", clipId: clipId(id) });
	}
	for (const id of sortedIds(beforeMotionTextSequences.keys())) {
		const previous = beforeMotionTextSequences.get(id);
		if (previous && !afterMotionTextSequences.has(id)) {
			operations.push({
				kind: "delete-motion-text-sequence",
				sequenceId: previous.id,
				expectedSequenceRevision: previous.revision,
			});
		}
	}
	for (const id of sortedIds(beforeMarkers.keys())) {
		if (!afterMarkers.has(id))
			operations.push({ kind: "delete-marker", markerId: markerId(id) });
	}
	for (const id of sortedIds(afterAssets.keys())) {
		const current = afterAssets.get(id);
		const previous = beforeAssets.get(id);
		if (!current) continue;
		if (!previous) operations.push({ kind: "create-asset", asset: current });
		else if (!same(previous, current)) {
			throw new OpenCutProjectionError(
				"unrepresentable",
				`The frozen operation union cannot update asset ${id}`,
			);
		}
	}
	for (const id of sortedIds(afterTracks.keys())) {
		const current = afterTracks.get(id);
		if (current && !beforeTracks.has(id))
			operations.push({ kind: "create-track", track: current });
	}
	for (const id of sortedIds(afterMotionTextSequences.keys())) {
		const current = afterMotionTextSequences.get(id);
		if (current && !beforeMotionTextSequences.has(id)) {
			operations.push({
				kind: "create-motion-text-sequence",
				sequence: current,
			});
		}
	}
	for (const id of sortedIds(afterClips.keys())) {
		const current = afterClips.get(id);
		if (current && !beforeClips.has(id))
			operations.push({ kind: "create-clip", clip: current });
	}
	for (const id of sortedIds(afterMarkers.keys())) {
		const current = afterMarkers.get(id);
		if (current && !beforeMarkers.has(id))
			operations.push({ kind: "create-marker", marker: current });
	}

	for (const id of sortedIds(afterTracks.keys())) {
		const current = afterTracks.get(id);
		const previous = beforeTracks.get(id);
		if (!current || !previous) continue;
		const patch = changedPatch(previous, current, [
			"kind",
			"name",
			"hidden",
			"muted",
			"sceneId",
		]);
		if (Object.keys(patch).length > 0)
			operations.push({ kind: "update-track", trackId: trackId(id), patch });
	}
	for (const id of sortedIds(afterClips.keys())) {
		const current = afterClips.get(id);
		const previous = beforeClips.get(id);
		if (!current || !previous) continue;
		const patch = changedPatch(previous, current, [
			"trackId",
			"startTime",
			"duration",
			"trimStart",
			"trimEnd",
			"assetId",
			"content",
			"adjustment",
			"editing",
		]);
		const freezePatch =
			previous.freezeFrame === current.freezeFrame
				? {}
				: { freezeFrame: current.freezeFrame ?? null };
		const transitionPatch = same(previous.transitionIn, current.transitionIn)
			? {}
			: { transitionIn: current.transitionIn ?? null };
		const retimePatch = same(previous.retime, current.retime)
			? {}
			: { retime: current.retime ?? null };
		const combined = {
			...patch,
			...(previous.sourceComponent !== current.sourceComponent && {
				sourceComponent: current.sourceComponent ?? null,
			}),
			...freezePatch,
			...transitionPatch,
			...retimePatch,
		};
		if (Object.keys(combined).length > 0)
			operations.push({
				kind: "update-clip",
				clipId: clipId(id),
				patch: combined,
			});
	}
	for (const id of sortedIds(afterMotionTextSequences.keys())) {
		const current = afterMotionTextSequences.get(id);
		const previous = beforeMotionTextSequences.get(id);
		if (!current || !previous || same(previous, current)) continue;
		operations.push({
			kind: "update-motion-text-sequence",
			sequenceId: previous.id,
			expectedSequenceRevision: previous.revision,
			sequence: current,
		});
	}
	// Existing clips must leave a soon-to-be-deleted parent (or asset) before
	// the evaluator applies the parent's cascading deletion.
	for (const id of sortedIds(beforeTracks.keys())) {
		if (!afterTracks.has(id))
			operations.push({ kind: "delete-track", trackId: trackId(id) });
	}
	for (const id of sortedIds(beforeAssets.keys())) {
		if (!afterAssets.has(id))
			operations.push({ kind: "delete-asset", assetId: assetId(id) });
	}
	for (const id of sortedIds(afterMarkers.keys())) {
		const current = afterMarkers.get(id);
		const previous = beforeMarkers.get(id);
		if (!current || !previous) continue;
		const patch = changedPatch(previous, current, [
			"time",
			"note",
			"color",
			"sceneId",
		]);
		if (Object.keys(patch).length > 0)
			operations.push({ kind: "update-marker", markerId: markerId(id), patch });
	}

	const reducedTrackIds = [
		...before.tracks
			.map((track) => track.id)
			.filter((id) => afterTracks.has(id)),
		...sortedIds(afterTracks.keys()).filter((id) => !beforeTracks.has(id)),
	];
	if (
		!same(
			projectTrackOrder({
				project: after.project,
				tracks: reducedTrackIds.map((id) => afterTracks.get(id)!),
			}),
			projectTrackOrder(after),
		)
	) {
		operations.push({
			kind: "reorder-tracks",
			trackIds: after.tracks.map((track) => track.id),
		});
	}
	if (operations.length === 0) {
		throw new OpenCutProjectionError(
			"empty",
			"A transaction-routable command must produce a non-empty public batch",
		);
	}
	canonicalOperationFingerprint(operations);
	return operations;
}

export function cloneOpenCutDraft(
	draft: OpenCutProjectDraft,
): OpenCutProjectDraft {
	return cloneOpaque(draft);
}

export function publicDocumentsEqual(
	left: TransactionEngineDocument,
	right: TransactionEngineDocument,
): boolean {
	const normalized = (document: TransactionEngineDocument) => ({
		project: document.project,
		// Collection membership is unordered, but lane-relative compositing order is not.
		trackOrder: document.project?.sceneState
			? projectTrackOrder(document)
			: undefined,
		tracks: [...document.tracks].sort((a, b) => a.id.localeCompare(b.id)),
		clips: [...document.clips].sort((a, b) => a.id.localeCompare(b.id)),
		assets: [...document.assets].sort((a, b) => a.id.localeCompare(b.id)),
		markers: [...document.markers].sort((a, b) => a.id.localeCompare(b.id)),
		motionTextSequences: [...(document.motionTextSequences ?? [])].sort(
			(a, b) => a.id.localeCompare(b.id),
		),
		revision: 0,
		idempotency: [],
	});
	return same(normalized(left), normalized(right));
}

export const OPEN_CUT_MARKER_ID_KEY = MARKER_ID_KEY;
