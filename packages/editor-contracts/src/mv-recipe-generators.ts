import type { MvGlyphRainScene, MvGlyphRainPlan } from "./mv-glyph-rain";
export type { MvGlyphRain } from "./mv-glyph-rain";
import type { MvEase, MvRole, MvSpan } from "./mv-recipe";
import type { MvAsciiSweep, MvAsciiSweepPlan } from "./mv-ascii-sweep";
import type { MvGridScene, MvGridPlan } from "./mv-grid";
import type { MvHexFloatScene, MvHexFloatPlan } from "./mv-hex-float";
import type { MvShatterScene, MvShatterPlan } from "./mv-shatter";
import type { MvClothScene, MvClothPlan } from "./mv-cloth";
import type {
	MvParticleScrollScene,
	MvParticleScrollPlan,
} from "./mv-particle-scroll";

export interface MvParticleReveal {
	readonly image: string;
	readonly columns: number;
	readonly rows: number;
	/** Normalized [left, top, width, height]. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	readonly scatter: number;
	readonly stagger: number;
	readonly spin: number;
	readonly startScale: number;
	readonly opacity: number;
	readonly direction: "in" | "out";
}

export type MvGeneratorScene =
	| MvClothScene
	| MvShatterScene
	| MvGridScene
	| MvHexFloatScene
	| MvParticleScrollScene
	| {
			readonly kind: "asciiSweep";
			readonly role: MvRole;
			readonly settings: MvAsciiSweep;
			readonly span: MvSpan;
			readonly easing: MvEase;
	  }
	| MvGlyphRainScene
	| {
			readonly kind: "particleReveal";
			readonly role: MvRole;
			readonly settings: MvParticleReveal;
			readonly span: MvSpan;
			readonly easing: MvEase;
	  };

/** Rust-produced geometry only, not an authoring format. */
export type MvGeneratorPlan =
	| MvClothPlan
	| MvShatterPlan
	| MvGridPlan
	| MvHexFloatPlan
	| MvParticleScrollPlan
	| {
			readonly kind: "asciiSweep";
			readonly role: MvRole;
			readonly data: MvAsciiSweepPlan;
	  }
	| MvGlyphRainPlan
	| {
			readonly kind: "particleReveal";
			readonly role: MvRole;
			readonly data: {
				readonly image: string;
				readonly rect: readonly [number, number, number, number];
				readonly fit: MvParticleReveal["fit"];
				readonly opacity: number;
				readonly fullImage: boolean;
				readonly particles: readonly {
					readonly uv: readonly [number, number, number, number];
					readonly offset: readonly [number, number];
					readonly scale: number;
					readonly rotation: number;
					readonly opacity: number;
				}[];
			};
	  };
