import type { EditorHost } from "@opencut/editor-ports/host";
import { createInMemoryPorts } from "@opencut/editor-ports/in-memory";
import { createBrowserRuntimePorts } from "@opencut/editor-classic/browser";

/**
 * This embed's host composition — the whole "platform decisions stay outside
 * the editor" contract in one function.
 *
 * Port set: the published in-memory roles widened with the browser runtime
 * ports (asset resolution, runtime asset loading, worker hosting). The store
 * stays in-memory, so state lives for the page's lifetime; an embed that wants
 * durable projects supplies its own `ProjectStore` in the final override slot
 * (the in-repo Vite host swaps in a browser `BrowserProjectStore` there).
 *
 * GPU-free boot: the rasterizer is forced to `"none"`, so the editor runs
 * degraded-but-interactive without any GPU — the configuration this example's
 * headless smoke asserts. A host with a real GPU simply omits the override.
 */
export function createExampleEditorHost({
	projectId,
}: {
	projectId: string;
}): EditorHost {
	const browser = createBrowserRuntimePorts({
		base: import.meta.env.BASE_URL ?? "/",
	});
	return {
		...createInMemoryPorts({
			graphics: { mode: "force", rasterizer: "none" },
		}),
		projectId,
		navigation: {
			onProjectReplaced: () => {},
			onExitProject: () => {},
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
