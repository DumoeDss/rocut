import type { MvColor } from "./mv-recipe";

/** Color operations use straight-alpha sRGB. Spatial filters resample
 * premultiplied sRGB with transparent borders; bloom/lightLeak explicit expand
 * mode adds glow coverage. Palette is a luminance ramp, not a 3D LUT. */
export type MvEffect =
	| {
			readonly kind: "lightLeak";
			readonly amount: number;
			readonly alpha: "preserve" | "expand";
			/** Outer song clock multiplier, 0..8, default 1. */
			readonly speed?: number;
			/** Wrapped u32 addition to source.seed, default 0. */
			readonly seedOffset?: number;
	  }
	| { readonly kind: "invert"; readonly amount: number }
	| { readonly kind: "fade"; readonly amount: number }
	| {
			readonly kind: "flash";
			readonly amount: number;
			readonly color: readonly [number, number, number];
	  }
	| {
			readonly kind: "letterbox";
			readonly amount: number;
			/** Per-side frame-height fraction in 0..0.5; RGB is blackened, alpha preserved. */
			readonly heightFraction: number;
	  }
	/** Static shared RGB noise: amount 1 spans one 8-bit LSB before quantization. */
	| { readonly kind: "quantizationDither"; readonly amount: number }
	| {
			readonly kind: "grade";
			readonly exposure: number;
			readonly contrast: number;
			readonly saturation: number;
			readonly lift: readonly [number, number, number];
			readonly gain: readonly [number, number, number];
	  }
	| {
			readonly kind: "palette";
			readonly colors: readonly MvColor[];
			readonly mix: number;
	  }
	| { readonly kind: "vignette"; readonly amount: number }
	| { readonly kind: "grain"; readonly amount: number; readonly fps: number }
	| {
			readonly kind: "lineBoil";
			readonly amount: number;
			readonly cellSize: number;
			readonly fps: number;
	  }
	| {
			readonly kind: "glitch";
			readonly amount: number;
			readonly bands: number;
			readonly fps: number;
	  }
	| {
			readonly kind: "chromaticAberration" | "zoomBlur";
			readonly amount: number;
			readonly center: readonly [number, number];
	  }
	| {
			readonly kind: "bloom";
			readonly amount: number;
			readonly threshold: number;
			readonly radius: number;
			readonly alpha: "preserve" | "expand";
	  };
