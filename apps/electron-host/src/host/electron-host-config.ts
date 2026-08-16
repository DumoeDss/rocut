import type { EditorHost } from "@opencut/editor-ports/host";
import {
	BrowserAssetResolver,
	BrowserRuntimeAssetLoader,
} from "@opencut/editor-classic/browser";
import {
	createInMemoryPorts,
	DeterministicIdGenerator,
	RecordingDiagnostics,
} from "@opencut/editor-ports/in-memory";
import type { LogRecord, WorkerRequest } from "@opencut/editor-ports";
import {
	DEFAULT_FILESYSTEM_STORE_IDENTITY,
	FilesystemProjectStore,
} from "../store/filesystem-project-store";
import { IpcStoreBridge } from "../store/ipc-store-bridge";
import { ElectronRuntimeResources } from "./electron-runtime-resources";

/**
 * Process-lifetime host instances, the `vite-host-config.ts` pattern: the host
 * object is recreated whenever the project id changes, and the store/ID
 * sequence/diagnostics must survive that recreation or the editor branch would
 * mount against an empty store that never saw the project the picker created.
 * The store is the filesystem store over the production `IpcStoreBridge` —
 * one bridge, one durable store, for every session in this process.
 */
/**
 * Records as the reference implementation does, and mirrors to the console.
 *
 * A silent recorder is the right default for a headless conformance run, where
 * the assertions read `logs`. In a desktop shell it means a failed user action
 * produces no signal anywhere -- not a toast, not a console line -- so this Host
 * opts into surfacing what it records.
 */
class ConsoleMirroringDiagnostics extends RecordingDiagnostics {
	log({ record }: { record: LogRecord }): void {
		super.log({ record });
		const line = `[diagnostics] ${record.message}`;
		const context = record.context ?? {};
		if (record.level === "error") {
			console.error(line, context);
		} else if (record.level === "warn") {
			console.warn(line, context);
		} else {
			console.info(line, context);
		}
	}
}

const electronDiagnostics = new ConsoleMirroringDiagnostics();
const electronIds = new DeterministicIdGenerator();
const electronFilesystemStore = new FilesystemProjectStore(
	new IpcStoreBridge(),
	{ identity: DEFAULT_FILESYSTEM_STORE_IDENTITY },
);

/**
 * The Electron composition root (design E3) — the desktop-shaped roles owned,
 * the reference roles visible. Each final override below names its decision;
 * the roles deliberately NOT overridden (`environment`, `exporter`, and the
 * `createInMemoryPorts()` defaults underneath) are the in-memory reference
 * implementations, kept visible rather than re-derived.
 */
export function createElectronEditorHost({
	projectId,
	onProjectIdChange,
	onExitProject,
	workerUrlRewriter,
	forceRendererBackend,
}: {
	projectId: string;
	onProjectIdChange: (projectId: string) => void;
	onExitProject: () => void;
	/** Evidence-harness plumbing; the default is the E6 scheme rewrite. */
	workerUrlRewriter?: (args: { request: WorkerRequest }) => URL;
	/** Evidence entries force no renderer backend (the vite host's pattern). */
	forceRendererBackend?: "none";
}): EditorHost {
	// Design E3, assets/assetLoader: reuse the browser resolver/loader over
	// THIS host's base. The base is the renderer's own scheme origin — the
	// Group 3 single-origin decision: the build's allowlist copy lives in the
	// same `opencut://app` tree the protocol handler serves, so a second
	// `opencut://assets` host would be ceremony, not isolation (deviation from
	// design E2's two-host sketch, recorded in the Group 5 evidence).
	const assets = new BrowserAssetResolver("/");
	const runtimeResources = new ElectronRuntimeResources(workerUrlRewriter);
	return {
		...createInMemoryPorts({
			graphics:
				forceRendererBackend === "none"
					? { mode: "force", rasterizer: "none" }
					: undefined,
		}),
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
			// Through the asset role, not a hand-built URL: same resolver, same
			// base, every other consumer uses.
			logoUrl: assets.resolve({ ref: { path: "logos/opencut/svg/logo.svg" } }),
		},
		links: {
			discordUrl: "https://discord.com/invite/Mu3acKZvCp",
			roadmapUrl: "https://opencut.app/roadmap",
		},
		// Design E3, owned roles — each a final override:
		assets,
		assetLoader: new BrowserRuntimeAssetLoader(
			assets,
			globalThis.fetch.bind(globalThis),
		),
		runtimeResources,
		// Reference roles, process-lifetime by decision (never the per-call
		// instances createInMemoryPorts() would provide):
		diagnostics: electronDiagnostics,
		ids: electronIds,
		// The desktop substitution this Host exists to prove: durable projects
		// on disk through the preload bridge, not IndexedDB, not in-memory.
		store: electronFilesystemStore,
	};
}
