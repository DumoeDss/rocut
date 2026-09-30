import { drawHorrorTreatment } from "./horror-treatments";
import { drawKineticTreatment } from "./kinetic-treatments";
import { drawLooksTreatment } from "./looks-treatments";
import { drawTreatTransTreatment } from "./treat-trans-treatments";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface TypographyTreatmentDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
}

interface PositionedGlyph {
	readonly character: string;
	readonly globalIndex: number;
	readonly x: number;
	readonly y: number;
}

export function drawTypographyTreatment(
	options: TypographyTreatmentDraw,
): boolean {
	if (drawHorrorTreatment(options)) return true;
	if (drawKineticTreatment(options)) return true;
	if (drawLooksTreatment(options)) return true;
	if (drawTreatTransTreatment(options)) return true;
	switch (options.frame.cut?.preset.treat) {
		case "tyHollowKey":
			drawHollowKey(options);
			return true;
		case "tyHeadRules":
			drawHeadRules(options);
			return true;
		case "tyHeadBig":
			drawHeadBig(options);
			return true;
		case "tyIndexSup":
			drawIndexSup(options);
			return true;
		default:
			return false;
	}
}

function drawHollowKey(options: TypographyTreatmentDraw): void {
	const glyphs = positionedGlyphs(options);
	const keyIndex = keyGlyphIndex(options.frame.cut?.text ?? "");
	for (const glyph of glyphs) {
		options.ctx.textAlign = "center";
		if (glyph.globalIndex === keyIndex) {
			options.ctx.lineWidth = Math.max(1.5, options.size * 0.045);
			options.ctx.strokeStyle = options.frame.palette.accent;
			options.ctx.strokeText(
				glyph.character,
				glyph.x,
				glyph.y,
				options.size * 0.76,
			);
		} else {
			options.ctx.fillText(
				glyph.character,
				glyph.x,
				glyph.y,
				options.size * 0.76,
			);
		}
	}
}

function drawHeadRules(options: TypographyTreatmentDraw): void {
	options.ctx.textAlign = "center";
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	const width = measuredWidth(options);
	const left = options.x - width / 2;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		left,
		options.y - options.size * 0.66,
		width,
		Math.max(3, options.size * 0.075),
	);
	options.ctx.fillRect(
		left,
		options.y + options.size * 0.66,
		width,
		Math.max(1, options.size * 0.018),
	);
}

function drawHeadBig(options: TypographyTreatmentDraw): void {
	const glyphs = positionedGlyphs(options);
	if (glyphs.length < 2) {
		options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
		return;
	}
	const key = glyphs.find((glyph) => /[\p{L}\p{N}]/u.test(glyph.character));
	if (!key) return;
	const scale = 1.48;
	const extra = options.size * 0.62 * (scale - 1);
	for (const glyph of glyphs) {
		const isHead = glyph === key;
		const shift = isHead ? -extra / 2 : extra / 2;
		drawTransformedGlyph({
			...options,
			color: isHead ? options.frame.palette.accent : undefined,
			deltaX: shift,
			deltaY: isHead ? -options.size * 0.36 * (scale - 1) : 0,
			glyph,
			scale: isHead ? scale : 1,
		});
	}
}

function drawIndexSup(options: TypographyTreatmentDraw): void {
	const glyphs = positionedGlyphs(options);
	for (const glyph of glyphs) {
		options.ctx.textAlign = "center";
		options.ctx.fillStyle = options.frame.palette.foreground;
		options.ctx.fillText(
			glyph.character,
			glyph.x,
			glyph.y,
			options.size * 0.76,
		);
		const baseFont = options.ctx.font;
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.textAlign = "left";
		options.ctx.font = `${options.frame.font.style} ${options.frame.font.weight} ${Math.max(10, options.size * 0.26)}px ${quoteFamily(options.frame.font.family)}`;
		options.ctx.fillText(
			String(glyph.globalIndex + 1),
			glyph.x + options.size * 0.32,
			glyph.y - options.size * 0.42,
		);
		options.ctx.font = baseFont;
	}
}

function positionedGlyphs(options: TypographyTreatmentDraw): PositionedGlyph[] {
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
	const positioned: PositionedGlyph[] = [];
	for (const [index, character] of characters.entries()) {
		const advance = advances[index] * widthScale;
		const center = cursor + advance / 2;
		cursor += advance;
		if (/\s/u.test(character)) continue;
		let globalIndex = globalCharacters.indexOf(character, searchFrom);
		if (globalIndex < 0) globalIndex = globalCharacters.indexOf(character);
		if (globalIndex < 0) globalIndex = positioned.length;
		searchFrom = globalIndex + 1;
		positioned.push({ character, globalIndex, x: center, y: options.y });
	}
	return positioned;
}

function keyGlyphIndex(text: string): number {
	const characters = Array.from(text).filter(
		(character) => !/\s/u.test(character),
	);
	const han = characters.findIndex((character) =>
		/\p{Script=Han}/u.test(character),
	);
	if (han >= 0) return han;
	const alphaNumeric = characters.findIndex((character) =>
		/[\p{L}\p{N}]/u.test(character),
	);
	return alphaNumeric >= 0 ? alphaNumeric : 0;
}

function drawTransformedGlyph({
	color,
	ctx,
	deltaX,
	deltaY,
	frame,
	glyph,
	scale,
	size,
}: TypographyTreatmentDraw & {
	readonly color?: string;
	readonly deltaX: number;
	readonly deltaY: number;
	readonly glyph: PositionedGlyph;
	readonly scale: number;
}): void {
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(glyph.x + deltaX, glyph.y + deltaY);
	ctx.scale(scale, scale);
	ctx.textAlign = "center";
	ctx.fillStyle = color ?? frame.palette.foreground;
	ctx.fillText(glyph.character, 0, 0, size * 0.76);
	ctx.restore();
	ctx.fillStyle = baseFill;
}

function measuredWidth(options: TypographyTreatmentDraw): number {
	const characters = Array.from(options.text);
	const natural = characters.reduce(
		(sum, character) =>
			sum + (/\s/u.test(character) ? options.size * 0.34 : options.size * 0.62),
		0,
	);
	return Math.min(options.maxWidth, natural);
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll('"', '\\"')}"`;
}
