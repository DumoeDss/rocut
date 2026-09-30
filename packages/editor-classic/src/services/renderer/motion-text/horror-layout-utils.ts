import { signedRandom, unitRandom } from "./deterministic-random";
import {
	clamp01,
	drawKineticLayoutText,
	drawKineticRule,
	fitKineticText,
	outCubic,
} from "./kinetic-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export {
	clamp01,
	drawKineticLayoutText,
	drawKineticRule,
	fitKineticText,
	outCubic,
};

export function horrorGlyphs(text: string): readonly string[] {
	return Array.from(text).filter((character) => !/\s/u.test(character));
}

export function horrorWords(text: string): readonly string[] {
	const normalized = text.trim().replace(/\s+/gu, " ");
	if (!normalized) return [];
	const words = normalized.split(" ");
	return words.length > 1 ? words : horrorGlyphs(normalized);
}

export function horrorLines({
	maximum,
	text,
}: {
	readonly maximum: number;
	readonly text: string;
}): readonly string[] {
	const normalized = text.trim().replace(/\s+/gu, " ");
	if (!normalized) return [];
	const words = normalized.split(" ");
	if (words.length > 1) {
		const lines: string[] = [];
		let line = "";
		for (const word of words) {
			if (line && `${line} ${word}`.length > maximum) {
				lines.push(line);
				line = word;
			} else {
				line = line ? `${line} ${word}` : word;
			}
		}
		if (line) lines.push(line);
		return lines;
	}
	const glyphs = Array.from(normalized);
	const lines: string[] = [];
	for (let index = 0; index < glyphs.length; index += maximum) {
		lines.push(glyphs.slice(index, index + maximum).join(""));
	}
	return lines;
}

export function horrorTextBlock({
	lines,
	lineGap,
	options,
	size,
	x,
	y,
	alpha = 1,
	color = options.frame.palette.foreground,
	rotation = 0,
}: {
	readonly lines: readonly string[];
	readonly lineGap: number;
	readonly options: TypographyLayoutOptions;
	readonly size: number;
	readonly x: number;
	readonly y: number;
	readonly alpha?: number;
	readonly color?: string;
	readonly rotation?: number;
}): void {
	const firstY = y - ((lines.length - 1) * lineGap) / 2;
	for (const [index, line] of lines.entries()) {
		drawKineticLayoutText({
			options,
			text: {
				text: line,
				x,
				y: firstY + index * lineGap,
				size,
				alpha,
				color,
				rotation,
			},
		});
	}
}

export function fillHorrorRect({
	alpha = 1,
	color,
	height,
	options,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly options: TypographyLayoutOptions;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (width <= 0 || height <= 0 || alpha <= 0) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function horrorRandom({
	options,
	salt,
}: {
	readonly options: TypographyLayoutOptions;
	readonly salt: number;
}): number {
	return unitRandom({ seed: options.frame.cut?.seed ?? 0, salt });
}

export function horrorSignedRandom({
	options,
	salt,
}: {
	readonly options: TypographyLayoutOptions;
	readonly salt: number;
}): number {
	return signedRandom({ seed: options.frame.cut?.seed ?? 0, salt });
}

export function horrorStep(options: TypographyLayoutOptions): number {
	return Math.floor(options.frame.localTime / 4_000);
}

export function horrorDate(options: TypographyLayoutOptions): string {
	const year = 1987 + Math.floor(horrorRandom({ options, salt: 5 }) * 19);
	const month = 1 + Math.floor(horrorRandom({ options, salt: 6 }) * 12);
	const day = 1 + Math.floor(horrorRandom({ options, salt: 7 }) * 28);
	return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

export function horrorTime(options: TypographyLayoutOptions): string {
	const elapsedSeconds = Math.floor(options.frame.localTime / 120_000);
	const start =
		2 * 3_600 + Math.floor(horrorRandom({ options, salt: 8 }) * 7_200);
	const seconds = start + elapsedSeconds;
	return `${String(Math.floor(seconds / 3_600) % 24).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
