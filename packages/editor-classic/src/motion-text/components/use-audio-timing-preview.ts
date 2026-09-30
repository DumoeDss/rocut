import type { MotionTextSequence } from "@opencut/editor-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorInstance } from "../../editor/use-editor";
import {
	createMotionTextAudioTimingPreview,
	type MotionTextAudioTimingPreview,
} from "./audio-binding-previews";

export function useMotionTextAudioTimingPreview({
	sequence,
	selectedClipId,
	onMessage,
}: {
	readonly sequence: MotionTextSequence;
	readonly selectedClipId: string;
	readonly onMessage: (message: string | null) => void;
}) {
	const editor = useEditorInstance();
	const [preview, setPreview] = useState<MotionTextAudioTimingPreview | null>(
		null,
	);
	const [isApplying, setIsApplying] = useState(false);
	const previewRef = useRef<MotionTextAudioTimingPreview | null>(null);
	const activePreview =
		preview?.baseRevision === sequence.revision &&
		preview.sequence.id === sequence.id &&
		preview.clipId === selectedClipId
			? preview
			: null;

	const clearPreview = useCallback(() => {
		const ownedPreview = previewRef.current;
		if (
			ownedPreview &&
			editor.renderer.getMotionTextSequencePreview()?.sequence ===
				ownedPreview.sequence
		) {
			editor.renderer.clearMotionTextSequencePreview({
				sequenceId: ownedPreview.sequence.id,
			});
		}
		previewRef.current = null;
		setPreview(null);
	}, [editor]);

	useEffect(
		() => () => {
			const ownedPreview = previewRef.current;
			if (
				ownedPreview &&
				editor.renderer.getMotionTextSequencePreview()?.sequence ===
					ownedPreview.sequence
			) {
				editor.renderer.clearMotionTextSequencePreview({
					sequenceId: ownedPreview.sequence.id,
				});
			}
			previewRef.current = null;
		},
		[editor, sequence.id],
	);

	const publishPreview = useCallback(
		({
			candidate,
			clipId,
		}: {
			readonly candidate: MotionTextSequence;
			readonly clipId: string;
		}): boolean => {
			const nextPreview = createMotionTextAudioTimingPreview({
				before: sequence,
				after: candidate,
				clipId,
			});
			if (
				!editor.renderer.setMotionTextSequencePreview({
					baseRevision: nextPreview.baseRevision,
					sequence: nextPreview.sequence,
				})
			) {
				onMessage(
					"The sequence changed before the timing preview could be shown.",
				);
				return false;
			}
			previewRef.current = nextPreview;
			setPreview(nextPreview);
			onMessage(null);
			return true;
		},
		[editor, onMessage, sequence],
	);

	const cancelPreview = useCallback(() => {
		clearPreview();
		onMessage(null);
	}, [clearPreview, onMessage]);

	const applyPreview = useCallback(async () => {
		if (!activePreview || isApplying) return;
		const committed = editor.project
			.getActive()
			.motionTextSequences.find(
				(candidate) => candidate.id === activePreview.sequence.id,
			);
		const published = editor.renderer.getMotionTextSequencePreview();
		if (
			committed?.revision !== activePreview.baseRevision ||
			published?.sequence !== activePreview.sequence
		) {
			clearPreview();
			onMessage(
				"The sequence or canvas preview changed. Generate a new timing preview.",
			);
			return;
		}
		setIsApplying(true);
		onMessage(null);
		try {
			await editor.project.updateMotionTextSequence({
				sequence: activePreview.sequence,
			});
			clearPreview();
			onMessage(
				activePreview.movedCueCount === 0
					? "Audio binding synchronized; protected cue timing was preserved."
					: `Audio timing synchronized for ${activePreview.movedCueCount} ${activePreview.movedCueCount === 1 ? "cue" : "cues"}.`,
			);
		} catch (error) {
			onMessage(
				error instanceof Error
					? error.message
					: "The timing preview could not be applied.",
			);
		} finally {
			setIsApplying(false);
		}
	}, [activePreview, clearPreview, editor, isApplying, onMessage]);

	return {
		activePreview,
		isApplying,
		publishPreview,
		clearPreview,
		cancelPreview,
		applyPreview,
	};
}
