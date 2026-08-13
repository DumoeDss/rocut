/**
 * Graphics capability negotiation.
 *
 * The single most important thing about this file is that it holds **two**
 * types, not one, and collapsing them is the obvious mistake:
 *
 * - `EnvironmentCapabilities.describeGraphics()` is what the **Host declares**
 *   — either "detect it" or "treat this environment as having no rasterizer".
 * - `GraphicsCapabilityReport` is what the **runtime reports**. A Host never
 *   asserts it.
 *
 * Collapsing them breaks two acceptance clauses at once. Slice §3.5 needs a
 * *constructible* no-rasterizer Host, which only a Host-side **force** provides
 * without special hardware — S01 could never reach a configuration that rendered
 * the degraded-renderer banner. Slice §3.6 needs a report the Host **cannot
 * fake**, because the clause is that the answer is *truthful* on both backends,
 * with the selected backend recorded per run so a green cannot come from having
 * silently tested the same backend twice.
 */

/** Named as an enumeration on purpose — see `RuntimeGraphicsQuery`. */
export type GraphicsBackend = "webgl" | "webgpu";

/** What the Host declares about its environment. */
export type GraphicsDeclaration =
	| { readonly mode: "detect" }
	| { readonly mode: "force"; readonly rasterizer: "none" };

/**
 * Where a report's facts came from.
 *
 * `"unimplemented"` is deliberately expressible and deliberately visible. This
 * change declares the runtime query before the runtime can answer it, so the
 * placeholder must be able to say so rather than quietly reporting a plausible
 * number.
 */
export type GraphicsReportSource = "runtime" | "host-forced" | "unimplemented";

export type GraphicsCapabilityReport =
	| {
			readonly rasterizer: "none";
			readonly backend: null;
			/** A count, and here it is exactly zero. */
			readonly livePreviewLimit: 0;
			readonly reason: string;
			readonly source: GraphicsReportSource;
	  }
	| {
			readonly rasterizer: "gpu";
			readonly backend: GraphicsBackend;
			/**
			 * How many live previews the runtime can drive.
			 *
			 * A **count**, not a flag. The Slice Plan names the exact failure this
			 * prevents — "C1 declaring, say, a preview count while C0b exports a
			 * boolean" — and a count is correct on its own terms: the Host's real
			 * question is "how many preview surfaces may I lay out?", which a
			 * boolean cannot answer and cannot grow to answer.
			 *
			 * Per ruling D9=(B): more than one on WebGPU; one on WebGL, where the
			 * wgpu device is bound to a single canvas at device-creation time. The
			 * `1` branch is a first-class outcome, not an error state — E0's
			 * carried risk is that WebGL may well be the ordinary path rather than
			 * the degraded one.
			 */
			readonly livePreviewLimit: number;
			readonly source: GraphicsReportSource;
	  };

/**
 * The **runtime-side** query this contract expects, declared here before the
 * implementation that answers it exists.
 *
 * That inversion is the point. C0b authors the wasm export; landing the
 * TypeScript declaration first makes the two-sided seam a **compile-time**
 * contract, so an implementation of an incompatible shape fails to build rather
 * than failing at runtime — see
 * `__tests__/runtime-graphics-query.compile-guard.ts`, which asserts exactly
 * that a boolean-returning implementation is rejected.
 *
 * Both members are load-bearing in their type:
 * - `selectedBackend` returns an **enumeration**, so "did we get a GPU?" cannot
 *   be answered with a boolean that erases which backend it was.
 * - `concurrentCompositorInstances` returns a **count**, from which
 *   `livePreviewLimit` is *derived* rather than guessed.
 */
export interface RuntimeGraphicsQuery {
	/**
	 * The backend the runtime actually selected, or **`null` when it could not
	 * acquire a rasterizer at all**.
	 *
	 * The nullable case is not defensive typing. Without it the runtime side of
	 * this contract is *incapable* of reporting "no rasterizer", so a genuinely
	 * GPU-less machine under `{ mode: "detect" }` would get a fabricated
	 * `rasterizer: "gpu"` report — silent degradation, which is precisely the
	 * failure D9's honesty clause exists to prevent. The Host-side *force* covers
	 * the constructibility half of §3.5; this covers the truthfulness half of
	 * §3.6, and they are not interchangeable.
	 *
	 * Note that a no-rasterizer machine is the one configuration §3.5 fact 3
	 * records as **never having been tried**, so this branch must exist before
	 * anyone can try it.
	 */
	selectedBackend(): GraphicsBackend | null;
	/**
	 * How many compositor instances can be driven concurrently. A **count**.
	 * Meaningless — and required to be `0` — when `selectedBackend()` is `null`.
	 */
	concurrentCompositorInstances(): number;
	/**
	 * Why no rasterizer was available, when `selectedBackend()` is `null`.
	 * Required because a no-rasterizer report must carry a stated reason.
	 */
	unavailableReason?(): string;
}

/**
 * Marks an implementation as not yet able to answer honestly.
 *
 * A brand on the *object* rather than a `runtimeSource` parameter on
 * `deriveGraphicsReport`. That parameter was an escape hatch: any caller could
 * stamp `source: "runtime"` onto the placeholder, defeating the marker whose
 * entire job is to stop an un-replaced placeholder from being mistaken for a
 * measurement. Reference identity against the placeholder was fragile for the
 * mirror-image reason — a wrapper or a spread silently reported `"runtime"`.
 */
export const UNIMPLEMENTED_MARKER = Symbol.for(
	"opencut.graphics.unimplemented",
);

/**
 * The placeholder this change ships so the declaration is not merely aspirational.
 *
 * It reports `source: "unimplemented"`. It must be replaced by C0b, and the
 * marker is what makes an un-replaced placeholder visible in a report rather
 * than indistinguishable from a real measurement of a single-preview machine.
 */
export const UNIMPLEMENTED_RUNTIME_GRAPHICS: RuntimeGraphicsQuery & {
	[UNIMPLEMENTED_MARKER]: true;
} = {
	[UNIMPLEMENTED_MARKER]: true,
	selectedBackend: () => "webgl",
	concurrentCompositorInstances: () => 1,
};

/** What the Host implements. */
export interface EnvironmentCapabilities {
	describeGraphics(): GraphicsDeclaration;
}

/**
 * What the session exposes. Produced from the runtime, never from the Host's
 * assertion — except for the one case the Host is *entitled* to force, which is
 * "no rasterizer", and which is reported as `host-forced` so it is never
 * mistaken for a measurement.
 */
export interface SessionCapabilities {
	graphics(): Promise<GraphicsCapabilityReport>;
}

function sourceOf(runtime: RuntimeGraphicsQuery): GraphicsReportSource {
	return (runtime as { [UNIMPLEMENTED_MARKER]?: boolean })[
		UNIMPLEMENTED_MARKER
	] === true
		? "unimplemented"
		: "runtime";
}

/**
 * Derive the report. The only place the two sides meet.
 *
 * A forced no-rasterizer declaration short-circuits: the runtime is not
 * consulted, because the whole point of the force is that it must work on
 * hardware that would answer differently.
 */
export function deriveGraphicsReport(args: {
	declaration: GraphicsDeclaration;
	runtime: RuntimeGraphicsQuery;
}): GraphicsCapabilityReport {
	const { declaration, runtime } = args;

	if (declaration.mode === "force") {
		return {
			rasterizer: "none",
			backend: null,
			livePreviewLimit: 0,
			reason: "host declared no rasterizer",
			source: "host-forced",
		};
	}

	const source = sourceOf(runtime);
	const backend = runtime.selectedBackend();

	// The detect branch must be able to reach the absent case, or a genuinely
	// GPU-less machine gets a fabricated "gpu" report.
	if (backend === null) {
		return {
			rasterizer: "none",
			backend: null,
			livePreviewLimit: 0,
			reason:
				runtime.unavailableReason?.() ??
				"the runtime reported no available graphics backend",
			source,
		};
	}

	// Reported verbatim, including zero. Clamping to one was the shape shipped
	// first, and it is the same fabrication M5 removed one level up, in the more
	// dangerous direction: a runtime that can drive **no** live preview would be
	// reported as able to drive one, and a Host that trusted the count would lay
	// out a surface that cannot render. A rasterizer with a zero preview budget is
	// a real state — a GPU acquired but no compositor instance available — and the
	// count exists to carry exactly that answer.
	const livePreviewLimit = runtime.concurrentCompositorInstances();
	return { rasterizer: "gpu", backend, livePreviewLimit, source };
}
