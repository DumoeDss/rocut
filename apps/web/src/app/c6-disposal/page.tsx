"use client";

import { C6DisposalHarness } from "@opencut/editor-classic/evidence";
import { createNextEditorHost } from "@/editor/host/next-editor-host";
import { BrowserProjectStore } from "@opencut/editor-classic/storage";

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
