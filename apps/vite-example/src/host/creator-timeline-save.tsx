import { useEffect } from "react";
import { useEditorInstance } from "@opencut/editor-classic/session";
import type { CreatorWorkspaceBridge } from "@opencut/editor-classic/surface";

/** A save completes only after the owning workspace acknowledges its derived documents. */
export function CreatorTimelineSave({
	connection,
}: {
	connection: Promise<CreatorWorkspaceBridge | null>;
}) {
	const editor = useEditorInstance();
	useEffect(
		() =>
			editor.save.afterPersist(async ({ projectId, sceneId }) => {
				const bridge = await connection;
				if (bridge)
					await bridge.execute({
						type: "timeline.saved",
						nativeProjectId: projectId,
						sceneId,
					});
			}),
		[editor, connection],
	);
	return null;
}
