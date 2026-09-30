import type {
	MotionTextResolvedCut,
	MotionTextSequence,
} from "@opencut/editor-contracts";

export type MotionTextCanvasContext = Pick<
	CanvasRenderingContext2D,
	| "beginPath"
	| "clip"
	| "fillRect"
	| "fillStyle"
	| "fillText"
	| "filter"
	| "font"
	| "globalAlpha"
	| "lineWidth"
	| "rect"
	| "restore"
	| "rotate"
	| "save"
	| "scale"
	| "setTransform"
	| "shadowBlur"
	| "shadowColor"
	| "strokeStyle"
	| "strokeText"
	| "textAlign"
	| "textBaseline"
	| "transform"
	| "translate"
> & {
	readonly canvas?: HTMLCanvasElement | OffscreenCanvas;
	arc?: CanvasRenderingContext2D["arc"];
	closePath?: CanvasRenderingContext2D["closePath"];
	fill?: CanvasRenderingContext2D["fill"];
	lineTo?: CanvasRenderingContext2D["lineTo"];
	moveTo?: CanvasRenderingContext2D["moveTo"];
	stroke?: CanvasRenderingContext2D["stroke"];
	globalCompositeOperation?: GlobalCompositeOperation;
	imageSmoothingEnabled?: boolean;
	clearRect?: CanvasRenderingContext2D["clearRect"];
	drawImage?: CanvasRenderingContext2D["drawImage"];
};

export interface MotionTextRenderDiagnostic {
	readonly severity: "warning" | "error";
	readonly code:
		| "font-digest-mismatch"
		| "font-load-failed"
		| "font-runtime-unavailable"
		| "invalid-font"
		| "invalid-plan"
		| "missing-font"
		| "missing-glyph"
		| "unsupported-preset"
		| "unverifiable-system-font";
	readonly message: string;
	readonly fontId?: string;
	readonly codePoints?: readonly number[];
	readonly preset?: string;
}

export interface MotionTextPalette {
	readonly background: string;
	readonly foreground: string;
	readonly accent: string;
	readonly secondary: string;
}

export interface MotionTextResolvedFont {
	readonly family: string;
	readonly style: "normal" | "italic";
	readonly weight: number;
	readonly fingerprint: string;
}

export interface MotionTextRenderRuntime {
	readonly sequence: MotionTextSequence;
	readonly orderedCuts: readonly MotionTextResolvedCut[];
	readonly cueColorsById: ReadonlyMap<string, Readonly<Record<string, string>>>;
	readonly baseDiagnostics: readonly MotionTextRenderDiagnostic[];
	readonly resolvedFonts: ReadonlyMap<string, MotionTextResolvedFont>;
	readonly fingerprint: string;
}

export interface MotionTextRenderFrame {
	readonly sequenceTime: number;
	readonly cut: MotionTextResolvedCut | null;
	readonly previousCut: MotionTextResolvedCut | null;
	readonly localTime: number;
	readonly progress: number;
	readonly enterProgress: number;
	readonly exitProgress: number;
	readonly opacity: number;
	readonly translateX: number;
	readonly translateY: number;
	readonly scale: number;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly skewX: number;
	readonly rotation: number;
	readonly blur: number;
	readonly wipe: number;
	readonly palette: MotionTextPalette;
	readonly previousPalette: MotionTextPalette | null;
	readonly font: MotionTextResolvedFont;
	readonly previousFont: MotionTextResolvedFont | null;
	readonly diagnostics: readonly MotionTextRenderDiagnostic[];
	readonly contentFingerprint: string;
}
