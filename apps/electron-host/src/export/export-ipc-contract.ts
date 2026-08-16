/**
 * sdk-export-capability — the export bridge's shared contract (design D3/D4).
 *
 * This file is the SEAM between the three parties of the desktop export path:
 * the preload (`electron/preload.cjs` exposes `window.opencutExport` over these
 * exact channel names), the main process (`main-export-ipc.ts` installs the
 * handlers), and the two renderer consumers (the interactive window's job
 * panel and the hidden `export-renderer` window's producer loop). It imports
 * no Electron — only types and the event vocabulary from the experimental
 * ports entry — so both `bun build` (main bundle) and the renderer (vite) can
 * consume it.
 *
 * Channel discipline (the renderer-holds-no-paths guarantee, same as the store
 * bridge): every argument and return value on these channels is an identifier
 * or a structured-clone value. A completed job's output is named by an opaque
 * descriptor (`"file:<relative-output-name>"`) — never an absolute path;
 * "reveal in folder" would be a main-side shell action, not a renderer one.
 * IPC traffic is not `connect-src`, so the committed CSP gains nothing here
 * (D4); the surface test asserts the CSP stays byte-identical.
 *
 * Operations (each name is mirrored verbatim in `electron/preload.cjs`; the
 * drift test `__tests__/export-bridge-surface.test.ts` fails if the lists
 * diverge):
 *
 * - `startJob`      (invoke) the interactive window asks for a job. Takes the
 *                   provider-shaped `ExportJobRequest` plus optional project
 *                   meta main records for the output name and the
 *                   stale-timeline guard. The job opens `queued` (no render
 *                   spec yet — only the producer window can know the
 *                   project's canvas/fps/duration). Main then opens the
 *                   hidden export-renderer window for it.
 * - `beginExport`   (invoke) the export window attaches: it declares the
 *                   render spec it computed from the loaded project. With a
 *                   `jobId` the call attaches to that job — resuming an
 *                   `interrupted` job at its persisted frame index, or
 *                   beginning rendering for a `queued` one; without a
 *                   `jobId` it starts a fresh job in one step. Returns the
 *                   authoritative spec plus `nextNeededFrame`.
 * - `frame`         (send)   high-volume frame batches, `ipcMain.on` not
 *                   invoke. Main acknowledges via the `frameAck` event —
 *                   the acknowledged flow-control the spec demands (the
 *                   producer keeps at most one batch in flight).
 * - `audio`         (invoke) the job's extracted timeline WAV, sent once,
 *                   before `finalize`.
 * - `finalize`      (invoke) every frame accepted; main runs the one FFmpeg
 *                   encode. Settles asynchronously via the `jobEvent`
 *                   channel.
 * - `failJob`       (invoke) the producer's failure channel: a project that
 *                   will not load, a render that throws, a degraded
 *                   rasterizer. Without it a dead producer could only leave
 *                   the job `rendering` until the next boot's interrupt scan.
 * - `listJobs` / `getJob` / `cancelJob` / `resumeJob` / `discardJob` /
 *   `readJobOutputBytes`  (invoke) the provider-shaped job-control surface
 *                   the interactive panel addresses by identity only.
 *                   `resumeJob` re-opens the export window for the job.
 * - `canExport`     (invoke) the capability probe: whether main discovered an
 *                   FFmpeg binary at boot. Added by Group C (the 14th op)
 *                   because the spec's "No binary means unsupported" scenario
 *                   demands a renderer-askable truthful answer BEFORE any job
 *                   exists — a `startJob` that settles `failed` with the
 *                   `ffmpeg-missing` reason is truthful per-job but cannot
 *                   back a synchronous `canExport` that decides whether the
 *                   option is offered at all.
 * - `jobDone`       (invoke) the export window's own "my lifecycle is
 *                   complete" signal; main destroys the window (main also
 *                   destroys on the settled event — this is the window's
 *                   belt-and-braces second channel, and the only one it can
 *                   fire deliberately).
 *
 * Main→renderer events (names exported below, payloads typed):
 *
 * - `jobEvent`    `{ jobId, event }` — the ports event vocabulary verbatim
 *                 (`phase` / `progress` / `settled`), forwarded to every
 *                 window on every store transition.
 * - `frameAck`    `{ jobId, acceptedFrames, moreWanted }` — the frame
 *                 backpressure acknowledgement.
 * - `jobsChanged` `null` — a job was added or removed; a list consumer
 *                 re-polls `listJobs`.
 */
import type {
	ExportJobEvent,
	ExportJobRequest,
	ExportJobSnapshot,
} from "@opencut/editor-ports/export-jobs";

/** Every operation name below is mirrored verbatim in `electron/preload.cjs`. */
export const EXPORT_IPC_OPERATIONS = [
	"startJob",
	"beginExport",
	"frame",
	"audio",
	"finalize",
	"failJob",
	"listJobs",
	"getJob",
	"cancelJob",
	"resumeJob",
	"discardJob",
	"readJobOutputBytes",
	"jobDone",
	"canExport",
] as const;

export type ExportIpcOperation = (typeof EXPORT_IPC_OPERATIONS)[number];

export const EXPORT_IPC_CHANNEL_PREFIX = "opencut-export:";

/** Main→renderer event channels (built from the same prefix, distinct names). */
export const EXPORT_JOB_EVENT_CHANNEL = `${EXPORT_IPC_CHANNEL_PREFIX}jobEvent`;
export const EXPORT_FRAME_ACK_CHANNEL = `${EXPORT_IPC_CHANNEL_PREFIX}frameAck`;
export const EXPORT_JOBS_CHANGED_CHANNEL = `${EXPORT_IPC_CHANNEL_PREFIX}jobsChanged`;

/**
 * The render spec only the producer window can compute (it loaded the
 * project). Persisted with the job record so ANY fresh renderer can resume —
 * recovery is a file fact, not a process fact (design D3).
 */
export interface ExportRenderSpec {
	readonly width: number;
	readonly height: number;
	readonly fps: { readonly numerator: number; readonly denominator: number };
	readonly totalFrames: number;
}

/** `startJob` arguments: the provider-shaped request plus bookkeeping meta. */
export interface StartJobWireArgs {
	readonly request: ExportJobRequest;
	readonly projectName?: string;
	readonly projectContentDigest?: string;
}

/**
 * `beginExport` arguments. `jobId` attaches to an existing job (resume or
 * queued-attach); its absence starts a fresh job, which then REQUIRES
 * `renderSpec`. `projectContentDigest` is the stale-timeline guard: it must
 * match the value recorded at `startJob`, or the job fails with a named
 * reason rather than render a stale timeline (design D3's two-window
 * contention row). It digests the project record's CONTENT (`data`), not its
 * metadata: a thumbnail save bumps `summary.updatedAt` without touching
 * `data`, and reopening a project to reach the Resume button must not
 * invalidate an interrupted job (the D2 recovery finding).
 */
export interface BeginExportWireArgs {
	readonly jobId?: string;
	readonly request: ExportJobRequest;
	readonly renderSpec?: ExportRenderSpec;
	readonly projectName?: string;
	readonly projectContentDigest?: string;
}

/** The authoritative render assignment a producer resumes/starts from. */
export interface BeginExportWireResult extends ExportRenderSpec {
	readonly jobId: string;
	readonly request: ExportJobRequest;
	readonly nextNeededFrame: number;
}

/** The `frame` channel payload (ipcRenderer.send, structured clone). */
export interface FrameBatchMessage {
	readonly jobId: string;
	readonly startIndex: number;
	/** Concatenated RGB24 frames (`width * height * 3` bytes each). */
	readonly buffer: Uint8Array;
}

/** The `frameAck` event payload — the backpressure acknowledgement. */
export interface FrameAckMessage {
	readonly jobId: string;
	readonly acceptedFrames: number;
	readonly moreWanted: boolean;
}

/** The `jobEvent` event payload — the ports event vocabulary verbatim. */
export interface JobEventMessage {
	readonly jobId: string;
	readonly event: ExportJobEvent;
}

/** The `audio` channel payload: the timeline's extracted WAV, sent once. */
export interface AudioWireArgs {
	readonly jobId: string;
	readonly wav: ArrayBuffer;
}

/**
 * A snapshot as it crosses IPC: `ExportJobSnapshot` is already plain
 * structured-clone data (strings, numbers, frozen plain objects), so the wire
 * type is the port type by alias — spelled out so the seam names its own
 * vocabulary instead of borrowing one that may churn (the entry is
 * experimental).
 */
export type ExportJobWireSnapshot = ExportJobSnapshot;

/** The resume assignment `resumeJob` hands a fresh producer window. */
export type ResumeWireResult = BeginExportWireResult;

/**
 * The `canExport` probe result. `ffmpegAvailable` is main's boot-time
 * discovery verdict (design D3: env → configured root → `PATH`, never
 * bundling) — the one fact the renderer cannot compute for itself and the one
 * the frozen `ExportProvider.canExport` must answer truthfully before any job
 * exists. No path crosses: the discovered location stays in main.
 */
export interface CanExportWireResult {
	readonly ffmpegAvailable: boolean;
}

/**
 * The content digest backing the stale-timeline guard — ONE recipe, consumed
 * on both sides of the bridge: `electron/main.cjs` via the bundled
 * `dist-main/main-export-ipc.cjs`, the producer window via this module. Both
 * environments have Web Crypto (`globalThis.crypto.subtle` — Node ≥ 20 and
 * Chromium). Date instances are normalized to ISO strings; anything
 * JSON-opaque (Maps, Sets) contributes only its tag — the project payload is
 * JSON-shaped by `encodeProject`, so the limitation is recorded rather than
 * worked around.
 */
export async function projectContentDigest(data: unknown): Promise<string> {
	const normalized = JSON.stringify(data, (_key, value: unknown) => {
		if (value instanceof Date) {
			return { __isoDate__: value.toISOString() };
		}
		return value;
	});
	const bytes = new TextEncoder().encode(normalized);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * The stale-timeline guard's digest: NOT the whole record. The record's
 * `data` embeds volatile bookkeeping (`metadata.thumbnail` — the post-open
 * save writes the rendered thumbnail INTO the payload — and
 * `metadata.updatedAt`), so a whole-data digest still trips on a reopen.
 * The guard's actual question is "did the RENDER INPUT change", so this
 * digests exactly the render-input projection: `scenes`, `currentSceneId`,
 * `settings` (fps/canvas/background), `version`. A timeline edit moves it; a
 * thumbnail save does not. Same consumption discipline as
 * `projectContentDigest` (main.cjs via the bundle, producer via the module).
 */
export async function projectTimelineDigest(
	recordData: unknown,
): Promise<string> {
	const data = (recordData ?? {}) as {
		scenes?: unknown;
		currentSceneId?: unknown;
		settings?: unknown;
		version?: unknown;
	};
	return projectContentDigest({
		scenes: data.scenes ?? null,
		currentSceneId: data.currentSceneId ?? null,
		settings: data.settings ?? null,
		version: data.version ?? null,
	});
}
