import type { MvDrawPaint } from "./mv-draw-paint";
import type { MvEmberDrawingSpace } from "./mv-ember-path";
import type {
	MvConvergeTransform,
	MvConvergeTransformOp,
} from "./mv-converge-transform";

/** A gradient is created in the source CTM, then the rectangle is filled in
 * its own native CTM. Neither transform is flattened or inferred by the host. */
export type MvGradientRect = MvEmberDrawingSpace & {
	readonly kind: "gradientRect";
	readonly rect: readonly [number, number, number, number];
	readonly paint: MvDrawPaint & { readonly kind: "fill" };
	readonly styleTransform: MvConvergeTransform;
	readonly styleOperations: readonly MvConvergeTransformOp[];
};
