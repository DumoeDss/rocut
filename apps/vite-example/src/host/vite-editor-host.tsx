import { useMemo } from "react";
import type { EditorHost } from "@/editor/host/editor-host";
import { createInMemoryPorts } from "@/editor/ports/in-memory";
import { EditorSessionHost } from "@/editor/session";

/**
 * This example's implementation of the editor host seam.
 *
 * It has no router, which is the point: the editor's identity and navigation
 * needs are satisfied by three callbacks over local state. Nothing here asserts
 * a URL structure.
 */
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
		() => ({
			...createInMemoryPorts(),
			projectId,
			navigation: {
				// The requested project did not exist and the editor made a new one.
				// There is no route to replace, so this updates local state and keeps
				// the address bar honest enough to survive a reload.
				onProjectReplaced: ({ projectId: replacementId }) => {
					onProjectIdChange(replacementId);
					window.history.replaceState(
						null,
						"",
						`?project=${encodeURIComponent(replacementId)}`,
					);
				},
				onExitProject,
				// Intentionally a no-op. This host is a single page with no history
				// stack of its own, and calling `history.back()` would navigate away
				// from the example entirely — worse than doing nothing.
				onGoBack: () => {},
			},
			// No server sits behind this host, so neither endpoint is configured and
			// both features render their explicit unavailable state.
			services: {},
			// This host supplies its own branding and outbound links rather than the
			// editor importing them from `@/site/*`. The asset is copied by the
			// runtime allowlist in vite.config.ts; the links point at the upstream
			// project because that is what this example is an example of.
			branding: { logoUrl: "/logos/opencut/svg/logo.svg" },
			links: {
				discordUrl: "https://discord.com/invite/Mu3acKZvCp",
				roadmapUrl: "https://opencut.app/roadmap",
			},
		}),
		[projectId, onProjectIdChange, onExitProject],
	);

	return <EditorSessionHost host={host}>{children}</EditorSessionHost>;
}
