"use client";

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
		<SurfaceEvidenceHarness hostName="next" createHost={createEvidenceHost} />
	);
}
