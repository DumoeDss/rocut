import type {
	PlacementPolicyContext,
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionPlacementPolicy,
} from "@opencut/editor-contracts/engine";
import {
	isValidAsset,
	isValidClip,
	isValidProject,
	isValidTrack,
} from "@opencut/editor-contracts/engine/invariant";
import {
	evaluateClipTransitions,
	isMediaSourceSpanValid,
	type TransitionClip,
	type TransitionLink,
} from "opencut-wasm";
import { projectOpenCutDraft } from "./projection";
import type { OpenCutProjectDraft } from "./types";

/** Serialization boundary only: timing, handles and overlap decisions live in Rust. */
export function evaluateDocumentTransitions({
	document,
	previous,
}: {
	document: TransactionEngineDocument;
	previous?: TransactionEngineDocument;
}) {
	const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
	const tracks = new Map(document.tracks.map((track) => [track.id, track]));
	const clips: TransitionClip[] = [];
	const links: TransitionLink[] = [];
	for (const clip of document.clips) {
		if (clip.transitionIn)
			links.push({
				outgoingClipId: clip.transitionIn.outgoingClipId,
				incomingClipId: clip.id,
				durationFrames: clip.transitionIn.durationFrames,
			});
		const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
		if (
			tracks.get(clip.trackId)?.kind !== "video" ||
			!asset ||
			(asset.kind !== "video" && asset.kind !== "image") ||
			clip.content
		)
			continue;
		clips.push({
			id: clip.id,
			trackId: clip.trackId,
			start: clip.startTime,
			duration: clip.duration,
			source:
				asset.kind === "image"
					? { type: "image" }
					: {
							type: "video",
							trimStart: clip.trimStart,
							sourceDuration: asset.duration ?? 0,
							playbackRate: clip.retime?.rate ?? 1,
							freezeFrame: clip.freezeFrame,
						},
		});
	}
	if (!links.length) return { links, accepted: [], rejected: [], removed: [] };
	if (!document.project)
		throw new Error("Transitions require a project frame rate");
	return {
		links,
		...evaluateClipTransitions({
			clips,
			links,
			frameRate: document.project.frameRate,
			...(previous && {
				previous: {
					clipIds: previous.clips.map((clip) => clip.id),
					links: previous.clips.flatMap((clip) =>
						clip.transitionIn
							? [
									{
										outgoingClipId: clip.transitionIn.outgoingClipId,
										incomingClipId: clip.id,
										durationFrames: clip.transitionIn.durationFrames,
									},
								]
							: [],
					),
				},
			}),
		}),
	};
}

/** Apply Rust's cleanup before diff/history construction; never mutate adapter.encode. */
export function reconcileDraftTransitions({
	draft,
	previous,
}: {
	draft: OpenCutProjectDraft;
	previous: TransactionEngineDocument;
}): void {
	const document = projectOpenCutDraft(draft, {
		revision: previous.revision,
		idempotency: [],
	});
	const result = evaluateDocumentTransitions({ document, previous });
	if (result.rejected.length) {
		const error = result.rejected[0].error;
		throw new Error(
			"Invalid clip transition: " +
				(error.code === "invalid-plan" ? error.reason : error.code),
		);
	}
	const removedIds = new Set(
		result.removed.map((index) => result.links[index].incomingClipId),
	);
	if (!removedIds.size) return;
	const scene = draft.project.scenes.find(
		(scene) => scene.id === draft.project.currentSceneId,
	);
	if (!scene)
		throw new Error("Transition reconciliation requires an active scene");
	for (const track of [scene.tracks.main, ...scene.tracks.overlay]) {
		for (const element of track.elements) {
			if (
				(element.type === "video" || element.type === "image") &&
				removedIds.has(element.id)
			)
				delete element.transitionIn;
		}
	}
}

function operationIndex({
	context,
	ids,
}: {
	context: PlacementPolicyContext;
	ids: string[];
}): number | undefined {
	const indexes = ids.flatMap((id) => {
		const index = context.operationIndexByEntityId.get(id);
		return index === undefined ? [] : [index];
	});
	return indexes.length ? Math.max(...indexes) : undefined;
}

export const openCutMediaPolicy: TransactionPlacementPolicy = {
	evaluate(context) {
		const { document } = context;
		// The engine reports schema failures first. Never pass malformed candidates into the ABI.
		if (
			!document.project ||
			!isValidProject(document.project, document.project.id) ||
			!document.clips.every(isValidClip) ||
			!document.assets.every(isValidAsset) ||
			!document.tracks.every(isValidTrack)
		)
			return [];
		const issues: TransactionEngineIssue[] = [];
		const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
		for (const clip of document.clips) {
			if (clip.retime === undefined && clip.freezeFrame === undefined) continue;
			const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
			if (
				!asset ||
				asset.duration === undefined ||
				(asset.kind !== "video" && asset.kind !== "audio")
			)
				continue;
			if (
				!isMediaSourceSpanValid({
					duration: clip.duration,
					trimStart: clip.trimStart,
					trimEnd: clip.trimEnd,
					sourceDuration: asset.duration,
					playbackRate: clip.retime?.rate ?? 1,
					freezeFrame: clip.freezeFrame,
				})
			) {
				const ids = [clip.id, asset.id];
				issues.push({
					code: "source-out-of-bounds",
					message: "Clip playback exceeds its source media",
					entityIds: ids,
					operationIndex: operationIndex({ context, ids }),
				});
			}
		}
		const graph = evaluateDocumentTransitions({ document });
		for (const entry of graph.rejected) {
			const link = graph.links[entry.linkIndex];
			const ids = [link.outgoingClipId, link.incomingClipId];
			const reason =
				entry.error.code === "invalid-plan"
					? entry.error.reason
					: entry.error.code;
			issues.push({
				code: "provider:clip-transition",
				message: "Invalid clip transition: " + reason,
				entityIds: ids,
				operationIndex: operationIndex({ context, ids }),
			});
		}
		return issues;
	},
};
