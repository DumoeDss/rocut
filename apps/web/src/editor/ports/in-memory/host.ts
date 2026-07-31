/**
 * A complete in-memory `EditorHost`.
 *
 * Separate from `./index.ts` so the port implementations stay importable without
 * pulling in the host seam — the conformance suite runs against *ports*, and an
 * adapter author who implements one port should not have to construct a host to
 * exercise it.
 */
import type { EditorHost } from "../../host/editor-host";
import type { GraphicsDeclaration } from "../environment";
import type { ProjectStore } from "../project-store";
import { createInMemoryPorts } from "./index";

export function createInMemoryHost(
	options: {
		projectId?: string;
		graphics?: GraphicsDeclaration;
		store?: ProjectStore;
	} = {},
): EditorHost {
	return {
		projectId: options.projectId ?? "memory-project",
		navigation: {
			onProjectReplaced: () => {},
			onExitProject: () => {},
			onGoBack: () => {},
		},
		services: {},
		branding: { logoUrl: "assets/logo.svg" },
		links: {
			discordUrl: "https://example.invalid/discord",
			roadmapUrl: "https://example.invalid/roadmap",
		},
		...createInMemoryPorts({
			graphics: options.graphics,
			store: options.store,
		}),
	};
}
