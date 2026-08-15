import { useEffect, useReducer, useState } from "react";
import { useEditorInstance } from "../../../editor/use-editor";
import { useCommittedRef } from "../../../hooks/use-committed-ref";
import { useKeyframeSelection } from "./use-keyframe-selection";
import { registerCanceller } from "../../../editor/cancel-interaction";
import { useEditorSession } from "../../../editor/session/editor-session-provider";
import { useSurfaceDragCoordinator } from "../../../editor/surface/embedding/surface-drag-coordinator";
import {
	KeyframeDragController,
	type KeyframeDragConfig,
	type KeyframeDragState,
} from "../../controllers/keyframe-drag-controller";
import type { TimelineElement } from "../..";
import type { MediaTime } from "../../../wasm";

export type { KeyframeDragState };

export function useKeyframeDrag({
	zoomLevel,
	element,
	displayedStartTime,
}: {
	zoomLevel: number;
	element: TimelineElement;
	displayedStartTime: MediaTime;
}) {
	const editor = useEditorInstance();
	const session = useEditorSession();
	const dragCoordinator = useSurfaceDragCoordinator();
	const {
		selectedKeyframes,
		isKeyframeSelected,
		setKeyframeSelection,
		toggleKeyframeSelection,
		selectKeyframeRange,
	} = useKeyframeSelection();

	const config: KeyframeDragConfig = {
		zoomLevel,
		element,
		displayedStartTime,
		getFps: () => editor.project.getActive()?.settings.fps ?? null,
		selectedKeyframes,
		isKeyframeSelected,
		setKeyframeSelection,
		toggleKeyframeSelection,
		selectKeyframeRange,
		executeCommand: (command) => editor.command.execute({ command }),
		seek: ({ time }) => editor.playback.seek({ time }),
		getTotalDuration: () => editor.timeline.getTotalDuration(),
		startMouseDrag: ({ move, finish, cancel }) =>
			dragCoordinator.start({ kind: "mouse", move, finish, cancel }),
	};
	const configRef = useCommittedRef(config);
	const [controller] = useState(
		() => new KeyframeDragController({ configRef }),
	);

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);

	useEffect(() => {
		if (!controller.isActive) return;
		return registerCanceller({ session, fn: () => controller.cancel() });
	}, [controller.isActive, controller, session]);

	useEffect(() => () => controller.destroy(), [controller]);

	return {
		keyframeDragState: controller.keyframeDragState,
		handleKeyframeMouseDown: controller.onKeyframeMouseDown,
		handleKeyframeClick: controller.onKeyframeClick,
		getVisualOffsetPx: controller.getVisualOffsetPx,
	};
}
