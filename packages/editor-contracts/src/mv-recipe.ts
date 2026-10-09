import type { MvEffect } from "./mv-recipe-post";
import type { MvPostAutomation } from "./mv-recipe-post-automation";
import type { MvCompositionScene } from "./mv-recipe-composition";
import type { MvTransition } from "./mv-recipe-transition";
import type { MvSpriteStyle } from "./mv-recipe-sprite";
import type { MvGeneratorScene } from "./mv-recipe-generators";
import type { MvImageSequenceScene } from "./image-sequence";
import type { MvAfterimageScene } from "./mv-afterimage";
import type { MvTypeCardScene } from "./mv-type-card";
import type { MvConvergeScene } from "./mv-converge";
import type { MvEmberScene } from "./mv-ember";
import type { MvTitleRiffScene } from "./mv-title-riff";
import type { MvKanjiSlamScene } from "./mv-kanji-slam";
import type { MvThreadScene } from "./mv-thread";
import type { MvFallScene } from "./mv-fall";
import type { MvFlameScene } from "./mv-flame";
import type {
	MvAudioBinding,
	MvCameraAudio,
	MvPostAudio,
} from "./mv-recipe-audio";
export type { MvTransition } from "./mv-recipe-transition";

export type MvRole = "background" | "subject" | "graphics" | "foreground";
export type MvColor = readonly [number, number, number, number];
export type MvEase =
	| "linear"
	| "inOutSine"
	| "inOutCubic"
	| "inExpo"
	| "outExpo"
	| "inOutExpo"
	| "inQuad"
	| "outQuad";
export interface MvSpan {
	readonly startFrame: number;
	readonly durationFrames: number;
}
export interface MvCamera {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}
export interface MvPose {
	readonly x: number;
	readonly y: number;
	readonly height: number;
	readonly rotation: number;
	readonly opacity: number;
}
export interface MvOscillation {
	readonly amplitude: number;
	readonly frequency: number;
	readonly phase: number;
}
export interface MvSprite extends MvSpriteStyle {
	readonly image: string;
	readonly role: MvRole;
	readonly from: MvPose;
	readonly to: MvPose;
	readonly anchor: readonly [number, number];
	readonly flip?: boolean;
	readonly drawingFps?: number;
	readonly sway?: MvOscillation;
	readonly breathe?: MvOscillation;
}
export type MvScene =
	| MvFallScene
	| MvFlameScene
	| MvThreadScene
	| MvKanjiSlamScene
	| MvTitleRiffScene
	| MvEmberScene
	| MvConvergeScene
	| MvTypeCardScene
	| MvAfterimageScene
	| MvImageSequenceScene
	| MvGeneratorScene
	| MvCompositionScene
	| { readonly kind: "solid"; readonly role: MvRole; readonly color: MvColor }
	| {
			readonly kind: "illust";
			readonly motion: MvSpan;
			readonly easing: MvEase;
			readonly background?: {
				readonly image: string;
				readonly from: MvCamera;
				readonly to: MvCamera;
				readonly audio?: readonly MvCameraAudio[];
			};
			readonly sprites?: readonly MvSprite[];
	  }
	| {
			readonly kind: "transition";
			readonly from: string;
			readonly to: string;
			readonly span: MvSpan;
			readonly easing: MvEase;
			readonly style: MvTransition;
	  };

/** Parameters only. Rust validates every nested field, graph and resource before
 * persistence/evaluation; no authored expressions run in a declarative recipe. */
export interface MvRecipe {
	readonly version: 1;
	readonly root: string;
	readonly songStartSeconds: number;
	readonly outputRoles: readonly MvRole[];
	readonly nodes: readonly { readonly id: string; readonly scene: MvScene }[];
	readonly audio?: MvAudioBinding;
	readonly post?: readonly ({
		readonly effects: readonly MvEffect[];
		readonly automation?: readonly MvPostAutomation[];
		readonly audio?: readonly MvPostAudio[];
	} & (
		| { readonly stage?: "role"; readonly roles: readonly MvRole[] }
		| { readonly stage: "composite"; readonly roles?: readonly [] }
	))[];
}
