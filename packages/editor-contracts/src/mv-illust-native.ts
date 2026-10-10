import type { MvColor, MvRole, MvSpan, MvEase } from "./mv-recipe";
import type { MvBurst, MvBurstView, MvBurstPlan } from "./mv-burst";
import type { MvEmberCommand } from "./mv-ember-plan";
import type { MvEmberPathStep } from "./mv-ember-path";
type Character = NonNullable<MvBurst["cuts"][number]["character"]>;
type Composite = "multiply"|"screen"|"soft-light"|"overlay"|"color"|"source-over"|"lighter"|"lighten";
export type MvIllustNativeGradient = { stops: readonly (readonly [number,MvColor])[]; amount?: number; composite?: Composite };
type Entrance = { at?: number; duration?: number; dx?: number; dy?: number; ds?: number; rotation?: number; alpha?: boolean; easing?: MvEase };
type Underlay = { color?: MvColor; offset?: readonly [number,number]; amount?: number };
export type MvIllustNativeActor = { sprite: Character; to?: readonly [number,number,number]; easing?: MvEase; drawingFps?: number;
	entrance?: Entrance; exit?: Entrance; beatBump?: number; shadow?: Underlay; rim?: Underlay; silhouette?: MvColor;
	glowAt?: readonly [number,number,number]; glowColor?: MvColor; glowAmount?: number; role?: MvRole };
type Particle = { n?: number; seed?: number; color?: MvColor };
export type MvIllustNativeFx =
	| (Particle & { type: "embers"; area?: readonly [number,number,number,number]; rise?: number; size?: number; wind?: number; alpha?: number })
	| (Particle & { type: "fireflies"; area?: readonly [number,number,number,number]; size?: number; alpha?: number })
	| (Particle & { type: "rain"; angle?: number; speed?: number; len?: number; width?: number })
	| (Particle & { type: "dust" })
	| (Particle & { type: "feathers"; size?: number; line?: MvColor })
	| (Particle & { type: "rays"; x:number; y:number; len?:number; amount?:number })
	| { type:"glow"; x:number; y:number; r:number; color?:MvColor; amount?:number; beat?:number }
	| (Particle & { type:"cracks"; x?:number; y?:number; reach?:number; progress?:number; at?:number; duration?:number; width?:number; glow?:MvColor })
	| { type:"grad"; gradient:MvIllustNativeGradient }
	| { type:"fill"; color:MvColor; amount?:number; composite?:Composite };
export type MvIllustNative = { bg?: string; bgFrom?: MvBurstView; bgTo?: MvBurstView; bgEase?: MvEase; beatZoom?: number; shake?: number;
	color?: MvColor; grad?: MvIllustNativeGradient; tint?: readonly {color:MvColor;amount:number;composite:Composite}[]; overlayGrad?:MvIllustNativeGradient;
	layers?:readonly {image:string;from:readonly [number,number,number];to?:readonly [number,number,number];easing?:MvEase;anchor?:readonly [number,number];alpha?:number;rotation?:number;role?:MvRole}[];
	chars?:readonly MvIllustNativeActor[]; fxBack?:readonly MvIllustNativeFx[]; fx?:readonly MvIllustNativeFx[]; vignette?:number };
export type MvIllustNativeScene = {kind:"illustNative";settings:MvIllustNative;bpm:number;span:MvSpan};
type Bezier = {kind:"move";point:readonly [number,number]}|{kind:"cubic";points:readonly [number,number,number,number,number,number]}|{kind:"quadratic";points:readonly [number,number,number,number]};
export type MvIllustNativePlan = {allocationBytes:number;commands:readonly (
	| {kind:"native";role:MvRole;command:MvEmberCommand}
	| {kind:"sprite";role:MvRole;sprite:NonNullable<MvBurstPlan["character"]>;tint:MvColor|null;offset:readonly [number,number];blurPx:number;composite:Composite}
	| {kind:"path";role:MvRole;path:readonly MvEmberPathStep[];color:MvColor;width:number;blurPx:number;composite:Composite}
	| {kind:"feather";role:MvRole;transform:readonly number[];color:MvColor;line:MvColor;body:readonly Bezier[];spine:readonly Bezier[]}
)[]};
export type MvIllustNativePlanNode = {kind:"illustNative";data:MvIllustNativePlan};
