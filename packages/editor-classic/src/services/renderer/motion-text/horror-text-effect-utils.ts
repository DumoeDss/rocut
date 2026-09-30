import { signedRandom, unitRandom } from "./deterministic-random";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export const HORROR_TICKS_PER_SECOND = 120_000;

export interface HorrorTextEffectOptions extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

export interface HorrorTreatmentOptions extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
}

export interface PositionedHorrorGlyph {
	readonly character: string;
	readonly globalIndex: number;
	readonly order: number;
	readonly x: number;
	readonly y: number;
}

export function positionedHorrorGlyphs(
	options: HorrorTreatmentOptions,
): readonly PositionedHorrorGlyph[] {
	const characters = Array.from(options.text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? options.size * 0.34 : options.size * 0.62,
	);
	const naturalWidth = advances.reduce((sum, advance) => sum + advance, 0);
	const widthScale =
		naturalWidth > 0 ? Math.min(1, options.maxWidth / naturalWidth) : 1;
	const width = naturalWidth * widthScale;
	const startX =
		options.ctx.textAlign === "left" || options.ctx.textAlign === "start"
			? options.x
			: options.ctx.textAlign === "right" || options.ctx.textAlign === "end"
				? options.x - width
				: options.x - width / 2;
	const globalCharacters = Array.from(options.frame.cut?.text ?? "").filter(
		(character) => !/\s/u.test(character),
	);
	let cursor = startX;
	let searchFrom = 0;
	const positioned: PositionedHorrorGlyph[] = [];
	for (const [index, character] of characters.entries()) {
		const advance = advances[index] * widthScale;
		const center = cursor + advance / 2;
		cursor += advance;
		if (/\s/u.test(character)) continue;
		let globalIndex = globalCharacters.indexOf(character, searchFrom);
		if (globalIndex < 0) globalIndex = globalCharacters.indexOf(character);
		if (globalIndex < 0) globalIndex = positioned.length;
		searchFrom = globalIndex + 1;
		positioned.push({
			character,
			globalIndex,
			order:
				globalCharacters.length <= 1
					? 0
					: globalIndex / (globalCharacters.length - 1),
			x: center,
			y: options.y,
		});
	}
	return positioned;
}

export function drawHorrorGlyph({
	alpha = 1,
	color,
	deltaX = 0,
	deltaY = 0,
	glyph,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly deltaX?: number;
	readonly deltaY?: number;
	readonly glyph: PositionedHorrorGlyph;
	readonly options: HorrorTextEffectOptions;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
}): void {
	if (alpha <= 0 || Math.abs(scaleX) <= Number.EPSILON) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(glyph.x + deltaX, glyph.y + deltaY);
	if (rotation) ctx.rotate(rotation);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.textAlign = "center";
	if (color) ctx.fillStyle = color;
	options.drawGlyph({
		text: glyph.character,
		x: 0,
		y: 0,
		maxWidth: options.size * 0.78,
		size: options.size,
	});
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function drawHorrorText({
	alpha = 1,
	color,
	deltaX = 0,
	deltaY = 0,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly deltaX?: number;
	readonly deltaY?: number;
	readonly options: HorrorTextEffectOptions;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
}): void {
	if (alpha <= 0 || Math.abs(scaleX) <= Number.EPSILON) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(options.x + deltaX, options.y + deltaY);
	if (rotation) ctx.rotate(rotation);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.textAlign = "center";
	if (color) ctx.fillStyle = color;
	options.drawGlyph({
		text: options.text,
		x: 0,
		y: 0,
		maxWidth: options.maxWidth,
		size: options.size,
	});
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function horrorEffectRandom({
	options,
	salt,
}: {
	readonly options: HorrorTreatmentOptions;
	readonly salt: number;
}): number {
	return unitRandom({ seed: options.frame.cut?.seed ?? 0, salt });
}

export function horrorEffectSignedRandom({
	options,
	salt,
}: {
	readonly options: HorrorTreatmentOptions;
	readonly salt: number;
}): number {
	return signedRandom({ seed: options.frame.cut?.seed ?? 0, salt });
}

export function clampHorror(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function lerpHorror({
	end,
	progress,
	start,
}: {
	readonly end: number;
	readonly progress: number;
	readonly start: number;
}): number {
	return start + (end - start) * progress;
}

export function horrorOutCubic(value: number): number {
	return 1 - (1 - clampHorror(value)) ** 3;
}

export function horrorInCubic(value: number): number {
	return clampHorror(value) ** 3;
}

export function horrorInOutCubic(value: number): number {
	const progress = clampHorror(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export function horrorOutExpo(value: number): number {
	const progress = clampHorror(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

export function horrorOutBack(value: number): number {
	const progress = clampHorror(value);
	const shifted = progress - 1;
	const overshoot = 2.2;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}
