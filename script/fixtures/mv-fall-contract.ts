import type { MvFall } from "../../packages/editor-contracts/src/mv-fall";
import type { MvAudioStop } from "../../packages/editor-contracts/src/mv-recipe-audio";
export const FALL_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/dark.js",
] as const;
export interface FallReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}
export interface FallSong {
	readonly bpm: number;
	readonly beats: readonly number[];
	readonly downbeatIndex0: number;
	readonly stops?: readonly MvAudioStop[];
}
export interface FallFrame {
	readonly shotStart: number;
	readonly duration: number;
	readonly time: number;
	readonly args: Omit<MvFall, "beats">;
}
export interface FallClock {
	idx(t: number): number;
	beat(t: number): number;
	at(n: number): number;
}
export interface FallEngine {
	readonly SCENES: Record<
		string,
		{
			preload(args: FallFrame["args"]): string[];
			draw(
				ctx: CanvasRenderingContext2D,
				input: {
					args: FallFrame["args"];
					t: number;
					lt: number;
					dur: number;
					p: number;
					shot: { t0: number; t1: number };
					clock: FallClock;
				},
			): void;
		}
	>;
	readonly loaded: Map<string, ImageBitmap>;
	audio?: { stops: readonly MvAudioStop[] };
	makeClock(beats: readonly number[], bpm: number, offset: number): FallClock;
	canvas(width: number, height: number): HTMLCanvasElement;
}
export function fallSong(): FallSong {
	return {
		bpm: 120,
		downbeatIndex0: 0,
		beats: Array.from({ length: 40 }, (_, i) => i / 2),
	};
}
export function fallFrame(): FallFrame {
	return { shotStart: 4, duration: 4, time: 4, args: { char: "fall-char" } };
}
