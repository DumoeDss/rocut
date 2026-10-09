/** Evaluated Rust drawing transport. RGB channels are 0..255; alpha is 0..1. */
export interface MvLightLeakPlan {
	readonly seconds: number;
	readonly seed: number;
	readonly gradients: readonly {
		readonly center: readonly [number, number];
		readonly radius: number;
		readonly stops: readonly {
			readonly offset: number;
			readonly color: readonly [number, number, number, number];
		}[];
	}[];
}
