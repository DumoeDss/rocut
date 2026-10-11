import { useMemo, useRef, useState } from "react";
import {
	revisionOf,
	type NativeTransitionStyle,
	type PeelTransitionStyle,
	type BendTransitionStyle,
} from "@opencut/editor-contracts";
import { useEditor, useEditorInstance } from "../editor/use-editor";
import {
	assetCatalogFromMedia,
	projectOpenCutDraft,
} from "../editor/transactions/opencut";
import { UpdateElementsCommand } from "../commands/timeline/element/update-elements";
import type { ImageElement, VideoElement } from "../timeline";
import { inspectTransitionChoice } from "./transition-choice";
import {
	nativePeelDefaults,
	nativeBendDefaults,
	transitionStyleOf,
} from "./transition-style";

type BendDraft = { [K in Exclude<keyof BendTransitionStyle, "kind">]: string };
function bendDraft(style?: BendTransitionStyle): BendDraft | undefined {
	return (
		style && {
			direction: style.direction,
			hinge: String(style.hinge),
			angle: String(style.angle),
			perspective: String(style.perspective),
			shading: String(style.shading),
		}
	);
}

type PeelDraft = { [K in Exclude<keyof PeelTransitionStyle, "kind">]: string };
function peelDraft(style?: PeelTransitionStyle): PeelDraft | undefined {
	return (
		style && {
			direction: style.direction,
			curl: String(style.curl),
			segments: String(style.segments),
			shading: String(style.shading),
			perspective: String(style.perspective),
		}
	);
}

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
	const peelCatalog = useMemo(() => nativePeelDefaults(), []);
	const bendCatalog = useMemo(() => nativeBendDefaults(), []);
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
	const sourceKey = JSON.stringify([element.id, saved, defaultOutgoing]);
	const initialDraft = {
		sourceKey,
		outgoingId: defaultOutgoing,
		frames: String(saved?.durationFrames ?? 30),
		kind: saved?.kind ?? ("cross-dissolve" as NativeTransitionStyle["kind"]),
		peel: peelDraft(saved?.kind === "peel" ? saved : peelCatalog.style),
		bend: bendDraft(saved?.kind === "bend" ? saved : bendCatalog.style),
	};
	const [draft, setDraft] = useState(initialDraft);
	// Adopt external history changes before rendering children; do not keep an old
	// duration draft when undo returns to a previously visited saved relation.
	if (draft.sourceKey !== sourceKey) setDraft(initialDraft);
	const { outgoingId, frames, kind, peel, bend } =
		draft.sourceKey === sourceKey ? draft : initialDraft;
	const setOutgoingId = (value: string) =>
		setDraft({ sourceKey, frames, kind, peel, bend, outgoingId: value });
	const setFrames = (value: string) =>
		setDraft({ sourceKey, outgoingId, kind, peel, bend, frames: value });
	const setKind = (value: NativeTransitionStyle["kind"]) => {
		if (
			busy.current ||
			(value !== "cross-dissolve" && value !== "peel" && value !== "bend")
		)
			return;
		setDraft({ sourceKey, outgoingId, frames, kind: value, peel, bend });
	};
	const setPeel = (key: keyof PeelDraft, value: string) => {
		if (!busy.current && peel)
			setDraft({
				sourceKey,
				outgoingId,
				frames,
				kind,
				bend,
				peel: { ...peel, [key]: value },
			});
	};
	const setBend = (key: keyof BendDraft, value: string) => {
		if (!busy.current && bend)
			setDraft({
				sourceKey,
				outgoingId,
				frames,
				kind,
				peel,
				bend: { ...bend, [key]: value },
			});
	};
	const [message, setMessage] = useState("");
	const [isSaving, setSaving] = useState(false);
	const busy = useRef(false);

	const durationFrames = frames.trim() ? Number(frames) : NaN;
	const numeric = (value: string) => (value.trim() ? Number(value) : NaN);
	const style: NativeTransitionStyle | undefined =
		kind === "cross-dissolve"
			? { kind }
			: kind === "bend"
				? bend
					? {
							kind,
							direction: bend.direction as BendTransitionStyle["direction"],
							hinge: numeric(bend.hinge),
							angle: numeric(bend.angle),
							perspective: numeric(bend.perspective),
							shading: numeric(bend.shading),
						}
					: undefined
				: peel
					? {
							kind,
							direction: peel.direction as PeelTransitionStyle["direction"],
							curl: numeric(peel.curl),
							segments: numeric(peel.segments),
							shading: numeric(peel.shading),
							perspective: numeric(peel.perspective),
						}
					: undefined;
	const validation = style
		? inspectTransitionChoice({
				document,
				incomingId: element.id,
				outgoingId,
				durationFrames,
				style,
			})
		: {
				valid: false,
				message:
					(kind === "bend" ? bendCatalog.error : peelCatalog.error) ??
					"Native style is unavailable.",
			};
	const unchanged =
		saved?.outgoingClipId === outgoingId &&
		saved.durationFrames === durationFrames &&
		JSON.stringify(transitionStyleOf(saved)) === JSON.stringify(style);
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
											...style!,
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
		kind,
		setKind,
		peel,
		setPeel,
		peelAvailable: !!peelCatalog.style,
		peelError: peelCatalog.error,
		bend,
		setBend,
		bendAvailable: !!bendCatalog.style,
		bendError: bendCatalog.error,
		setFrames,
		validation,
		unchanged,
		isSaving,
		message,
		save,
	};
}
