"use client";

import { C6DisposalHarness } from "@/editor/session/c6-disposal-harness";
import { createNextEditorHost } from "@/editor/host/next-editor-host";
import { BrowserProjectStore } from "@/services/storage/browser-project-store";

const BUILD_MARKER = process.env.NEXT_PUBLIC_C6_BUILD_MARKER ?? "development";

export default function C6DisposalPage() {
	return (
		<C6DisposalHarness
			createHost={({ projectId, onProjectReplaced, onExitProject, onGoBack }) =>
				createNextEditorHost({
					projectId,
					onProjectReplaced,
					onExitProject,
					onGoBack,
				})
			}
			isDurableBrowserStore={(store) => store instanceof BrowserProjectStore}
			buildMarker={BUILD_MARKER}
		/>
	);
}
