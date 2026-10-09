import type {
	ThreadReference,
	ThreadSong,
	ThreadClock,
} from "./mv-thread-contract";

export type FlameReference = ThreadReference;
export type FlameSong = ThreadSong & {
	readonly envelope?: {
		readonly fps: number;
		readonly vocal: readonly number[];
	};
};
/** Original author arguments, independent of the native producer's schema. */
export interface FlameOracleArgs {
	readonly mode?: "breathe" | "grow" | "dark";
	readonly img?: string;
	readonly face?: string;
	readonly flameAt?: readonly [number, number, number, number, number, number];
	readonly stops?: readonly (readonly [number, number])[];
	readonly zoomAt?: number;
	readonly zoomTo?: number;
	readonly igniteAt?: number;
	readonly h?: number;
	readonly faceAt?: readonly [number, number];
	readonly facePos?: readonly [number, number];
}
export interface FlameOracleFrame {
	readonly shotStart: number;
	readonly duration: number;
	readonly time: number;
	readonly args: FlameOracleArgs;
}
export interface FlameOracleEngine {
	readonly SCENES: Record<
		string,
		{
			preload(args: FlameOracleArgs): string[];
			draw(
				ctx: CanvasRenderingContext2D,
				input: {
					args: FlameOracleArgs;
					t: number;
					lt: number;
					dur: number;
					p: number;
					shot: { t0: number; t1: number };
					clock: ThreadClock;
					env: { vocal(time: number): number };
				},
			): void;
		}
	>;
	readonly loaded: Map<string, ImageBitmap>;
	readonly __darkDebug: { deflamed?: HTMLCanvasElement };
	audio?: { stops: NonNullable<ThreadSong["stops"]> };
	makeClock(beats: readonly number[], bpm: number, offset: number): ThreadClock;
	makeEnv(envelope?: FlameSong["envelope"]): { vocal(time: number): number };
	canvas(width: number, height: number): HTMLCanvasElement;
}
