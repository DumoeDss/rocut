import type { MvRole, MvSpan } from "./mv-recipe";

/** Complete original falling scene; original film artwork is not bundled. */
export interface MvFall {
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	/** Declared image resource. */
	readonly char: string;
	/** Source seconds, original order; [] suppresses global reviewed stops. */
	readonly freeze?: readonly (readonly [number, number])[];
	/** Full source-time pulses; [] suppresses the first-stop default pulse. */
	readonly pulse?: readonly number[];
	readonly vp?: readonly [number, number];
	readonly speed?: number;
	readonly h?: number;
}
export interface MvFallScene {
	readonly kind: "fall";
	readonly role: MvRole;
	readonly settings: MvFall;
	readonly span: MvSpan;
}
