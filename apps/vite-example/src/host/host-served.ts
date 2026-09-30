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

/** Export options the host relays from the CLI; mirrors `ExportOptions`. */
export interface HostExportOptions {
	readonly format: "mp4" | "webm";
	readonly quality: "low" | "medium" | "high" | "very_high";
	readonly includeAudio?: boolean;
	readonly range?: {
		readonly startTime: number;
		readonly endTime: number;
	};
}

function isHostExportOptions(
	value: Record<string, unknown>,
): value is Record<string, unknown> & HostExportOptions {
	const { format, quality, includeAudio, range } = value;
	if (format !== "mp4" && format !== "webm") return false;
	if (
		quality !== "low" &&
		quality !== "medium" &&
		quality !== "high" &&
		quality !== "very_high"
	) {
		return false;
	}
	if (includeAudio !== undefined && typeof includeAudio !== "boolean") {
		return false;
	}
	return (
		range === undefined ||
		(isRecord(range) &&
			typeof range.startTime === "number" &&
			typeof range.endTime === "number")
	);
}

/**
 * A command the host directs at THIS pane. The host process has no canvas, no
 * WebGL and no WebCodecs, so it cannot rasterize a frame; this pane can, and
 * these frames are how the host borrows it.
 */
export type HostCommand =
	| {
			readonly command: "export.start";
			readonly jobId: string;
			readonly options: HostExportOptions;
	  }
	| { readonly command: "export.cancel"; readonly jobId: string };

function parseHostCommand(parsed: Record<string, unknown>): HostCommand | null {
	const { command, jobId } = parsed;
	if (typeof jobId !== "string" || jobId === "") return null;
	if (command === "export.cancel") return { command, jobId };
	if (
		command === "export.start" &&
		isRecord(parsed.options) &&
		isHostExportOptions(parsed.options)
	) {
		return {
			command,
			jobId,
			options: parsed.options,
		};
	}
	return null;
}

/**
 * Subscribe to the host's event stream — ONE EventSource carrying two frame
 * kinds, deliberately not two connections: the host counts attached panes by
 * counting these connections, and a second one would make this pane look like
 * two renderers.
 *
 * `{revision}` frames fire only on engine-side applies (agent mutations, draft
 * approvals) — an external editor save reopens the host engine WITHOUT
 * notifying, so every one means "the project changed outside this session",
 * never this session's own save. `{command}` frames are the host directing
 * this pane.
 */
export function subscribeHostEvents(handlers: {
	readonly onRevision?: (revision: number) => void;
	readonly onCommand?: (command: HostCommand) => void;
}): () => void {
	const source = new EventSource(
		new URL("api/events", location.href).toString(),
	);
	source.onmessage = (message) => {
		try {
			const parsed: unknown = JSON.parse(message.data);
			if (!isRecord(parsed)) return;
			if (typeof parsed.revision === "number") {
				handlers.onRevision?.(parsed.revision);
				return;
			}
			const command = parseHostCommand(parsed);
			if (command !== null) handlers.onCommand?.(command);
		} catch {
			// Malformed frames are dropped; EventSource keeps reconnecting.
		}
	};
	return () => source.close();
}

/**
 * Report render progress and read back whether the CLI asked to cancel. The
 * cancel flag rides the progress RESPONSE rather than a separate poll so the
 * exporter's `onCancel` costs no extra round trip.
 */
export async function reportExportProgress({
	jobId,
	progress,
}: {
	readonly jobId: string;
	readonly progress: number;
}): Promise<{ cancelRequested: boolean }> {
	const response = await fetch(
		new URL(
			`api/export/${encodeURIComponent(jobId)}/progress`,
			location.href,
		).toString(),
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ progress }),
		},
	);
	if (!response.ok) return { cancelRequested: false };
	const parsed: unknown = await response.json();
	return {
		cancelRequested: isRecord(parsed) && parsed.cancelRequested === true,
	};
}

/** Hand the encoded bytes back to the host, which writes the file. */
export async function uploadExportResult({
	jobId,
	bytes,
}: {
	readonly jobId: string;
	readonly bytes: ArrayBuffer;
}): Promise<void> {
	await fetch(
		new URL(
			`api/export/${encodeURIComponent(jobId)}/result`,
			location.href,
		).toString(),
		{
			method: "POST",
			headers: { "content-type": "application/octet-stream" },
			body: bytes,
		},
	);
}

/** Tell the host this render failed, so the job settles instead of going stale. */
export async function reportExportFailure({
	jobId,
	error,
}: {
	readonly jobId: string;
	readonly error: string;
}): Promise<void> {
	const url = new URL(
		`api/export/${encodeURIComponent(jobId)}/result`,
		location.href,
	);
	url.searchParams.set("error", error);
	await fetch(url.toString(), { method: "POST" });
}
