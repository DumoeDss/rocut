import type { MvColor, MvRole, MvSpan } from "./mv-recipe";

/** Explicit author colors; no original-song palette is injected. */
export interface MvConvergePalette {
	readonly background: readonly [MvColor, MvColor, MvColor];
	readonly shadow: MvColor;
	readonly dusk: MvColor;
	readonly verm: MvColor;
	readonly sunset: MvColor;
	readonly glow: MvColor;
	readonly hi: MvColor;
	readonly core: MvColor;
	readonly shard: {
		readonly body: MvColor;
		readonly rim: MvColor;
		readonly edge: MvColor;
	};
	readonly firefly: {
		readonly body: MvColor;
		readonly core: MvColor;
		readonly edge: MvColor;
	};
	readonly white: MvColor;
}
export interface MvConverge {
	/** uint32, wrapping-added to the programmatic source seed. */
	readonly seed: number;
	/** Safe integer absolute song ticks, strictly after this scene's start; may exceed its end. */
	readonly whiteAtTicks: number;
	readonly beats:
		| { readonly kind: "analysis" }
		| { readonly kind: "manual"; readonly songTicks: readonly number[] };
	readonly grain: number;
	readonly palette: MvConvergePalette;
}
export interface MvConvergeScene {
	readonly kind: "converge";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvConverge;
}
