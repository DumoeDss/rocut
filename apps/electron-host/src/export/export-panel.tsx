import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	ExportJobFormat,
	ExportJobPhase,
	ExportJobQuality,
	ExportJobRequest,
	ExportJobSnapshot,
} from "@opencut/editor-ports/export-jobs";
import {
	isBridgeUnavailable,
	RendererExportBridge,
} from "./renderer-export-bridge";

/**
 * The host-owned export job panel (design D3, spec "Job control is
 * host-owned"): host chrome, not editor surface — a compact bottom-right
 * overlay beside the editor, never inside `SessionEditorSurface`.
 *
 * It speaks the JOB surface directly (not the frozen exporter): the job-shaped
 * UX the frozen promise cannot express — live progress by phase, cancel,
 * interrupted-job discovery and resume after a restart — addresses jobs by
 * identity only and renders no filesystem path anywhere (a completed output is
 * its opaque `file:<relative-name>` descriptor and its byte size; "reveal in
 * folder" would be a main-side shell action, not a renderer one).
 *
 * Event-driven throughout (the C6 boundary): progress arrives by the
 * `jobEvent` push, list membership by `jobsChanged` — the panel owns no timer
 * of any kind.
 */

/** The live phases a running view can show, with human names. */
const PHASE_LABELS: Readonly<Record<string, string>> = {
	queued: "Starting…",
	rendering: "Rendering frames…",
	encoding: "Encoding…",
};

type PanelView =
	| { kind: "probing" }
	| { kind: "hidden" }
	| { kind: "unsupported"; reason: string }
	| { kind: "idle" }
	| {
			kind: "running";
			phase: ExportJobPhase;
			progress: number;
			frames: Readonly<{ accepted: number; total: number }> | null;
	  }
	| { kind: "done"; name: string; bytes: number }
	| { kind: "failed"; reason: string; canRetry: boolean };

function formatBytes(bytes: number): string {
	if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${String(bytes)} B`;
}

/** Select an option without asserting a string into a union type. */
function pickOption<T extends string>(args: {
	value: string;
	options: readonly T[];
	fallback: T;
}): T {
	return args.options.find((option) => option === args.value) ?? args.fallback;
}

const FORMAT_OPTIONS: readonly ExportJobFormat[] = ["mp4", "webm"];
const QUALITY_OPTIONS: readonly ExportJobQuality[] = [
	"low",
	"medium",
	"high",
	"very_high",
];

/** The relative output name only — the `file:` prefix is provider protocol. */
function outputName(descriptor: string): string {
	return descriptor.replace(/^file:/, "");
}

export function ExportPanel({ projectId }: { projectId: string }) {
	const bridge = useMemo(() => new RendererExportBridge(), []);
	const [view, setView] = useState<PanelView>({ kind: "probing" });
	const [interrupted, setInterrupted] = useState<readonly ExportJobSnapshot[]>(
		[],
	);
	const [dismissed, setDismissed] = useState(false);
	const [format, setFormat] = useState<ExportJobFormat>("mp4");
	const [quality, setQuality] = useState<ExportJobQuality>("high");
	const [includeAudio, setIncludeAudio] = useState(true);
	const lastRequest = useRef<ExportJobRequest | null>(null);
	const activeJobId = useRef<string | null>(null);

	const refreshJobs = useCallback(async () => {
		try {
			const jobs = await bridge.listJobs();
			setInterrupted(
				jobs.filter((job) => job.phase === "interrupted"),
			);
		} catch {
			// Degrade to the last known list; the next push event re-triggers.
		}
	}, [bridge]);

	/** Adopt a settled snapshot: the one place terminal states are decided. */
	const applySettled = useCallback((snapshot: ExportJobSnapshot) => {
		activeJobId.current = null;
		switch (snapshot.phase) {
			case "completed":
				setView(
					snapshot.output !== null
						? {
								kind: "done",
								name: outputName(snapshot.output.descriptor),
								bytes: snapshot.output.bytes,
							}
						: {
								kind: "failed",
								reason: "completed without an output record",
								canRetry: false,
							},
				);
				break;
			case "cancelled":
				setView({ kind: "failed", reason: "cancelled", canRetry: true });
				break;
			default:
				setView({
					kind: "failed",
					reason: snapshot.error ?? "export failed",
					canRetry: true,
				});
		}
	}, []);

	useEffect(() => {
		let alive = true;
		const events = bridge.onAnyJobEvent({
			handler: ({ jobId, event }) => {
				if (!alive) return;
				if (jobId !== activeJobId.current) {
					// Another window's job (or one we already settled): only a
					// fresh interruption changes what this panel lists.
					if (event.type === "phase" && event.phase === "interrupted") {
						void refreshJobs();
					}
					return;
				}
				if (event.type === "progress") {
					setView((current) =>
						current.kind === "running"
							? {
									...current,
									progress: event.progress,
									frames: event.frames ?? current.frames,
								}
							: current,
					);
					return;
				}
				if (event.type === "phase") {
					if (event.phase === "interrupted") {
						// The producer died mid-run: back to the idle form, and
						// the job joins the resumable list.
						activeJobId.current = null;
						setView({ kind: "idle" });
						void refreshJobs();
						return;
					}
					setView((current) =>
						current.kind === "running"
							? { ...current, phase: event.phase }
							: current,
					);
					return;
				}
				void bridge
					.getJob({ jobId })
					.then((snapshot) => {
						if (alive && snapshot !== null) applySettled(snapshot);
					})
					.catch(() => {});
			},
		});
		const listChanges = bridge.onJobsChanged({
			handler: () => {
				void refreshJobs();
			},
		});
		void bridge
			.canExport()
			.then((capability) => {
				if (!alive) return;
				if (isBridgeUnavailable(capability)) {
					setView({ kind: "hidden" });
					return;
				}
				setView(
					capability.canExport
						? { kind: "idle" }
						: { kind: "unsupported", reason: capability.reason ?? "" },
				);
			})
			.catch(() => {
				if (alive) setView({ kind: "hidden" });
			});
		void refreshJobs();
		return () => {
			alive = false;
			events.unsubscribe();
			listChanges.unsubscribe();
		};
	}, [bridge, refreshJobs, applySettled]);

	const startWith = useCallback(
		async ({ request }: { request: ExportJobRequest }) => {
			try {
				const { jobId } = await bridge.startJob({ request });
				lastRequest.current = request;
				activeJobId.current = jobId;
				setView({
					kind: "running",
					phase: "queued",
					progress: 0,
					frames: null,
				});
				// The queued/rendering events can beat startJob's reply across
				// IPC; one fetch reconciles anything that already happened —
				// including an immediate settle.
				const snapshot = await bridge.getJob({ jobId });
				if (
					snapshot !== null &&
					(snapshot.phase === "completed" ||
						snapshot.phase === "failed" ||
						snapshot.phase === "cancelled")
				) {
					applySettled(snapshot);
				} else if (snapshot !== null && activeJobId.current === jobId) {
					setView({
						kind: "running",
						phase: snapshot.phase,
						progress: snapshot.progress,
						frames: snapshot.frames,
					});
				}
			} catch (error) {
				setView({
					kind: "failed",
					reason: error instanceof Error ? error.message : String(error),
					canRetry: true,
				});
			}
		},
		[bridge, applySettled],
	);

	const handleStart = useCallback(() => {
		void startWith({
			request: { projectId, format, quality, includeAudio },
		});
	}, [startWith, projectId, format, quality, includeAudio]);

	const handleRetry = useCallback(() => {
		const request = lastRequest.current;
		if (request !== null) void startWith({ request });
	}, [startWith]);

	const handleCancel = useCallback(async () => {
		const jobId = activeJobId.current;
		if (jobId === null) return;
		try {
			await bridge.cancelJob({ jobId });
			// The settled event decides the view; nothing to do on success.
		} catch {
			// A cancel that cannot cross shows up as the job's own outcome.
		}
	}, [bridge]);

	const handleResume = useCallback(
		async ({ jobId }: { jobId: string }) => {
			try {
				await bridge.resumeJob({ jobId });
				activeJobId.current = jobId;
				const snapshot = await bridge.getJob({ jobId });
				if (snapshot !== null && snapshot.phase !== "interrupted") {
					setView({
						kind: "running",
						phase: snapshot.phase,
						progress: snapshot.progress,
						frames: snapshot.frames,
					});
				}
				void refreshJobs();
			} catch (error) {
				setView({
					kind: "failed",
					reason: error instanceof Error ? error.message : String(error),
					canRetry: false,
				});
			}
		},
		[bridge, refreshJobs],
	);

	const handleDiscard = useCallback(
		async ({ jobId }: { jobId: string }) => {
			try {
				await bridge.discardJob({ jobId });
			} catch {
				// A discard that cannot cross stays visible; retry by clicking again.
			}
			await refreshJobs();
		},
		[bridge, refreshJobs],
	);

	if (view.kind === "hidden") return null;
	if (dismissed) {
		return (
			<button
				type="button"
				data-testid="export-panel-toggle"
				onClick={() => setDismissed(false)}
				className="bg-primary text-primary-foreground fixed right-4 bottom-4 z-50 rounded-md px-3 py-1.5 text-sm shadow-lg"
			>
				Export
			</button>
		);
	}

	const percent = view.kind === "running" ? Math.round(view.progress * 100) : 0;

	return (
		<aside
			data-testid="export-panel"
			className="bg-background border-border text-foreground fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-3 rounded-md border p-3 shadow-lg"
		>
			<header className="flex items-center justify-between">
				<h2 className="text-sm font-semibold">Export</h2>
				<button
					type="button"
					aria-label="Collapse export panel"
					onClick={() => setDismissed(true)}
					className="text-muted-foreground hover:text-foreground rounded px-1 text-sm"
				>
					×
				</button>
			</header>

			{view.kind === "probing" ? (
				<p data-testid="export-status" className="text-muted-foreground text-xs">
					Checking export availability…
				</p>
			) : null}

			{view.kind === "unsupported" ? (
				<p data-testid="export-status" className="text-muted-foreground text-xs">
					Export unavailable: no FFmpeg binary was found ({view.reason}). Set
					OPENCUT_FFMPEG_PATH, place ffmpeg(.exe) under the app&apos;s bin/, or
					install it on PATH.
				</p>
			) : null}

			{view.kind === "idle" ? (
				<div className="flex flex-col gap-2">
					<label className="flex flex-col gap-1 text-xs">
						<span className="text-muted-foreground">Format</span>
						<select
							value={format}
							onChange={(event) =>
								setFormat(
									pickOption({
										value: event.target.value,
										options: FORMAT_OPTIONS,
										fallback: format,
									}),
								)
							}
							data-testid="export-format"
							className="border-border bg-background rounded-md border px-2 py-1 text-sm"
						>
							<option value="mp4">MP4 (H.264) — better compatibility</option>
							<option value="webm">WebM (VP9) — smaller file size</option>
						</select>
					</label>
					<label className="flex flex-col gap-1 text-xs">
						<span className="text-muted-foreground">Quality</span>
						<select
							value={quality}
							onChange={(event) =>
								setQuality(
									pickOption({
										value: event.target.value,
										options: QUALITY_OPTIONS,
										fallback: quality,
									}),
								)
							}
							data-testid="export-quality"
							className="border-border bg-background rounded-md border px-2 py-1 text-sm"
						>
							<option value="low">Low — smallest file size</option>
							<option value="medium">Medium — balanced</option>
							<option value="high">High — recommended</option>
							<option value="very_high">Very high — largest file size</option>
						</select>
					</label>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={includeAudio}
							onChange={(event) => setIncludeAudio(event.target.checked)}
							data-testid="export-audio"
						/>
						<span>Include audio in export</span>
					</label>
					<button
						type="button"
						onClick={handleStart}
						data-testid="export-start"
						className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
					>
						Export
					</button>
				</div>
			) : null}

			{view.kind === "running" ? (
				<div className="flex flex-col gap-2">
					<p data-testid="export-status" className="text-muted-foreground text-xs">
						{PHASE_LABELS[view.phase] ?? "Working…"}
					</p>
					<div
						data-testid="export-progress"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percent}
						className="bg-accent h-1.5 w-full overflow-hidden rounded-full"
					>
						<div className="bg-primary h-full rounded-full" style={{ width: `${String(percent)}%` }} />
					</div>
					<p className="text-muted-foreground text-xs">
						{String(percent)}%
						{view.frames !== null
							? ` — ${String(view.frames.accepted)}/${String(view.frames.total)} frames`
							: ""}
					</p>
					<button
						type="button"
						onClick={() => void handleCancel()}
						data-testid="export-cancel"
						className="border-border hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-sm"
					>
						Cancel
					</button>
				</div>
			) : null}

			{view.kind === "done" ? (
				<div className="flex flex-col gap-2">
					<p data-testid="export-status" className="text-muted-foreground text-xs">
						Export complete.
					</p>
					<p className="text-sm font-medium" data-testid="export-output">
						{view.name}
					</p>
					<p className="text-muted-foreground text-xs">{formatBytes(view.bytes)}</p>
					<button
						type="button"
						onClick={() => setView({ kind: "idle" })}
						className="border-border hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-sm"
					>
						Done
					</button>
				</div>
			) : null}

			{view.kind === "failed" ? (
				<div className="flex flex-col gap-2">
					<p data-testid="export-status" className="text-sm font-medium">
						{view.reason === "cancelled" ? "Export cancelled" : "Export failed"}
					</p>
					<p className="text-muted-foreground text-xs">{view.reason}</p>
					<div className="flex gap-2">
						{view.canRetry ? (
							<button
								type="button"
								onClick={handleRetry}
								data-testid="export-retry"
								className="border-border hover:bg-accent hover:text-accent-foreground flex-1 rounded-md border px-3 py-1.5 text-sm"
							>
								Retry
							</button>
						) : null}
						<button
							type="button"
							onClick={() => setView({ kind: "idle" })}
							data-testid="export-dismiss"
							className="border-border hover:bg-accent hover:text-accent-foreground flex-1 rounded-md border px-3 py-1.5 text-sm"
						>
							Dismiss
						</button>
					</div>
				</div>
			) : null}

			{interrupted.length > 0 ? (
				<section className="border-border flex flex-col gap-1 border-t pt-2">
					<h3 className="text-muted-foreground text-xs font-medium">
						Interrupted exports
					</h3>
					<ul className="flex flex-col gap-1" data-testid="export-interrupted-list">
						{interrupted.map((job) => (
							<li
								key={job.jobId}
								data-testid="export-interrupted"
								className="border-border flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
							>
								<span className="text-muted-foreground truncate">
									{job.request.format}
									{job.frames !== null
										? ` · ${String(job.frames.accepted)}/${String(job.frames.total)} frames`
										: " · not started"}
								</span>
								<span className="flex shrink-0 gap-1">
									<button
										type="button"
										onClick={() => void handleResume({ jobId: job.jobId })}
										data-testid="export-resume"
										className="border-border hover:bg-accent hover:text-accent-foreground rounded border px-2 py-0.5"
									>
										Resume
									</button>
									<button
										type="button"
										onClick={() => void handleDiscard({ jobId: job.jobId })}
										data-testid="export-discard"
										className="border-border hover:bg-accent hover:text-accent-foreground rounded border px-2 py-0.5"
									>
										Discard
									</button>
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</aside>
	);
}
