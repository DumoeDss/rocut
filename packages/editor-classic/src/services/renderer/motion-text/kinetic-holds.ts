import { kineticWordSegments } from "./kinetic-words";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

const TICKS_PER_SECOND = 120_000;

interface KineticHoldDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

interface WordGlyph {
	readonly character: string;
	readonly wordCenter: number;
	readonly wordIndex: number;
	readonly x: number;
	readonly y: number;
}

interface GlyphTransform {
	readonly rotation?: number;
	readonly scale?: number;
	readonly skewX?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}

export function drawKineticHold(options: KineticHoldDraw): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "knWordPulse":
			return drawWordPulse(options);
		case "knCounterRock":
			return drawCounterRock(options);
		case "knWordRide":
			return drawWordRide(options);
		case "knTickShift":
			return drawTickShift(options);
		case "knBeatLean":
			return drawBeatLean(options);
		case "knGapBreath":
			return drawGapBreath(options);
		default:
			return false;
	}
}

function drawWordPulse(options: KineticHoldDraw): boolean {
	const glyphs = positionedWordGlyphs(options);
	if (glyphs.length === 0) return true;
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const period = 0.52;
	const wordCount = wordCountOf(glyphs);
	const current = Math.floor(seconds / period) % wordCount;
	const since = seconds % period;
	const pulse = Math.exp(-since * 4) * 0.154;
	for (const glyph of glyphs) {
		drawWordGlyph({
			...options,
			glyph,
			transform: {
				scale: glyph.wordIndex === current ? 1 + pulse : 1,
			},
		});
	}
	return true;
}

function drawCounterRock(options: KineticHoldDraw): boolean {
	const glyphs = positionedWordGlyphs(options);
	if (glyphs.length === 0) return true;
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const amplitude =
		(4 * Math.PI * Math.sin(seconds * Math.PI * 2 * 0.55)) / 180;
	const wordCount = wordCountOf(glyphs);
	for (const glyph of glyphs) {
		drawWordGlyph({
			...options,
			glyph,
			transform: {
				rotation:
					amplitude *
					(glyph.wordIndex % 2 === 0 ? 1 : -1) *
					(wordCount === 1 ? 0.6 : 1),
			},
		});
	}
	return true;
}

function drawWordRide(options: KineticHoldDraw): boolean {
	const glyphs = positionedWordGlyphs(options);
	if (glyphs.length === 0) return true;
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	for (const glyph of glyphs) {
		const phase = seconds * 3.1 - glyph.wordIndex * 1.25;
		drawWordGlyph({
			...options,
			glyph,
			transform: {
				rotation: (Math.cos(phase) * 3.5 * Math.PI) / 180,
				translateY: options.size * 0.077 * Math.sin(phase),
			},
		});
	}
	return true;
}

function drawTickShift(options: KineticHoldDraw): boolean {
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const period = 0.5;
	const since = seconds % period;
	const index = Math.floor(seconds / period);
	const direction = index % 2 === 0 ? -1 : 1;
	const progress = outBack({ overshoot: 2.6, value: clamp01(since / 0.09) });
	const distance = options.size * 0.055;
	const offset =
		lerp({ start: -direction, end: direction, progress }) * distance;
	options.ctx.save();
	options.ctx.translate(offset, 0);
	options.drawGlyph(options);
	options.ctx.restore();
	return true;
}

function drawBeatLean(options: KineticHoldDraw): boolean {
	const glyphs = positionedWordGlyphs(options);
	if (glyphs.length === 0) return true;
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const period = 0.55;
	const since = seconds % period;
	const beat = Math.floor(seconds / period);
	const amplitude =
		(19.8 * Math.PI * Math.exp(-since * 4.5) * Math.cos(since * 15)) / 180;
	for (const glyph of glyphs) {
		drawWordGlyph({
			...options,
			glyph,
			transform: {
				skewX: amplitude * ((glyph.wordIndex + beat) % 2 === 0 ? -1 : 1),
			},
		});
	}
	return true;
}

function drawGapBreath(options: KineticHoldDraw): boolean {
	const glyphs = positionedWordGlyphs(options);
	const wordCount = wordCountOf(glyphs);
	if (wordCount < 2) return false;
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const amplitude =
		options.size * 0.176 * (0.5 - 0.5 * Math.cos(seconds * Math.PI * 2 * 0.4));
	for (const glyph of glyphs) {
		drawWordGlyph({
			...options,
			glyph,
			transform: {
				translateX: (glyph.wordIndex - (wordCount - 1) / 2) * amplitude,
			},
		});
	}
	return true;
}

function positionedWordGlyphs(options: KineticHoldDraw): readonly WordGlyph[] {
	const words = kineticWordSegments({ text: options.text });
	if (words.length === 0) return [];
	const glyphWidth = options.size * 0.62;
	const gap = options.size * (options.text.includes(" ") ? 0.34 : 0.12);
	const wordWidths = words.map((word) => Array.from(word).length * glyphWidth);
	const natural =
		wordWidths.reduce((total, width) => total + width, 0) +
		gap * (words.length - 1);
	const fit = Math.min(1, options.maxWidth / Math.max(1, natural));
	let cursor = options.x - (natural * fit) / 2;
	const glyphs: WordGlyph[] = [];
	for (const [wordIndex, word] of words.entries()) {
		const wordWidth = wordWidths[wordIndex] * fit;
		const wordCenter = cursor + wordWidth / 2;
		for (const [index, character] of Array.from(word).entries()) {
			glyphs.push({
				character,
				wordCenter,
				wordIndex,
				x: cursor + (index + 0.5) * glyphWidth * fit,
				y: options.y,
			});
		}
		cursor += wordWidth + gap * fit;
	}
	return glyphs;
}

function drawWordGlyph({
	ctx,
	drawGlyph,
	glyph,
	size,
	transform,
}: KineticHoldDraw & {
	readonly glyph: WordGlyph;
	readonly transform: GlyphTransform;
}): void {
	ctx.save();
	ctx.translate(
		glyph.wordCenter + (transform.translateX ?? 0),
		glyph.y + (transform.translateY ?? 0),
	);
	if (transform.rotation) ctx.rotate(transform.rotation);
	if (transform.skewX) {
		ctx.transform(1, 0, Math.tan(transform.skewX), 1, 0, 0);
	}
	const scale = transform.scale ?? 1;
	ctx.scale(scale, scale);
	ctx.translate(glyph.x - glyph.wordCenter, 0);
	ctx.textAlign = "center";
	drawGlyph({
		text: glyph.character,
		x: 0,
		y: 0,
		maxWidth: size * 0.76,
		size,
	});
	ctx.restore();
}

function wordCountOf(glyphs: readonly WordGlyph[]): number {
	return glyphs.length === 0 ? 0 : glyphs[glyphs.length - 1].wordIndex + 1;
}

function outBack({
	value,
	overshoot,
}: {
	readonly value: number;
	readonly overshoot: number;
}): number {
	const shifted = clamp01(value) - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function lerp({
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

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
