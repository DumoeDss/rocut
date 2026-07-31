/**
 * The runtime-side GPU resource query — declared here, before the wasm side that
 * answers it exists.
 *
 * ## Why this file exists, stated plainly
 *
 * GPU resources are the one class the session **cannot** mediate acquisition
 * for: they are allocated inside the wasm module, so the session is not in their
 * construction path and there is no syntactic form a boundary check could scan
 * for. Without something else, the registry for this class is *exactly*
 * `PluginDisposerRegistry` — it sees only what someone remembered to hand it,
 * and a forgotten `trackGpuResource` is invisible.
 *
 * That would be the worst class to be blind on. It is the one the Slice records
 * as **demonstrably created** inside packaged Elftia — a real GPU context in all
 * four measured configurations — and **never measured for release**.
 *
 * So the mitigation is the same move used for `RuntimeGraphicsQuery`: freeze the
 * declaration before the implementation, so the wasm side is compelled to supply
 * it and an incompatible shape fails to compile. `liveHandles()` lets `dispose()`
 * **reconcile** the registry against what the runtime actually still holds, which
 * turns an untracked allocation into a *reported discrepancy* rather than into
 * nothing at all.
 *
 * This replaces an earlier, false claim that the session-minted resource id was
 * itself the teardown key. It was not — it was a session counter, with no type
 * linking it to anything in the runtime.
 */

/**
 * A handle key **minted by the runtime**, not by the session.
 *
 * This is the parameter the wasm teardown export takes. Typing it as its own
 * name rather than as a bare number is what makes "the tracked id is the
 * teardown's parameter" true rather than aspirational.
 */
export type GpuHandleId = number;

export interface RuntimeGpuResourceQuery {
	/**
	 * Every handle the runtime currently considers live.
	 *
	 * The reconciliation source. A handle here that the registry never saw is an
	 * untracked allocation — the exact blind spot this contract exists to avoid
	 * inheriting — and disposal reports it instead of ignoring it.
	 */
	liveHandles(): readonly GpuHandleId[];

	/** Release one. This is the wasm teardown export, keyed by the handle. */
	release(args: { handle: GpuHandleId }): void;
}

/**
 * The placeholder, marked so an un-replaced one is visible rather than
 * indistinguishable from a runtime that genuinely holds nothing.
 */
export const UNIMPLEMENTED_GPU_MARKER = Symbol.for(
	"opencut.gpu.unimplemented",
);

export const UNIMPLEMENTED_RUNTIME_GPU: RuntimeGpuResourceQuery & {
	[UNIMPLEMENTED_GPU_MARKER]: true;
} = {
	[UNIMPLEMENTED_GPU_MARKER]: true,
	liveHandles: () => [],
	release: () => {},
};

export function isUnimplementedGpuRuntime(
	runtime: RuntimeGpuResourceQuery,
): boolean {
	return (
		(runtime as { [UNIMPLEMENTED_GPU_MARKER]?: boolean })[
			UNIMPLEMENTED_GPU_MARKER
		] === true
	);
}

/**
 * What `dispose()` reports about handles the runtime still holds.
 *
 * Distinguishing "the runtime was never asked" from "the runtime holds nothing"
 * is the same distinction `created` vs `released` makes for the other four
 * classes, and it is required for the same reason: an unmeasured zero and a
 * clean zero must not look alike.
 */
export interface GpuReconciliation {
	readonly source: "runtime" | "unimplemented";
	/** Live in the runtime but never tracked by the session. */
	readonly untracked: readonly GpuHandleId[];
	/** Tracked and released by the session, yet still live in the runtime. */
	readonly leaked: readonly GpuHandleId[];
}
