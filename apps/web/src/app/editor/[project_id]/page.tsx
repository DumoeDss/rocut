"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { EditorProvider } from "@/components/providers/editor-provider";
import { MobileGate } from "@/components/editor/mobile-gate";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import type { EditorHost } from "@/editor/host/editor-host";
import { createInMemoryPorts } from "@/editor/ports/in-memory";
import { EditorSessionHost } from "@/editor/session";
import { EditorRoot } from "@/editor/surface/editor-root";
import { DEFAULT_LOGO_URL, SITE_URL } from "@/site/brand";
import { SOCIAL_LINKS } from "@/site/social";

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
	const projectId = params.project_id as string;

	const host = useMemo<EditorHost>(
		() => ({
			...createInMemoryPorts(),
			projectId,
			navigation: {
				onProjectReplaced: ({ projectId: newProjectId }) =>
					router.replace(`/editor/${newProjectId}`),
				onExitProject: () => router.push("/projects"),
				onGoBack: () => router.back(),
			},
			services: {
				soundSearchEndpoint: "/api/sounds/search",
				feedbackEndpoint: "/api/feedback",
			},
			// Supplied from `@/site/*` so these stay single-sourced and this app
			// renders exactly what it did at the pin. The editor no longer imports
			// site code itself, which is what keeps the distributable graph clean.
			branding: { logoUrl: DEFAULT_LOGO_URL },
			links: {
				discordUrl: SOCIAL_LINKS.discord,
				roadmapUrl: `${SITE_URL}/roadmap`,
			},
		}),
		[projectId, router],
	);

	return (
		<EditorSessionHost host={host}>
			<div className="h-screen w-screen">
				<MobileGate>
					<EditorProvider>
						<EditorRoot />
						<ChangelogNotification />
					</EditorProvider>
				</MobileGate>
			</div>
		</EditorSessionHost>
	);
}
