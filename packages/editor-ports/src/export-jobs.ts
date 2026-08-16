/**
 * @opencutSurface experimental — S08 pre-work: the addressable export-job lifecycle (identity, phases, progress, cancellation, best-effort recovery) beside the frozen ExportProvider promise shape; ratify, revise or remove at S08
 */
/**
 * The export-job surface.
 *
 * This is the ADDITIVE EXPERIMENTAL export-job entry, declared beside the frozen
 * `ExportProvider` (`export-provider.ts`, which stays byte-identical). **S08 owns
 * production export** and may ratify, revise, or remove this surface outright —
 * that is precisely what the experimental classification buys: monotone growth
 * without a frozen-surface revision.
 *
 * **What forced the shape** (the change's Part 1 audit, `design.md`):
 *
 * - **F1 — no job identity.** The frozen `export(): Promise<ExportOutcome>` is an
 *   anonymous promise. Production needs an addressable job: observable,
 *   cancellable, discoverable after death, restartable. Hence `jobId` and
 *   snapshots.
 * - **F2 — no progress channel.** The donor renders with an internal progress
 *   callback the port has nowhere to put. Hence `progress`, `frames`, and
 *   `onJobEvent`.
 * - **F3 — no cancellation.** The donor cancels by a polled internal flag the
 *   contract cannot carry. Hence the two-step `requestCancel` / `confirmCancelled`.
 * - **F4 — `bytes: ArrayBuffer` is whole-file-in-memory and destination-blind.**
 *   Hence `ExportJobOutput.descriptor`: an opaque string that names the output to
 *   the provider (never a filesystem path — "reveal in folder" is a provider-side
 *   action, and no renderer-facing value here may smuggle a location), plus
 *   `readJobOutputBytes` as the explicit bytes bridge that keeps the frozen
 *   promise semantics implementable on top.
 * - **F5 — no recovery.** Cancel or crash destroys everything in the donor. Hence
 *   the `interrupted` phase (a discovery state: persisted record, dead producer —
 *   conflating it with `failed` would lose "resume is possible") and `resume`
 *   with frame counts preserved.
 *
 * Two structural decisions recorded by the change's design (D1/D2), restated
 * here because a reader of this file will otherwise re-derive them wrongly:
 *
 * - **Why a separate subpath and not a widened role:** the ports barrel
 *   `index.ts` is byte-frozen; `EditorHostPorts.exporter` cannot widen without
 *   editing it. An exports-map addition is the sanctioned additive move.
 * - **Why the reference implementation lives in this file and not beside
 *   `UnsupportedExportProvider`:** `./in-memory` is a frozen-classified entry
 *   whose file must carry no markers and no experimental-class symbols.
 *   Self-containment also means this entry edits no existing ports source file.
 *
 * **The store is the semantic SSOT.** `ExportJobStore` is a pure reducer — no
 * IO, no timers, no wall clock. Every transition returns a NEW store (the
 * repo's value style); illegal transitions throw `ExportJobTransitionError`,
 * because the state machine is the contract. Both the in-memory provider below
 * and a real desktop job manager transition through it, so the mutation-verified
 * suite proves the semantics once and every implementation inherits the proofs.
 *
 * **Clock discipline.** The reducer never calls `Date.now()`; every
 * event-producing transition takes an optional `now` in its single options
 * object, which lands in the event's `at`, and an omitted `now` continues a
 * monotonic sequence ordinal (`lastAt + 1`). Tests are therefore deterministic;
 * the provider passes its `clock()` at its boundary, which defaults to
 * `Date.now`.
 *
 * **Progress scales.** Each live phase reports on its own `[0, 1]` scale —
 * rendering as accepted/total frames, encoding as the encoder's own time
 * progress (the transition to `encoding` resets the scale, and the phase travels
 * with every snapshot so a consumer composing a single bar knows which scale it
 * is reading; the donor itself composes phases onto one bar with reserved
 * shares). Within a phase, progress never decreases: `acceptFrames` only grows
 * the accepted count and `setEncodeProgress` refuses a lower value outright.
 * `completed` settles at exactly `1`; failure, cancellation, and interruption
 * freeze the last live value.
 */
import type { ProjectId } from "./identity";

/**
 * A container hint. The donor de-facto set is spelled literally for completion,
 * but the type stays open — F7 (the format set is unfixed) is S08's to close,
 * and the runtime here accepts any non-empty string for the same reason: a
 * Host exercising an exotic container against the reference must not be blocked
 * by a policy call this surface does not own.
 */
export type ExportJobFormat = "mp4" | "webm" | (string & {});

/** The donor's quality ladder, verbatim. */
export type ExportJobQuality = "low" | "medium" | "high" | "very_high";

/** One export job to start. The provider validates what it can (see `startJob`). */
export interface ExportJobRequest {
	readonly projectId: ProjectId;
	readonly format: ExportJobFormat;
	readonly quality?: ExportJobQuality;
	readonly includeAudio?: boolean;
	/**
	 * Mirrors opencut-wasm's `FrameRate { numerator, denominator }` shape
	 * WITHOUT importing it — this package has zero dependencies by contract,
	 * so the shape is spelled structurally and stays compatible by value.
	 */
	readonly fps?: { readonly numerator: number; readonly denominator: number };
}

/**
 * The fixed phase set. `interrupted` is a discovery state, not a live phase: a
 * persisted record whose producer died. Only `queued`, `rendering`, and
 * `encoding` are live; `completed`, `failed`, and `cancelled` are settled.
 */
export type ExportJobPhase =
	| "queued"
	| "rendering"
	| "encoding"
	| "completed"
	| "failed"
	| "cancelled"
	| "interrupted";

/**
 * A completed job's output, named opaquely. The descriptor is a provider-chosen
 * string that identifies the output to the provider (the in-memory reference
 * uses `memory:<jobId>`); it is **never a filesystem path** — no
 * renderer-facing value in this surface may carry a location. `bytes` is the
 * output's size in bytes, matching what `readJobOutputBytes` returns.
 */
export interface ExportJobOutput {
	readonly descriptor: string;
	readonly bytes: number;
}

/**
 * One observation of a job. Poll `getJob`/`listJobs` for these, or subscribe
 * through `onJobEvent` for push-style delivery of the same information.
 */
export interface ExportJobSnapshot {
	readonly jobId: string;
	readonly request: ExportJobRequest;
	readonly phase: ExportJobPhase;
	/** Phase-local progress in `[0, 1]` (see "Progress scales" above). */
	readonly progress: number;
	readonly output: ExportJobOutput | null;
	readonly error: string | null;
	/** Present once rendering has begun; preserved through every later phase. */
	readonly frames: Readonly<{ accepted: number; total: number }> | null;
}

/**
 * What a job reports as it moves. `at` is the caller-supplied clock value (or
 * the store's sequence ordinal) at the transition — the reducer itself never
 * reads a wall clock.
 */
export type ExportJobEvent =
	| { readonly type: "phase"; readonly phase: ExportJobPhase; readonly at: number }
	| {
			readonly type: "progress";
			readonly progress: number;
			readonly frames?: Readonly<{ accepted: number; total: number }>;
			readonly at: number;
	  }
	| {
			readonly type: "settled";
			readonly phase: "completed" | "failed" | "cancelled";
			readonly output?: ExportJobOutput;
			readonly error?: string;
			readonly at: number;
	  };

/**
 * The named refusal the state machine throws: an illegal transition, an
 * out-of-contract input, or work offered after a cancel request. The state
 * machine is the contract, so the contract's violations are typed.
 */
export class ExportJobTransitionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExportJobTransitionError";
	}
}

/**
 * A provider-level failure: unknown job id, an invalid start request, or bytes
 * asked of a job that never completed. The store never throws this — it is the
 * provider's own vocabulary, typed for the same reason the store's is.
 */
export class ExportJobError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExportJobError";
	}
}

interface ExportJobStoreState {
	readonly jobId: string;
	readonly request: ExportJobRequest;
	readonly phase: ExportJobPhase;
	readonly progress: number;
	readonly frames: Readonly<{ accepted: number; total: number }> | null;
	readonly output: ExportJobOutput | null;
	readonly error: string | null;
	readonly cancelRequested: boolean;
	readonly events: readonly ExportJobEvent[];
	readonly lastAt: number;
}

const SETTLED_PHASES: readonly ExportJobPhase[] = [
	"completed",
	"failed",
	"cancelled",
];

/**
 * The export-job state machine — pure, immutable, the semantic SSOT.
 *
 * Every transition validates, then returns a NEW store; the receiver is left
 * untouched. Snapshots and events are defensively built fresh values — mutating
 * a returned object does not alter the machine. Each transition takes a single
 * options object (the package's own idiom) whose optional `now` supplies the
 * clock (see "Clock discipline" in the module docblock).
 *
 * Transition table, so the contract reads in one place:
 *
 * - `open`                       → `queued`, progress 0.
 * - `beginRendering`             `queued` → `rendering`; `totalFrames` must be
 *                                 a positive integer; frames start at 0/total.
 * - `acceptFrames`               `rendering` only; `count` a positive integer;
 *                                 accepted + count must not exceed total
 *                                 (OVERFLOW THROWS — the chosen and documented
 *                                 behavior: an overshoot is a producer bug the
 *                                 contract should surface, not absorb);
 *                                 progress = accepted/total; refuses to run
 *                                 after `beginEncoding` (throws) and after a
 *                                 cancel request (throws).
 * - `beginEncoding`              `rendering` only, and only when
 *                                 accepted === total — frame accuracy is a
 *                                 state-machine property, not a producer
 *                                 promise. Resets the progress scale to 0.
 * - `setEncodeProgress`          `encoding` only; clamps to `[0, 1]`, then
 *                                 REFUSES a decrease (throws) — monotonicity
 *                                 within the phase is enforced, not assumed.
 * - `complete`                   `encoding` only; descriptor non-empty, bytes a
 *                                 non-negative integer; settles at progress 1.
 *                                 After a cancel request it throws: a completed
 *                                 output that ignored a cancel is a missed
 *                                 cancel.
 * - `fail`                       any live phase (including after a cancel
 *                                 request — a producer can die mid-cancel);
 *                                 freezes progress.
 * - `requestCancel`              any live phase; records the intent, emits no
 *                                 event. In `queued` there is nothing to clean,
 *                                 so a caller may confirm immediately — the
 *                                 mechanism is uniformly two-step.
 * - `confirmCancelled`           only after `requestCancel`; settles `cancelled`
 *                                 and freezes progress. The two steps exist so
 *                                 a real producer can clean resources (kill the
 *                                 encoder, delete the raw stream) between
 *                                 intent and settlement.
 * - `interrupt`                  any live phase → `interrupted`; frames and
 *                                 progress are kept (F5's discovery state).
 * - `resume`                     `interrupted` → `rendering`, frames kept,
 *                                 total preserved. When accepted === total at
 *                                 interruption (an encode-phase death), the
 *                                 resumed producer goes straight to
 *                                 `beginEncoding`.
 *
 * **Discard is a removal, not a phase.** There is no `discard()` transition and
 * no `"discarded"` phase: `discardable()` is the guard and the provider deletes
 * the job (record, artifacts, bytes). It is false only inside the cancel window
 * (cancel requested, not yet confirmed) — removal there would race the very
 * cleanup the window exists for. Every departure from a live phase closes the
 * window (`confirmCancelled`, `fail`, and `interrupt` all clear the pending
 * flag — the window belongs to the producer that opened it, and a resumed job
 * must not inherit a secret cancel it cannot even observe). A settled job is
 * discardable: removing a completed output is a legitimate discard, and
 * "discoverable after death" never means "undeletable".
 */
export class ExportJobStore {
	private constructor(private readonly state: ExportJobStoreState) {}

	/** Open a job in `queued` with progress 0, emitting the first phase event. */
	static open(args: {
		jobId: string;
		request: ExportJobRequest;
		now?: number;
	}): ExportJobStore {
		const at = args.now ?? 0;
		return new ExportJobStore({
			jobId: args.jobId,
			request: args.request,
			phase: "queued",
			progress: 0,
			frames: null,
			output: null,
			error: null,
			cancelRequested: false,
			events: [{ type: "phase", phase: "queued", at }],
			lastAt: at,
		});
	}

	private requireLive(method: string): void {
		const { phase } = this.state;
		if (phase !== "queued" && phase !== "rendering" && phase !== "encoding") {
			throw new ExportJobTransitionError(
				`${method}: illegal from phase "${phase}" — only queued, rendering, or encoding are live`,
			);
		}
	}

	private requireNoPendingCancel(method: string): void {
		if (this.state.cancelRequested) {
			throw new ExportJobTransitionError(
				`${method}: a cancel was requested — work must stop before the job settles`,
			);
		}
	}

	private static positiveInteger(args: {
		method: string;
		name: string;
		value: number;
	}): number {
		if (!Number.isInteger(args.value) || args.value < 1) {
			throw new ExportJobTransitionError(
				`${args.method}: ${args.name} must be a positive integer, got ${String(args.value)}`,
			);
		}
		return args.value;
	}

	/** Build the next store: patch the state, append the event, advance the clock. */
	private step(args: {
		patch: Partial<ExportJobStoreState>;
		event: ExportJobEvent;
		now?: number;
	}): ExportJobStore {
		const at = args.now ?? this.state.lastAt + 1;
		return new ExportJobStore({
			...this.state,
			...args.patch,
			events: [...this.state.events, args.event],
			lastAt: at,
		});
	}

	/** The `at` a transition with this `now` (or the next sequence ordinal) lands on. */
	private atFor(now?: number): number {
		return now ?? this.state.lastAt + 1;
	}

	beginRendering(args: { totalFrames: number; now?: number }): ExportJobStore {
		this.requireLive("beginRendering");
		this.requireNoPendingCancel("beginRendering");
		ExportJobStore.positiveInteger({
			method: "beginRendering",
			name: "totalFrames",
			value: args.totalFrames,
		});
		const frames = { accepted: 0, total: args.totalFrames };
		return this.step({
			patch: { phase: "rendering", frames },
			event: { type: "phase", phase: "rendering", at: this.atFor(args.now) },
			now: args.now,
		});
	}

	acceptFrames(args: { count: number; now?: number }): ExportJobStore {
		this.requireLive("acceptFrames");
		this.requireNoPendingCancel("acceptFrames");
		ExportJobStore.positiveInteger({
			method: "acceptFrames",
			name: "count",
			value: args.count,
		});
		const { frames } = this.state;
		// beginRendering always set frames before leaving "queued", but the state
		// is typed honestly: rendering without frames is impossible by
		// construction, not by hope.
		if (frames === null) {
			throw new ExportJobTransitionError("acceptFrames: rendering began without a frame budget");
		}
		const accepted = frames.accepted + args.count;
		if (accepted > frames.total) {
			throw new ExportJobTransitionError(
				`acceptFrames: ${String(accepted)} would exceed the total ${String(frames.total)} — a frame overshoot is a producer bug the contract surfaces, not absorbs`,
			);
		}
		const next = { accepted, total: frames.total };
		const progress = accepted / frames.total;
		return this.step({
			patch: { frames: next, progress },
			event: { type: "progress", progress, frames: next, at: this.atFor(args.now) },
			now: args.now,
		});
	}

	beginEncoding(args: { now?: number } = {}): ExportJobStore {
		this.requireLive("beginEncoding");
		this.requireNoPendingCancel("beginEncoding");
		const { frames } = this.state;
		if (frames === null || frames.accepted !== frames.total) {
			throw new ExportJobTransitionError(
				"beginEncoding: every frame must be accepted first — frame accuracy is a state-machine property, not a producer promise",
			);
		}
		return this.step({
			patch: { phase: "encoding", progress: 0 },
			event: { type: "phase", phase: "encoding", at: this.atFor(args.now) },
			now: args.now,
		});
	}

	setEncodeProgress(args: { progress: number; now?: number }): ExportJobStore {
		this.requireLive("setEncodeProgress");
		this.requireNoPendingCancel("setEncodeProgress");
		if (!Number.isFinite(args.progress)) {
			throw new ExportJobTransitionError(
				`setEncodeProgress: progress must be a finite number, got ${String(args.progress)}`,
			);
		}
		const clamped = Math.min(1, Math.max(0, args.progress));
		if (clamped < this.state.progress) {
			throw new ExportJobTransitionError(
				`setEncodeProgress: ${String(clamped)} would decrease from ${String(this.state.progress)} — encode progress is monotonic within the phase`,
			);
		}
		return this.step({
			patch: { progress: clamped },
			event: { type: "progress", progress: clamped, at: this.atFor(args.now) },
			now: args.now,
		});
	}

	complete(args: { output: ExportJobOutput; now?: number }): ExportJobStore {
		if (this.state.phase !== "encoding") {
			throw new ExportJobTransitionError(
				`complete: illegal from phase "${this.state.phase}" — only encoding completes`,
			);
		}
		this.requireNoPendingCancel("complete");
		const { output } = args;
		if (
			typeof output.descriptor !== "string" ||
			output.descriptor.length === 0 ||
			!Number.isInteger(output.bytes) ||
			output.bytes < 0
		) {
			throw new ExportJobTransitionError(
				"complete: output needs a non-empty descriptor and a non-negative integer byte count",
			);
		}
		return this.step({
			patch: { phase: "completed", output, progress: 1 },
			event: { type: "settled", phase: "completed", output, at: this.atFor(args.now) },
			now: args.now,
		});
	}

	fail(args: { reason: string; now?: number }): ExportJobStore {
		this.requireLive("fail");
		if (typeof args.reason !== "string" || args.reason.length === 0) {
			throw new ExportJobTransitionError("fail: reason must be a non-empty string");
		}
		return this.step({
			patch: { phase: "failed", error: args.reason, cancelRequested: false },
			event: { type: "settled", phase: "failed", error: args.reason, at: this.atFor(args.now) },
			now: args.now,
		});
	}

	/** Record the intent to cancel. Emits no event; the settled event comes at confirm. */
	requestCancel(): ExportJobStore {
		this.requireLive("requestCancel");
		return new ExportJobStore({ ...this.state, cancelRequested: true });
	}

	confirmCancelled(args: { now?: number } = {}): ExportJobStore {
		this.requireLive("confirmCancelled");
		if (!this.state.cancelRequested) {
			throw new ExportJobTransitionError(
				"confirmCancelled: no cancel was requested — requestCancel comes first",
			);
		}
		return this.step({
			patch: { phase: "cancelled", cancelRequested: false },
			event: { type: "settled", phase: "cancelled", at: this.atFor(args.now) },
			now: args.now,
		});
	}

	interrupt(args: { now?: number } = {}): ExportJobStore {
		this.requireLive("interrupt");
		// Interruption closes a pending cancel window along with the live phase:
		// the window belongs to the producer that requested the cancel, and it
		// dies with that producer. A hidden pending cancel that survived into
		// `interrupted` would make the resumed job unable to accept any work
		// (every work transition refuses a pending cancel) — a resume trap, not
		// a recovery. Whether a resumed job should in fact continue is the
		// owning manager's policy call, made on the visible record, not a
		// secret flag's.
		return this.step({
			patch: { phase: "interrupted", cancelRequested: false },
			event: { type: "phase", phase: "interrupted", at: this.atFor(args.now) },
			now: args.now,
		});
	}

	resume(args: { now?: number } = {}): ExportJobStore {
		if (this.state.phase !== "interrupted") {
			throw new ExportJobTransitionError(
				`resume: illegal from phase "${this.state.phase}" — only interrupted resumes`,
			);
		}
		return this.step({
			patch: { phase: "rendering" },
			event: { type: "phase", phase: "rendering", at: this.atFor(args.now) },
			now: args.now,
		});
	}

	/**
	 * Whether the provider may remove this job. False only inside the cancel
	 * window (see the class docblock); true for every phase, live or settled.
	 */
	discardable(): boolean {
		return !this.state.cancelRequested;
	}

	/** The current observation, defensively built. */
	snapshot(): ExportJobSnapshot {
		const { state } = this;
		const frames = state.frames ? { ...state.frames } : null;
		return Object.freeze({
			jobId: state.jobId,
			request: state.request,
			phase: state.phase,
			progress: state.progress,
			output: state.output,
			error: state.error,
			frames,
		});
	}

	/** Every event since `open`, in order. */
	events(): readonly ExportJobEvent[] {
		return this.state.events;
	}
}

/**
 * The port interface: an addressable, observable, cancellable, recoverable
 * export job manager. A poll-only consumer can ignore `onJobEvent` entirely;
 * every observation is also reachable through `getJob`/`listJobs`.
 */
export interface ExportJobProvider {
	listJobs(): readonly ExportJobSnapshot[];
	canStartJob(args: { request: ExportJobRequest }): boolean;
	startJob(args: { request: ExportJobRequest }): Promise<{ jobId: string }>;
	getJob(args: { jobId: string }): ExportJobSnapshot | null;
	cancelJob(args: { jobId: string }): Promise<ExportJobSnapshot>;
	resumeJob(args: { jobId: string }): Promise<{ jobId: string }>;
	discardJob(args: { jobId: string }): Promise<void>;
	onJobEvent(args: {
		jobId: string;
		handler: (event: ExportJobEvent) => void;
	}): { unsubscribe(): void };
	readJobOutputBytes(args: { jobId: string }): Promise<ArrayBuffer>;
}

interface ProviderOptions {
	/** The clock whose values land in event `at`s. Defaults to `Date.now`. */
	readonly clock?: () => number;
	/**
	 * How the reference schedules its next synthetic step. Defaults to
	 * `queueMicrotask`; tests inject a manual queue for determinism.
	 *
	 * Why a microtask and not a timer: this file sits inside the C6
	 * session-resource boundary's scanned sources, where direct timer
	 * acquisition (`setTimeout` et al.) is a violation — editor code schedules
	 * timers through the session's resource registry, which a zero-dependency
	 * ports reference has no access to. A microtask chain is not a timer
	 * resource (it cannot be cancelled, and cannot outlive its job: every step
	 * re-checks the store before doing work), which makes it the honest
	 * default for a synthetic reference rather than an exemption to be begged
	 * from the checker.
	 */
	readonly scheduler?: (fn: () => void) => void;
}

interface JobRecord {
	readonly jobId: string;
	store: ExportJobStore;
	emitted: number;
	readonly subscribers: Set<(event: ExportJobEvent) => void>;
	outputBytes: ArrayBuffer | null;
}

/** The reference's synthetic job shape: 1 s at 30 fps, three frame batches, two encode steps. */
const REFERENCE_TOTAL_FRAMES = 30;
const REFERENCE_FRAME_BATCH = 10;
const REFERENCE_ENCODE_STEP = 0.5;
const REFERENCE_OUTPUT_BYTES = 64;

/**
 * The in-memory reference implementation: conforming, non-producing.
 *
 * It accepts jobs and advances them through synthetic phases on the injected
 * (or default) scheduler, honors cancel and resume, persists nothing, and
 * renders nothing — a job's "output" is `REFERENCE_OUTPUT_BYTES` zero bytes
 * under the opaque `memory:<jobId>` descriptor. It exists so the lifecycle
 * semantics are exercisable without any process, IPC, or binary (the same
 * reason `ExportJobStore` is exported), and so a Host author can compose
 * headlessly.
 *
 * The provider transitions ONLY through `ExportJobStore` — every advance step
 * is a store transition, so the mutation-verified semantics carry over. The
 * reference has no encoder process or raw stream to clean, so `cancelJob`
 * confirms immediately; the two-step exists for real producers, and this
 * implementation documents by doing that it has nothing between the steps.
 *
 * **Interrupt/resume at the provider level:** the reference has no producer
 * that can die, so `__interrupt(jobId)` exists as a documented test-only hook
 * to place a job in `interrupted`; the store-level interrupt/resume semantics
 * are tested directly against `ExportJobStore`. (The alternative — driving the
 * store directly for everything — would leave `resumeJob`'s provider path
 * unexercised, which is the one path a real Host composes.)
 */
export class InMemoryExportJobProvider implements ExportJobProvider {
	private readonly clock: () => number;
	private readonly scheduler: (fn: () => void) => void;
	private readonly jobs = new Map<string, JobRecord>();
	private nextJobNumber = 1;

	constructor(options: ProviderOptions = {}) {
		this.clock = options.clock ?? (() => Date.now());
		this.scheduler = options.scheduler ?? ((fn) => queueMicrotask(fn));
	}

	listJobs(): readonly ExportJobSnapshot[] {
		return [...this.jobs.values()].map((record) => record.store.snapshot());
	}

	canStartJob(args: { request: ExportJobRequest }): boolean {
		// Truthful rather than unconditional: the reference starts anything its
		// own startJob would accept (an invalid request answers false here and
		// throws there — same judgment, two honest shapes).
		return InMemoryExportJobProvider.validateRequest(args.request) === null;
	}

	async startJob(args: { request: ExportJobRequest }): Promise<{ jobId: string }> {
		const invalid = InMemoryExportJobProvider.validateRequest(args.request);
		if (invalid !== null) throw new ExportJobError(`startJob: ${invalid}`);
		const jobId = `job-${String(this.nextJobNumber)}`;
		this.nextJobNumber += 1;
		const record: JobRecord = {
			jobId,
			store: ExportJobStore.open({
				jobId,
				request: args.request,
				now: this.clock(),
			}),
			emitted: 0,
			subscribers: new Set(),
			outputBytes: null,
		};
		this.jobs.set(jobId, record);
		this.emitNewEvents(record);
		this.scheduleAdvance(jobId);
		return { jobId };
	}

	getJob(args: { jobId: string }): ExportJobSnapshot | null {
		return this.jobs.get(args.jobId)?.store.snapshot() ?? null;
	}

	async cancelJob(args: { jobId: string }): Promise<ExportJobSnapshot> {
		const record = this.requireJob({ method: "cancelJob", jobId: args.jobId });
		const snapshot = record.store.snapshot();
		if (SETTLED_PHASES.includes(snapshot.phase)) {
			// Idempotent by contract: a second cancel, or a cancel after
			// completion, reports the settled state and does no work.
			return snapshot;
		}
		if (snapshot.phase === "interrupted") {
			throw new ExportJobError(
				"cancelJob: an interrupted job is neither live nor settled — resume it or discard it",
			);
		}
		record.store = record.store.requestCancel().confirmCancelled({ now: this.clock() });
		this.emitNewEvents(record);
		return record.store.snapshot();
	}

	async resumeJob(args: { jobId: string }): Promise<{ jobId: string }> {
		const record = this.requireJob({ method: "resumeJob", jobId: args.jobId });
		// The store throws ExportJobTransitionError unless the job is
		// interrupted — surfaced as-is, because phase legality is the store's
		// judgment to make, not the provider's.
		record.store = record.store.resume({ now: this.clock() });
		this.emitNewEvents(record);
		this.scheduleAdvance(args.jobId);
		return { jobId: args.jobId };
	}

	async discardJob(args: { jobId: string }): Promise<void> {
		const record = this.requireJob({ method: "discardJob", jobId: args.jobId });
		if (!record.store.discardable()) {
			throw new ExportJobError(
				"discardJob: a cancel was requested but not confirmed — finish the cancellation before removing the job",
			);
		}
		// Removal is the provider's: record, synthetic bytes, subscription set.
		this.jobs.delete(args.jobId);
	}

	onJobEvent(args: {
		jobId: string;
		handler: (event: ExportJobEvent) => void;
	}): { unsubscribe(): void } {
		const record = this.requireJob({ method: "onJobEvent", jobId: args.jobId });
		record.subscribers.add(args.handler);
		return {
			unsubscribe: () => {
				record.subscribers.delete(args.handler);
			},
		};
	}

	async readJobOutputBytes(args: { jobId: string }): Promise<ArrayBuffer> {
		const record = this.requireJob({ method: "readJobOutputBytes", jobId: args.jobId });
		const snapshot = record.store.snapshot();
		if (snapshot.phase !== "completed" || record.outputBytes === null) {
			throw new ExportJobError(
				"readJobOutputBytes: only a completed job has output bytes",
			);
		}
		// Defensive copy: a caller corrupting its copy must not reach the record.
		return record.outputBytes.slice(0);
	}

	/**
	 * TEST-ONLY hook: place a live job in `interrupted`, as a dead producer
	 * would leave it. Not part of `ExportJobProvider`; the conformance suite
	 * uses it to exercise the provider-level resume path. The store-level
	 * interrupt semantics are tested directly against `ExportJobStore`.
	 */
	__interrupt(jobId: string): void {
		const record = this.requireJob({ method: "__interrupt", jobId });
		record.store = record.store.interrupt({ now: this.clock() });
		this.emitNewEvents(record);
	}

	private requireJob(args: { method: string; jobId: string }): JobRecord {
		const record = this.jobs.get(args.jobId);
		if (record === undefined) {
			throw new ExportJobError(`${args.method}: no job "${args.jobId}"`);
		}
		return record;
	}

	private static validateRequest(request: ExportJobRequest): string | null {
		if (typeof request?.projectId !== "string" || request.projectId.length === 0) {
			return "a job needs a non-empty projectId";
		}
		if (typeof request.format !== "string" || request.format.length === 0) {
			return "a job needs a non-empty format";
		}
		if (
			request.fps !== undefined &&
			(!Number.isInteger(request.fps.numerator) ||
				!Number.isInteger(request.fps.denominator) ||
				request.fps.numerator < 1 ||
				request.fps.denominator < 1)
		) {
			return "fps needs positive integer numerator and denominator";
		}
		return null;
	}

	private scheduleAdvance(jobId: string): void {
		this.scheduler(() => this.advance(jobId));
	}

	/**
	 * One synthetic step, computed from the current snapshot rather than a
	 * fixed script — which is exactly why resume needs no special path: the
	 * same step rule continues an interrupted run from its persisted frames.
	 */
	private advance(jobId: string): void {
		const record = this.jobs.get(jobId);
		if (record === undefined) return; // discarded mid-flight
		const snapshot = record.store.snapshot();
		if (SETTLED_PHASES.includes(snapshot.phase) || snapshot.phase === "interrupted") {
			return; // settled or dead producer: no further synthetic work
		}
		let next: ExportJobStore;
		if (snapshot.phase === "queued") {
			next = record.store.beginRendering({
				totalFrames: REFERENCE_TOTAL_FRAMES,
				now: this.clock(),
			});
		} else if (snapshot.phase === "rendering") {
			const frames = snapshot.frames;
			if (frames !== null && frames.accepted < frames.total) {
				next = record.store.acceptFrames({
					count: Math.min(REFERENCE_FRAME_BATCH, frames.total - frames.accepted),
					now: this.clock(),
				});
			} else {
				next = record.store.beginEncoding({ now: this.clock() });
			}
		} else {
			if (snapshot.progress < 1) {
				next = record.store.setEncodeProgress({
					progress: Math.min(1, snapshot.progress + REFERENCE_ENCODE_STEP),
					now: this.clock(),
				});
			} else {
				const output: ExportJobOutput = {
					descriptor: `memory:${jobId}`,
					bytes: REFERENCE_OUTPUT_BYTES,
				};
				record.outputBytes = new ArrayBuffer(REFERENCE_OUTPUT_BYTES);
				next = record.store.complete({ output, now: this.clock() });
			}
		}
		record.store = next;
		this.emitNewEvents(record);
		const phase = next.snapshot().phase;
		if (!SETTLED_PHASES.includes(phase) && phase !== "interrupted") {
			this.scheduleAdvance(jobId);
		}
	}

	private emitNewEvents(record: JobRecord): void {
		const events = record.store.events();
		for (; record.emitted < events.length; record.emitted += 1) {
			const event = events[record.emitted];
			for (const handler of record.subscribers) handler(event);
		}
	}
}
