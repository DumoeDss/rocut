import type { MvThread } from "../../packages/editor-contracts/src/mv-thread";
import type { MvAudioStop } from "../../packages/editor-contracts/src/mv-recipe-audio";
export const THREAD_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/dark.js",
] as const;
export interface ThreadReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}
export interface ThreadSong {
	readonly bpm: number;
	readonly beats: readonly number[];
	readonly downbeatIndex0: number;
	readonly stops?: readonly MvAudioStop[];
}
export interface ThreadFrame {
	readonly shotStart: number;
	readonly duration: number;
	readonly time: number;
	readonly args: Omit<MvThread, "beats" | "bpm" | "downbeatIndex0">;
}
export interface ThreadClock {
	idx(t: number): number;
	beat(t: number): number;
	at(n: number): number;
}
export interface ThreadEngine {
	readonly SCENES: Record<
		string,
		{
			preload(args: ThreadFrame["args"]): string[];
			draw(
				ctx: CanvasRenderingContext2D,
				input: {
					args: ThreadFrame["args"];
					t: number;
					lt: number;
					dur: number;
					p: number;
					shot: { t0: number; t1: number };
					clock: ThreadClock;
				},
			): void;
		}
	>;
	readonly loaded: Map<string, ImageBitmap>;
	audio?: { stops: readonly MvAudioStop[] };
	makeClock(beats: readonly number[], bpm: number, offset: number): ThreadClock;
	canvas(width: number, height: number): HTMLCanvasElement;
}
export function threadSong(): ThreadSong {
	return {
		bpm: 120,
		downbeatIndex0: 0,
		beats: Array.from({ length: 40 }, (_, i) => i / 2),
	};
}
export function threadFrame(): ThreadFrame {
	return { shotStart: 4, duration: 4, time: 4, args: { hand: "thread-hand" } };
}
