/** putImageData ignores CTM, clip and paint state. Native admission owns bytes. */
export type MvEmberPixels = {
	readonly size: readonly [number, number];
	readonly position: readonly [number, number];
} & (
	| {
			/** Original alpha with white RGB, including alpha zero. */
			readonly kind: "alphaPixels";
			readonly alpha: readonly number[];
	  }
	| {
			/** Opaque original gray, not an alpha mask. */
			readonly kind: "grayPixels";
			readonly gray: readonly number[];
	  }
);
