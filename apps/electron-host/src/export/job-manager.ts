/**
 * sdk-export-capability — `ExportJobManager` (design D3): the main-process
 * owner of export jobs. Pure Node (no Electron) so `bun test` exercises the
 * exact class the Electron main process installs over IPC.
 *
 * On-disk layout under the exports root (fixed so probes and recovery are
 * file facts, not process facts):
 *
 * ```
 * <root>/jobs/<jobId>.json         record (persisted after EVERY transition)
 * <root>/jobs/<jobId>.raw          append-only RGB24 frame stream
 * <root>/jobs/<jobId>.audio.wav    the timeline WAV the producer extracted
 * <root>/<outputName>.partial      FFmpeg's in-flight output
 * <root>/<outputName>              the deliverable
 * ```
 *
 * `outputName` is `<sanitized-project-name>-<jobId-first-8>.<ext>` — a
 * RELATIVE name. The renderer-visible descriptor is `"file:" + outputName`;
 * no absolute path ever crosses the bridge.
 *
 * **The store is the semantic SSOT.** Every transition this manager performs
 * on a job it owns in this process goes through `ExportJobStore`
 * (`@opencut/editor-ports/export-jobs`, Group A), and the record is persisted
 * after every transition, so the record at rest equals the store's snapshot.
 * Two transitions are deliberately record-level surgery instead, each because
 * the store instance died with the producer and cannot exist:
 *
 * - the boot-time interrupt scan (`interruptAllLive`) rewriting a live-phase
 *   record to `interrupted` — the discovery transition itself;
 * - `failJob` on a job with no live store (a dead producer's record).
 * Both emit the same event vocabulary a store transition would have.
 *
 * **Resume is a replay.** A fresh process cannot call `resume()` on a store
 * it never owned; instead `resumeJob`/`beginExport` reconstructs the live
 * store by replaying the legal prefix
 * (`open → beginRendering(total) → acceptFrames(accepted)`) and skips
 * re-emitting the replayed events (the cursor starts at the end). The
 * reconstructed state is exactly the state `resume()` would have produced —
 * `rendering` with `accepted/total` frames kept — which is the invariant the
 * store's own transition table documents. A job interrupted before it ever
 * rendered (`totalFrames === null`) reconstructs to `queued` and adopts its
 * render spec on attach, which is the honest recovery for it.
 *
 * **Cancel intent is a manager fact, not a store fact.** The store's
 * `cancelRequested` is deliberately invisible in snapshots (Group A's
 * design: interruption closes the window, and policy calls ride the record).
 * But the FFmpeg exit handler must know whether a death belongs to the cancel
 * flow (which awaits the death before `confirmCancelled`) or is a failure to
 * settle. `LiveJob.cancelRequested` bridges that: set by `cancelJob` before
 * the kill, checked by the exit handler, never persisted — after a restart a
 * cancel that never confirmed is an interruption, which is what it was.
 *
 * Timer discipline: this file sits inside the C6 scan roots
 * (`apps/electron-host/src`), so it acquires no bare platform timer — the one
 * delay it needs (SIGTERM→SIGKILL grace) comes from `node:timers/promises`
 * under an aliased binding.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	ftruncateSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delayMs } from "node:timers/promises";
import {
	ExportJobStore,
	ExportJobTransitionError,
	type ExportJobEvent,
	type ExportJobPhase,
	type ExportJobRequest,
	type ExportJobSnapshot,
} from "@opencut/editor-ports/export-jobs";

/** Named refusal: unknown job, wrong phase for the operation, protocol misuse. */
export class ExportJobManagerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExportJobManagerError";
	}
}

/** Named protocol failures that settle a job `failed` (surfaced to the UI). */
export const FRAME_STREAM_DESYNC_REASON = "frame-stream-desync";
export const PROJECT_UPDATED_MID_JOB_REASON = "project-updated-mid-job";
export const FFMPEG_MISSING_REASON = "ffmpeg-missing";
export const RAW_STREAM_SHORT_REASON = "raw-stream-short";

const LIVE_PHASES: readonly ExportJobPhase[] = ["queued", "rendering", "encoding"];
const SETTLED_PHASES: readonly ExportJobPhase[] = [
	"completed",
	"failed",
	"cancelled",
];

/** Grace between SIGTERM and SIGKILL when killing an encoder, ms. */
const KILL_GRACE_MS = 3000;
/** Bytes of stderr tail kept for a failure reason. */
const STDERR_TAIL_BYTES = 2000;

/**
 * The persisted record. Field set per the task contract plus `progress` and
 * `outputBytes` (a record must reproduce a snapshot alone — after a restart
 * there is no store to ask) and the envelope `kind` (the store bridge's own
 * convention; a foreign file in the directory is skipped, not parsed).
 */
interface ExportJobRecord {
	readonly kind: "opencut-export-job";
	readonly jobId: string;
	request: ExportJobRequest;
	phase: ExportJobPhase;
	progress: number;
	acceptedFrames: number;
	totalFrames: number | null;
	width: number | null;
	height: number | null;
	fps: { numerator: number; denominator: number } | null;
	readonly pixelFormat: "rgb24";
	outputName: string | null;
	outputBytes: number | null;
	error: string | null;
	readonly createdAtMs: number;
	updatedAtMs: number;
	projectContentGuard: string | null;
}

/** In-process state a record carries while some producer owns it. */
interface LiveJob {
	store: ExportJobStore;
	/** Events cursor — everything before it was already emitted (Group A's idiom). */
	emitted: number;
	rawFd: number | null;
	child: ChildProcess | null;
	childExit: Promise<void> | null;
	settled: Promise<ExportJobSnapshot> | null;
	/** Cancel intent for THIS process's encoder (see the class docblock). */
	cancelRequested: boolean;
}

interface JobEntry {
	record: ExportJobRecord;
	live: LiveJob | null;
	readonly subscribers: Set<(event: ExportJobEvent) => void>;
}

/** What `onAnyJob` hears: one job's event, or a list membership change. */
export type ExportJobNotification =
	| { readonly kind: "event"; readonly jobId: string; readonly event: ExportJobEvent }
	| { readonly kind: "listChanged" };

export interface ExportJobManagerArgs {
	/** The exports root this manager owns (created if absent). */
	readonly root: string;
	/** A resolved FFmpeg path, or null when no binary was discovered. */
	readonly ffmpegPath: string | null;
	readonly log?: (line: string) => void;
}

function isAbsent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isLivePhase(phase: ExportJobPhase): boolean {
	return LIVE_PHASES.includes(phase);
}

function isSettledPhase(phase: ExportJobPhase): boolean {
	return SETTLED_PHASES.includes(phase);
}

function fpsFloat(fps: { numerator: number; denominator: number }): number {
	return fps.numerator / fps.denominator;
}

/** `<sanitized>-<jobId8>.<ext>` — relative, path-free, collision-proof. */
function buildOutputName(args: {
	projectName: string | undefined;
	jobId: string;
	format: string;
}): string {
	const sanitized =
		(args.projectName ?? "export")
			.replace(/[<>:"/\\|?*\s]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "export";
	const ext = /^[\w-]+$/.test(args.format) ? args.format : "mp4";
	return `${sanitized}-${args.jobId.slice(0, 8)}.${ext}`;
}

export class ExportJobManager {
	private readonly root: string;
	private readonly ffmpegPath: string | null;
	private readonly log: (line: string) => void;
	private readonly jobs = new Map<string, JobEntry>();
	private readonly anyJobHandlers = new Set<
		(event: ExportJobNotification) => void
	>();
	private tempCounter = 0;

	constructor(args: ExportJobManagerArgs) {
		this.root = args.root;
		this.ffmpegPath = args.ffmpegPath;
		this.log = args.log ?? (() => {});
		mkdirSync(join(args.root, "jobs"), { recursive: true });
	}

	// -- layout helpers -----------------------------------------------------

	private recordPath(jobId: string): string {
		return join(this.root, "jobs", `${jobId}.json`);
	}

	private rawPath(jobId: string): string {
		return join(this.root, "jobs", `${jobId}.raw`);
	}

	private wavPath(jobId: string): string {
		return join(this.root, "jobs", `${jobId}.audio.wav`);
	}

	private outputPath(outputName: string): string {
		// outputName is built by this class from sanitized segments; it is a
		// single relative filename by construction, never a traversal.
		return join(this.root, outputName);
	}

	/** Atomic write: temp sibling, then rename (the store bridge's discipline). */
	private writeAtomic(target: string, bytes: Uint8Array | string): void {
		const temp = `${target}.tmp-${process.pid}-${this.tempCounter++}`;
		let descriptor: number | undefined;
		try {
			descriptor = openSync(temp, "w");
			const buffer =
				typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
			let written = 0;
			while (written < buffer.length) {
				written += writeSync(descriptor, buffer, written, buffer.length - written);
			}
			closeSync(descriptor);
			descriptor = undefined;
			renameSync(temp, target);
		} catch (error) {
			if (descriptor !== undefined) {
				try {
					closeSync(descriptor);
				} catch {
					// The original failure is the one that matters.
				}
			}
			try {
				unlinkSync(temp);
			} catch {
				// Absent temp is fine; the next write replaces a stale one.
			}
			throw error;
		}
	}

	private persist(entry: JobEntry): void {
		entry.record.updatedAtMs = Date.now();
		this.writeAtomic(
			this.recordPath(entry.record.jobId),
			JSON.stringify(entry.record, null, "\t"),
		);
	}

	private removeIfPresent(target: string): void {
		try {
			unlinkSync(target);
		} catch (error) {
			if (!isAbsent(error)) throw error;
		}
	}

	private closeRawStream(live: LiveJob): void {
		if (live.rawFd === null) return;
		try {
			closeSync(live.rawFd);
		} catch {
			// Already closed — an exit path may have beaten us to it.
		}
		live.rawFd = null;
	}

	/** Delete the job's transient artifacts (raw stream, wav, partial output). */
	private cleanupArtifacts(jobId: string, includeOutput: boolean): void {
		const entry = this.jobs.get(jobId);
		if (entry?.live) this.closeRawStream(entry.live);
		this.removeIfPresent(this.rawPath(jobId));
		this.removeIfPresent(this.wavPath(jobId));
		if (entry?.record.outputName) {
			this.removeIfPresent(`${this.outputPath(entry.record.outputName)}.partial`);
			if (includeOutput) {
				this.removeIfPresent(this.outputPath(entry.record.outputName));
			}
		}
	}

	// -- events -------------------------------------------------------------

	private emitEvent(jobId: string, event: ExportJobEvent): void {
		const entry = this.jobs.get(jobId);
		if (entry) {
			for (const handler of entry.subscribers) handler(event);
		}
		for (const handler of this.anyJobHandlers) {
			handler({ kind: "event", jobId, event });
		}
	}

	/** Drain a live store's unemitted events (Group A's cursor idiom). */
	private drainEvents(entry: JobEntry): void {
		if (!entry.live) return;
		const events = entry.live.store.events();
		for (; entry.live.emitted < events.length; entry.live.emitted += 1) {
			this.emitEvent(entry.record.jobId, events[entry.live.emitted]);
		}
	}

	private notifyListChanged(): void {
		for (const handler of this.anyJobHandlers) handler({ kind: "listChanged" });
	}

	/**
	 * Push-style observation, Group A's shape: per-job handlers plus a global
	 * `onAnyJob` for list membership changes. A poll-only consumer ignores both.
	 */
	subscribe(args: {
		jobId: string;
		handler: (event: ExportJobEvent) => void;
	}): { unsubscribe(): void } {
		const entry = this.requireEntry(args.jobId);
		entry.subscribers.add(args.handler);
		return {
			unsubscribe: () => {
				entry.subscribers.delete(args.handler);
			},
		};
	}

	onAnyJob(handler: (event: ExportJobNotification) => void): {
		unsubscribe(): void;
	} {
		this.anyJobHandlers.add(handler);
		return {
			unsubscribe: () => {
				this.anyJobHandlers.delete(handler);
			},
		};
	}

	// -- lookup -------------------------------------------------------------

	private requireEntry(jobId: string): JobEntry {
		const entry = this.jobs.get(jobId);
		if (entry === undefined) {
			throw new ExportJobManagerError(`no job "${jobId}"`);
		}
		return entry;
	}

	private readRecordFromDisk(jobId: string): ExportJobRecord | null {
		let text: string;
		try {
			text = readFileSync(this.recordPath(jobId), "utf8");
		} catch (error) {
			if (isAbsent(error)) return null;
			throw error;
		}
		try {
			const parsed = JSON.parse(text) as ExportJobRecord;
			return parsed.kind === "opencut-export-job" ? parsed : null;
		} catch {
			this.log(`job ${jobId}: unreadable record, skipping`);
			return null;
		}
	}

	/**
	 * Bring every on-disk record into the in-memory map (lazy load on first
	 * touch — `listJobs`/`getJob`/`interruptAllLive` after a restart).
	 */
	private loadEntry(jobId: string): JobEntry | null {
		if (this.jobs.has(jobId)) return this.jobs.get(jobId) ?? null;
		const record = this.readRecordFromDisk(jobId);
		if (record === null) return null;
		const entry: JobEntry = {
			record,
			live: null,
			subscribers: new Set(),
		};
		this.jobs.set(jobId, entry);
		return entry;
	}

	private snapshotOf(record: ExportJobRecord): ExportJobSnapshot {
		return {
			jobId: record.jobId,
			request: record.request,
			phase: record.phase,
			progress: record.phase === "completed" ? 1 : record.progress,
			output:
				record.phase === "completed" && record.outputName !== null
					? {
							descriptor: `file:${record.outputName}`,
							bytes: record.outputBytes ?? 0,
						}
					: null,
			error: record.error,
			frames:
				record.totalFrames !== null
					? { accepted: record.acceptedFrames, total: record.totalFrames }
					: null,
		};
	}

	// -- lifecycle ----------------------------------------------------------

	private static validateRequest(request: ExportJobRequest): string | null {
		if (typeof request?.projectId !== "string" || request.projectId.length === 0) {
			return "a job needs a non-empty projectId";
		}
		if (typeof request?.format !== "string" || request.format.length === 0) {
			return "a job needs a non-empty format";
		}
		return null;
	}

	/**
	 * Open a job (`queued`, no render spec — only the producer window can know
	 * the project's canvas/fps/duration). Records the output name and the
	 * stale-timeline guard when the caller knows the project meta.
	 */
	startJob(args: {
		request: ExportJobRequest;
		projectName?: string;
		projectContentDigest?: string;
	}): { jobId: string } {
		const invalid = ExportJobManager.validateRequest(args.request);
		if (invalid !== null) throw new ExportJobManagerError(`startJob: ${invalid}`);
		const jobId = randomUUID();
		const now = Date.now();
		const record: ExportJobRecord = {
			kind: "opencut-export-job",
			jobId,
			request: args.request,
			phase: "queued",
			progress: 0,
			acceptedFrames: 0,
			totalFrames: null,
			width: null,
			height: null,
			fps: null,
			pixelFormat: "rgb24",
			outputName: buildOutputName({
				projectName: args.projectName,
				jobId,
				format: args.request.format,
			}),
			outputBytes: null,
			error: null,
			createdAtMs: now,
			updatedAtMs: now,
			projectContentGuard: args.projectContentDigest ?? null,
		};
		const entry: JobEntry = {
			record,
			live: {
				store: ExportJobStore.open({ jobId, request: args.request, now }),
				emitted: 0,
				rawFd: null,
				child: null,
				childExit: null,
				settled: null,
				cancelRequested: false,
			},
			subscribers: new Set(),
		};
		this.jobs.set(jobId, entry);
		this.persist(entry);
		this.drainEvents(entry);
		this.notifyListChanged();
		this.log(`job ${jobId}: opened for project ${args.request.projectId}`);
		return { jobId };
	}

	/**
	 * Reconstruct a live store for a persisted record by replaying the legal
	 * prefix. A record that never rendered (`totalFrames === null`) replays to
	 * `queued`; one that did replays to `rendering` at its accepted count.
	 */
	private reconstructStore(entry: JobEntry): ExportJobStore {
		const { record } = entry;
		let store = ExportJobStore.open({
			jobId: record.jobId,
			request: record.request,
		});
		if (record.totalFrames !== null) {
			store = store.beginRendering({ totalFrames: record.totalFrames });
			if (record.acceptedFrames > 0) {
				store = store.acceptFrames({ count: record.acceptedFrames });
			}
		}
		return store;
	}

	/**
	 * A live store exists for this entry in THIS process. Reconstruction is
	 * the resume: the record's phase is aligned to the reconstructed store's
	 * actual phase, and an interrupted job's revival is announced with one
	 * synthetic phase event (the replayed events stay behind the cursor).
	 */
	private ensureLive(entry: JobEntry): LiveJob {
		if (entry.live === null) {
			const store = this.reconstructStore(entry);
			const phase = store.snapshot().phase;
			entry.live = {
				store,
				emitted: store.events().length,
				rawFd: null,
				child: null,
				childExit: null,
				settled: null,
				cancelRequested: false,
			};
			const wasInterrupted = entry.record.phase === "interrupted";
			entry.record.phase = phase;
			this.persist(entry);
			if (wasInterrupted) {
				this.emitEvent(entry.record.jobId, {
					type: "phase",
					phase,
					at: Date.now(),
				});
			}
		}
		return entry.live;
	}

	/**
	 * The producer window attaches: declare the render spec, and either begin
	 * rendering (queued — fresh or never-rendered), resume (interrupted, spec
	 * already recorded), or re-attach idempotently (rendering/encoding — the
	 * `resumeJob` IPC op already transitioned the record). Returns the
	 * authoritative assignment, `nextNeededFrame` first among equals.
	 */
	beginExport(args: {
		jobId?: string;
		request: ExportJobRequest;
		renderSpec?: {
			width: number;
			height: number;
			fps: { numerator: number; denominator: number };
			totalFrames: number;
		};
		projectName?: string;
		projectContentDigest?: string;
	}): {
		jobId: string;
		request: ExportJobRequest;
		width: number;
		height: number;
		fps: { numerator: number; denominator: number };
		totalFrames: number;
		nextNeededFrame: number;
	} {
		let entry: JobEntry;
		if (args.jobId === undefined) {
			if (args.renderSpec === undefined) {
				throw new ExportJobManagerError(
					"beginExport: a fresh job needs its render spec",
				);
			}
			const { jobId } = this.startJob({
				request: args.request,
				projectName: args.projectName,
				projectContentDigest: args.projectContentDigest,
			});
			entry = this.requireEntry(jobId);
		} else {
			entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		}
		const { record } = entry;
		const attachSpec = args.renderSpec;

		// The stale-timeline guard: a project whose CONTENT moved between the
		// panel's start and the window's attach renders a stale timeline by
		// definition — fail with a named reason (design D3's contention row).
		// The guard digests the record's `data`, not its metadata: thumbnail
		// saves bump `summary.updatedAt` without touching content, and the
		// D2 recovery finding showed a metadata guard invalidates every
		// interrupted job the moment its project is reopened to reach Resume.
		if (
			args.projectContentDigest !== undefined &&
			record.projectContentGuard !== null &&
			args.projectContentDigest !== record.projectContentGuard
		) {
			this.failJob({
				jobId: record.jobId,
				reason: `${PROJECT_UPDATED_MID_JOB_REASON}: content digest ${record.projectContentGuard.slice(0, 12)}… at start, producer sees ${args.projectContentDigest.slice(0, 12)}…`,
			});
			throw new ExportJobManagerError(
				`beginExport: ${PROJECT_UPDATED_MID_JOB_REASON}`,
			);
		}

		if (isSettledPhase(record.phase)) {
			throw new ExportJobManagerError(
				`beginExport: job ${record.jobId} already settled (${record.phase})`,
			);
		}

		// The producer must be exporting the job it was assigned: a request
		// naming a different project or format is a wiring bug, named here
		// before any state moves.
		if (
			args.jobId !== undefined &&
			(args.request.projectId !== record.request.projectId ||
				args.request.format !== record.request.format)
		) {
			throw new ExportJobManagerError(
				`beginExport: request mismatch for job ${record.jobId} — the record says ${record.request.projectId}/${record.request.format}, the producer declared ${args.request.projectId}/${args.request.format}`,
			);
		}

		if (record.phase === "interrupted") {
			// A rendering job's frames are the resumable part; without the raw
			// stream the record is a receipt for work that cannot continue.
			if (record.totalFrames !== null && !existsSync(this.rawPath(record.jobId))) {
				throw new ExportJobManagerError(
					`beginExport: interrupted job ${record.jobId} has no raw stream to resume — discard the job`,
				);
			}
			// The stream must also AGREE with the record (surplus tail
			// truncates away; a short stream fails the job — M-1's guard).
			if (record.totalFrames !== null) {
				this.reconcileRawStream(record);
			}
			this.ensureLive(entry); // record.phase is now rendering|queued
		}

		if (record.phase === "queued") {
			if (attachSpec === undefined) {
				throw new ExportJobManagerError(
					`beginExport: queued job ${record.jobId} needs its render spec`,
				);
			}
			this.ensureLive(entry);
			const live = entry.live as LiveJob;
			live.store = live.store.beginRendering({
				totalFrames: attachSpec.totalFrames,
				now: Date.now(),
			});
			record.phase = "rendering";
			record.totalFrames = attachSpec.totalFrames;
			record.width = attachSpec.width;
			record.height = attachSpec.height;
			record.fps = { ...attachSpec.fps };
			record.progress = 0;
			this.persist(entry);
			this.drainEvents(entry);
			this.log(
				`job ${record.jobId}: rendering ${attachSpec.width}x${attachSpec.height}@${fpsFloat(attachSpec.fps)} ${attachSpec.totalFrames} frames`,
			);
			return this.assignmentOf(record);
		}

		// rendering (or encoding): an idempotent re-attach. The spec, if
		// declared again, must be the same job it always was.
		if (attachSpec !== undefined) {
			this.assertSpecMatches({ record, spec: attachSpec });
		}
		return this.assignmentOf(record);
	}

	private assignmentOf(record: ExportJobRecord): {
		jobId: string;
		request: ExportJobRequest;
		width: number;
		height: number;
		fps: { numerator: number; denominator: number };
		totalFrames: number;
		nextNeededFrame: number;
	} {
		const spec = this.requireSpec(record);
		return {
			jobId: record.jobId,
			request: record.request,
			width: spec.width,
			height: spec.height,
			fps: spec.fps,
			totalFrames: record.totalFrames as number,
			nextNeededFrame: record.acceptedFrames,
		};
	}

	private requireSpec(record: ExportJobRecord): {
		width: number;
		height: number;
		fps: { numerator: number; denominator: number };
	} {
		if (
			record.width === null ||
			record.height === null ||
			record.fps === null ||
			record.totalFrames === null
		) {
			throw new ExportJobManagerError(
				`job ${record.jobId} has no render spec yet`,
			);
		}
		return { width: record.width, height: record.height, fps: record.fps };
	}

	private assertSpecMatches(args: {
		record: ExportJobRecord;
		spec: {
			width: number;
			height: number;
			fps: { numerator: number; denominator: number };
			totalFrames: number;
		};
	}): void {
		const { record, spec } = args;
		if (
			record.width !== null &&
			(record.width !== spec.width ||
				record.height !== spec.height ||
				record.totalFrames !== spec.totalFrames ||
				record.fps?.numerator !== spec.fps.numerator ||
				record.fps?.denominator !== spec.fps.denominator)
		) {
			throw new ExportJobManagerError(
				`beginExport: spec mismatch for job ${record.jobId} — the record says ${String(record.width)}x${String(record.height)}@${String(record.fps?.numerator)}/${String(record.fps?.denominator)} ${String(record.totalFrames)}f, the producer declared ${String(spec.width)}x${String(spec.height)}@${String(spec.fps.numerator)}/${String(spec.fps.denominator)} ${String(spec.totalFrames)}f`,
			);
		}
	}

	// -- frame stream -------------------------------------------------------

	/**
	 * Append one batch of RGB24 frames. `startIndex` MUST equal the record's
	 * accepted count — a gap or a duplicate is a protocol error that fails the
	 * job with the named reason (the producer's transport lost ordering; the
	 * stream cannot be trusted past that point).
	 */
	acceptFrames(args: {
		jobId: string;
		startIndex: number;
		buffer: Uint8Array;
	}): { acceptedFrames: number; moreWanted: boolean } {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		const { record } = entry;
		if (!isLivePhase(record.phase)) {
			throw new ExportJobManagerError(
				`acceptFrames: job ${args.jobId} is ${record.phase}, not live`,
			);
		}
		if (entry.live === null) {
			this.failJob({
				jobId: args.jobId,
				reason: "frames-without-producer: no live store owns this job",
			});
			throw new ExportJobManagerError(
				`acceptFrames: job ${args.jobId} has no attached producer (beginExport comes first)`,
			);
		}
		const spec = this.requireSpec(record);
		const frameBytes = spec.width * spec.height * 3;
		if (
			args.buffer.byteLength === 0 ||
			args.buffer.byteLength % frameBytes !== 0
		) {
			this.failJob({
				jobId: args.jobId,
				reason: `frame-batch-size: ${String(args.buffer.byteLength)} bytes is not a whole number of ${String(frameBytes)}-byte frames`,
			});
			throw new ExportJobManagerError(
				`acceptFrames: bad batch size ${String(args.buffer.byteLength)}`,
			);
		}
		if (args.startIndex !== record.acceptedFrames) {
			this.failJob({
				jobId: args.jobId,
				reason: `${FRAME_STREAM_DESYNC_REASON}: expected startIndex ${String(record.acceptedFrames)}, got ${String(args.startIndex)}`,
			});
			throw new ExportJobManagerError(
				`acceptFrames: ${FRAME_STREAM_DESYNC_REASON}`,
			);
		}
		const count = args.buffer.byteLength / frameBytes;
		if (record.acceptedFrames + count > (record.totalFrames as number)) {
			this.failJob({
				jobId: args.jobId,
				reason: `frame-overshoot: ${String(record.acceptedFrames + count)} would exceed total ${String(record.totalFrames)}`,
			});
			throw new ExportJobManagerError("acceptFrames: frame overshoot");
		}

		// Append before the transition: a write failure must not advance the
		// count (the reverse — count then failed write — would poison resume).
		const live = entry.live;
		if (live.rawFd === null) {
			live.rawFd = openSync(this.rawPath(args.jobId), "a");
		}
		const buffer = Buffer.from(
			args.buffer.buffer,
			args.buffer.byteOffset,
			args.buffer.byteLength,
		);
		let written = 0;
		while (written < buffer.length) {
			written += writeSync(live.rawFd, buffer, written, buffer.length - written);
		}

		try {
			live.store = live.store.acceptFrames({ count, now: Date.now() });
		} catch (error) {
			if (error instanceof ExportJobTransitionError) {
				// Work offered inside the cancel window is simply refused — the
				// cancel owns the settlement, not this frame batch.
				if (live.cancelRequested || !live.store.discardable()) {
					throw new ExportJobManagerError(`acceptFrames: ${error.message}`);
				}
				this.failJob({
					jobId: args.jobId,
					reason: `frame-transition: ${error.message}`,
				});
				throw new ExportJobManagerError(`acceptFrames: ${error.message}`);
			}
			throw error;
		}
		const snapshot = live.store.snapshot();
		record.acceptedFrames = snapshot.frames?.accepted ?? record.acceptedFrames;
		record.progress = snapshot.progress;
		this.persist(entry);
		this.drainEvents(entry);
		return {
			acceptedFrames: record.acceptedFrames,
			moreWanted: record.acceptedFrames < (record.totalFrames as number),
		};
	}

	/**
	 * The disk is the resumable truth, so it must AGREE with the record before
	 * any producer attaches to frames it did not write (review M-1).
	 * `acceptFrames` appends before the store transition and persists after
	 * it, so a death in that window leaves the file AHEAD of the record (a
	 * garbage tail from the dead process — frame-aligned truncation removes
	 * exactly it), while a mid-`writeSync` death leaves it SHORT of a record
	 * that claims those frames — that job can never be completed honestly,
	 * so it settles `failed` with the named reason rather than handing
	 * FFmpeg a truncated tail that would lengthen the output silently.
	 */
	private reconcileRawStream(record: ExportJobRecord): void {
		const spec = this.requireSpec(record);
		const frameBytes = spec.width * spec.height * 3;
		const expected = record.acceptedFrames * frameBytes;
		const rawPath = this.rawPath(record.jobId);
		const size = statSync(rawPath).size;
		if (size > expected) {
			const fd = openSync(rawPath, "r+");
			try {
				ftruncateSync(fd, expected);
			} finally {
				closeSync(fd);
			}
			this.log(
				`job ${record.jobId}: raw stream held ${String(size)} bytes for ${String(record.acceptedFrames)} accepted frames — truncated to ${String(expected)} (garbage tail from the dead producer)`,
			);
			return;
		}
		if (size < expected) {
			const reason = `${RAW_STREAM_SHORT_REASON}: the record claims ${String(record.acceptedFrames)} frames (${String(expected)} bytes) but the raw stream holds ${String(size)} bytes`;
			this.failJob({ jobId: record.jobId, reason });
			throw new ExportJobManagerError(`reconcileRawStream: ${reason}`);
		}
	}

	/**
	 * The job's timeline WAV, exactly once, before finalize. Not a store
	 * transition — the encode consumes it as FFmpeg's second input.
	 */
	acceptAudio(args: { jobId: string; wav: ArrayBuffer }): void {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		if (entry.record.phase !== "rendering") {
			throw new ExportJobManagerError(
				`acceptAudio: job ${args.jobId} is ${entry.record.phase}, not rendering`,
			);
		}
		const bytes = new Uint8Array(args.wav);
		this.writeAtomic(this.wavPath(args.jobId), bytes);
		this.log(`job ${args.jobId}: audio ${String(bytes.byteLength)} bytes`);
	}

	// -- encode -------------------------------------------------------------

	/**
	 * Every frame accepted: transition to encoding and spawn FFmpeg ONCE.
	 * Returns when the encode has STARTED; completion arrives as the store's
	 * `settled` event (or poll `getJob` / await `whenSettled`).
	 */
	finalize(args: { jobId: string }): { jobId: string; encoding: boolean } {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		const { record } = entry;
		if (record.phase !== "rendering" || entry.live === null) {
			throw new ExportJobManagerError(
				`finalize: job ${args.jobId} is ${record.phase} with ${entry.live === null ? "no" : "a"} live producer — only a rendering job finalizes`,
			);
		}
		if (this.ffmpegPath === null) {
			this.failJob({
				jobId: args.jobId,
				reason: FFMPEG_MISSING_REASON,
			});
			throw new ExportJobManagerError(`finalize: ${FFMPEG_MISSING_REASON}`);
		}
		if (record.request.format !== "mp4" && record.request.format !== "webm") {
			this.failJob({
				jobId: args.jobId,
				reason: `unsupported-format: ${record.request.format}`,
			});
			throw new ExportJobManagerError(
				`finalize: unsupported format ${record.request.format}`,
			);
		}
		const live = entry.live;
		try {
			live.store = live.store.beginEncoding({ now: Date.now() });
		} catch (error) {
			if (error instanceof ExportJobTransitionError) {
				throw new ExportJobManagerError(`finalize: ${error.message}`);
			}
			throw error;
		}
		record.phase = "encoding";
		record.progress = 0;
		this.persist(entry);
		this.drainEvents(entry);
		this.runFfmpeg(entry);
		return { jobId: args.jobId, encoding: true };
	}

	/** Build the reference invocation (mp4/webm per the design's fixed set). */
	private ffmpegArgs(entry: JobEntry): string[] {
		const { record } = entry;
		const spec = this.requireSpec(record);
		const hasAudio = existsSync(this.wavPath(record.jobId));
		const args = [
			"-hide_banner",
			"-nostats",
			"-progress",
			"pipe:1",
			"-f",
			"rawvideo",
			"-pixel_format",
			"rgb24",
			"-video_size",
			`${spec.width}x${spec.height}`,
			"-framerate",
			`${spec.fps.numerator}/${spec.fps.denominator}`,
			"-i",
			this.rawPath(record.jobId),
		];
		if (hasAudio) {
			args.push("-f", "wav", "-i", this.wavPath(record.jobId));
		}
		args.push("-map", "0:v:0");
		if (hasAudio) {
			args.push("-map", "1:a:0");
		}
		if (record.request.format === "webm") {
			args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32");
			if (hasAudio) args.push("-c:a", "libopus");
		} else {
			args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
			if (hasAudio) args.push("-c:a", "aac");
			args.push("-movflags", "+faststart");
		}
		// The `.partial` suffix hides the container extension from ffmpeg's
		// muxer inference — name the container explicitly.
		args.push("-f", record.request.format);
		args.push("-y", `${this.outputPath(record.outputName as string)}.partial`);
		return args;
	}

	private runFfmpeg(entry: JobEntry): void {
		const { record } = entry;
		const live = entry.live as LiveJob;
		const outputName = record.outputName as string;
		const partialPath = `${this.outputPath(outputName)}.partial`;
		const finalPath = this.outputPath(outputName);
		const totalSeconds =
			(record.totalFrames as number) /
			fpsFloat(record.fps as { numerator: number; denominator: number });

		let releaseChildExit: () => void = () => {};
		live.childExit = new Promise<void>((resolve) => {
			releaseChildExit = resolve;
		});

		const child = spawn(this.ffmpegPath as string, this.ffmpegArgs(entry), {
			stdio: ["ignore", "pipe", "pipe"],
		});
		live.child = child;
		let stderrTail = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-STDERR_TAIL_BYTES);
		});
		child.stdout?.on("data", (chunk: Buffer) => {
			// `-progress pipe:1` emits `key=value` lines; `out_time_ms` is
			// microseconds despite the name. Progress is phase-local [0,1]
			// against the job's exact duration.
			for (const line of chunk.toString("utf8").split(/\r?\n/)) {
				const match = /^out_time_ms=(\d+)/.exec(line);
				if (match === null) continue;
				const seconds = Number(match[1]) / 1_000_000;
				const progress = Math.min(1, Math.max(0, seconds / totalSeconds));
				this.applyEncodeProgress({ entry, progress });
			}
		});

		// A spawn failure fires "error" and may never fire "exit": the exit
		// gate must release in both paths or a cancel await would hang.
		child.once("error", (error) => {
			this.log(`job ${record.jobId}: ffmpeg spawn error ${String(error)}`);
			this.failJob({ jobId: record.jobId, reason: `ffmpeg-spawn: ${String(error)}` });
			releaseChildExit();
		});

		child.once("exit", (code, signal) => {
			releaseChildExit();
			// A death inside the cancel window belongs to the cancel flow: it
			// awaits this release before confirmCancelled + cleanup.
			if (live.cancelRequested) return;
			const current = this.jobs.get(record.jobId);
			if (current === undefined || isSettledPhase(current.record.phase)) return;
			if (code === 0) {
				try {
					renameSync(partialPath, finalPath);
					const bytes = statSync(finalPath).size;
					this.completeJob({ entry, outputName, bytes });
				} catch (error) {
					this.failJob({
						jobId: record.jobId,
						reason: `ffmpeg-output: ${String(error)}`,
					});
				}
				return;
			}
			this.failJob({
				jobId: record.jobId,
				reason: `ffmpeg-exit-${String(code ?? signal)}: ${stderrTail.slice(-400)}`,
			});
		});

		this.log(
			`job ${record.jobId}: ffmpeg pid ${String(child.pid)} encoding ${outputName}`,
		);
	}

	private applyEncodeProgress(args: { entry: JobEntry; progress: number }): void {
		const { entry } = args;
		const live = entry.live;
		if (live === null || entry.record.phase !== "encoding") return;
		try {
			live.store = live.store.setEncodeProgress({
				progress: args.progress,
				now: Date.now(),
			});
		} catch {
			// A decrease (FFmpeg re-reports slightly backwards near the end) is
			// skipped, not fatal — monotonicity is the store's rule to enforce.
			return;
		}
		entry.record.progress = live.store.snapshot().progress;
		this.persist(entry);
		this.drainEvents(entry);
	}

	private completeJob(args: {
		entry: JobEntry;
		outputName: string;
		bytes: number;
	}): void {
		const { entry } = args;
		const live = entry.live;
		if (live === null) return;
		live.store = live.store.complete({
			output: { descriptor: `file:${args.outputName}`, bytes: args.bytes },
			now: Date.now(),
		});
		entry.record.phase = "completed";
		entry.record.progress = 1;
		entry.record.outputBytes = args.bytes;
		this.persist(entry);
		this.drainEvents(entry);
		// The deliverable stays; the transient stream does not (design D3's
		// disk-cost row). The raw stream's append handle is closed inside.
		this.cleanupArtifacts(entry.record.jobId, false);
		this.log(
			`job ${entry.record.jobId}: completed ${args.outputName} ${String(args.bytes)} bytes`,
		);
	}

	// -- failure / cancel / interrupt / resume ------------------------------

	/**
	 * Fail a job with a named reason. With a live store this is the store's
	 * own `fail` transition; without one (a dead producer's record) it is the
	 * documented record-level surgery — both emit the same `settled` event
	 * vocabulary.
	 */
	failJob(args: { jobId: string; reason: string }): void {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		const { record } = entry;
		if (isSettledPhase(record.phase)) return;
		if (entry.live !== null && isLivePhase(entry.live.store.snapshot().phase)) {
			entry.live.store = entry.live.store.fail({
				reason: args.reason,
				now: Date.now(),
			});
			this.syncFromStore(entry);
			this.persist(entry);
			this.drainEvents(entry);
		} else {
			record.phase = "failed";
			record.error = args.reason;
			this.persist(entry);
			this.emitEvent(record.jobId, {
				type: "settled",
				phase: "failed",
				error: args.reason,
				at: Date.now(),
			});
		}
		if (entry.live?.child) {
			this.killChild(entry.live);
		}
		this.cleanupArtifacts(args.jobId, true);
		this.log(`job ${args.jobId}: failed — ${args.reason}`);
	}

	private syncFromStore(entry: JobEntry): void {
		const snapshot = (entry.live as LiveJob).store.snapshot();
		entry.record.phase = snapshot.phase;
		entry.record.progress = snapshot.progress;
		entry.record.error = snapshot.error;
		if (snapshot.frames !== null) {
			entry.record.acceptedFrames = snapshot.frames.accepted;
		}
	}

	private killChild(live: LiveJob): void {
		if (live.child === null || live.childExit === null) return;
		if (live.child.exitCode !== null || live.child.signalCode !== null) return;
		try {
			live.child.kill("SIGTERM");
		} catch {
			// Already dead — the exit handler ran.
		}
	}

	/** SIGTERM, then SIGKILL after the grace. Awaitable encoder teardown. */
	private async killChildAwaitExit(live: LiveJob): Promise<void> {
		if (live.child === null || live.childExit === null) return;
		this.killChild(live);
		const died = await Promise.race([
			live.childExit.then(() => true),
			delayMs(KILL_GRACE_MS).then(() => false),
		]);
		if (!died) {
			try {
				live.child.kill("SIGKILL");
			} catch {
				// Raced with natural exit.
			}
			await live.childExit;
		}
	}

	/**
	 * Two-step cancel (Group A's semantics): record the intent, kill the
	 * encoder (SIGTERM, SIGKILL after 3 s), stop accepting frames, delete the
	 * raw stream/wav/partial — and KEEP the record, marked `cancelled`, so the
	 * job list still shows the history.
	 */
	async cancelJob(args: { jobId: string }): Promise<ExportJobSnapshot> {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		const { record } = entry;
		if (isSettledPhase(record.phase)) {
			return this.snapshotOf(record); // idempotent by contract
		}
		if (record.phase === "interrupted") {
			throw new ExportJobManagerError(
				`cancelJob: job ${args.jobId} is interrupted — resume it or discard it`,
			);
		}
		if (entry.live === null) {
			// No producer in this process (e.g. a queued job whose window never
			// attached): nothing to kill, settle directly at the record.
			record.phase = "cancelled";
			this.persist(entry);
			this.emitEvent(args.jobId, {
				type: "settled",
				phase: "cancelled",
				at: Date.now(),
			});
			this.cleanupArtifacts(args.jobId, true);
			this.log(`job ${args.jobId}: cancelled`);
			return this.snapshotOf(record);
		}
		const live = entry.live;
		live.cancelRequested = true;
		live.store = live.store.requestCancel();
		await this.killChildAwaitExit(live);
		try {
			live.store = live.store.confirmCancelled({ now: Date.now() });
		} catch (error) {
			if (error instanceof ExportJobTransitionError) {
				throw new ExportJobManagerError(`cancelJob: ${error.message}`);
			}
			throw error;
		}
		this.syncFromStore(entry);
		this.persist(entry);
		this.drainEvents(entry);
		this.cleanupArtifacts(args.jobId, true);
		this.log(`job ${args.jobId}: cancelled`);
		return this.snapshotOf(record);
	}

	/**
	 * Resume an interrupted job: reconstruct the live store (the replay), keep
	 * the frames, and hand a fresh producer the assignment. Fails with a named
	 * reason (leaving the job interrupted) when the raw stream is gone — the
	 * frames are the resumable part, not the record.
	 */
	resumeJob(args: { jobId: string }): {
		jobId: string;
		request: ExportJobRequest;
		width: number;
		height: number;
		fps: { numerator: number; denominator: number };
		totalFrames: number;
		nextNeededFrame: number;
	} {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		if (entry.record.phase !== "interrupted") {
			throw new ExportJobManagerError(
				`resumeJob: job ${args.jobId} is ${entry.record.phase}, not interrupted`,
			);
		}
		if (!existsSync(this.rawPath(args.jobId))) {
			throw new ExportJobManagerError(
				`resumeJob: job ${args.jobId} has no raw stream — the frames are gone; discard the job`,
			);
		}
		// The stream must AGREE with the record before a producer resumes
		// onto it (M-1: surplus truncates, shortage fails with the reason).
		// A spec-less job (interrupted from `queued`) has no frames to
		// reconcile — its refusal is `assignmentOf`'s own no-spec error.
		if (entry.record.totalFrames !== null) {
			this.reconcileRawStream(entry.record);
		}
		this.ensureLive(entry);
		this.drainEvents(entry);
		this.log(
			`job ${args.jobId}: resumed at frame ${String(entry.record.acceptedFrames)}`,
		);
		return this.assignmentOf(entry.record);
	}

	/** Discard: everything goes, including the record and any output. */
	discardJob(args: { jobId: string }): void {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		if (
			entry.live !== null &&
			isLivePhase(entry.live.store.snapshot().phase) &&
			!entry.live.store.discardable()
		) {
			throw new ExportJobManagerError(
				`discardJob: job ${args.jobId} is mid-cancel — let the cancellation finish first`,
			);
		}
		if (entry.live) {
			this.killChild(entry.live);
		}
		this.cleanupArtifacts(args.jobId, true);
		try {
			unlinkSync(this.recordPath(args.jobId));
		} catch (error) {
			if (!isAbsent(error)) throw error;
		}
		this.jobs.delete(args.jobId);
		this.notifyListChanged();
		this.log(`job ${args.jobId}: discarded`);
	}

	/**
	 * Boot-time scan: every record whose phase is live belonged to a producer
	 * that died with the previous process — interrupt it (frames and record
	 * kept) so the job list surfaces it as resumable. In-process live jobs
	 * transition through their store; records without one get the documented
	 * record-level interrupt. Returns how many jobs were interrupted.
	 */
	interruptAllLive(): number {
		let interrupted = 0;
		for (const jobId of this.allRecordIds()) {
			const entry = this.loadEntry(jobId);
			if (entry === null || !isLivePhase(entry.record.phase)) continue;
			if (entry.live !== null) {
				entry.live.store = entry.live.store.interrupt({ now: Date.now() });
				this.syncFromStore(entry);
				if (entry.live.child) {
					this.killChild(entry.live);
				}
				this.closeRawStream(entry.live);
				this.persist(entry);
				this.drainEvents(entry);
			} else {
				entry.record.phase = "interrupted";
				this.persist(entry);
				this.emitEvent(jobId, {
					type: "phase",
					phase: "interrupted",
					at: Date.now(),
				});
			}
			interrupted += 1;
			this.log(`job ${jobId}: interrupted (was live at scan)`);
		}
		return interrupted;
	}

	private allRecordIds(): string[] {
		let entries: string[];
		try {
			entries = readdirSync(join(this.root, "jobs"));
		} catch {
			return [];
		}
		return entries
			.filter((name) => name.endsWith(".json") && !name.includes(".tmp-"))
			.map((name) => name.slice(0, -".json".length));
	}

	// -- observation --------------------------------------------------------

	listJobs(): readonly ExportJobSnapshot[] {
		const snapshots = this.allRecordIds().flatMap((jobId) => {
			const entry = this.loadEntry(jobId);
			return entry === null ? [] : [this.snapshotOf(entry.record)];
		});
		snapshots.sort((left, right) => {
			const leftCreated = this.jobs.get(left.jobId)?.record.createdAtMs ?? 0;
			const rightCreated = this.jobs.get(right.jobId)?.record.createdAtMs ?? 0;
			return rightCreated - leftCreated;
		});
		return snapshots;
	}

	getJob(args: { jobId: string }): ExportJobSnapshot | null {
		const entry = this.loadEntry(args.jobId);
		return entry === null ? null : this.snapshotOf(entry.record);
	}

	/** The completed output's bytes (the frozen port's bridge over jobs). */
	readJobOutputBytes(args: { jobId: string }): ArrayBuffer {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		const { record } = entry;
		if (record.phase !== "completed" || record.outputName === null) {
			throw new ExportJobManagerError(
				`readJobOutputBytes: job ${args.jobId} has no completed output`,
			);
		}
		const bytes = readFileSync(this.outputPath(record.outputName));
		return bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
	}

	/**
	 * Await a job's settlement (any of completed/failed/cancelled). Already-
	 * settled jobs resolve immediately. The encode path's completion is
	 * asynchronous by design; this is the awaitable seam for it.
	 */
	whenSettled(args: { jobId: string }): Promise<ExportJobSnapshot> {
		const entry = this.loadEntry(args.jobId) ?? this.requireEntry(args.jobId);
		if (isSettledPhase(entry.record.phase)) {
			return Promise.resolve(this.snapshotOf(entry.record));
		}
		if (entry.live === null) {
			return Promise.reject(
				new ExportJobManagerError(
					`whenSettled: job ${args.jobId} has no live producer to settle it`,
				),
			);
		}
		entry.live.settled ??= new Promise<ExportJobSnapshot>((resolve) => {
			const { unsubscribe } = this.subscribe({
				jobId: args.jobId,
				handler: (event) => {
					if (event.type !== "settled") return;
					unsubscribe();
					const settled = this.getJob({ jobId: args.jobId });
					resolve(settled ?? this.snapshotOf(entry.record));
				},
			});
		});
		return entry.live.settled;
	}

	/**
	 * Teardown: kill live encoders, close streams. Records stay as they are.
	 *
	 * INVARIANT — nobody calls this on app quit today, and mid-encode crash
	 * recovery depends on that accident (review m-2): a record resting at
	 * `encoding` is interrupted by the boot scan and resumes cleanly, whereas
	 * a SIGTERM from THIS method routes the child through the exit handler
	 * and would settle the job `failed`, destroying resumability. If quit
	 * wiring ever adopts `dispose()`, the exit handler must first learn to
	 * treat a job whose record is already `interrupted` as an expected death.
	 */
	async dispose(): Promise<void> {
		for (const entry of this.jobs.values()) {
			const live = entry.live;
			if (live === null) continue;
			await this.killChildAwaitExit(live);
			this.closeRawStream(live);
		}
	}
}

// -- binary discovery -------------------------------------------------------

const ffmpegDiscoveryCache = new Map<string, string | null>();

/**
 * `OPENCUT_FFMPEG_PATH` → `<root>/bin/ffmpeg(.exe)` → `PATH` scan. Never
 * bundling (design D3): a missing binary is `canExport: false`, not an error.
 * Results are cached per arguments — discovery runs on boot and on every
 * `canExport` probe, and the PATH scan is not free.
 */
export function resolveFfmpegPath(args: {
	envValue?: string;
	configuredRoot?: string;
}): string | null {
	const cacheKey = JSON.stringify([args.envValue ?? null, args.configuredRoot ?? null]);
	const cached = ffmpegDiscoveryCache.get(cacheKey);
	if (cached !== undefined) return cached;
	const names = process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg", "ffmpeg.exe"];
	const found = (() => {
		if (args.envValue !== undefined && args.envValue !== "" && existsSync(args.envValue)) {
			return args.envValue;
		}
		if (args.configuredRoot !== undefined) {
			for (const name of names) {
				const candidate = join(args.configuredRoot, "bin", name);
				if (existsSync(candidate)) return candidate;
			}
		}
		const pathValue = process.env.PATH ?? "";
		for (const dir of pathValue.split(process.platform === "win32" ? ";" : ":")) {
			if (dir === "") continue;
			for (const name of names) {
				const candidate = join(dir, name);
				if (existsSync(candidate)) return candidate;
			}
		}
		return null;
	})();
	ffmpegDiscoveryCache.set(cacheKey, found);
	return found;
}
