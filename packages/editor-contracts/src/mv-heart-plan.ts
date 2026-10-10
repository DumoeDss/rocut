import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvColor } from "./mv-recipe";
import type { MvHeartSkySettings } from "./mv-heart";
import type { MvDrawPaint } from "./mv-draw-paint";
import type { MvEmberDrawingSpace, MvEmberPathStep } from "./mv-ember-path";
import type { MvEmberSurfaceDraw } from "./mv-ember-plan";
import type {
	MvHeartBinding,
	MvHeartPreparedImageCommand,
} from "./mv-heart-prepared";

export type MvHeartPathStep =
	| MvEmberPathStep
	| {
			readonly kind: "quadraticCurveTo";
			readonly control: readonly [number, number];
			readonly point: readonly [number, number];
	  };
type NativeBlit = Extract<MvEmberSurfaceDraw, { readonly kind: "blit" }>;
/** Owned Rust blits explicitly serialize null clip/raster; static native blits
 * may omit them. Both keep the same wire kind and string surface identity. */
export type MvHeartBlit = Omit<NativeBlit, "raster"> & {
	readonly raster?: NativeBlit["raster"] | null;
};
export type MvHeartDraw =
	| Exclude<MvEmberSurfaceDraw, { readonly kind: "path" | "blit" }>
	| MvHeartBlit
	| MvHeartPreparedImageCommand
	| (MvEmberDrawingSpace & {
			readonly kind: "path";
			readonly path: readonly MvHeartPathStep[];
			readonly paints: readonly MvDrawPaint[];
	  })
	| (MvEmberDrawingSpace & {
			readonly kind: "shadowPath";
			readonly path: readonly MvEmberPathStep[];
			readonly paints: readonly MvDrawPaint[];
			readonly shadow: {
				readonly color: MvColor;
				readonly blurPx: number;
				readonly offset: readonly [0, 0];
			};
	  });
/** Exact admitted Sky Milky Way native filter transport. Not a shadow or a
 * post-blur of existing pixels; Rust currently admits identity and sigma 10. */
export interface MvHeartFilteredPath {
	readonly kind: "filteredPath";
	readonly transform: readonly [1, 0, 0, 1, 0, 0];
	readonly operations: readonly [];
	readonly path: readonly MvHeartPathStep[];
	readonly paints: readonly MvDrawPaint[];
	readonly blurPx: 10;
}
export type MvHeartSurfaceDraw = MvHeartDraw | MvHeartFilteredPath;
type Lifetime<T> =
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
			readonly commands: readonly T[];
	  }
	| {
			readonly kind: "appendSurface";
			readonly surface: string;
			readonly commands: readonly T[];
	  }
	| { readonly kind: "releaseSurface"; readonly surface: string };
export type MvHeartOwnerCommand = MvHeartDraw | Lifetime<MvHeartDraw>;
/** Includes core Sky filtered paths, without asserting an owner/dispatch bridge. */
export type MvHeartCommand = MvHeartSurfaceDraw | Lifetime<MvHeartSurfaceDraw>;
export interface MvHeartPlan {
	readonly commands: readonly MvHeartCommand[];
	readonly rasterBudgetBytes: number;
}
export interface MvHeartBackgroundBinding {
	readonly source: ProgrammaticResource;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly decodedRgbaSha256: string;
	readonly decoder: "canvas2d-srgb-unpremultiplied-rgba8-v1";
}
export interface MvHeartOwnerIdentity {
	readonly ownerId: number;
	readonly sessionId: number;
	readonly binding: MvHeartBinding;
	readonly background: MvHeartBackgroundBinding | null;
	readonly character?: MvHeartBackgroundBinding;
	readonly imagesManifestSha256: string;
}
/** Heart crop owner envelope retains its existing untagged shape. */
export interface MvHeartOwnerFrame {
	readonly identity: MvHeartOwnerIdentity;
	readonly plan: {
		readonly commands: readonly MvHeartOwnerCommand[];
		readonly rasterBudgetBytes: number;
	};
}
/** Sky has a distinct producer, identity and transport, and never Heart crops. */
export interface MvHeartSkyOwnerIdentity {
	readonly ownerId: number;
	readonly sessionId: number;
	readonly binding: MvHeartBackgroundBinding;
	readonly character: MvHeartBackgroundBinding;
	readonly settings: MvHeartSkySettings;
	readonly imagesManifestSha256: string;
}
export type MvHeartSkyDraw =
	| Exclude<MvHeartDraw, { readonly kind: "preparedImage" }>
	| MvHeartFilteredPath;
export type MvHeartSkyCommand =
	| MvHeartSkyDraw
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
			readonly commands: readonly MvHeartSkyDraw[];
	  }
	| { readonly kind: "releaseSurface"; readonly surface: string };
export interface MvHeartSkyOwnerFrame {
	readonly kind: "skyShatter";
	readonly identity: MvHeartSkyOwnerIdentity;
	readonly plan: {
		readonly commands: readonly MvHeartSkyCommand[];
		readonly rasterBudgetBytes: number;
	};
}
export type MvHeartNativeOwnerFrame = MvHeartOwnerFrame | MvHeartSkyOwnerFrame;
