import type { EditorHost } from "@opencut/editor-ports/host";
import {
	createBrowserRuntimePorts,
	type BrowserWorkerUrlRewriter,
} from "@opencut/editor-classic/browser";
import {
	createInMemoryPorts,
	DeterministicIdGenerator,
	RecordingDiagnostics,
} from "@opencut/editor-ports/in-memory";
import { BrowserProjectStore } from "@opencut/editor-classic/storage";
import {
	DEFAULT_BROWSER_STORAGE_IDENTITY,
	browserStoreDiagnosticLogRecord,
} from "@opencut/editor-classic/storage";

const viteDiagnostics = new RecordingDiagnostics();
const viteIds = new DeterministicIdGenerator();
const viteBrowserProjectStore = new BrowserProjectStore({
	storageIdentity: DEFAULT_BROWSER_STORAGE_IDENTITY,
	diagnostic: (diagnostic) =>
		viteDiagnostics.log({
			record: browserStoreDiagnosticLogRecord(diagnostic),
		}),
});

export function createViteEditorHost({
	projectId,
	onProjectIdChange,
	onExitProject,
	base = import.meta.env.BASE_URL ?? "/",
	rewriteWorkerUrl,
	transcriptionWorkerUrl,
	forceRendererBackend,
}: {
	projectId: string;
	onProjectIdChange: (projectId: string) => void;
	onExitProject: () => void;
	base?: string;
	rewriteWorkerUrl?: BrowserWorkerUrlRewriter;
	transcriptionWorkerUrl?: string;
	forceRendererBackend?: "none";
}): EditorHost {
	void viteBrowserProjectStore.prepareForSession().catch(() => {
		viteDiagnostics.log({
			record: browserStoreDiagnosticLogRecord({
				level: "warning",
				phase: "storage-initialization",
				operation: "inspect",
				scope: { kind: "store" },
				code: "unavailable",
				retryable: true,
			}),
		});
	});
	const browser = createBrowserRuntimePorts({
		base,
		rewriteWorkerUrl:
			rewriteWorkerUrl ??
			(transcriptionWorkerUrl
				? ({ request }) =>
						request.id === "transcription"
							? new URL(
									transcriptionWorkerUrl!,
									globalThis.location?.href ?? "http://opencut.invalid/",
								)
							: request.url
				: undefined),
	});
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
			logoUrl: browser.assets.resolve({
				ref: { path: "logos/opencut/svg/logo.svg" },
			}),
		},
		links: {
			discordUrl: "https://discord.com/invite/Mu3acKZvCp",
			roadmapUrl: "https://opencut.app/roadmap",
		},
		...browser,
		// Final override: production sessions intentionally share durable state,
		// and one process-lifetime ID sequence, never the per-call reference roles
		// created by createInMemoryPorts().
		diagnostics: viteDiagnostics,
		ids: viteIds,
		store: viteBrowserProjectStore,
	};
}
