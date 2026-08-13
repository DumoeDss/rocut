import type { EditorHost } from "@/editor/host/editor-host";
import {
	createBrowserRuntimePorts,
	resolveHostPath,
} from "@/editor/host/browser-runtime";
import {
	createInMemoryPorts,
	DeterministicIdGenerator,
	RecordingDiagnostics,
} from "@/editor/ports/in-memory";
import { BrowserProjectStore } from "@/services/storage/browser-project-store";
import {
	DEFAULT_BROWSER_STORAGE_IDENTITY,
	browserStoreDiagnosticLogRecord,
} from "@/services/storage/browser-project-store-internals";
import { SOCIAL_LINKS } from "@/site/social";

const OPENCUT_SITE_URL = "https://opencut.app";

export const NEXT_PUBLIC_ASSET_BASE =
	process.env.NEXT_PUBLIC_OPENCUT_BASE || "/";

const nextDiagnostics = new RecordingDiagnostics();
const nextIds = new DeterministicIdGenerator();
const nextBrowserProjectStore = new BrowserProjectStore({
	storageIdentity: DEFAULT_BROWSER_STORAGE_IDENTITY,
	diagnostic: (diagnostic) =>
		nextDiagnostics.log({
			record: browserStoreDiagnosticLogRecord(diagnostic),
		}),
});

export function createNextEditorHost({
	projectId,
	onProjectReplaced,
	onExitProject,
	onGoBack,
	base = NEXT_PUBLIC_ASSET_BASE,
	forceRendererBackend,
	workerFixture = false,
}: {
	projectId: string;
	onProjectReplaced: (projectId: string) => void;
	onExitProject: () => void;
	onGoBack: () => void;
	base?: string;
	forceRendererBackend?: "none";
	workerFixture?: boolean;
}): EditorHost {
	void nextBrowserProjectStore.prepareForSession().catch(() => {
		nextDiagnostics.log({
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
		rewriteWorkerUrl: workerFixture
			? () =>
					new URL(
						resolveHostPath(base, "workers/c4-worker-fixture.js"),
						globalThis.location?.href ?? "http://opencut.invalid/",
					)
			: undefined,
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
			onProjectReplaced: ({ projectId: replacementId }) =>
				onProjectReplaced(replacementId),
			onExitProject,
			onGoBack,
		},
		services: {
			soundSearchEndpoint: resolveHostPath(base, "api/sounds/search"),
			feedbackEndpoint: resolveHostPath(base, "api/feedback"),
		},
		branding: {
			logoUrl: browser.assets.resolve({
				ref: { path: "logos/opencut/svg/logo.svg" },
			}),
		},
		links: {
			discordUrl: SOCIAL_LINKS.discord,
			roadmapUrl: `${OPENCUT_SITE_URL}/roadmap`,
		},
		// Unrelated in-memory roles remain for C5/C6. These final overrides make
		// the three C4 production roles impossible to inherit by spread order.
		...browser,
		diagnostics: nextDiagnostics,
		ids: nextIds,
		store: nextBrowserProjectStore,
	};
}
