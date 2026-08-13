/**
 * The compile-time guard on the two-sided seam between this contract and C0b.
 *
 * This file has **no runtime assertions and is not a test**. It is checked by
 * `tsc` — which is exactly the point. The Slice Plan withdrew the `C0b ∥ C1`
 * concurrency edge because the two children own opposite ends of one interface,
 * and named the failure it feared: *"C1 declaring, say, a preview count while
 * C0b exports a boolean."* Landing the TypeScript declaration first turns that
 * failure from a runtime surprise into a build error.
 *
 * Every `@ts-expect-error` below is a **two-way** assertion: if the shape it
 * marks ever stops being an error, TypeScript reports the unused directive as an
 * error instead. So this file fails the build both if the guard breaks and if
 * the guard becomes vacuous.
 *
 * The file is named `.compile-guard.ts`, outside `bun test`'s globs
 * (`*.test.ts`, `*_test.ts`, `*.spec.ts`, `*_spec.ts`), so the runner does not
 * collect a file with nothing to run.
 */
import type {
	GraphicsBackend,
	RuntimeGraphicsQuery,
} from "../environment";
import type { GpuHandleId, RuntimeGpuResourceQuery } from "../gpu-resources";

/** The shape C0b owes. Compiles, and is what a correct implementation looks like. */
export const conformingRuntimeGraphics: RuntimeGraphicsQuery = {
	selectedBackend: (): GraphicsBackend => "webgpu",
	concurrentCompositorInstances: () => 2,
};

/**
 * A runtime that genuinely has no rasterizer must be expressible. If this
 * stopped compiling, the report side could no longer say "no rasterizer" and a
 * GPU-less machine would silently get a fabricated `"gpu"` report.
 */
export const noRasterizerRuntimeIsExpressible: RuntimeGraphicsQuery = {
	selectedBackend: () => null,
	concurrentCompositorInstances: () => 0,
	unavailableReason: () => "no adapter",
};

/**
 * A C0b that exported a boolean "do we have a GPU?" instead of the backend
 * enumeration. This is the exact failure mode the plan named.
 */
export const booleanBackendIsRejected: RuntimeGraphicsQuery = {
	// @ts-expect-error `boolean` is not a `GraphicsBackend`. A boolean cannot say
	// *which* backend was selected, and §3.6 requires the backend be recorded per
	// run so a green cannot come from silently testing the same one twice.
	selectedBackend: () => true,
	concurrentCompositorInstances: () => 2,
};

/**
 * A C0b that answered preview concurrency with a flag rather than a count.
 * A Host's real question is "how many preview surfaces may I lay out?", which a
 * boolean cannot answer and cannot grow to answer.
 */
export const booleanConcurrencyIsRejected: RuntimeGraphicsQuery = {
	selectedBackend: (): GraphicsBackend => "webgpu",
	// @ts-expect-error `boolean` is not a count.
	concurrentCompositorInstances: () => true,
};

/** A backend outside the enumeration is rejected too, not silently widened. */
export const unknownBackendIsRejected: RuntimeGraphicsQuery = {
	// @ts-expect-error "vulkan" is not a browser graphics backend this contract knows.
	selectedBackend: () => "vulkan",
	concurrentCompositorInstances: () => 1,
};

// ---------------------------------------------------------------------------
// The GPU-handle query. Same move, applied to the class the session cannot
// mediate acquisition of — so the runtime is compelled to expose what disposal
// reconciles against, rather than the registry being blind the way Elftia's
// `PluginDisposerRegistry` is.
// ---------------------------------------------------------------------------

/** The shape the wasm side owes. */
export const conformingRuntimeGpu: RuntimeGpuResourceQuery = {
	liveHandles: (): readonly GpuHandleId[] => [1, 2, 3],
	release: ({ handle }: { handle: GpuHandleId }) => {
		void handle;
	},
};

/**
 * A runtime that answered "do I still hold anything?" with a flag. A boolean
 * cannot be reconciled against the registry, so an untracked allocation would
 * stay invisible — exactly the blindness this query exists to remove.
 */
export const booleanLiveHandlesIsRejected: RuntimeGpuResourceQuery = {
	// @ts-expect-error a boolean cannot be reconciled against tracked handles.
	liveHandles: () => true,
	release: () => {},
};

/** A teardown that is not keyed by the handle is rejected. */
export const unkeyedTeardownIsRejected: RuntimeGpuResourceQuery = {
	liveHandles: () => [],
	// @ts-expect-error teardown must take the runtime's handle, not release everything.
	release: (all: boolean) => {
		void all;
	},
};
