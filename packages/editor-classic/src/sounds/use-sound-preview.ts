import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorSession } from "../editor/session/editor-session-provider";
import { useEditorInstance } from "../editor/use-editor";
import {
	createSoundPreviewController,
	type SoundPreviewSource,
} from "./preview-controller";

export function useSoundPreview(sounds: readonly SoundPreviewSource[]) {
	const session = useEditorSession();
	const editor = useEditorInstance();
	const [playingId, setPlayingId] = useState<number | null>(null);
	const owner = useRef<ReturnType<typeof createSoundPreviewController> | null>(
		null,
	);

	useEffect(() => {
		const controller = createSoundPreviewController({
			onChange: setPlayingId,
			onError: (message) => toast.error(message),
		});
		owner.current = controller;
		const lifecycle = session.watch({
			select: (snapshot) => snapshot.lifecycle,
			onChange: (state) => {
				if (state !== "mounted") controller.stop();
			},
		});
		let projectId = editor.project.getActiveOrNull()?.metadata.id;
		const unsubscribe = editor.project.subscribe(() => {
			const next = editor.project.getActiveOrNull()?.metadata.id;
			if (next !== projectId) controller.stop();
			projectId = next;
		});
		return () => {
			lifecycle.unsubscribe();
			unsubscribe();
			controller.dispose();
			owner.current = null;
		};
	}, [editor, session]);

	useEffect(() => {
		owner.current?.retain(sounds);
	}, [sounds]);
	return {
		playingId,
		playSound: ({ sound }: { sound: SoundPreviewSource }) => {
			if (session.state === "mounted") owner.current?.toggle({ sound });
		},
	};
}
