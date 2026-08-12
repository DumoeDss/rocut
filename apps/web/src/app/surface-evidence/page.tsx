"use client";

import * as React from "react";

import { createNextEditorHost } from "@/editor/host/next-editor-host";
import { SurfaceEvidenceHarness } from "@/editor/surface/evidence/surface-evidence-harness";

const createEvidenceHost = ({
	projectId,
	onProjectReplaced,
}: {
	projectId: string;
	onProjectReplaced: (projectId: string) => void;
}) =>
	createNextEditorHost({
		projectId,
		onProjectReplaced,
		onExitProject: () => {},
		onGoBack: () => {},
		forceRendererBackend: "none",
		workerFixture: true,
	});

export default function SurfaceEvidencePage() {
	return (
		<SurfaceEvidenceHarness
			hostName="next"
			hostReactIdentity={React}
			buildMarker={
				process.env.NEXT_PUBLIC_R2_BUILD_MARKER ?? "missing-next-marker"
			}
			createHost={createEvidenceHost}
		/>
	);
}
