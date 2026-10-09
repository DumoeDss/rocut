import type { MvRole, MvSpan } from "./mv-recipe";

/** Complete native thread scene, not an authored-JavaScript generator. */
export interface MvThread {
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
	/** Declared image resource; the reference artwork is not bundled. */
	readonly hand: string;
	readonly light?: readonly [number, number];
	/** Source-second intervals; [] overrides global reviewed stops. Never merged. */
	readonly stops?: readonly (readonly [number, number])[];
	readonly kickAt?: number | null;
	readonly arriveAt?: number | null;
	readonly handRot?: number;
	readonly handH?: number;
	readonly handX?: number;
	readonly handY?: number;
}
export interface MvThreadScene {
	readonly kind: "thread";
	readonly role: MvRole;
	readonly settings: MvThread;
	readonly span: MvSpan;
}
