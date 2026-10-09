export interface MvAudioBinding {
	readonly resource: string;
	readonly inputSha256: string;
}
/** Reviewed evidence in source-audio seconds; order and overlaps are significant. */
export interface MvAudioStop {
	readonly kind: "stop" | "gap";
	readonly start: number;
	readonly end: number;
	readonly depthDb?: number;
}
/** Optional additive field of rocut-mv-audio/1; absence is not analyzed empty. */
export interface MvAudioStopMetadata {
	readonly stops?: readonly MvAudioStop[];
}
export type MvAudioChannel =
	| "mix_rms"
	| "low_power"
	| "mid_power"
	| "high_power"
	| "vocal_rms";
export type MvAudioSignal = (
	| { readonly kind: "envelope"; readonly channel: MvAudioChannel }
	| { readonly kind: "beatPulse" | "barPulse"; readonly decay: number }
) & {
	/** song stays at outer recipe time; source follows references/drawingFps. */
	readonly clock: "song" | "source";
	readonly missing: "zero" | "error";
};
export interface MvAudioResponse<T extends string> {
	readonly target: T;
	readonly signal: MvAudioSignal;
	readonly amount: number;
}
export type MvCameraAudio = MvAudioResponse<"x" | "y" | "zoom">;
export type MvSpriteAudio = MvAudioResponse<
	"x" | "y" | "scale" | "rotation" | "opacity"
>;
export interface MvPostAudio {
	/** Zero-based effect index; modifies its amount, within that effect's bounds. */
	readonly effect: number;
	readonly signal: MvAudioSignal;
	readonly amount: number;
}
