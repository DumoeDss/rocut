import type { MvColor, MvRole, MvSpan } from "./mv-recipe";

/** Explicit scene colors; original-song defaults are never injected. */
export interface MvEmberPalette {
	readonly background: MvColor;
	readonly aura: MvColor;
	readonly dusk: MvColor;
	readonly verm: MvColor;
	readonly sunset: MvColor;
	readonly glow: MvColor;
	readonly hi: MvColor;
	readonly core: MvColor;
}
export type MvEmberBeats =
	| { readonly kind: "analysis" }
	| { readonly kind: "manual"; readonly songTicks: readonly number[] };
export interface MvEmberHud {
	/** Declared font resource; actual bytes and static variation axes are reused. */
	readonly font: string;
	readonly title: string;
	readonly clock: {
		readonly hour: number;
		readonly minute: number;
		readonly fps: number;
	};
}
interface MvEmberCommon {
	readonly palette: MvEmberPalette;
	readonly grain: number;
}
interface MvEmberHudScene extends MvEmberCommon {
	readonly beats: MvEmberBeats;
	readonly hud: MvEmberHud;
	/** Absolute song ticks; intervals are [start, end), not clip-local frames. */
	readonly stopsTicks: readonly (readonly [number, number])[];
}
export interface MvEmberBreathe extends MvEmberHudScene {
	readonly mode: "breathe";
	readonly flaresTicks: readonly (readonly [number, number])[];
	readonly thumpsTicks: readonly number[];
}
export interface MvEmberIgnite extends MvEmberHudScene {
	readonly mode: "ignite";
	readonly blackFrom:
		| { readonly kind: "lastBeat" }
		| { readonly kind: "at"; readonly songTicks: number };
	readonly crackAtTicks: number;
	readonly ring: number;
	/** Original crack geometry seed: 0 selects fallback 5. The programmatic
	 * source.seed does not alter Ember, including its fixed particle channels. */
	readonly seed: number;
}
export interface MvEmberCollapseKey {
	readonly songTicks: number;
	readonly factor: number;
	readonly easing: "out" | "in" | "io" | "soft" | "whip";
	readonly hit: boolean;
}
export interface MvEmberCollapse extends MvEmberCommon {
	readonly mode: "collapse";
	readonly image: string;
	/** Design-pixel focus offset, authored for this declared image. */
	readonly focus: readonly [number, number];
	readonly endTicks: number;
	readonly keys:
		| {
				readonly kind: "manual";
				readonly values: readonly MvEmberCollapseKey[];
		  }
		| { readonly kind: "analysis"; readonly beats: MvEmberBeats };
}
export type MvEmber = MvEmberBreathe | MvEmberIgnite | MvEmberCollapse;
export interface MvEmberScene {
	readonly kind: "ember";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvEmber;
}
