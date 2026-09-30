import { drawCoreEntrance } from "./core-entrances";
import { drawEnterAEntrance } from "./enter-a-entrances";
import { drawEnterBEntrance } from "./enter-b-entrances";
import { drawHorrorEntrance } from "./horror-entrances";
import { drawKineticEntrance } from "./kinetic-entrances";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface TypographyEntranceDraw extends TypographyTextDraw {
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

export function drawTypographyEntrance(
	options: TypographyEntranceDraw,
): boolean {
	if (options.frame.enterProgress >= 0.999) return false;
	if (drawCoreEntrance(options)) return true;
	if (drawHorrorEntrance(options)) return true;
	if (drawKineticEntrance(options)) return true;
	if (drawEnterAEntrance(options)) return true;
	if (drawEnterBEntrance(options)) return true;
	switch (options.frame.cut?.preset.enter) {
		case "tyKeyFirst":
			drawKeyFirst(options);
			return true;
		case "tyLineWipe":
			drawLineWipe(options);
			return true;
		case "tyZoomOne":
			drawZoomOne(options);
			return true;
		case "tyUnderLift":
			drawUnderLift(options);
			return true;
		case "tyDotGrow":
			drawDotGrow(options);
			return true;
		case "tyBracketOpen":
			drawBracketOpen(options);
			return true;
		case "tyRetype":
			drawRetype(options);
			return true;
		case "tyRubyDrop":
			drawRubyDrop(options);
			return true;
		default:
			return false;
	}
}

function drawKeyFirst(options: TypographyEntranceDraw): void {
	const glyphs = positionedGlyphs(options);
	if (glyphs.length === 0) return;
	const keyIndex = keyGlyphIndex(options.frame.cut?.text ?? "");
	const key = glyphs.find((glyph) => glyph.globalIndex === keyIndex);
	const anchorX = key?.x ?? options.x;
	const anchorY = key?.y ?? options.y;
	const maxDistance = Math.max(
		1,
		...glyphs.map((glyph) => Math.abs(glyph.globalIndex - keyIndex)),
	);
	for (const glyph of glyphs) {
		if (glyph.globalIndex === keyIndex) {
			const q = clamp(options.frame.enterProgress / 0.42);
			if (q <= 0) continue;
			drawTransformedGlyph({
				...options,
				glyph,
				scaleX: lerp({ start: 2.1, end: 1, progress: outExpo(q) }),
				scaleY: lerp({ start: 2.1, end: 1, progress: outExpo(q) }),
				alpha: clamp(q * 4),
			});
			continue;
		}
		const distance = Math.abs(glyph.globalIndex - keyIndex) / maxDistance;
		const q = clamp(
			(options.frame.enterProgress - 0.3 - distance * 0.35) / 0.35,
		);
		if (q <= 0) continue;
		const eased = outExpo(q);
		drawTransformedGlyph({
			...options,
			glyph,
			deltaX: (anchorX - glyph.x) * (1 - eased),
			deltaY: (anchorY - glyph.y) * (1 - eased),
			scaleX: lerp({ start: 0.4, end: 1, progress: eased }),
			scaleY: lerp({ start: 0.4, end: 1, progress: eased }),
			alpha: clamp(q * 2.5),
		});
	}
}

function drawLineWipe(options: TypographyEntranceDraw): void {
	const glyphs = positionedGlyphs(options);
	const progress = inOutCubic(options.frame.enterProgress);
	const left =
		glyphs.length > 0 ? glyphs[0].x - options.size * 0.36 : options.x;
	const right =
		glyphs.length > 0
			? glyphs[glyphs.length - 1].x + options.size * 0.36
			: options.x;
	const edge = lerp({ start: left, end: right, progress });
	for (const glyph of glyphs) {
		const glyphLeft = glyph.x - options.size * 0.36;
		const revealed = clamp(
			(edge - glyphLeft) / Math.max(1, options.size * 0.72),
		);
		if (revealed <= 0) continue;
		if (revealed >= 1) {
			drawPlainGlyph({ options, glyph });
			continue;
		}
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			glyphLeft,
			glyph.y - options.size * 0.72,
			options.size * 0.72 * revealed,
			options.size * 1.44,
		);
		options.ctx.clip();
		drawPlainGlyph({ options, glyph });
		options.ctx.restore();
	}
	const ruleStart = lerp({ start: left, end: edge, progress: 0.72 });
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		ruleStart,
		options.y + options.size * 0.64,
		Math.max(0, edge - ruleStart),
		Math.max(2, options.size * 0.05),
	);
}

function drawZoomOne(options: TypographyEntranceDraw): void {
	const glyphs = positionedGlyphs(options);
	if (glyphs.length === 0) return;
	const centerX =
		glyphs.reduce((sum, glyph) => sum + glyph.x, 0) / glyphs.length;
	const centerY =
		glyphs.reduce((sum, glyph) => sum + glyph.y, 0) / glyphs.length;
	const segment =
		glyphs.length > 1 ? Math.min(0.55, 2.2 / (glyphs.length + 1)) : 1;
	for (const glyph of glyphs) {
		const start = glyph.order * (1 - segment);
		const q = clamp((options.frame.enterProgress - start) / segment);
		if (q <= 0) continue;
		if (q < 0.38) {
			const eased = outCubic(q / 0.38);
			drawTransformedGlyph({
				...options,
				glyph,
				deltaX: centerX - glyph.x,
				deltaY: centerY - glyph.y,
				scaleX: lerp({ start: 2.6, end: 2.1, progress: eased }),
				scaleY: lerp({ start: 2.6, end: 2.1, progress: eased }),
				alpha: clamp(q / 0.1),
			});
			continue;
		}
		const eased = inOutCubic((q - 0.38) / 0.62);
		drawTransformedGlyph({
			...options,
			glyph,
			deltaX: (centerX - glyph.x) * (1 - eased),
			deltaY: (centerY - glyph.y) * (1 - eased),
			scaleX: lerp({ start: 2.1, end: 1, progress: eased }),
			scaleY: lerp({ start: 2.1, end: 1, progress: eased }),
		});
	}
}

function drawUnderLift(options: TypographyEntranceDraw): void {
	const glyphs = positionedGlyphs(options);
	const progress = options.frame.enterProgress;
	const baseAlpha = options.ctx.globalAlpha;
	for (const glyph of glyphs) {
		const q = clamp((progress - 0.22 - glyph.order * 0.38) / 0.4);
		if (q <= 0) continue;
		const scaleY = Math.max(0.02, outBack(q));
		drawTransformedGlyph({
			...options,
			glyph,
			deltaY: (1 - scaleY) * options.size * 0.45,
			scaleX: 1,
			scaleY,
		});
	}
	const grow = outExpo(clamp(progress / 0.32));
	const retract = inCubic(clamp((progress - 0.72) / 0.28));
	const width = options.maxWidth * Math.max(0, grow - retract);
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		options.x - width / 2,
		options.y + options.size * 0.57,
		width,
		Math.max(2.5, options.size * 0.055),
	);
}

function drawDotGrow(options: TypographyEntranceDraw): void {
	for (const glyph of positionedGlyphs(options)) {
		const start = glyph.order * 0.5;
		const dotProgress = clamp((options.frame.enterProgress - start) / 0.18);
		const glyphProgress = clamp(
			(options.frame.enterProgress - start - 0.2) / 0.3,
		);
		if (dotProgress <= 0) continue;
		if (glyphProgress <= 0) {
			drawTransformedGlyph({
				...options,
				glyph: { ...glyph, character: "・" },
				scaleX: 1.25 * outBack(dotProgress),
				scaleY: 1.25 * outBack(dotProgress),
				color: options.frame.palette.accent,
			});
			continue;
		}
		drawTransformedGlyph({
			...options,
			glyph,
			scaleX: lerp({
				start: 0.3,
				end: 1,
				progress: outBack(glyphProgress),
			}),
			scaleY: lerp({
				start: 0.3,
				end: 1,
				progress: outBack(glyphProgress),
			}),
			alpha: clamp(glyphProgress * 3),
		});
	}
}

function drawBracketOpen(options: TypographyEntranceDraw): void {
	const glyphs = positionedGlyphs(options);
	const progress = inOutCubic(
		clamp((options.frame.enterProgress - 0.08) / 0.62),
	);
	const halfWidth = (options.maxWidth / 2) * progress;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - halfWidth,
		options.y - options.size * 0.75,
		halfWidth * 2,
		options.size * 1.5,
	);
	options.ctx.clip();
	for (const glyph of glyphs) drawPlainGlyph({ options, glyph });
	options.ctx.restore();

	const alpha =
		clamp(options.frame.enterProgress / 0.08) *
		(1 - clamp((options.frame.enterProgress - 0.78) / 0.22));
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

function drawRetype(options: TypographyEntranceDraw): void {
	const glyphs = positionedGlyphs(options);
	if (glyphs.length === 0) return;
	const wrongIndex =
		glyphs.length >= 3
			? 1 + (Math.abs(options.frame.cut?.seed ?? 0) % (glyphs.length - 1))
			: -1;
	const stepCount = glyphs.length + (wrongIndex >= 0 ? 2 : 0);
	const step = Math.floor(options.frame.enterProgress * (stepCount + 0.999));
	let shown: number;
	let wrong = false;
	if (wrongIndex < 0 || step <= wrongIndex)
		shown = Math.min(glyphs.length, step);
	else if (step === wrongIndex + 1) {
		shown = wrongIndex + 1;
		wrong = true;
	} else if (step === wrongIndex + 2) shown = wrongIndex;
	else shown = Math.min(glyphs.length, step - 2);

	for (const [index, glyph] of glyphs.entries()) {
		if (index >= shown) break;
		drawTransformedGlyph({
			...options,
			glyph:
				wrong && index === wrongIndex ? { ...glyph, character: "あ" } : glyph,
			color:
				wrong && index === wrongIndex
					? options.frame.palette.accent
					: undefined,
		});
	}
	const cursorGlyph = glyphs[Math.min(shown, glyphs.length - 1)];
	const cursorX =
		shown === 0
			? glyphs[0].x - options.size * 0.36
			: cursorGlyph.x + options.size * 0.4;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		cursorX,
		options.y - options.size * 0.55,
		Math.max(2, options.size * 0.045),
		options.size * 1.1,
	);
}

function drawRubyDrop(options: TypographyEntranceDraw): void {
	for (const glyph of positionedGlyphs(options)) {
		const q = clamp((options.frame.enterProgress - glyph.order * 0.45) / 0.55);
		if (q <= 0) continue;
		if (q < 0.4) {
			drawTransformedGlyph({
				...options,
				glyph,
				deltaY: -options.size * 0.8,
				scaleX: 0.32,
				scaleY: 0.32,
				alpha: clamp((q / 0.4) * 1.6),
				color: options.frame.palette.secondary,
			});
			continue;
		}
		const eased = outCubic((q - 0.4) / 0.6);
		drawTransformedGlyph({
			...options,
			glyph,
			deltaY: -options.size * 0.8 * (1 - eased),
			scaleX: lerp({ start: 0.32, end: 1, progress: eased }),
			scaleY: lerp({ start: 0.32, end: 1, progress: eased }),
			color: eased < 0.55 ? options.frame.palette.secondary : undefined,
		});
	}
}

function positionedGlyphs({
	ctx,
	frame,
	maxWidth,
	size,
	text,
	x,
	y,
}: TypographyEntranceDraw): PositionedGlyph[] {
	const characters = Array.from(text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? size * 0.34 : size * 0.62,
	);
	const naturalWidth = advances.reduce((sum, advance) => sum + advance, 0);
	const widthScale =
		naturalWidth > 0 ? Math.min(1, maxWidth / naturalWidth) : 1;
	const width = naturalWidth * widthScale;
	const startX =
		ctx.textAlign === "left" || ctx.textAlign === "start"
			? x
			: ctx.textAlign === "right" || ctx.textAlign === "end"
				? x - width
				: x - width / 2;
	const globalCharacters = Array.from(frame.cut?.text ?? "");
	const globalDrawable = globalCharacters.filter(
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
		let globalIndex = globalDrawable.indexOf(character, searchFrom);
		if (globalIndex < 0) globalIndex = globalDrawable.indexOf(character);
		if (globalIndex < 0) globalIndex = positioned.length;
		searchFrom = globalIndex + 1;
		positioned.push({
			character,
			globalIndex,
			order:
				globalDrawable.length <= 1
					? 0
					: globalIndex / (globalDrawable.length - 1),
			x: center,
			y,
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
		const before = text.slice(0, text.indexOf(longest));
		return Array.from(before).filter((character) => !/\s/u.test(character))
			.length;
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
	readonly options: TypographyEntranceDraw;
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
	color,
	ctx,
	deltaX = 0,
	deltaY = 0,
	drawGlyph,
	glyph,
	scaleX = 1,
	scaleY = 1,
	size,
}: TypographyEntranceDraw & {
	readonly alpha?: number;
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
		text: glyph.character,
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

function outBack(value: number): number {
	const progress = clamp(value);
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
}
