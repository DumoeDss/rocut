import type { EditorHost } from "@/editor/host/editor-host";
import {
	createBrowserRuntimePorts,
	type BrowserWorkerUrlRewriter,
} from "@/editor/host/browser-runtime";
import { createInMemoryPorts } from "@/editor/ports/in-memory";

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
	};
}
