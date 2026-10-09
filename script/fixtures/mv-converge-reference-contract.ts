export const CONVERGE_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/intro.js",
] as const;
export interface ConvergeReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}
export interface ConvergeReferenceFrame {
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	readonly args: {
		readonly seed: number;
		readonly whiteAt: number;
		readonly grain: number;
	};
}
export interface ConvergeOriginalClock {
	readonly beats: readonly number[];
	idx(time: number): number;
	since(time: number): number;
	pulse(time: number, decay?: number): number;
}
export interface ConvergeOriginalEngine {
	SCENES: Record<
		string,
		{
			init(): Promise<unknown>;
			draw(
				ctx: CanvasRenderingContext2D,
				state: Record<string, unknown>,
			): unknown;
		}
	>;
	canvas(width: number, height: number): HTMLCanvasElement;
	makeClock(
		beats: readonly number[],
		bpm: number,
		downbeat?: number,
	): ConvergeOriginalClock;
	audio?: { beats: readonly number[] };
	clock?: ConvergeOriginalClock;
}
export type ConvergeOriginalWindow = Window &
	typeof globalThis & { Z?: ConvergeOriginalEngine };
