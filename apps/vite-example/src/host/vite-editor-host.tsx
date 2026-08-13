import { useMemo } from "react";
import type { EditorHost } from "@/editor/host/editor-host";
import { EditorSessionHost } from "@/editor/session";
import { createViteEditorHost } from "./vite-host-config";

/** The Vite composition root: platform decisions stay outside the editor. */
export function ViteEditorHost({
	projectId,
	onProjectIdChange,
	onExitProject,
	children,
}: {
	projectId: string;
	onProjectIdChange: (projectId: string) => void;
	onExitProject: () => void;
	children: React.ReactNode;
}) {
	const host = useMemo<EditorHost>(
		() =>
			createViteEditorHost({
				projectId,
				onProjectIdChange,
				onExitProject,
			}),
		[projectId, onProjectIdChange, onExitProject],
	);

	return <EditorSessionHost host={host}>{children}</EditorSessionHost>;
}
