/**
 * The session's resource registry.
 *
 * ## It mediates acquisition; it does not collect registrations
 *
 * E0 established that Elftia's `PluginDisposerRegistry` tracks only disposers
 * somebody explicitly registered, and is therefore blind to all five of timers,
 * Workers, audio contexts, object URLs and GPU resources. A `register(disposer)`
 * API **inherits that blindness by construction**, because a forgotten call is
 * invisible — there is nothing to notice.
 *
 * Mediating acquisition inverts it. A direct `setTimeout`, `new Worker`,
 * `new AudioContext` or `URL.createObjectURL` in editor source becomes a
 * detectable boundary violation (`script/check-port-boundary.mjs`) rather than a
 * leak, so the blind spot becomes a check failure.
 *
 * ## The one class that cannot be acquisition-mediated, and what closes it
 *
 * GPU resources are allocated *inside the wasm module*, so the session cannot be
 * in their construction path and no boundary check can scan for a syntactic
 * form. Tracking alone would leave this class as blind as
 * `PluginDisposerRegistry` — and it is the worst class to be blind on, being the
 * one demonstrably created inside packaged Elftia and never measured for
 * release.
 *
 * What closes it is **reconciliation**, not the tracking call:
 * `trackGpuResource` takes the runtime's own `GpuHandleId`, and `dispose()`
 * compares the registry against `RuntimeGpuResourceQuery.liveHandles()`. A
 * handle the runtime holds that the session never saw is reported as
 * `untracked`; one the session released that the runtime still holds is reported
 * as `leaked`. A forgotten `trackGpuResource` therefore becomes a *reported
 * discrepancy* rather than nothing.
 */
import type {
	AudioContextHandle,
	AudioContextRequest,
	GpuHandleId,
	GpuReconciliation,
	ObjectUrlHandle,
	ResourceId,
	WorkerHandle,
	WorkerRequest,
} from "@/editor/ports";

/**
 * The five classes, named. Not a generic `Disposable[]`: a class with no entries
 * must read as an explicit zero rather than as absence, and a list cannot do
 * that.
 */
export type SessionResourceClass =
	| "timer"
	| "worker"
	| "audioContext"
	| "objectUrl"
	| "gpuResource";

export const SESSION_RESOURCE_CLASSES = [
	"timer",
	"worker",
	"audioContext",
	"objectUrl",
	"gpuResource",
] as const satisfies readonly SessionResourceClass[];

export interface TimerHandle {
	readonly resourceId: ResourceId;
	readonly kind: "timeout" | "interval" | "animationFrame";
	cancel(): void;
}

export interface GpuResourceHandle {
	readonly resourceId: ResourceId;
	/** The runtime's own key. Also the teardown export's parameter. */
	readonly handle: GpuHandleId;
	readonly label: string;
	release(): void;
}

export interface SessionResourceRef {
	readonly resourceId: ResourceId;
	readonly resourceClass: SessionResourceClass;
}

export interface ResourceClassReport {
	readonly created: number;
	readonly released: number;
}

/**
 * What `dispose()` returns.
 *
 * `created` is in the report deliberately. E0's disposal numbers were unusable
 * because Workers, audio contexts and object URLs were **never created** in that
 * measurement — so they were *unmeasured, not clean*, and nothing in the numbers
 * distinguished the two. Reporting created alongside released makes C6's
 * "created before asserted released" obligation mechanical rather than something
 * C6 has to reconstruct from context.
 */
export interface DisposalReport {
	readonly timer: ResourceClassReport;
	readonly worker: ResourceClassReport;
	readonly audioContext: ResourceClassReport;
	readonly objectUrl: ResourceClassReport;
	readonly gpuResource: ResourceClassReport;
	/** What was actually released, in the order it was released. */
	readonly releaseOrder: readonly SessionResourceRef[];
	/**
	 * The registry checked against what the runtime still holds. This is what
	 * makes the un-mediated GPU class measurable rather than merely tracked.
	 */
	readonly gpuReconciliation: GpuReconciliation;
}

/**
 * Acquisition signatures derived from the editor's real call shapes, not
 * invented: one `new Worker(new URL("./worker.ts", import.meta.url), { type:
 * "module" })` site, ten `URL.createObjectURL(file | blob)` sites, and audio
 * contexts constructed with an optional `{ sampleRate }`.
 */
export interface SessionResources {
	setTimeout(args: { handler: () => void; ms: number }): TimerHandle;
	setInterval(args: { handler: () => void; ms: number }): TimerHandle;
	requestAnimationFrame(args: {
		handler: (time: number) => void;
	}): TimerHandle;

	createWorker(args: { request: WorkerRequest }): WorkerHandle;
	createAudioContext(args: {
		request?: AudioContextRequest;
	}): AudioContextHandle;
	createObjectUrl(args: { blob: Blob }): ObjectUrlHandle;

	/**
	 * See this file's header. The `handle` is the runtime's own key, so release
	 * goes through the runtime's teardown rather than through an opaque callback
	 * the session cannot relate to anything.
	 */
	trackGpuResource(args: {
		handle: GpuHandleId;
		label: string;
	}): GpuResourceHandle;

	/**
	 * A live count per class, without disposing.
	 *
	 * Every class is always present, so an untouched class reports zero rather
	 * than being missing from the object.
	 */
	inspect(): DisposalReport;
}
