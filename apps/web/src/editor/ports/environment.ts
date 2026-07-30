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
	selectedBackend(): GraphicsBackend;
	concurrentCompositorInstances(): number;
}

/**
 * The placeholder this change ships so the declaration is not merely aspirational.
 *
 * It reports `source: "unimplemented"`. It must be replaced by C0b, and the
 * marker is what makes an un-replaced placeholder visible in a report rather
 * than indistinguishable from a real measurement of a single-preview machine.
 */
export const UNIMPLEMENTED_RUNTIME_GRAPHICS: RuntimeGraphicsQuery = {
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
	runtimeSource?: GraphicsReportSource;
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

	const instances = runtime.concurrentCompositorInstances();
	return {
		rasterizer: "gpu",
		backend: runtime.selectedBackend(),
		livePreviewLimit: instances,
		source:
			args.runtimeSource ??
			(runtime === UNIMPLEMENTED_RUNTIME_GRAPHICS ? "unimplemented" : "runtime"),
	};
}
