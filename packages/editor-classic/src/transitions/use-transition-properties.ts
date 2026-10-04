import { useMemo, useRef, useState } from "react";
import { revisionOf } from "@opencut/editor-contracts";
import { useEditor, useEditorInstance } from "../editor/use-editor";
import {
	assetCatalogFromMedia,
	projectOpenCutDraft,
} from "../editor/transactions/opencut";
import { UpdateElementsCommand } from "../commands/timeline/element/update-elements";
import type { ImageElement, VideoElement } from "../timeline";
import { inspectTransitionChoice } from "./transition-choice";

export function useTransitionProperties({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement;
	trackId: string;
}) {
	const editor = useEditorInstance();
	const [project, scenes, assets] = useEditor((current) => [
		current.project.getActive(),
		current.scenes.getScenes(),
		current.media.getAssets(),
	]);
	const document = useMemo(
		() =>
			projectOpenCutDraft(
				{
					project: { ...project, scenes },
					assetCatalog: assetCatalogFromMedia(assets),
				},
				{ revision: revisionOf(0), idempotency: [] },
			),
		[project, scenes, assets],
	);
	const scene = scenes.find((entry) => entry.id === project.currentSceneId);
	const track =
		scene &&
		[scene.tracks.main, ...scene.tracks.overlay].find(
			(entry) => entry.id === trackId,
		);
	const candidates = (track?.elements ?? []).filter(
		(clip): clip is VideoElement | ImageElement =>
			clip.id !== element.id &&
			(clip.type === "video" || clip.type === "image"),
	);
	const saved = element.transitionIn;
	const defaultOutgoing =
		saved?.outgoingClipId ??
		candidates.find(
			(clip) =>
				inspectTransitionChoice({
					document,
					incomingId: element.id,
					outgoingId: clip.id,
					durationFrames: 2,
				}).valid,
		)?.id ??
		candidates[0]?.id ??
		"";
	const sourceKey = JSON.stringify([
		element.id,
		saved?.outgoingClipId,
		saved?.durationFrames,
		defaultOutgoing,
	]);
	const initialDraft = {
		sourceKey,
		outgoingId: defaultOutgoing,
		frames: String(saved?.durationFrames ?? 30),
	};
	const [draft, setDraft] = useState(initialDraft);
	// Adopt external history changes before rendering children; do not keep an old
	// duration draft when undo returns to a previously visited saved relation.
	if (draft.sourceKey !== sourceKey) setDraft(initialDraft);
	const { outgoingId, frames } =
		draft.sourceKey === sourceKey ? draft : initialDraft;
	const setOutgoingId = (value: string) =>
		setDraft({ sourceKey, frames, outgoingId: value });
	const setFrames = (value: string) =>
		setDraft({ sourceKey, outgoingId, frames: value });
	const [message, setMessage] = useState("");
	const [isSaving, setSaving] = useState(false);
	const busy = useRef(false);

	const durationFrames = frames.trim() ? Number(frames) : NaN;
	const validation = inspectTransitionChoice({
		document,
		incomingId: element.id,
		outgoingId,
		durationFrames,
	});
	const unchanged =
		saved?.outgoingClipId === outgoingId &&
		saved.durationFrames === durationFrames;
	const save = async (remove = false) => {
		if (busy.current || (remove ? !saved : !validation.valid || unchanged))
			return;
		busy.current = true;
		setSaving(true);
		setMessage("");
		editor.playback.pause();
		try {
			await editor.command.execute({
				command: new UpdateElementsCommand({
					updates: [
						{
							trackId,
							elementId: element.id,
							patch: {
								transitionIn: remove
									? undefined
									: {
											kind: "cross-dissolve",
											outgoingClipId: outgoingId,
											durationFrames,
										},
							},
						},
					],
				}),
			});
			setMessage(remove ? "Transition removed." : "Transition saved.");
		} catch (error) {
			setMessage(
				"Transition was not saved. " +
					(error instanceof Error ? error.message : "Try again."),
			);
		} finally {
			busy.current = false;
			setSaving(false);
		}
	};
	return {
		fps: project.settings.fps,
		isHidden:
			!!track?.hidden ||
			!!element.hidden ||
			!!candidates.find((clip) => clip.id === outgoingId)?.hidden,
		candidates,
		outgoingId,
		setOutgoingId,
		frames,
		setFrames,
		validation,
		unchanged,
		isSaving,
		message,
		save,
	};
}
