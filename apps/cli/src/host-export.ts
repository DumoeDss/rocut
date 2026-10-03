/**
 * Host-side export orchestration — the "borrow the pane's renderer" design.
 *
 * WHY THIS SHAPE. Rendering a timeline to pixels needs a GPU graphics stack:
 * `canvas-renderer` wants a 2D context, the compositor wants WebGL, and
 * `scene-exporter` wants WebCodecs' `AudioEncoder`. Node has none of them, so
 * this host — a plain Node HTTP server — cannot rasterize a single frame on
 * its own. The Electron host solves that by opening a HIDDEN BrowserWindow.
 * This host does not have to: the user is already looking at a pane that runs
 * the whole editor, renderer included. So instead of acquiring a second
 * browser, the host DIRECTS the one already attached, and the pane streams the
 * encoded bytes back.
 *
 * The consequence is honest and load-bearing rather than a defect to hide: with
 * no pane attached there is no renderer, and `start` refuses immediately
 * (`no-surface-attached`) instead of accepting a job that could never run.
 *
 * WRITE SURFACE. The host only ever writes INSIDE the project directory it
 * already owns (`<projectDir>/exports/<jobId>.<ext>`). A caller that wants the
 * file elsewhere copies it there itself — the CLI runs as the user and can do
 * that, so the HTTP surface never gains an arbitrary-path write.
 */
import { randomBytes } from "node:crypto";
import { createExportOutputWriter } from "./host-export-output";

/** Containers the editor's exporter supports (`editor-classic/src/export`). */
export const EXPORT_FORMATS = Object.freeze(["mp4", "webm"] as const);
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Quality presets the editor's exporter supports. */
export const EXPORT_QUALITIES = Object.freeze([
	"low",
	"medium",
	"high",
	"very_high",
] as const);
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

/**
 * A job is terminal in `completed` / `failed` / `cancelled`. `running` means a
 * pane acknowledged it by reporting progress; `pending` means the command was
 * broadcast but no pane has spoken yet.
 */
export type ExportJobStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface ExportOptions {
	readonly format: ExportFormat;
	readonly quality: ExportQuality;
	readonly includeAudio?: boolean;
	readonly range?: {
		readonly startTime: number;
		readonly endTime: number;
	};
}

export interface ExportJob {
	readonly id: string;
	readonly options: ExportOptions;
	readonly startedAt: number;
	status: ExportJobStatus;
	/** 0..1. Reported by the pane; never synthesized here. */
	progress: number;
	/** Absolute path, always inside the project directory. Set on completion. */
	outputPath?: string;
	error?: string;
	/** Set by `cancel`; the pane polls it through its `onCancel` callback. */
	cancelRequested: boolean;
	updatedAt: number;
}

/** One attached pane's server-sent-events sink. */
export interface SurfaceStream {
	write(chunk: string): void;
	flush?(): void;
}

export interface ExportRegistry {
	/** Register an attached pane; returns the detach function. */
	attachSurface(stream: SurfaceStream): () => void;
	/** How many panes are attached right now — 0 means "cannot render". */
	surfaceCount(): number;
	start(options: ExportOptions): ExportJob;
	get(id: string): ExportJob | undefined;
	list(): readonly ExportJob[];
	reportProgress(id: string, progress: number): ExportJob | undefined;
	complete(id: string, bytes: Uint8Array): Promise<ExportJob | undefined>;
	fail(id: string, error: string): ExportJob | undefined;
	cancel(id: string): ExportJob | undefined;
}

/** Thrown by `start` when no pane is attached — a refusal, not a failure. */
export class NoSurfaceAttachedError extends Error {
	readonly code = "no-surface-attached";
	constructor() {
		super(
			"no editor pane is attached to this host, so there is no renderer to " +
				"export with — open the project's editor URL and retry",
		);
		this.name = "NoSurfaceAttachedError";
	}
}

/** A job that has neither progressed nor settled within this window is dead. */
export const EXPORT_STALE_MS = 10 * 60 * 1000;

export function createExportRegistry(args: {
	readonly projectDir: string;
	readonly now?: () => number;
	readonly newId?: () => string;
	readonly noteActivity?: () => void;
}): ExportRegistry {
	const now = args.now ?? (() => Date.now());
	const newId = args.newId ?? (() => randomBytes(8).toString("hex"));
	const noteActivity = args.noteActivity ?? (() => {});
	const surfaces = new Set<SurfaceStream>();
	const jobs = new Map<string, ExportJob>();
	const writeOutput = createExportOutputWriter({
		projectDir: args.projectDir,
		now,
		noteActivity,
	});

	const send = (frame: unknown): void => {
		const chunk = `data: ${JSON.stringify(frame)}\n\n`;
		for (const surface of surfaces) {
			try {
				surface.write(chunk);
				surface.flush?.();
			} catch {
				// A dead stream is dropped on its own close callback; a write
				// that throws here must not abort the remaining fan-out.
			}
		}
	};

	/**
	 * Settle jobs that stopped reporting. Swept on read rather than on a timer:
	 * the host is event-driven by design (no timers of its own), and a stale
	 * job only matters at the moment someone asks about it.
	 */
	const sweep = (): void => {
		const cutoff = now() - EXPORT_STALE_MS;
		for (const job of jobs.values()) {
			if (job.status !== "pending" && job.status !== "running") continue;
			if (job.updatedAt > cutoff) continue;
			job.status = "failed";
			job.error =
				"the editor pane stopped reporting before the export finished " +
				"(closed, reloaded, or the render died)";
			job.updatedAt = now();
		}
	};

	const settle = (
		id: string,
		mutate: (job: ExportJob) => void,
	): ExportJob | undefined => {
		const job = jobs.get(id);
		if (job === undefined) return undefined;
		// Terminal is terminal: a second pane reporting the same job (two panes
		// on one project both obey the broadcast) must not reopen it.
		if (
			job.status === "completed" ||
			job.status === "failed" ||
			job.status === "cancelled"
		) {
			return job;
		}
		mutate(job);
		job.updatedAt = now();
		noteActivity();
		return job;
	};

	return {
		attachSurface(stream) {
			surfaces.add(stream);
			return () => {
				surfaces.delete(stream);
			};
		},
		surfaceCount() {
			return surfaces.size;
		},
		start(options) {
			if (surfaces.size === 0) throw new NoSurfaceAttachedError();
			const at = now();
			const job: ExportJob = {
				id: newId(),
				options,
				startedAt: at,
				status: "pending",
				progress: 0,
				cancelRequested: false,
				updatedAt: at,
			};
			jobs.set(job.id, job);
			send({ command: "export.start", jobId: job.id, options });
			noteActivity();
			return job;
		},
		get(id) {
			sweep();
			return jobs.get(id);
		},
		list() {
			sweep();
			return [...jobs.values()];
		},
		reportProgress(id, progress) {
			return settle(id, (job) => {
				job.status = "running";
				job.progress = Math.min(1, Math.max(0, progress));
			});
		},
		async complete(id, bytes) {
			const job = jobs.get(id);
			if (job === undefined) return undefined;
			if (
				job.status === "completed" ||
				job.status === "failed" ||
				job.status === "cancelled"
			) {
				return job;
			}
			return writeOutput(job, bytes);
		},
		fail(id, error) {
			return settle(id, (job) => {
				if (job.cancelRequested && error === "cancelled") {
					job.status = "cancelled";
				} else {
					job.status = "failed";
					job.error = error;
				}
			});
		},
		cancel(id) {
			const job = jobs.get(id);
			if (job === undefined) return undefined;
			if (
				job.status === "completed" ||
				job.status === "failed" ||
				job.status === "cancelled"
			) {
				return job;
			}
			job.cancelRequested = true;
			job.updatedAt = now();
			send({ command: "export.cancel", jobId: job.id });
			noteActivity();
			return job;
		},
	};
}

/** Parse + validate an `ExportOptions` off an untrusted request body. */
export function parseExportOptions(raw: unknown): ExportOptions | string {
	if (typeof raw !== "object" || raw === null) {
		return "export options must be an object";
	}
	const body = raw as Record<string, unknown>;
	const format = body.format ?? "mp4";
	if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
		return `format must be one of ${EXPORT_FORMATS.join(", ")}`;
	}
	const quality = body.quality ?? "high";
	if (!EXPORT_QUALITIES.includes(quality as ExportQuality)) {
		return `quality must be one of ${EXPORT_QUALITIES.join(", ")}`;
	}
	if (
		body.includeAudio !== undefined &&
		typeof body.includeAudio !== "boolean"
	) {
		return "includeAudio must be a boolean when present";
	}
	let range: ExportOptions["range"];
	if (body.range !== undefined) {
		if (typeof body.range !== "object" || body.range === null) {
			return "range must be an object when present";
		}
		const candidate = body.range as Record<string, unknown>;
		if (
			!Number.isSafeInteger(candidate.startTime) ||
			!Number.isSafeInteger(candidate.endTime) ||
			(candidate.startTime as number) < 0 ||
			(candidate.endTime as number) <= (candidate.startTime as number)
		) {
			return "range needs non-negative integer ticks with endTime after startTime";
		}
		range = {
			startTime: candidate.startTime as number,
			endTime: candidate.endTime as number,
		};
	}
	return {
		format: format as ExportFormat,
		quality: quality as ExportQuality,
		...(body.includeAudio === undefined
			? {}
			: { includeAudio: body.includeAudio as boolean }),
		...(range === undefined ? {} : { range }),
	};
}
