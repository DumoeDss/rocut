import { signedRandom, unitRandom } from "./deterministic-random";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export const TICKS_PER_SECOND = 120_000;

export interface ExitHoldDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

export interface ExitHoldGlyph {
	readonly character: string;
	readonly height: number;
	readonly index: number;
	readonly order: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}

export interface ExitHoldGlyphTransform {
	readonly alpha?: number;
	readonly character?: string;
	readonly clipX?: readonly [number, number];
	readonly clipY?: readonly [number, number];
	readonly color?: string;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly skewX?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}

export function exitHoldGlyphs(options: ExitHoldDraw): ExitHoldGlyph[] {
	const characters = Array.from(options.text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? options.size * 0.34 : options.size * 0.62,
	);
	const naturalWidth = advances.reduce((sum, advance) => sum + advance, 0);
	const fit =
		naturalWidth > 0 ? Math.min(1, options.maxWidth / naturalWidth) : 1;
	const width = naturalWidth * fit;
	const startX =
		options.ctx.textAlign === "left" || options.ctx.textAlign === "start"
			? options.x
			: options.ctx.textAlign === "right" || options.ctx.textAlign === "end"
				? options.x - width
				: options.x - width / 2;
	let cursor = startX;
	const glyphs: ExitHoldGlyph[] = [];
	for (const [sourceIndex, character] of characters.entries()) {
		const advance = (advances[sourceIndex] ?? options.size * 0.62) * fit;
		const center = cursor + advance / 2;
		cursor += advance;
		if (/\s/u.test(character)) continue;
		glyphs.push({
			character,
			height: options.size,
			index: glyphs.length,
			order: 0,
			width: advance,
			x: center,
			y: options.y,
		});
	}
	const denominator = Math.max(1, glyphs.length - 1);
	return glyphs.map((glyph) => ({
		...glyph,
		order: glyph.index / denominator,
	}));
}

export function drawExitHoldGlyph({
	glyph,
	options,
	transform = {},
}: {
	readonly glyph: ExitHoldGlyph;
	readonly options: ExitHoldDraw;
	readonly transform?: ExitHoldGlyphTransform;
}): void {
	const {
		alpha = 1,
		character = glyph.character,
		clipX,
		clipY,
		color,
		rotation = 0,
		scaleX = 1,
		scaleY = 1,
		skewX = 0,
		translateX = 0,
		translateY = 0,
	} = transform;
	if (alpha <= 0.003 || Math.abs(scaleX) < 0.004 || Math.abs(scaleY) < 0.004) {
		return;
	}
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.save();
	options.ctx.translate(glyph.x + translateX, glyph.y + translateY);
	if (rotation) options.ctx.rotate(rotation);
	if (skewX) options.ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	options.ctx.scale(scaleX, scaleY);
	if (clipX || clipY) {
		const x0 = (clipX?.[0] ?? -1.6) * glyph.width;
		const x1 = (clipX?.[1] ?? 1.6) * glyph.width;
		const y0 = (clipY?.[0] ?? -1.2) * glyph.height;
		const y1 = (clipY?.[1] ?? 1.2) * glyph.height;
		if (x1 <= x0 || y1 <= y0) {
			options.ctx.restore();
			return;
		}
		options.ctx.beginPath();
		options.ctx.rect(x0, y0, x1 - x0, y1 - y0);
		options.ctx.clip();
	}
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.textAlign = "center";
	if (color) options.ctx.fillStyle = color;
	options.drawGlyph({
		text: character,
		x: 0,
		y: 0,
		maxWidth: options.size * Math.max(0.76, Math.abs(scaleX)),
		size: options.size,
	});
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

export function drawExitHoldOutline({
	alpha = 1,
	color,
	glyph,
	lineWidth,
	options,
	scale = 1,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly glyph: ExitHoldGlyph;
	readonly lineWidth: number;
	readonly options: ExitHoldDraw;
	readonly scale?: number;
}): void {
	if (alpha <= 0.003 || scale <= 0.003) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.translate(glyph.x, glyph.y);
	options.ctx.scale(scale, scale);
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.lineWidth = lineWidth / scale;
	options.ctx.strokeStyle = color;
	options.ctx.textAlign = "center";
	options.ctx.strokeText(glyph.character, 0, 0, options.size * 0.76);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
}

// Positional drawing arguments keep the dozens of small preset recipes legible.
// eslint-disable-next-line opencut/prefer-object-params
export function drawGlyphSet(
	options: ExitHoldDraw,
	resolve: (glyph: ExitHoldGlyph) => ExitHoldGlyphTransform | null | undefined,
): void {
	for (const glyph of exitHoldGlyphs(options)) {
		const transform = resolve(glyph);
		if (transform === null) continue;
		drawExitHoldGlyph({ glyph, options, transform: transform ?? {} });
	}
}

export function secondsOf(frame: MotionTextRenderFrame): number {
	return frame.localTime / TICKS_PER_SECOND;
}

export function frameStep(frame: MotionTextRenderFrame): number {
	return Math.floor(secondsOf(frame) * 24);
}

// A variadic salt list mirrors the source pack's deterministic hash helpers.
// eslint-disable-next-line opencut/prefer-object-params
export function randomUnit(seed: number, ...salts: number[]): number {
	let value = seed | 0;
	for (const salt of salts) {
		value = Math.imul(value ^ (salt | 0), 0x45d9f3b) | 0;
		value ^= value >>> 16;
	}
	return unitRandom({ seed: value, salt: salts.length + 17 });
}

// A variadic salt list mirrors the source pack's deterministic hash helpers.
// eslint-disable-next-line opencut/prefer-object-params
export function randomSigned(seed: number, ...salts: number[]): number {
	let value = seed | 0;
	for (const salt of salts) {
		value = Math.imul(value ^ (salt | 0), 0x119de1f3) | 0;
		value ^= value >>> 13;
	}
	return signedRandom({ seed: value, salt: salts.length + 23 });
}

export function smoothNoise({
	seed,
	salt,
	value,
}: {
	readonly seed: number;
	readonly salt: number;
	readonly value: number;
}): number {
	const lower = Math.floor(value);
	const fraction = value - lower;
	const eased = smooth(fraction);
	return lerp({
		start: randomSigned(seed, salt, lower),
		end: randomSigned(seed, salt, lower + 1),
		progress: eased,
	});
}

export function mixHex({
	from,
	to,
	progress,
}: {
	readonly from: string;
	readonly to: string;
	readonly progress: number;
}): string {
	const left = expandHex(from);
	const right = expandHex(to);
	if (!left || !right) return progress < 0.5 ? from : to;
	const amount = clamp01(progress);
	const component = (offset: number) =>
		Math.round(
			Number.parseInt(left.slice(offset, offset + 2), 16) * (1 - amount) +
				Number.parseInt(right.slice(offset, offset + 2), 16) * amount,
		)
			.toString(16)
			.padStart(2, "0");
	return `#${component(0)}${component(2)}${component(4)}`;
}

function expandHex(value: string): string | null {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value);
	if (!match?.[1]) return null;
	return match[1].length === 3
		? Array.from(match[1], (component) => component.repeat(2)).join("")
		: match[1];
}

export function stagger({
	order,
	progress,
	spread,
}: {
	readonly order: number;
	readonly progress: number;
	readonly spread: number;
}): number {
	return clamp01((progress - order * spread) / Math.max(0.001, 1 - spread));
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function smooth(value: number): number {
	const progress = clamp01(value);
	return progress * progress * (3 - 2 * progress);
}

export function inQuad(value: number): number {
	return clamp01(value) ** 2;
}

export function outQuad(value: number): number {
	return 1 - (1 - clamp01(value)) ** 2;
}

export function inCubic(value: number): number {
	return clamp01(value) ** 3;
}

export function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

export function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export function inOutSine(value: number): number {
	return -(Math.cos(Math.PI * clamp01(value)) - 1) / 2;
}

export function bell(value: number): number {
	return Math.sin(Math.PI * clamp01(value));
}

export function degrees(value: number): number {
	return (value * Math.PI) / 180;
}

export function lerp({
	start,
	end,
	progress,
}: {
	readonly start: number;
	readonly end: number;
	readonly progress: number;
}): number {
	return start + (end - start) * progress;
}
