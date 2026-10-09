import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvEmberClip } from "./mv-ember-path";
import type {
	MvConvergeTransform,
	MvConvergeTransformOp,
} from "./mv-converge-transform";
import type { MvDrawComposite } from "./mv-draw-paint";

/** Transient, Rust-derived; not an authored source.resources entry. */
export interface MvHeartBinding {
	readonly source: ProgrammaticResource;
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly decodedRgbaSha256: string;
	readonly decoder: "canvas2d-srgb-unpremultiplied-rgba8-v1";
	readonly algorithm: "heart-components-v1";
}
export interface MvHeartPreparedImage {
	readonly binding: MvHeartBinding;
	readonly part:
		| { readonly kind: "body" }
		| { readonly kind: "chip"; readonly label: number };
	readonly width: number;
	readonly height: number;
	readonly rgbaSha256: string;
}
/** Resolve only from the currently admitted Heart session; never URL/image fallback. */
export interface MvHeartPreparedImageCommand {
	readonly kind: "preparedImage";
	readonly image: MvHeartPreparedImage;
	readonly sourceRect: readonly [number, number, number, number] | null;
	readonly destinationRect: readonly [number, number, number, number];
	readonly transform: MvConvergeTransform;
	readonly operations: readonly MvConvergeTransformOp[];
	readonly clip: MvEmberClip | null;
	readonly composite: MvDrawComposite;
	readonly opacity: number;
	readonly smoothing: boolean;
	readonly smoothingQuality: "low" | "medium" | "high";
}
