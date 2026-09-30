import { unitRandom } from "./deterministic-random";
import { drawCoreHold } from "./core-holds";
import { drawExitBHold } from "./exit-b-holds";
import { drawExitHoldHold } from "./exit-hold-holds";
import { drawHorrorHold } from "./horror-holds";
import { drawKineticHold } from "./kinetic-holds";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

const TICKS_PER_SECOND = 120_000;

interface TypographyHoldDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

interface PositionedGlyph {
	readonly character: string;
	readonly globalIndex: number;
	readonly x: number;
	readonly y: number;
}

export function drawTypographyHold(options: TypographyHoldDraw): boolean {
	if (
		options.frame.enterProgress < 0.999 &&
		options.frame.cut?.preset.enter !== "cut"
	) {
		return false;
	}
	if (drawCoreHold(options)) return true;
	if (drawHorrorHold(options)) return true;
	if (drawKineticHold(options)) return true;
	if (drawExitHoldHold(options)) return true;
	if (drawExitBHold(options)) return true;
	switch (options.frame.cut?.preset.hold) {
		case "tyKeyPulse":
			return drawKeyPulse(options);
		case "tyReadCursor":
			return drawReadCursor(options);
		case "tyOutlineBlink":
			return drawOutlineBlink(options);
		case "tyTrackStep":
			return drawTrackStep(options);
		default:
			return false;
	}
}

function drawKeyPulse(options: TypographyHoldDraw): boolean {
	const glyphs = positionedGlyphs({ options });
	if (glyphs.length === 0) return true;
	const keyIndex = keyGlyphIndex(options.frame.cut?.text ?? "");
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const pulse = (0.5 + 0.5 * Math.sin(seconds * Math.PI * 2 * 0.95)) ** 4;
	const amount = glyphs.length === 1 ? 0.07 : 0.1;
	if (
		glyphs.length === 1 &&
		!/^\p{Script=Han}$/u.test(glyphs[0]?.character ?? "")
	) {
		return false;
	}
	for (const glyph of glyphs) {
		if (glyph.globalIndex === keyIndex) {
			drawTransformedGlyph({
				...options,
				glyph,
				scale: 1 + amount * pulse,
			});
		} else {
			drawPlainGlyph({ options, glyph });
		}
	}
	return true;
}

function drawReadCursor(options: TypographyHoldDraw): boolean {
	const glyphs = positionedGlyphs({ options });
	if (glyphs.length === 0) return true;
	const cursor = options.frame.localTime / TICKS_PER_SECOND / 0.25;
	const position = Math.floor(cursor) % (glyphs.length + 2);
	const fraction = cursor % 1;
	const liftProgress =
		outCubic(clamp(fraction * 4)) *
		(1 - inCubic(clamp((fraction - 0.6) / 0.4)));
	for (const [index, glyph] of glyphs.entries()) {
		if (index === position) {
			drawTransformedGlyph({
				...options,
				color: options.frame.palette.accent,
				deltaY: -options.size * 0.07 * liftProgress,
				glyph,
			});
		} else {
			drawPlainGlyph({ options, glyph });
		}
	}
	return true;
}

function drawOutlineBlink(options: TypographyHoldDraw): boolean {
	const blinkCycle = 48_000;
	const shiftedTime = options.frame.localTime + 28_000;
	const blinkPhase = (shiftedTime % blinkCycle) / blinkCycle;
	if (blinkPhase > 0.22) return false;
	const glyphs = positionedGlyphs({ options });
	if (glyphs.length === 0) return true;
	const cycle = Math.floor(shiftedTime / blinkCycle);
	const first = Math.floor(
		unitRandom({ seed: options.frame.cut?.seed ?? 0, salt: cycle * 3 + 41 }) *
			glyphs.length,
	);
	const second =
		glyphs.length > 3 &&
		unitRandom({
			seed: options.frame.cut?.seed ?? 0,
			salt: cycle * 3 + 42,
		}) < 0.3
			? Math.floor(
					unitRandom({
						seed: options.frame.cut?.seed ?? 0,
						salt: cycle * 3 + 43,
					}) * glyphs.length,
				)
			: -1;
	for (const [index, glyph] of glyphs.entries()) {
		if (index === first || index === second) {
			drawOutlineGlyph({ options, glyph });
		} else {
			drawPlainGlyph({ options, glyph });
		}
	}
	return true;
}

function drawTrackStep(options: TypographyHoldDraw): boolean {
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const step = seconds / 0.55;
	const index = Math.floor(step);
	const fraction = step - index;
	const levels = [0, 1, 2, 1] as const;
	const start = levels[index % levels.length] ?? 0;
	const end = levels[(index + 1) % levels.length] ?? 0;
	const level = lerp({
		start,
		end,
		progress: outExpo(clamp((fraction - 0.85) / 0.15)),
	});
	const glyphs = positionedGlyphs({
		options,
		tracking: options.size * 0.05 * level,
	});
	if (glyphs.length < 2) return false;
	for (const glyph of glyphs) drawPlainGlyph({ options, glyph });
	return true;
}

function positionedGlyphs({
	options,
	tracking = 0,
}: {
	readonly options: TypographyHoldDraw;
	readonly tracking?: number;
}): PositionedGlyph[] {
	const characters = Array.from(options.text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? options.size * 0.34 : options.size * 0.62,
	);
	const naturalWidth =
		advances.reduce((sum, advance) => sum + advance, 0) +
		Math.max(0, characters.length - 1) * tracking;
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
		cursor +=
			advance + (index < characters.length - 1 ? tracking * widthScale : 0);
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
	const words = text.trim().match(/\S+/gu) ?? [];
	const firstWord = words[0];
	if (words.length > 1 && firstWord) {
		let longest = firstWord;
		for (const word of words.slice(1)) {
			if (Array.from(word).length > Array.from(longest).length) longest = word;
		}
		return Array.from(text.slice(0, text.indexOf(longest))).filter(
			(character) => !/\s/u.test(character),
		).length;
	}
	const characters = Array.from(text).filter(
		(character) => !/\s/u.test(character),
	);
	const han = characters.findIndex((character) =>
		/\p{Script=Han}/u.test(character),
	);
	return han >= 0 ? han : Math.max(0, Math.floor((characters.length - 1) / 2));
}

function drawPlainGlyph({
	glyph,
	options,
}: {
	readonly glyph: PositionedGlyph;
	readonly options: TypographyHoldDraw;
}): void {
	options.ctx.textAlign = "center";
	options.drawGlyph({
		text: glyph.character,
		x: glyph.x,
		y: glyph.y,
		maxWidth: options.size * 0.76,
		size: options.size,
	});
}

function drawTransformedGlyph({
	color,
	ctx,
	deltaY = 0,
	drawGlyph,
	glyph,
	scale = 1,
	size,
}: TypographyHoldDraw & {
	readonly color?: string;
	readonly deltaY?: number;
	readonly glyph: PositionedGlyph;
	readonly scale?: number;
}): void {
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(glyph.x, glyph.y + deltaY);
	ctx.scale(scale, scale);
	ctx.textAlign = "center";
	if (color) ctx.fillStyle = color;
	drawGlyph({ text: glyph.character, x: 0, y: 0, maxWidth: size * 0.76, size });
	ctx.restore();
	ctx.fillStyle = baseFill;
}

function drawOutlineGlyph({
	glyph,
	options,
}: {
	readonly glyph: PositionedGlyph;
	readonly options: TypographyHoldDraw;
}): void {
	options.ctx.save();
	options.ctx.lineWidth = Math.max(1, options.size * 0.045);
	options.ctx.strokeStyle = options.frame.palette.accent;
	options.ctx.textAlign = "center";
	options.ctx.strokeText(
		glyph.character,
		glyph.x,
		glyph.y,
		options.size * 0.76,
	);
	options.ctx.restore();
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
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

function outExpo(value: number): number {
	return value >= 1 ? 1 : 1 - 2 ** (-10 * value);
}

function outCubic(value: number): number {
	return 1 - (1 - clamp(value)) ** 3;
}

function inCubic(value: number): number {
	return clamp(value) ** 3;
}
