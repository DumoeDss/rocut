import { drawCoreExit } from "./core-exits";
import { drawExitBExit } from "./exit-b-exits";
import { drawExitHoldExit } from "./exit-hold-exits";
import { drawHorrorExit } from "./horror-exits";
import { drawKineticExit } from "./kinetic-exits";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface TypographyExitDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

interface PositionedGlyph {
	readonly character: string;
	readonly globalIndex: number;
	readonly order: number;
	readonly x: number;
	readonly y: number;
}

export function drawTypographyExit(options: TypographyExitDraw): boolean {
	if (options.frame.exitProgress <= 0.001) return false;
	if (drawCoreExit(options)) return true;
	if (drawHorrorExit(options)) return true;
	if (drawKineticExit(options)) return true;
	if (drawExitHoldExit(options)) return true;
	if (drawExitBExit(options)) return true;
	switch (options.frame.cut?.preset.exit) {
		case "tyStrike":
			drawStrike(options);
			return true;
		case "tyToDot":
			drawToDot(options);
			return true;
		case "tyLineFeed":
			drawLineFeed(options);
			return true;
		case "tyBracketClose":
			drawBracketClose(options);
			return true;
		case "tyToIndex":
			drawToIndex(options);
			return true;
		case "tyKeyLast":
			drawKeyLast(options);
			return true;
		case "tyUnderSink":
			drawUnderSink(options);
			return true;
		case "tyFoldVert":
			drawFoldVert(options);
			return true;
		default:
			return false;
	}
}

function drawStrike(options: TypographyExitDraw): void {
	const glyphs = positionedGlyphs(options);
	const progress = options.frame.exitProgress;
	for (const glyph of glyphs) {
		const q = clamp((progress - 0.3 - glyph.order * 0.3) / 0.4);
		if (q >= 1) continue;
		if (q <= 0) {
			drawPlainGlyph({ options, glyph });
			continue;
		}
		const eased = inCubic(q);
		drawTransformedGlyph({
			...options,
			alpha: 1 - eased ** 2,
			glyph,
			scaleY: 1 - eased * 0.95,
		});
	}
	const grow = outExpo(clamp(progress / 0.38));
	const retract = inCubic(clamp((progress - 0.74) / 0.26));
	drawHorizontalRule({ options, grow, retract, offset: options.size * 0.04 });
}

function drawToDot(options: TypographyExitDraw): void {
	const progress = options.frame.exitProgress;
	for (const glyph of positionedGlyphs(options)) {
		const q = clamp((progress - glyph.order * 0.4) / 0.6);
		if (q <= 0) {
			drawPlainGlyph({ options, glyph });
			continue;
		}
		if (q >= 1) continue;
		if (q < 0.5) {
			drawTransformedGlyph({
				...options,
				glyph,
				scaleX: lerp({ start: 1, end: 0.3, progress: inCubic(q / 0.5) }),
				scaleY: lerp({ start: 1, end: 0.3, progress: inCubic(q / 0.5) }),
			});
			continue;
		}
		const dotProgress = (q - 0.5) / 0.5;
		const scale = 1.5 * (1 - inCubic(dotProgress));
		drawTransformedGlyph({
			...options,
			alpha: 1 - dotProgress ** 2,
			character: "・",
			color: options.frame.palette.accent,
			glyph,
			scaleX: scale,
			scaleY: scale,
		});
	}
}

function drawLineFeed(options: TypographyExitDraw): void {
	const progress = options.frame.exitProgress;
	if (progress >= 0.999) return;
	const stepPosition = progress * 3;
	const step = Math.min(3, Math.floor(stepPosition));
	const fraction = stepPosition - step;
	const offsetProgress = Math.min(
		1,
		(step + outCubic(clamp(fraction * 2.6))) / 3,
	);
	const distance = options.size * 1.8;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - options.maxWidth / 2,
		options.y - options.size * 0.78,
		options.maxWidth,
		options.size * 1.56,
	);
	options.ctx.clip();
	for (const glyph of positionedGlyphs(options)) {
		drawTransformedGlyph({
			...options,
			deltaY: -distance * offsetProgress,
			glyph,
		});
	}
	options.ctx.restore();
}

function drawBracketClose(options: TypographyExitDraw): void {
	const progress = options.frame.exitProgress;
	const eased = inOutCubic(clamp((progress - 0.12) / 0.7));
	const halfWidth = (options.maxWidth / 2 + options.size * 0.12) * (1 - eased);
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - halfWidth,
		options.y - options.size * 0.75,
		halfWidth * 2,
		options.size * 1.5,
	);
	options.ctx.clip();
	if (eased < 1) {
		for (const glyph of positionedGlyphs(options)) {
			drawPlainGlyph({ options, glyph });
		}
	}
	options.ctx.restore();
	const alpha = clamp(progress / 0.12) * (1 - clamp((progress - 0.84) / 0.16));
	if (alpha <= 0) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	const line = Math.max(2, options.size * 0.055);
	const arm = Math.max(options.size * 0.28, options.size * 0.45);
	const left = options.x - halfWidth - options.size * 0.18;
	const right = options.x + halfWidth + options.size * 0.18;
	const top = options.y - options.size * 0.68;
	const bottom = options.y + options.size * 0.68;
	options.ctx.fillRect(left, top, line, arm);
	options.ctx.fillRect(left, top, arm, line);
	options.ctx.fillRect(right - line, bottom - arm, line, arm);
	options.ctx.fillRect(right - arm, bottom - line, arm, line);
	options.ctx.globalAlpha = baseAlpha;
}

function drawToIndex(options: TypographyExitDraw): void {
	const progress = options.frame.exitProgress;
	for (const [index, glyph] of positionedGlyphs(options).entries()) {
		const q = clamp((progress - glyph.order * 0.4) / 0.6);
		if (q <= 0) {
			drawPlainGlyph({ options, glyph });
			continue;
		}
		if (q >= 1) continue;
		if (q < 0.3) {
			const scale = lerp({
				start: 1,
				end: 0.55,
				progress: inCubic(q / 0.3),
			});
			drawTransformedGlyph({ ...options, glyph, scaleX: scale, scaleY: scale });
			continue;
		}
		const indexProgress = (q - 0.3) / 0.7;
		drawTransformedGlyph({
			...options,
			alpha: 1 - inCubic(indexProgress),
			character: String(index + 1).padStart(2, "0"),
			color: options.frame.palette.secondary,
			deltaY: -options.size * 0.2 * indexProgress,
			glyph,
			scaleX: 0.42,
			scaleY: 0.42,
		});
	}
}

function drawKeyLast(options: TypographyExitDraw): void {
	const glyphs = positionedGlyphs(options);
	if (glyphs.length === 0) return;
	const progress = options.frame.exitProgress;
	const keyIndex = keyGlyphIndex(options.frame.cut?.text ?? "");
	const key =
		glyphs.find((glyph) => glyph.globalIndex === keyIndex) ?? glyphs[0];
	if (!key) return;
	const maxDistance = Math.max(
		1,
		...glyphs.map((glyph) => Math.abs(glyph.globalIndex - keyIndex)),
	);
	for (const glyph of glyphs) {
		if (glyph.globalIndex === keyIndex) {
			const q = clamp((progress - 0.45) / 0.55);
			if (q >= 1) continue;
			const eased = inCubic(q);
			drawTransformedGlyph({
				...options,
				alpha: 1 - eased,
				glyph,
				scaleX: 1 + eased * 1.8,
				scaleY: 1 + eased * 1.8,
			});
			continue;
		}
		const distance = Math.abs(glyph.globalIndex - keyIndex) / maxDistance;
		const q = clamp((progress - (1 - distance) * 0.2) / 0.45);
		if (q <= 0) {
			drawPlainGlyph({ options, glyph });
			continue;
		}
		if (q >= 1) continue;
		const eased = inCubic(q);
		drawTransformedGlyph({
			...options,
			alpha: 1 - eased,
			deltaX: (key.x - glyph.x) * eased,
			deltaY: (key.y - glyph.y) * eased,
			glyph,
			scaleX: 1 - eased * 0.6,
			scaleY: 1 - eased * 0.6,
		});
	}
}

function drawUnderSink(options: TypographyExitDraw): void {
	const progress = options.frame.exitProgress;
	for (const glyph of positionedGlyphs(options)) {
		const q = clamp((progress - 0.2 - glyph.order * 0.4) / 0.35);
		if (q <= 0) {
			drawPlainGlyph({ options, glyph });
			continue;
		}
		if (q >= 1) continue;
		const eased = inCubic(q);
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			glyph.x - options.size * 0.42,
			glyph.y - options.size * 0.72,
			options.size * 0.84,
			options.size * 1.28,
		);
		options.ctx.clip();
		drawTransformedGlyph({
			...options,
			deltaY: options.size * 1.25 * eased,
			glyph,
		});
		options.ctx.restore();
	}
	const grow = outExpo(clamp(progress / 0.28));
	const retract = inCubic(clamp((progress - 0.78) / 0.22));
	drawHorizontalRule({ options, grow, retract, offset: options.size * 0.56 });
}

function drawFoldVert(options: TypographyExitDraw): void {
	const glyphs = positionedGlyphs(options);
	const progress = options.frame.exitProgress;
	const fold = inOutCubic(clamp(progress / 0.5));
	const fade = clamp((progress - 0.36) / 0.5);
	if (fade >= 1) return;
	for (const [index, glyph] of glyphs.entries()) {
		const targetY =
			options.y + (index - (glyphs.length - 1) / 2) * options.size * 1.02;
		const drift = inCubic(fade) * options.size * 0.25;
		drawTransformedGlyph({
			...options,
			alpha: 1 - inCubic(fade),
			deltaX: (options.x - glyph.x) * fold,
			deltaY: (targetY - glyph.y) * fold + drift,
			glyph,
		});
	}
}

function drawHorizontalRule({
	options,
	grow,
	retract,
	offset,
}: {
	readonly options: TypographyExitDraw;
	readonly grow: number;
	readonly retract: number;
	readonly offset: number;
}): void {
	const left = options.x - options.maxWidth / 2;
	const right = options.x + options.maxWidth / 2;
	const start = lerp({ start: left, end: right, progress: retract });
	const end = lerp({ start: left, end: right, progress: grow });
	if (end - start < 1) return;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		start,
		options.y + offset,
		end - start,
		Math.max(2.5, options.size * 0.06),
	);
}

function positionedGlyphs(options: TypographyExitDraw): PositionedGlyph[] {
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
	readonly options: TypographyExitDraw;
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
	alpha = 1,
	character,
	color,
	ctx,
	deltaX = 0,
	deltaY = 0,
	drawGlyph,
	glyph,
	scaleX = 1,
	scaleY = 1,
	size,
}: TypographyExitDraw & {
	readonly alpha?: number;
	readonly character?: string;
	readonly color?: string;
	readonly deltaX?: number;
	readonly deltaY?: number;
	readonly glyph: PositionedGlyph;
	readonly scaleX?: number;
	readonly scaleY?: number;
}): void {
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(glyph.x + deltaX, glyph.y + deltaY);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.textAlign = "center";
	if (color) ctx.fillStyle = color;
	drawGlyph({
		text: character ?? glyph.character,
		x: 0,
		y: 0,
		maxWidth: size * 0.76,
		size,
	});
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
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

function inOutCubic(value: number): number {
	const progress = clamp(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
