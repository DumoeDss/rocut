"use client";

import { useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { MobileGate } from "@opencut/editor-classic/ui";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import type { EditorHost } from "@opencut/editor-ports/host";
import { createNextEditorHost } from "@/editor/host/next-editor-host";
import { C4NextRuntimeProbe } from "@/editor/host/c4-next-runtime-probe";
import { EditorSessionHost } from "@opencut/editor-classic/session";
import { SessionEditorSurface } from "@opencut/editor-classic/surface";

/**
 * The Next host of the editor.
 *
 * Everything Next-specific lives here: route params for project identity, the
 * router for navigation, the viewport-sized wrapper, and the changelog
 * announcement. The editor itself sees only the `EditorHost` object.
 */
export default function Editor() {
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const projectId = params.project_id as string;
	const c4BuildMarker =
		process.env.NEXT_PUBLIC_C4_BUILD_MARKER ?? "development";
	const requestedC4Probe = searchParams.get("c4-next-probe");
	const c4Probe =
		c4BuildMarker.startsWith("c4-final-commit-") &&
		(requestedC4Probe === "worker" || requestedC4Probe === "forced-none")
			? requestedC4Probe
			: null;

	const host = useMemo<EditorHost>(
		() =>
			createNextEditorHost({
				projectId,
				onProjectReplaced: (newProjectId) =>
					router.replace(`/editor/${newProjectId}`),
				onExitProject: () => router.push("/projects"),
				onGoBack: () => router.back(),
				forceRendererBackend: c4Probe === "forced-none" ? "none" : undefined,
				workerFixture: c4Probe === "worker",
			}),
		[projectId, router, c4Probe],
	);

	return (
		<EditorSessionHost host={host}>
			<div className="h-screen w-screen" data-c4-build-marker={c4BuildMarker}>
				<MobileGate>
					{c4Probe === "worker" || c4Probe === "forced-none" ? (
						<C4NextRuntimeProbe mode={c4Probe} />
					) : null}
					<SessionEditorSurface focusMode="focused" />
					<ChangelogNotification />
				</MobileGate>
			</div>
		</EditorSessionHost>
	);
}
