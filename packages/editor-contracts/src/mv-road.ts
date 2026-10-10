/** Scene authoring only; whole-song audio stops/downbeats and image facts are native-owner inputs. */
import type { MvRole, MvSpan } from "./mv-recipe";
import type { ReferencePostPlan } from "./mv-reference-post";
export type MvRoad = {
	/** Explicit source-song BPM; reviewed analysis does not carry this value. */
	bpm: number;
	mode?: "tear" | "run";
	char?: string;
	impact?: number;
	horizon?: number;
	open?: number;
	dolly?: number;
	slowAt?: number;
	freezeAt?: number;
	freezeStyle?: "photo" | "none";
};
export type MvRoadScene = {
	readonly kind: "road";
	readonly role: Exclude<MvRole, "foreground">;
	readonly settings: MvRoad;
	readonly span: MvSpan;
};
/** Required exact original post; Dawn is a Canvas gradient row with these positions. */
export type MvRoadNativePost = {
	readonly plan: ReferencePostPlan & { readonly profile: "road-original-gl-v1" };
	readonly profile: "road-original-gl-v1";
	readonly required: true;
	readonly mode: "tear" | "run";
	readonly songTicks: number;
	readonly shotStartTicks: number;
	readonly shotEndTicks: number;
	readonly bloom: 0.55;
	readonly beatCA: 0 | 2;
	readonly beats: readonly number[];
	readonly transition: { readonly kind: "black"; readonly durationSeconds: 0.3 } | null;
	readonly dawn: { readonly mix: 0.08; readonly stops: readonly (readonly [number, string])[] } | null;
};
