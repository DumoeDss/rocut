/** Test-only author contract. This is not a public Rocut scene or approximation. */
export const KANJI_SLAM_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/typo.js",
] as const;
export const KANJI_SLAM_FONTS = [
	{ family: "Zen Old Mincho", weight: 900, size: 1500, alias: "minchoHeavy" },
	{ family: "Shippori Mincho B1", weight: 700, size: 30, alias: "mincho" },
	{ family: "DotGothic16", weight: 400, size: 16, alias: "dot" },
] as const;
export interface KanjiSlamReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}
export interface KanjiSlamSong {
	readonly beats: readonly number[];
	readonly bpm: number;
	readonly downbeatIndex0: number;
}
export interface KanjiSlamArgs {
	readonly variant: "default" | "night" | "hand";
	readonly fire: boolean;
	readonly char: string;
	readonly bg: string | null;
	readonly glyphs: readonly string[];
	readonly fam: "minchoHeavy";
	readonly weight: 900;
	readonly charX: number;
	readonly charY: number;
	readonly charH: number;
	readonly face: readonly [number, number];
	readonly color: string;
	readonly sky: "sunset" | "night" | "day";
	readonly skyGrad?: readonly (readonly [number, string])[];
	readonly rim: string;
	readonly rimOff: readonly [number, number];
	readonly rimA: number;
	readonly haloA: number;
	readonly voiceDir: number | null;
	readonly wind: {
		readonly axis: "col" | "row";
		readonly from: number;
		readonly dir: -1 | 1;
		readonly amp: number;
		readonly freq: number;
		readonly speed: number;
		readonly q: number;
	};
	readonly slots: readonly {
		readonly x: number;
		readonly y: number;
		readonly s: number;
		readonly r: number;
	}[];
	readonly frames: readonly {
		readonly z: number;
		readonly dx: number;
		readonly dy: number;
	}[];
	readonly lines: "ink" | "light";
	readonly noFlash: boolean;
}
export interface KanjiSlamFrame {
	readonly shotId: string;
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	readonly args: KanjiSlamArgs;
}
export interface KanjiSlamAsset {
	readonly id: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly body: ArrayBuffer;
}
export interface KanjiSlamFont extends KanjiSlamAsset {
	readonly family: string;
	readonly weight: number;
}
export interface KanjiSlamImage extends KanjiSlamAsset {
	readonly width: number;
	readonly height: number;
	readonly hasTransparency: boolean;
}
export interface KanjiSlamClock {
	readonly beats: readonly number[];
	idx(time: number): number;
	since(time: number): number;
	phase(time: number): number;
	beat(time: number): number;
	bar(time: number): number;
	inBar(time: number): number;
	barPhase(time: number): number;
	pulse(time: number, decay?: number): number;
	downPulse(time: number, decay?: number): number;
}
export interface KanjiSlamEngine {
	FONT: Record<string, string>;
	loaded: Map<string, ImageBitmap>;
	scratch: HTMLCanvasElement[];
	canvas(width: number, height: number): HTMLCanvasElement;
	makeClock(
		beats: readonly number[],
		bpm: number,
		downbeat: number,
	): KanjiSlamClock;
	SCENES: Record<
		string,
		{
			preload(args: KanjiSlamArgs): string[];
			init(): Promise<unknown>;
			draw(
				ctx: CanvasRenderingContext2D,
				state: Record<string, unknown>,
			): unknown;
		}
	>;
}
