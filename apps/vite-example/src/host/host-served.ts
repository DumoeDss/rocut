import type { EditorHost } from "@opencut/editor-ports/host";
import { createBrowserRuntimePorts } from "@opencut/editor-classic/browser";
import {
	createInMemoryPorts,
	DeterministicIdGenerator,
	RecordingDiagnostics,
} from "@opencut/editor-ports/in-memory";
import { HttpProjectStore } from "./http-project-store";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Host-served mode (S06 follow-on: web-surface wiring).
 *
 * When the CLI host serves this surface, the page lives under the
 * authenticated `/<token>/` origin and its project is the host's — detected by
 * probing the same-origin `api/context` once at boot. The session then
 * persists through {@link HttpProjectStore} (the host's file SSOT) instead of
 * IndexedDB, and live-syncs agent commits through the revision event stream.
 */
export interface HostServedSurface {
	readonly projectId: string;
	readonly apiBase: string;
}

/**
 * Detect the host-served surface. Returns null in any other deployment
 * (vite dev, opencut.app, harness builds) — there `api/context` is not this
 * API and the probe fails fast.
 */
export async function detectHostServedSurface(
	fetchImpl: typeof fetch = fetch,
): Promise<HostServedSurface | null> {
	if (typeof location === "undefined") return null;
	try {
		const response = await fetchImpl(
			new URL("api/context", location.href).toString(),
		);
		if (!response.ok) return null;
		const payload: unknown = await response.json();
		if (!isRecord(payload) || !isRecord(payload.project)) return null;
		const projectId = payload.project.id;
		if (typeof projectId !== "string") return null;
		return { projectId, apiBase: "api" };
	} catch {
		return null;
	}
}

export interface HostServedHostOptions {
	readonly projectId: string;
	readonly base?: string;
}

export function createHostServedEditorHost({
	projectId,
	base,
}: HostServedHostOptions): EditorHost {
	const diagnostics = new RecordingDiagnostics();
	const ids = new DeterministicIdGenerator();
	const store = new HttpProjectStore({ base });
	const browser = createBrowserRuntimePorts({
		base: import.meta.env.BASE_URL ?? "/",
	});
	return {
		...createInMemoryPorts(),
		projectId,
		navigation: {
			// The pane hosts exactly the host's project; there is nowhere to
			// navigate to, so these are deliberate no-ops.
			onProjectReplaced: () => undefined,
			onExitProject: () => undefined,
			onGoBack: () => undefined,
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
		diagnostics,
		ids,
		store,
	};
}

/**
 * Subscribe to the host's revision event stream. Events fire only on
 * engine-side applies (agent mutations, draft approvals) — an external editor
 * save reopens the host engine WITHOUT notifying, so every event this
 * delivers is "the agent changed the project", never this session's own save.
 */
export function subscribeHostRevisions(
	onRevision: (revision: number) => void,
): () => void {
	const source = new EventSource(
		new URL("api/events", location.href).toString(),
	);
	source.onmessage = (message) => {
		try {
			const parsed: unknown = JSON.parse(message.data);
			if (
				isRecord(parsed) &&
				typeof parsed.revision === "number"
			) {
				onRevision(parsed.revision);
			}
		} catch {
			// Malformed frames are dropped; EventSource keeps reconnecting.
		}
	};
	return () => source.close();
}
