export const TYPE_CARD_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/typo.js",
] as const;

export interface TypeCardReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}

export interface TypeCardReferenceFont {
	/** Exact family identity, not a CSS font-family list. No URL/local() sources. */
	readonly family: string;
	readonly weight: number;
	/** Already-authorized local, uncompressed SFNT TTF/OTF bytes. */
	readonly bytes: ArrayBuffer;
}

export interface TypeCardReferenceArgs {
	readonly mode: "quiet" | "flicker";
	readonly lines: readonly string[];
	readonly fam?: string;
	readonly weight?: number;
	readonly size?: number;
	readonly color?: string;
	readonly paper?: string;
	readonly ruleColor?: string;
	readonly rule?: boolean;
	readonly vertical?: boolean;
	readonly sub?: string;
	readonly x?: number;
	readonly y?: number;
	readonly lead?: number;
	readonly stagger?: number;
	readonly fade?: number;
	readonly gap?: number;
}

export interface TypeCardReferenceFrame {
	readonly args: TypeCardReferenceArgs;
	/** Explicit absolute song time and shot origin, in seconds. */
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	/** Whole-song beat times; original shotBeats performs its own filtering. */
	readonly beats: readonly number[];
	readonly includePng?: boolean;
}

export interface TypeCardOriginalEngine {
	FONT: Record<string, string>;
	canvas(width?: number, height?: number): HTMLCanvasElement;
	scratch: HTMLCanvasElement[];
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
}

export type TypeCardOriginalWindow = Window &
	typeof globalThis & { Z?: TypeCardOriginalEngine };
