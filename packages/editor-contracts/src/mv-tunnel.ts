import type { MvRole, MvSpan } from "./mv-recipe";
import type { MvEmberCommand } from "./mv-ember-plan";
import type { ProgrammaticResource } from "./programmatic-resources";
import type { ReferencePostPlan } from "./mv-reference-post";

/** Dedicated original typo.js tunnel; not yet included in the public scene union. */
export interface MvTunnel {
	readonly fonts: {
		readonly mincho800: string;
		readonly dot400: string;
		readonly heavy900: string;
		readonly noto400: string;
		readonly noto800: string;
		readonly noto900: string;
	};
	/** Original preload-only image; the scene does not draw it. */
	readonly reveal?: string;
	/** Original visually inert authoring hint (default dawn). */
	readonly toward?: string;
	readonly words?: readonly string[];
	/** Absolute song seconds; ordered, not implicitly sorted. */
	readonly plan?: readonly (readonly [number, string])[];
	readonly f?: number;
	readonly v0?: number;
	readonly v1?: number;
	readonly fadeIn?: number;
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
}
/** Actual native measureText advances at 100px; never guessed or normalized. */
export interface MvTunnelFontStack {
	readonly role: "mincho800" | "dot400" | "heavy900";
	readonly resources: readonly [ProgrammaticResource, ProgrammaticResource];
	/** Rust-assigned content/instance aliases, not authored family strings. */
	readonly aliases: readonly [string, string];
	/** Rust-proven cmap first-match routing; TS does not parse/reroute fonts. */
	readonly routes: Readonly<Record<string, string>>;
}
export interface MvTunnelMeasurement {
	readonly nodeId: string;
	readonly fontStack: MvTunnelFontStack;
	readonly fontSize: 100;
	readonly advances: Readonly<Record<string, number>>;
}
export interface MvTunnelMetricRequest {
	readonly nodeId: string;
	readonly fontStack: MvTunnelFontStack;
	readonly fontSize: 100;
	readonly characters: readonly string[];
}
export interface MvTunnelScene {
	readonly kind: "tunnel";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvTunnel;
}
type SharedText = Extract<MvEmberCommand, { readonly kind: "text" }>;
type WithStack<T> = T extends SharedText
	? Omit<T, "kind" | "font"> & {
			readonly kind: "stackText";
			readonly fontStack: MvTunnelFontStack;
		}
	: never;
export type MvTunnelStackText = WithStack<SharedText>;
export interface MvTunnelPlan {
	readonly commands: readonly (
		| Extract<MvEmberCommand, { readonly kind: "path" | "rect" | "grain" }>
		| MvTunnelStackText
	)[];
}
export interface MvTunnelPost {
	readonly zoomBlur: number;
	readonly zoomCenter: readonly [number, number];
	readonly bloom: number;
	readonly bloomThreshold: number;
	readonly ca: number;
	readonly vignette: number;
	readonly boil: number;
}
export interface MvTunnelNativePost {
	readonly plan: ReferencePostPlan;
	readonly profile: "tunnel-original-gl-v1";
	readonly required: true;
	readonly songTicks: number;
	readonly parameters: MvTunnelPost;
}
export interface MvTunnelBoundStack {
	readonly nodeId: string;
	readonly fontStack: MvTunnelFontStack;
}
export interface MvTunnelFontLimits {
	readonly maxBytes: number;
	readonly maxResources: number;
	readonly maxLayoutBytes: number;
}
