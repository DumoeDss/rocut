import { useRef, useState } from "react";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../services/renderer/motion-text/support-manifest";
import { selectElementWithTrackTuple } from "../../timeline/element-with-track-selector";
import { mutateMotionTextSequence } from "../../wasm";
import type { MotionTextPresetCatalogEntry } from "../preset-catalog";

/** UI orchestration only: validation, locks, and replanning remain in Rust. */
export function usePresetApplication() {
	const editor = useEditorInstance();
	const [, element] = useEditor((current) =>
		selectElementWithTrackTuple({
			editor: current,
			elements: current.selection.getSelectedElements(),
		}),
	);
	const busy = useRef(false);
	const [isApplying, setIsApplying] = useState(false);
	const [message, setMessage] = useState<{
		error: boolean;
		text: string;
	} | null>(null);
	const targetName = element?.type === "motion-text" ? element.name : null;

	const apply = async (entry: MotionTextPresetCatalogEntry) => {
		if (busy.current) return;
		busy.current = true;
		setIsApplying(true);
		setMessage(null);
		try {
			const [, target] = selectElementWithTrackTuple({
				editor,
				elements: editor.selection.getSelectedElements(),
			});
			if (target?.type !== "motion-text")
				throw new Error("Select one motion-text clip on the timeline first.");
			const sequence = editor.project
				.getActive()
				.motionTextSequences.find(
					(candidate) => candidate.id === target.sequenceId,
				);
			if (!sequence)
				throw new Error("The selected motion-text sequence is missing.");
			const result = mutateMotionTextSequence({
				sequence,
				mutation: {
					kind: "apply-preset",
					group: entry.group,
					presetId: entry.id,
				},
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			});
			if (!result.sequence)
				throw new Error(
					result.diagnostics[0]?.message ?? "The preset could not be applied.",
				);
			await editor.project.updateMotionTextSequence({
				sequence: result.sequence,
			});
			setMessage({
				error: false,
				text: `${entry.name} applied to ${target.name}. Locked cuts and groups are preserved.`,
			});
		} catch (error) {
			setMessage({
				error: true,
				text:
					error instanceof Error
						? error.message
						: "The preset could not be applied.",
			});
		} finally {
			busy.current = false;
			setIsApplying(false);
		}
	};
	return { targetName, apply, isApplying, message };
}
