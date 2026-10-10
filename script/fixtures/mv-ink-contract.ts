export const INK_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/dark.js",
] as const;
export interface InkReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}
export interface InkSong {
	readonly beats: readonly number[];
	readonly bpm: number;
	readonly downbeatIndex0: number;
}
/** Only arguments consumed by unchanged original Ink; no invented path controls. */
export interface InkArgs {
	readonly char: string;
	readonly seed?: number;
	readonly h?: number;
	readonly x?: number;
	readonly y?: number;
}
export interface InkFrame {
	readonly shotStart: number;
	readonly duration: number;
	readonly time: number;
	readonly args: InkArgs;
}
export interface InkImage {
	readonly id: string;
	readonly mimeType: "image/png";
	readonly byteLength: number;
	readonly sha256: string;
	readonly width: number;
	readonly height: number;
	readonly body: ArrayBuffer;
}
export interface InkClock {
	idx(time: number): number;
	beat(time: number): number;
	at(index: number): number;
}
export interface InkEngine {
	readonly SCENES: Record<
		string,
		{
			preload(args: InkArgs): string[];
			draw(
				ctx: CanvasRenderingContext2D,
				input: {
					args: InkArgs;
					t: number;
					lt: number;
					dur: number;
					p: number;
					shot: { t0: number; t1: number };
					clock: InkClock;
				},
			): void;
		}
	>;
	readonly loaded: Map<string, ImageBitmap>;
	makeClock(beats: readonly number[], bpm: number, offset: number): InkClock;
	canvas(width: number, height: number): HTMLCanvasElement;
}
