import { signedRandom, unitRandom } from "./deterministic-random";
import type { MotionTextCanvasContext } from "./types";

export function layoutGlyphs(text: string): string[] {
	return Array.from(text).filter((character) => !/\s/u.test(character));
}

/**
 * Splits `words` into at most `lineCount` lines whose character lengths sit as
 * close to the ideal length as the word boundaries allow. Splitting an uneven
 * phrase evenly by word count gives one cramped line and one overflowing line;
 * this keeps the lines optically balanced.
 */
export function balancedWordLines({
	lineCount,
	words,
}: {
	readonly lineCount: number;
	readonly words: readonly string[];
}): string[] {
	const count = Math.min(lineCount, words.length);
	if (count <= 1) return [words.join(" ")];
	const lengths = words.map((word) => Array.from(word).length);
	const spanLength = ({
		start,
		end,
	}: {
		readonly start: number;
		readonly end: number;
	}) => {
		let total = end - start - 1;
		for (let index = start; index < end; index += 1) total += lengths[index];
		return total;
	};
	const ideal = spanLength({ end: words.length, start: 0 }) / count;
	const memo = new Map<string, { cost: number; cuts: readonly number[] }>();
	const best = ({
		start,
		lines,
	}: {
		readonly start: number;
		readonly lines: number;
	}): { cost: number; cuts: readonly number[] } => {
		if (lines === 1) {
			const delta = spanLength({ end: words.length, start }) - ideal;
			return { cost: delta * delta, cuts: [] };
		}
		const key = `${start}:${lines}`;
		const cached = memo.get(key);
		if (cached) return cached;
		let result: { cost: number; cuts: readonly number[] } = {
			cost: Number.POSITIVE_INFINITY,
			cuts: [],
		};
		const lastCut = words.length - lines + 1;
		for (let cut = start + 1; cut <= lastCut; cut += 1) {
			const delta = spanLength({ end: cut, start }) - ideal;
			const rest = best({ lines: lines - 1, start: cut });
			const cost = delta * delta + rest.cost;
			if (cost < result.cost) result = { cost, cuts: [cut, ...rest.cuts] };
		}
		memo.set(key, result);
		return result;
	};
	const cuts = [0, ...best({ lines: count, start: 0 }).cuts, words.length];
	const lines: string[] = [];
	for (let index = 0; index < cuts.length - 1; index += 1) {
		lines.push(words.slice(cuts[index], cuts[index + 1]).join(" "));
	}
	return lines;
}

/**
 * Splits `text` into `count` chunks for panel-style layouts: balanced between
 * words when the text has spaces, otherwise balanced between glyphs.
 */
export function chunkText({
	count,
	text,
}: {
	readonly count: number;
	readonly text: string;
}): string[] {
	const trimmed = text.trim();
	const words = trimmed.split(/\s+/u).filter(Boolean);
	if (words.length > 1) return balancedWordLines({ lineCount: count, words });
	const glyphs = layoutGlyphs(trimmed);
	if (glyphs.length === 0) return [text];
	const chunks: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const start = Math.floor((index * glyphs.length) / count);
		const end = Math.floor(((index + 1) * glyphs.length) / count);
		const chunk = glyphs.slice(start, Math.max(start + 1, end)).join("");
		if (chunk) chunks.push(chunk);
	}
	return chunks;
}

/**
 * Mostly Latin letters (English, Indonesian, Vietnamese …) rather than Japanese,
 * Chinese or Korean. Latin lyrics are read left to right and break between
 * words; CJK has no word spaces and breaks anywhere.
 */
export function isLatinText(text: string): boolean {
	const stripped = text.replace(/\s/gu, "");
	if (stripped.length === 0) return false;
	const latin = (stripped.match(/[A-Za-zÀ-ɏḀ-ỿ]/gu) ?? []).length;
	return latin / Array.from(stripped).length >= 0.6;
}

export function estimatedTextWidth({
	size,
	text,
}: {
	readonly size: number;
	readonly text: string;
}): number {
	return Array.from(text).reduce(
		(width, character) => width + size * (/\s/u.test(character) ? 0.34 : 0.62),
		0,
	);
}

// Variadic salts keep deterministic layout call sites compact and readable.
// eslint-disable-next-line opencut/prefer-object-params
export function layoutUnit(seed: number, ...salts: number[]): number {
	let value = seed | 0;
	for (const salt of salts) {
		value = Math.imul(value ^ (salt | 0), 0x45d9f3b) | 0;
		value ^= value >>> 16;
	}
	return unitRandom({ seed: value, salt: salts.length + 701 });
}

// Variadic salts keep deterministic layout call sites compact and readable.
// eslint-disable-next-line opencut/prefer-object-params
export function layoutSigned(seed: number, ...salts: number[]): number {
	let value = seed | 0;
	for (const salt of salts) {
		value = Math.imul(value ^ (salt | 0), 0x119de1f3) | 0;
		value ^= value >>> 13;
	}
	return signedRandom({ seed: value, salt: salts.length + 709 });
}

export function drawRotatedRect({
	alpha = 1,
	color,
	ctx,
	height,
	rotation,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly height: number;
	readonly rotation: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(rotation);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(-width / 2, -height / 2, width, height);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function drawDiscBands({
	alpha = 1,
	color,
	ctx,
	radius,
	scaleX = 1,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly radius: number;
	readonly scaleX?: number;
	readonly x: number;
	readonly y: number;
}): void {
	const bands = 22;
	const bandHeight = (radius * 2) / bands;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	for (let band = 0; band < bands; band += 1) {
		const centerY = -radius + (band + 0.5) * bandHeight;
		const normalized = centerY / radius;
		const halfWidth =
			radius * Math.sqrt(Math.max(0, 1 - normalized * normalized)) * scaleX;
		ctx.fillRect(
			x - halfWidth,
			y + centerY - bandHeight / 2,
			halfWidth * 2,
			bandHeight + 0.6,
		);
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
