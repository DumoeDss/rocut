import { useMemo } from "react";
import type { EditorHost } from "@opencut/editor-ports/host";
import { EditorSessionHost } from "@opencut/editor-classic/session";
import { createElectronEditorHost } from "./electron-host-config";

/** The Electron composition root: platform decisions stay outside the editor. */
export function ElectronEditorHost({
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
			createElectronEditorHost({
				projectId,
				onProjectIdChange,
				onExitProject,
			}),
		[projectId, onProjectIdChange, onExitProject],
	);

	return <EditorSessionHost host={host}>{children}</EditorSessionHost>;
}
