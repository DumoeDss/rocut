import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export interface LooksTreatmentDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
}

export interface LooksGlyph {
	readonly character: string;
	readonly index: number;
	readonly x: number;
	readonly width: number;
}

export function treatmentSeconds(options: LooksTreatmentDraw): number {
	return options.frame.localTime / 120_000;
}

export function treatmentPhase(options: LooksTreatmentDraw): number {
	return treatmentSeconds(options) * Math.PI * 2;
}

export function treatmentProgress(options: LooksTreatmentDraw): number {
	return Math.min(1, Math.max(0, options.frame.progress));
}

export function approximateLooksTextWidth(options: LooksTreatmentDraw): number {
	const natural = Array.from(options.text).reduce(
		(total, character) =>
			total +
			(character.trim().length === 0
				? options.size * 0.34
				: options.size * 0.62),
		0,
	);
	return Math.min(options.maxWidth, Math.max(options.size * 0.45, natural));
}

export function looksGlyphs(options: LooksTreatmentDraw): LooksGlyph[] {
	const characters = Array.from(options.text);
	const advances = characters.map((character) =>
		character.trim().length === 0 ? options.size * 0.34 : options.size * 0.62,
	);
	const natural = advances.reduce((total, advance) => total + advance, 0);
	const fit = natural > 0 ? Math.min(1, options.maxWidth / natural) : 1;
	const width = natural * fit;
	let cursor = options.x - width / 2;
	const glyphs: LooksGlyph[] = [];
	for (const [index, character] of characters.entries()) {
		const advance = advances[index]! * fit;
		const center = cursor + advance / 2;
		cursor += advance;
		if (character.trim().length === 0) continue;
		glyphs.push({ character, index, width: advance, x: center });
	}
	return glyphs;
}

export function drawLooksGlyphs({
	colorAt,
	options,
	scaleX = 1,
	scaleY = 1,
}: {
	readonly colorAt: (glyph: LooksGlyph) => string;
	readonly options: LooksTreatmentDraw;
	readonly scaleX?: number;
	readonly scaleY?: number;
}): void {
	for (const glyph of looksGlyphs(options)) {
		options.ctx.save();
		options.ctx.translate(glyph.x, options.y);
		options.ctx.scale(scaleX, scaleY);
		options.ctx.fillStyle = colorAt(glyph);
		options.ctx.textAlign = "center";
		options.ctx.fillText(glyph.character, 0, 0, glyph.width / scaleX);
		options.ctx.restore();
	}
}

export function withLooksContext({
	draw,
	options,
}: {
	readonly draw: () => void;
	readonly options: LooksTreatmentDraw;
}): void {
	options.ctx.save();
	try {
		draw();
	} finally {
		options.ctx.restore();
	}
}
