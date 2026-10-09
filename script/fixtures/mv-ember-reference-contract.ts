import type {
	ConvergeOriginalEngine,
	ConvergeReference,
} from "./mv-converge-reference-contract";

/** Same unmodified intro.js bundle; independent of the Rocut scene planner. */
export type EmberReference = ConvergeReference;
export interface EmberAudioFacts {
	readonly beats: readonly number[];
	readonly strongOnsets: readonly { t: number; strength: number }[];
	readonly envelopes: {
		readonly fps: number;
		readonly rms: readonly number[];
		readonly low: readonly number[];
		readonly mid: readonly number[];
		readonly high: readonly number[];
		readonly vocal?: readonly number[];
	};
}
export interface EmberReferenceAsset {
	readonly id: string;
	readonly mimeType: string;
	readonly sha256: string;
	readonly body: ArrayBuffer;
}
export type EmberKey = readonly [
	number,
	number,
	("out" | "in" | "soft" | "io")?,
	number?,
];
export interface EmberReferenceFrame {
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	readonly args: { readonly grain: number } & (
		| {
				readonly mode: "breathe";
				readonly stops: readonly (readonly [number, number])[];
				readonly flares: readonly (readonly [number, number])[];
				readonly thumps: readonly number[];
		  }
		| {
				readonly mode: "ignite";
				readonly stops: readonly (readonly [number, number])[];
				/** Omit only to exercise original beat-derived lastBeatBefore, not a fixture default. */
				readonly blackFrom?: number;
				readonly crackAt: number;
				readonly ring: number;
				readonly seed: number;
		  }
		| {
				readonly mode: "collapse";
				readonly bg: string;
				readonly focus: readonly [number, number];
				readonly end: number;
				readonly keys?: readonly EmberKey[];
		  }
	);
}
export interface EmberOriginalEngine extends ConvergeOriginalEngine {
	makeEnv(envelopes: EmberAudioFacts["envelopes"]): {
		get(channel: string, time: number): number;
		rms(time: number): number;
		low(time: number): number;
		mid(time: number): number;
		high(time: number): number;
		vocal(time: number): number;
	};
	loaded: Map<string, ImageBitmap>;
	audio?: {
		beats: readonly number[];
		onsets_strong: EmberAudioFacts["strongOnsets"];
	};
}
