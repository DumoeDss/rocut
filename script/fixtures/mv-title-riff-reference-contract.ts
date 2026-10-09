import type { ConvergeOriginalClock, ConvergeOriginalEngine, ConvergeReference } from "./mv-converge-reference-contract";

/** Test oracle transport only; complete original source, never production code. */
export type TitleRiffReference = ConvergeReference;
export const TITLE_RIFF_FONTS = [
	{ family: "Zen Old Mincho", weight: 900 },
	{ family: "DotGothic16", weight: 400 },
	{ family: "Zen Kaku Gothic New", weight: 500 },
	{ family: "Noto Serif JP", weight: 300 },
] as const;
export const TITLE_RIFF_CUES = ["sun", "hud", "hud2", "zan", "cross", "ko", "split", "neg", "sil", "lock", "exit"] as const;
export const TITLE_RIFF_HUD = ["title", "when", "bpm", "geo", "place", "len"] as const;
export interface TitleRiffSong {
	readonly beats: readonly number[];
	readonly bpm: number;
	readonly downbeatIndex0: number;
	readonly credit: string;
}
export interface TitleRiffRecap {
	readonly bg: string;
	readonly char?: string;
	readonly view: { readonly zoom: number; readonly x: number; readonly y: number; readonly rot: number };
	readonly h: number;
	readonly cx: number;
	readonly cy: number;
}
export interface TitleRiffReferenceFrame {
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	readonly args: {
		readonly variant: "intro" | "outro";
		readonly char: string;
		readonly sky: string;
		readonly glyphs: readonly [string, string];
		readonly ruby: false | readonly [string, string];
		readonly sub: string;
		readonly hud: Readonly<Record<typeof TITLE_RIFF_HUD[number], string>>;
		readonly cues: Readonly<Record<typeof TITLE_RIFF_CUES[number], number>>;
		readonly exit: boolean;
		readonly grain: number;
		readonly recap?: readonly TitleRiffRecap[];
		readonly final?: string;
	};
}
export interface TitleRiffAsset {
	readonly id: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly body: ArrayBuffer;
}
export interface TitleRiffFont extends TitleRiffAsset {
	readonly family: string;
	readonly weight: number;
}
export interface TitleRiffImage extends TitleRiffAsset {
	readonly width: number;
	readonly height: number;
	readonly hasTransparency: boolean;
}
export interface TitleRiffClock extends ConvergeOriginalClock {
	phase(time: number): number;
	beat(time: number): number;
	bar(time: number): number;
	inBar(time: number): number;
	barPhase(time: number): number;
}
export interface TitleRiffEngine extends ConvergeOriginalEngine {
	CREDIT: string;
	FONT: Record<string, string>;
	loaded: Map<string, ImageBitmap>;
	scratch: HTMLCanvasElement[];
}
