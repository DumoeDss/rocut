import type { HyperframesNativePoint } from "./hyperframes-audio-graph-types";

/** An active native sync observation, not a canonical full-history fader. */
export interface HyperframesResolvedAuthorGainFacts {
	gainBeforeFades: number;
	source: "normalized-volume-lane" | "normalized-GSAP" | "fallback";
	/** Native normalized clip-local seconds; null when no envelope was observed. */
	points: HyperframesNativePoint[] | null;
	fades: { fadeIn: number; fadeOut: number };
	/** Native branch inputs are diagnostic facts, not a reconstructed decision. */
	fallback: {
		routed: boolean;
		previousRuntimeVolume: number | null;
		currentElementVolume: number;
		baselineGain: number;
	} | null;
}

export type HyperframesResolvedAuthorGain =
	| { state: "unobserved" }
	| (HyperframesResolvedAuthorGainFacts & {
			state: "observed";
			observedAt: number;
	  });
