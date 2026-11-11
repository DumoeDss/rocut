import {
	drawEnterBGlyph,
	drawEnterBGlyphs,
	enterBBounds,
	enterBRandom,
	enterBRandomSigned,
	enterBSpring,
	randomSigned,
	randomUnit,
	stagger,
	type EnterBDraw,
	type EnterBBounds,
	type EnterBGlyph,
	type EnterBGlyphTransform,
} from "./enter-b-drawing";

/**
 * Shared drawing surface for the JIZURA 追加分2 (v0.12, "x2") packs.
 *
 * These helpers mirror the source packs' compact per-glyph recipe shape so each
 * ported part stays a transliteration of its JIZURA definition. Semantic
 * simplifications match the existing A/B family ports: single-line items,
 * horizontal writing only (`mv` collapses to dx/dy), no per-item vertical
 * metrics (vx/vy/r90/fs), and the stroke-piece layer is approximated by the
 * packs' own glyph-level fallback because rocut has no piece infrastructure.
 */
export type X2Draw = EnterBDraw;
export type X2Glyph = EnterBGlyph;
export type X2GlyphTransform = EnterBGlyphTransform;

/**
 * Per-glyph application point for x2 packs. Returning `null` hides the glyph
 * (JIZURA `HIDE`); `undefined` draws it untransformed (JIZURA final `null`).
 */
export function drawX2Glyphs({
	options,
	resolve,
}: {
	readonly options: X2Draw;
	readonly resolve: (
		glyph: X2Glyph,
	) => X2GlyphTransform | null | undefined;
}): void {
	drawEnterBGlyphs({ options, resolve });
}

export function drawX2Glyph({
	glyph,
	options,
	transform = {},
}: {
	readonly glyph: X2Glyph;
	readonly options: X2Draw;
	readonly transform?: X2GlyphTransform;
}): void {
	drawEnterBGlyph({ glyph, options, transform });
}

/** Stagger against a 0..1 per-glyph order key (JIZURA `stg`). */
// eslint-disable-next-line opencut/prefer-object-params
export function x2Stagger(progress: number, order: number, spread: number): number {
	return stagger({ order, progress, spread });
}

/** 0 at the middle of the line, 1 at both ends (JIZURA `ctr`). */
// eslint-disable-next-line opencut/prefer-object-params
export function x2CenterOrder(glyph: X2Glyph, count: number): number {
	return count > 1
		? Math.abs(glyph.index - (count - 1) / 2) / ((count - 1) / 2)
		: 0;
}

/** −1 left of middle, +1 right of it (JIZURA `sideOf`). */
// eslint-disable-next-line opencut/prefer-object-params
export function x2SideOf(glyph: X2Glyph, count: number): number {
	return count > 1 ? Math.sign(glyph.index - (count - 1) / 2) : 0;
}

export interface X2LineEnds {
	readonly firstX: number;
	readonly firstY: number;
	readonly lastX: number;
	readonly lastY: number;
	readonly centerX: number;
	readonly centerY: number;
}

/** First/last glyph position of the (single) line and the middle between them. */
export function x2LineEnds(glyphs: readonly X2Glyph[]): X2LineEnds | null {
	if (glyphs.length === 0) return null;
	const first = glyphs[0]!;
	const last = glyphs.at(-1)!;
	return {
		firstX: first.x,
		firstY: first.y,
		lastX: last.x,
		lastY: last.y,
		centerX: (first.x + last.x) / 2,
		centerY: (first.y + last.y) / 2,
	};
}

// eslint-disable-next-line opencut/prefer-object-params
export function x2Bounds(options: X2Draw, padding = 0): EnterBBounds {
	return enterBBounds(options, padding);
}

/** Triangle wave −1..1 starting at −1 (JIZURA `tri`). */
export function x2Triangle(value: number): number {
	return 2 * Math.abs(2 * (value - Math.floor(value + 0.5))) - 1;
}

export const x2Spring = enterBSpring;

/** Flash colour that differs from the item colour; the palette's accent stands in. */
export function x2Hot(options: X2Draw): string {
	return options.frame.palette.accent;
}

/** Muted palette slot (JIZURA `sc.sub`). */
export function x2Sub(options: X2Draw): string {
	return options.frame.palette.secondary;
}

/** Glyph ink width relative to a full-size slot, clamped (JIZURA `slotK`). */
// eslint-disable-next-line opencut/prefer-object-params
export function x2SlotK(glyph: X2Glyph, size: number): number {
	return Math.min(1, Math.max(0.3, glyph.width / Math.max(1, size)));
}

export function x2IsBlank(character: string): boolean {
	return character === " " || character === "　";
}

export function x2IsKanji(character: string): boolean {
	const code = character.codePointAt(0) ?? 0;
	return (
		(code >= 0x2e80 && code <= 0x2fdf) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0x20000 && code <= 0x2ffff)
	);
}

/** Deterministic unit hash for small integer choices (JIZURA `J.h`). */
// eslint-disable-next-line opencut/prefer-object-params
export function x2Hash(seed: number, ...salts: number[]): number {
	return Math.floor(randomUnit(seed, ...salts) * 0x10000) | 0;
}

export { enterBRandom as x2Random, enterBRandomSigned as x2RandomSigned };

// eslint-disable-next-line opencut/prefer-object-params
export function x2Signed(seed: number, ...salts: number[]): number {
	return randomSigned(seed, ...salts);
}

// eslint-disable-next-line opencut/prefer-object-params
export function x2Unit(seed: number, ...salts: number[]): number {
	return randomUnit(seed, ...salts);
}
