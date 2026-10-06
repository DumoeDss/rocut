import { useEffect, useRef, useState } from "react";
import { useEditorInstance } from "../editor/use-editor";
import { useEditorSession } from "../editor/session/editor-session-provider";
import type { SessionResources } from "../editor/session/resources";
import {
	CAPTION_IDLE_STATE,
	createCaptionTaskController,
	type CaptionProcessingState,
} from "./caption-task";

export function useCaptionTask() {
	const editor = useEditorInstance();
	const session = useEditorSession();
	const [processing, setProcessing] =
		useState<CaptionProcessingState>(CAPTION_IDLE_STATE);
	const owner = useRef<ReturnType<typeof createCaptionTaskController> | null>(
		null,
	);
	useEffect(() => {
		const controller = createCaptionTaskController({
			onChange: setProcessing,
			captureActivity: () => {
				const resources = editor.resources as SessionResources & {
					getActivityGeneration?: () => number;
					assertActivityGeneration?: (args: { generation: number }) => void;
				};
				const generation = resources.getActivityGeneration?.();
				const projectId = editor.project.getActiveOrNull()?.metadata.id;
				return () => {
					if (
						session.state !== "mounted" ||
						projectId !== editor.project.getActiveOrNull()?.metadata.id
					)
						return false;
					try {
						if (generation !== undefined)
							resources.assertActivityGeneration?.({ generation });
						return true;
					} catch {
						return false;
					}
				};
			},
		});
		owner.current = controller;
		const lifecycle = session.watch({
			select: (snapshot) => snapshot.lifecycle,
			onChange: (state) => {
				if (state !== "mounted") controller.invalidate();
			},
		});
		let projectId = editor.project.getActiveOrNull()?.metadata.id;
		const unsubscribe = editor.project.subscribe(() => {
			const next = editor.project.getActiveOrNull()?.metadata.id;
			if (next !== projectId) controller.invalidate();
			projectId = next;
		});
		return () => {
			lifecycle.unsubscribe();
			unsubscribe();
			controller.dispose();
			owner.current = null;
		};
	}, [editor, session]);
	return {
		processing,
		begin: (
			args: Parameters<
				ReturnType<typeof createCaptionTaskController>["begin"]
			>[0],
		) => owner.current?.begin(args) ?? null,
		cancel: () => owner.current?.cancel(),
	};
}
