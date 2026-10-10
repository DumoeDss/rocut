/** Author settings mirror Rust Heart core fields. Defaults, timing and geometry
 * belong to Rust; these declarations do not register a public scene dispatcher. */
export interface MvHeartShatterSettings {
	readonly heart: string;
	readonly bg?: string | null;
	readonly breakBeat?: number;
	readonly breakAt?: number | null;
	readonly x?: number;
	readonly y?: number;
}
/** Same fields, distinct Rust default break beat; no TS default injection. */
export type MvHeartBurnSettings = MvHeartShatterSettings;
/** Compatibility names for the existing two-mode contract. */
export type MvHeartBreakSettings = MvHeartShatterSettings;
export type MvHeartImplementedMode = "shatter" | "burn" | "gather" | "sun";
export type { MvHeartPlan } from "./mv-heart-plan";
/** Transient Rust discovery admission, never authored controls or label maps.
 * identityBytes is zero before actual parts are discovered; maxParts is a bound. */
export interface MvHeartPreparationAdmission {
	readonly ceilingBytes: number;
	readonly encodedSourceBytes: number;
	readonly decodedSourceBytes: number;
	readonly nativeSourceBytes: number;
	readonly fractureBytes: number;
	readonly identityBytes: number;
	readonly maxParts: number;
	readonly componentBudgetBytes: number;
}
/** Character dimensions are independently admitted native owner facts. */
export interface MvHeartGatherSettings {
	readonly heart: string;
	readonly char: string;
	readonly bg?: string | null;
	readonly firefly?: boolean | null;
	readonly n?: number | null;
	readonly charH?: number | null;
	readonly charX?: number | null;
	readonly charY?: number | null;
	readonly target?: readonly [number, number] | null;
}
/** Character dimensions are independently admitted native owner facts. */
export interface MvHeartSunSettings {
	readonly heart: string;
	readonly char: string;
	readonly fuseAt?: number | null;
	readonly fuseBeat?: number | null;
	readonly sunX?: number | null;
	readonly sunY?: number | null;
	readonly sunR?: number | null;
	readonly charH?: number | null;
	readonly charX?: number | null;
	readonly charY?: number | null;
}
/** Sky has its own retained Rust session, not the Heart component owner session. */
export interface MvHeartSkySettings {
	readonly bg: string;
	readonly char: string;
	readonly night?: string | null;
	readonly seed?: number | null;
	readonly impact?: readonly [number, number] | null;
	readonly releaseBeat?: number | null;
	readonly bands?: number | null;
	readonly charX?: number | null;
	readonly charH?: number | null;
}
/** Exact modes currently accepted by MvHeartOwner.frameJson. */
export type MvHeartOwnerScene =
	| { readonly kind: "heartShatter"; readonly settings: MvHeartShatterSettings }
	| { readonly kind: "heartBurn"; readonly settings: MvHeartBurnSettings }
	| { readonly kind: "heartGather"; readonly settings: MvHeartGatherSettings }
	| { readonly kind: "sunBloom"; readonly settings: MvHeartSunSettings }
	| { readonly kind: "skyShatter"; readonly settings: MvHeartSkySettings };
export interface MvHeartOwnerFrameInput {
	readonly scene: MvHeartOwnerScene;
	readonly shotStartTicks: number;
	readonly shotEndTicks: number;
	readonly songTicks: number;
	readonly beats: readonly number[];
	readonly bpm: number;
}
