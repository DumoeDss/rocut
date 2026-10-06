import { revisionOf, type TransactionBatch } from "@opencut/editor-contracts";
import type { EditorCore } from "../core";
import { InsertElementCommand } from "../commands/timeline/element/insert-element";
import { buildEmptyTrack } from "../timeline/placement";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import {
	assetCatalogFromMedia,
	cloneOpenCutDraft,
	createDetachedCommandContext,
	diffOpenCutProjection,
	projectOpenCutDraft,
} from "../editor/transactions/opencut";

/** Reuses the UI layout/placement pipeline on an isolated draft; never saves. */
export function planAgentCaptions({
	editor,
	captions,
	trackId,
	expectedRevision,
	idempotencyKey,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	trackId: string;
	expectedRevision: number;
	idempotencyKey: string;
}): TransactionBatch {
	if (!captions.length) throw new Error("no-caption-cues");
	if (captions.length > 10_000) throw new Error("too-many-caption-cues");
	const assets = editor.media.getAssets();
	const draft = cloneOpenCutDraft({
		project: {
			...editor.project.getActive(),
			scenes: editor.scenes.getScenes(),
		},
		assetCatalog: assetCatalogFromMedia(assets),
	});
	const metadata = { revision: revisionOf(expectedRevision), idempotency: [] };
	const before = projectOpenCutDraft(draft, metadata);
	if (before.tracks.some((track) => track.id === trackId))
		throw new Error("caption-track-already-exists");
	const scene = draft.project.scenes.find(
		(entry) => entry.id === draft.project.currentSceneId,
	);
	if (!scene) throw new Error("scene-not-found");
	scene.tracks.overlay.unshift(buildEmptyTrack({ id: trackId, type: "text" }));
	const { context } = createDetachedCommandContext({ draft, assets });
	captions.forEach((caption, index) => {
		new InsertElementCommand({
			placement: { mode: "explicit", trackId },
			element: buildSubtitleTextElement({
				index,
				caption,
				canvasSize: draft.project.settings.canvasSize,
			}),
		}).execute(context);
	});
	return {
		expectedRevision: revisionOf(expectedRevision),
		idempotencyKey,
		operations: diffOpenCutProjection({
			before,
			after: projectOpenCutDraft(draft, metadata),
		}),
	};
}
