/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- This is the concrete donor/opaque projection boundary; its small pure mappers intentionally mirror array callback signatures. */
import type {
	Asset,
	Clip,
	Marker,
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
import type { Bookmark, TimelineElement, TimelineTrack } from "../../../timeline/types";
import { cloneOpaque } from "../../persistence/opaque-value";
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
	};
}

function allTracks(draft: OpenCutProjectDraft): TimelineTrack[] {
	const scene = draft.project.scenes.find(
		(candidate) => candidate.id === draft.project.currentSceneId,
	);
	if (!scene) return [];
	return [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio];
}

function trackProjection(track: TimelineTrack): Track {
	return {
		id: trackId(track.id),
		kind: track.type,
		name: track.name,
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

function clipProjection(track: TimelineTrack, element: TimelineElement): Clip {
	const mediaId = elementAssetId(element);
	return {
		id: clipId(element.id),
		trackId: trackId(track.id),
		startTime: contractTime(element.startTime),
		duration: contractTime(element.duration),
		trimStart: contractTime(element.trimStart),
		trimEnd: contractTime(element.trimEnd),
		...(mediaId !== undefined && { assetId: assetId(mediaId) }),
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
	};
}

function markerProjection(
	sceneId: string,
	bookmark: Bookmark,
	index: number,
): Marker {
	return {
		id: markerId(markerIdentity(sceneId, bookmark, index)),
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
	},
): TransactionEngineDocument {
	const tracks = allTracks(draft);
	const scene = draft.project.scenes.find(
		(candidate) => candidate.id === draft.project.currentSceneId,
	);
	return {
		project: projectProjection(draft),
		tracks: tracks.map(trackProjection),
		clips: tracks.flatMap((track) =>
			track.elements.map((element) => clipProjection(track, element)),
		),
		assets: draft.assetCatalog.map(assetProjection),
		markers:
			scene?.bookmarks.map((bookmark, index) =>
				markerProjection(scene.id, bookmark, index),
			) ?? [],
		revision: metadata.revision,
		idempotency: metadata.idempotency,
	};
}

function stableValue(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return `string:${JSON.stringify(value)}`;
	if (typeof value === "number" || typeof value === "boolean") {
		return `${typeof value}:${String(value)}`;
	}
	if (Array.isArray(value)) {
		return `array:[${value.map(stableValue).join(",")}]`;
	}
	if (typeof value === "object") {
		const source = value as Record<string, unknown>;
		return `object:{${Object.keys(source)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableValue(source[key])}`)
			.join(",")}}`;
	}
	return `${typeof value}:${String(value)}`;
}

function same(left: unknown, right: unknown): boolean {
	return stableValue(left) === stableValue(right);
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
	const operations: TransactionOperation[] = [];
	const projectPatch = changedPatch(before.project, after.project, [
		"name",
		"frameRate",
		"canvasWidth",
		"canvasHeight",
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
		const patch = changedPatch(previous, current, ["kind", "name", "hidden"]);
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
		]);
		if (Object.keys(patch).length > 0)
			operations.push({ kind: "update-clip", clipId: clipId(id), patch });
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
		const patch = changedPatch(previous, current, ["time", "note", "color"]);
		if (Object.keys(patch).length > 0)
			operations.push({ kind: "update-marker", markerId: markerId(id), patch });
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
		tracks: [...document.tracks].sort((a, b) => a.id.localeCompare(b.id)),
		clips: [...document.clips].sort((a, b) => a.id.localeCompare(b.id)),
		assets: [...document.assets].sort((a, b) => a.id.localeCompare(b.id)),
		markers: [...document.markers].sort((a, b) => a.id.localeCompare(b.id)),
		revision: 0,
		idempotency: [],
	});
	return same(normalized(left), normalized(right));
}

export const OPEN_CUT_MARKER_ID_KEY = MARKER_ID_KEY;
