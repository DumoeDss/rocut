import { kineticWordSegments } from "./kinetic-words";

export interface KineticWordGlyph {
	readonly character: string;
	readonly glyphIndex: number;
	readonly indexInWord: number;
	readonly wordCenter: number;
	readonly wordEnd: number;
	readonly wordIndex: number;
	readonly wordStart: number;
	readonly x: number;
	readonly y: number;
}

export interface KineticWordGeometry {
	readonly centerX: number;
	readonly glyphs: readonly KineticWordGlyph[];
	readonly width: number;
	readonly wordCount: number;
}

export function resolveKineticWordGeometry({
	align,
	maxWidth,
	size,
	text,
	x,
	y,
}: {
	readonly align: CanvasTextAlign;
	readonly maxWidth: number;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): KineticWordGeometry {
	const words = kineticWordSegments({ text });
	const glyphWidth = size * 0.62;
	const gap = size * (text.includes(" ") ? 0.34 : 0.12);
	const wordWidths = words.map((word) => Array.from(word).length * glyphWidth);
	const natural =
		wordWidths.reduce((total, width) => total + width, 0) +
		gap * Math.max(0, words.length - 1);
	const fit = Math.min(1, maxWidth / Math.max(1, natural));
	const width = natural * fit;
	let cursor =
		align === "left" || align === "start"
			? x
			: align === "right" || align === "end"
				? x - width
				: x - width / 2;
	const glyphs: KineticWordGlyph[] = [];
	let glyphIndex = 0;
	for (const [wordIndex, word] of words.entries()) {
		const wordWidth = wordWidths[wordIndex] * fit;
		const wordStart = cursor;
		const wordEnd = cursor + wordWidth;
		const wordCenter = (wordStart + wordEnd) / 2;
		for (const [indexInWord, character] of Array.from(word).entries()) {
			glyphs.push({
				character,
				glyphIndex,
				indexInWord,
				wordCenter,
				wordEnd,
				wordIndex,
				wordStart,
				x: cursor + (indexInWord + 0.5) * glyphWidth * fit,
				y,
			});
			glyphIndex += 1;
		}
		cursor = wordEnd + gap * fit;
	}
	return {
		centerX:
			glyphs.length > 0
				? (glyphs[0].wordStart + glyphs[glyphs.length - 1].wordEnd) / 2
				: x,
		glyphs,
		width,
		wordCount: words.length,
	};
}
