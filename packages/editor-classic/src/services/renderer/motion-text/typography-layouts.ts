import { drawCoreLayout } from "./core-layouts";
import { drawHorrorLayout } from "./horror-layouts";
import { drawKineticLayout } from "./kinetic-layouts";
import { drawLayoutsA } from "./layouts-a";
import { drawLayoutsB } from "./layouts-b";
import { drawLayoutsC } from "./layouts-c";
import { drawLayoutsD } from "./layouts-d";
import { drawEditorialTypographyLayout } from "./typography-editorial-layouts";
import { drawGraphicTypographyLayout } from "./typography-graphic-layouts";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawTypographyLayout({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): boolean {
	const cut = frame.cut;
	if (!cut) return false;
	const options = { ctx, drawText, frame, height, setFontSize, width };
	if (drawCoreLayout(options)) return true;
	if (drawLayoutsA(options)) return true;
	if (drawLayoutsB(options)) return true;
	if (drawLayoutsC(options)) return true;
	if (drawLayoutsD(options)) return true;
	if (drawHorrorLayout(options)) return true;
	if (drawKineticLayout(options)) return true;

	switch (cut.preset.layout) {
		case "tyBaseline":
			drawBaseline({ ctx, drawText, frame, height, setFontSize, width });
			return true;
		case "tyFullTrack":
			drawFullTrack({ ctx, drawText, frame, height, setFontSize, width });
			return true;
		case "tyMargin":
			drawMargin({ ctx, drawText, frame, height, setFontSize, width });
			return true;
		case "tySquare":
			drawSquare({ ctx, drawText, frame, height, setFontSize, width });
			return true;
		default: {
			return (
				drawEditorialTypographyLayout(options) ||
				drawGraphicTypographyLayout(options)
			);
		}
	}
}

function drawBaseline({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const glyphCount = drawableGlyphs(cut.text).length;
	const targetLines = Math.min(3, Math.max(2, Math.ceil(glyphCount / 6)));
	const lines = splitLines({ text: cut.text, targetLineCount: targetLines });
	const longestLine = Math.max(
		...lines.map((line) => drawableGlyphs(line).length),
	);
	const size = Math.max(
		18,
		Math.min(
			height / Math.max(3.8, lines.length * 1.7),
			(width * 0.72) / Math.max(1, longestLine * 0.72),
		),
	);
	const left = width * 0.15;
	const lineGap = size * 1.62;
	const firstY = height / 2 - ((lines.length - 1) * lineGap) / 2;
	const ruleLeft = width * 0.06;
	const ruleWidth = width * 0.88;
	const ruleHeight = Math.max(1, Math.min(width, height) * 0.0015);

	setFontSize(size);
	ctx.textAlign = "left";
	for (const [index, line] of lines.entries()) {
		const y = firstY + index * lineGap;
		ctx.fillStyle = frame.palette.foreground;
		drawText({ text: line, x: left, y, maxWidth: width * 0.75, size });
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(ruleLeft, y + size * 0.66, ruleWidth, ruleHeight);
	}

	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		left,
		firstY + size * 0.61,
		Math.min(width * 0.16, size * 1.8),
		Math.max(2, size * 0.055),
	);
}

function drawFullTrack({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const glyphs = drawableGlyphs(frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const extent = portrait ? height : width;
	const crossExtent = portrait ? width : height;
	const margin = extent * 0.11;
	const span = Math.max(0, extent - margin * 2);
	const size = Math.max(
		18,
		Math.min(crossExtent * 0.2, (span / Math.max(1, glyphs.length)) * 0.82),
	);

	setFontSize(size);
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	for (const [index, glyph] of glyphs.entries()) {
		const position =
			glyphs.length === 1
				? extent / 2
				: margin + (span * index) / (glyphs.length - 1);
		drawText({
			text: glyph,
			x: portrait ? width / 2 : position,
			y: portrait ? position : height / 2,
			maxWidth: size * 1.2,
			size,
		});
	}

	ctx.fillStyle = frame.palette.secondary;
	const ruleHeight = Math.max(1, Math.min(width, height) * 0.0015);
	if (portrait) {
		ctx.fillRect(width / 2 + size * 0.68, margin, ruleHeight, span);
	} else {
		ctx.fillRect(margin, height / 2 + size * 0.68, span, ruleHeight);
	}
}

function drawMargin({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const lines = splitLines({
		text: cut.text,
		targetLineCount: drawableGlyphs(cut.text).length > 10 ? 2 : 1,
	});
	const longestLine = Math.max(
		...lines.map((line) => drawableGlyphs(line).length),
	);
	const size = Math.max(
		16,
		Math.min(
			Math.min(width, height) * 0.068,
			(width * 0.48) / Math.max(1, longestLine * 0.72),
		),
	);
	const right = Math.abs(cut.seed) % 2 === 1;
	const upper = Math.abs(cut.seed) % 4 >= 2;
	const x = right ? width * 0.92 : width * 0.08;
	const lineGap = size * 1.4;
	const blockHeight = (lines.length - 1) * lineGap;
	const y = (upper ? height * 0.2 : height * 0.8) - blockHeight / 2;

	setFontSize(size);
	ctx.textAlign = right ? "right" : "left";
	ctx.fillStyle = frame.palette.foreground;
	for (const [index, line] of lines.entries()) {
		drawText({
			text: line,
			x,
			y: y + index * lineGap,
			maxWidth: width * 0.5,
			size,
		});
	}

	const estimatedTextWidth = Math.min(width * 0.5, longestLine * size * 0.62);
	const ruleStart = right
		? x - estimatedTextWidth - size * 0.8
		: x + estimatedTextWidth + size * 0.8;
	const ruleEnd = right ? width * 0.08 : width * 0.92;
	const left = Math.min(ruleStart, ruleEnd);
	const ruleWidth = Math.abs(ruleEnd - ruleStart);
	if (ruleWidth > width * 0.05) {
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(
			left,
			y - Math.max(1, size * 0.02),
			ruleWidth,
			Math.max(1, Math.min(width, height) * 0.0015),
		);
		ctx.fillStyle = frame.palette.accent;
		const marker = Math.max(3, size * 0.16);
		ctx.fillRect(
			right ? left : left + ruleWidth - marker,
			y - marker / 2,
			marker,
			marker,
		);
	}
}

function drawSquare({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const glyphs = drawableGlyphs(frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const columns = Math.ceil(Math.sqrt(glyphs.length));
	const rows = Math.ceil(glyphs.length / columns);
	const cell = Math.min((width * 0.72) / columns, (height * 0.68) / rows);
	const gridWidth = columns * cell;
	const gridHeight = rows * cell;
	const left = width / 2 - gridWidth / 2;
	const top = height / 2 - gridHeight / 2;
	const size = Math.max(18, cell * 0.74);
	const accentIndex = Math.floor((glyphs.length - 1) / 2);

	setFontSize(size);
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		ctx.fillStyle =
			index === accentIndex ? frame.palette.accent : frame.palette.foreground;
		drawText({
			text: glyph,
			x: left + (column + 0.5) * cell,
			y: top + (row + 0.5) * cell,
			maxWidth: cell * 0.9,
			size,
		});
	}

	ctx.fillStyle = frame.palette.secondary;
	const rule = Math.max(1, Math.min(width, height) * 0.0015);
	for (let column = 0; column <= columns; column += 1) {
		ctx.fillRect(left + column * cell - rule / 2, top, rule, gridHeight);
	}
	for (let row = 0; row <= rows; row += 1) {
		ctx.fillRect(left, top + row * cell - rule / 2, gridWidth, rule);
	}
}

function drawableGlyphs(text: string): string[] {
	return Array.from(text).filter((character) => !/\s/u.test(character));
}

function splitLines({
	text,
	targetLineCount,
}: {
	readonly text: string;
	readonly targetLineCount: number;
}): string[] {
	const normalized = text.trim().replace(/\s+/gu, " ");
	if (targetLineCount <= 1 || normalized.length === 0) return [normalized];
	const words = normalized.split(" ");
	if (words.length > 1) return distributeWords({ words, targetLineCount });
	const glyphs = Array.from(normalized);
	const lineLength = Math.ceil(glyphs.length / targetLineCount);
	const lines: string[] = [];
	for (let index = 0; index < glyphs.length; index += lineLength) {
		lines.push(glyphs.slice(index, index + lineLength).join(""));
	}
	return lines.length > 0 ? lines : [normalized];
}

function distributeWords({
	words,
	targetLineCount,
}: {
	readonly words: readonly string[];
	readonly targetLineCount: number;
}): string[] {
	const lines: string[] = [];
	let wordIndex = 0;
	for (let lineIndex = 0; lineIndex < targetLineCount; lineIndex += 1) {
		const wordsLeft = words.length - wordIndex;
		const linesLeft = targetLineCount - lineIndex;
		const take = Math.max(1, Math.ceil(wordsLeft / linesLeft));
		lines.push(words.slice(wordIndex, wordIndex + take).join(" "));
		wordIndex += take;
		if (wordIndex >= words.length) break;
	}
	return lines;
}
