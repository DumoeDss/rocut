import type { MvColor, MvRole, MvSpan } from "./mv-recipe";

/** All positions: x / width, y / height. Sizes/tracking/radii use frame height. */
export interface MvTypeCardText {
	readonly font: string;
	readonly text: string;
	readonly position: readonly [number, number];
	readonly fontSize: number;
	readonly tracking: number;
	readonly color: MvColor;
}
export interface MvTypeCardQuiet {
	readonly mode: "quiet";
	readonly font: string;
	/** 1..128 single Unicode scalars with explicit optical size multipliers. */
	readonly glyphs: readonly {
		readonly text: string;
		readonly opticalScale: number;
	}[];
	readonly fontSize: number;
	readonly center: readonly [number, number];
	readonly orientation: "horizontal" | "vertical";
	/** Gap in base font-size units; timing fields are seconds. */
	readonly gap: number;
	readonly lead: number;
	readonly stagger: number;
	readonly fade: number;
	readonly color: MvColor;
	readonly background: MvColor;
	readonly rule: {
		readonly color: MvColor;
		readonly offset: number;
		readonly lengthScale: number;
		readonly lengthPadding: number;
		readonly width: number;
		readonly tickLength: number;
	} | null;
	readonly subtitle: MvTypeCardText | null;
	readonly grain: number;
}
export interface MvTypeCardPart {
	readonly text: string;
	readonly position: readonly [number, number];
	readonly fontSize: number;
}
export interface MvTypeCardLayout {
	readonly parts: readonly MvTypeCardPart[];
	readonly hold:
		| { readonly kind: "pulse"; readonly seconds: number }
		| { readonly kind: "sustain" };
	readonly glitch: number;
	readonly frame: {
		readonly rect: readonly [number, number, number, number];
		readonly color: MvColor;
		readonly width: number;
		readonly indicator: {
			readonly rect: readonly [number, number, number, number];
			readonly color: MvColor;
		};
	} | null;
	readonly kickGlow: {
		readonly center: readonly [number, number];
		readonly radius: number;
		readonly color: MvColor;
	} | null;
}
export interface MvTypeCardFlicker {
	readonly mode: "flicker";
	readonly font: string;
	readonly background: MvColor;
	/** Absolute song ticks (120000/second), or the recipe's reviewed analysis beats. */
	readonly beats:
		| { readonly kind: "analysis" }
		| { readonly kind: "manual"; readonly songTicks: readonly number[] };
	readonly layouts: readonly [
		MvTypeCardLayout,
		MvTypeCardLayout,
		MvTypeCardLayout,
		MvTypeCardLayout,
	];
	readonly rgbColors: readonly [MvColor, MvColor, MvColor];
	readonly noiseColors: readonly [MvColor, MvColor, MvColor];
	readonly scanlineOpacity: number;
	readonly idleScanColor: MvColor;
	readonly morse: {
		readonly elements: readonly (1 | 3)[];
		readonly position: readonly [number, number];
		readonly unit: number;
		readonly gap: number;
		readonly height: number;
		readonly litColor: MvColor;
		readonly unlitColor: MvColor;
		readonly label: MvTypeCardText;
	};
	readonly flood: {
		readonly center: readonly [number, number];
		readonly radiusFrom: number;
		readonly radiusTo: number;
		readonly colors: readonly [MvColor, MvColor, MvColor, MvColor];
		readonly white: MvColor;
	};
	readonly negative: MvTypeCardPart & { readonly color: MvColor };
	readonly grain: number;
}
export type MvTypeCard = MvTypeCardQuiet | MvTypeCardFlicker;
export interface MvTypeCardScene {
	readonly kind: "typeCard";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvTypeCard;
}
