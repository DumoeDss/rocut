import type { EditorHost } from "@opencut/editor-ports/host";
import {
	createInMemoryPorts,
	DeterministicIdGenerator,
	InMemoryProjectStore,
	RecordingDiagnostics,
} from "@opencut/editor-ports/in-memory";

/**
 * Process-lifetime host instances, the `vite-host-config.ts` pattern: the host
 * object is recreated whenever the project id changes, and the store/ID
 * sequence/diagnostics must survive that recreation or the editor branch would
 * mount against an empty store that never saw the project the picker created.
 */
const electronDiagnostics = new RecordingDiagnostics();
const electronIds = new DeterministicIdGenerator();
const electronInMemoryStore = new InMemoryProjectStore();

/**
 * The Electron composition root (design E3), skeleton stage.
 *
 * Every port is the reference implementation right now: this stage proves the
 * renderer boots and drives the real editor from the scheme origin. Group 4
 * final-overrides `store` with `FilesystemProjectStore` (via the preload
 * bridge), and Group 5 the desktop `assets`/`assetLoader`/`runtimeResources`
 * roles; each swap is a named decision added here, so the reference roles this
 * host deliberately keeps stay visible at every stage.
 *
 * `store`/`ids`/`diagnostics` are final-overridden with the module-lifetime
 * instances above — the same "one stable store, one process-lifetime ID
 * sequence" override `vite-host-config.ts` applies with its browser store.
 *
 * `navigation`, `branding` and `links` are per-host configuration, not port
 * roles — every host sets them.
 */
export function createElectronEditorHost({
	projectId,
	onProjectIdChange,
	onExitProject,
}: {
	projectId: string;
	onProjectIdChange: (projectId: string) => void;
	onExitProject: () => void;
}): EditorHost {
	return {
		...createInMemoryPorts(),
		projectId,
		navigation: {
			onProjectReplaced: ({ projectId: replacementId }) => {
				onProjectIdChange(replacementId);
				window.history.replaceState(
					null,
					"",
					`?project=${encodeURIComponent(replacementId)}`,
				);
			},
			onExitProject,
			onGoBack: () => {},
		},
		services: {},
		branding: {
			// The logo is a runtime asset the build copies out of the allowlist
			// (design E5); resolved against the renderer's own scheme origin, the
			// same resolver-over-a-base decision the desktop asset role lands in
			// Group 5, expressed here as a plain URL for the header chrome.
			logoUrl: new URL(
				"logos/opencut/svg/logo.svg",
				globalThis.location?.origin ?? "opencut://app/",
			).toString(),
		},
		links: {
			discordUrl: "https://discord.com/invite/Mu3acKZvCp",
			roadmapUrl: "https://opencut.app/roadmap",
		},
		// Final override: production sessions intentionally share one stable
		// in-memory store and one process-lifetime ID sequence, never the
		// per-call reference roles created by createInMemoryPorts().
		diagnostics: electronDiagnostics,
		ids: electronIds,
		store: electronInMemoryStore,
	};
}
