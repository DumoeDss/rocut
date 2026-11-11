import {
	inCubic,
	inOutCubic,
	mixHex,
	outCubic,
	secondsOf,
} from "./exit-hold-geometry";
import type { TypographyLayoutOptions } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";
import { x2Hash, x2IsKanji, x2Signed, x2Unit } from "./x2-drawing";

/**
 * JIZURA 追加分2 "x2typoA" — typographic spec layouts, quiet editorial decors
 * and type-only backgrounds, transliterated onto the rocut drawing contracts.
 *
 * House simplifications shared with the A/B family ports: single frame font,
 * horizontal writing (the vertical arms of 鉤組 are drawn as 90°-rotated
 * horizontal text), canvas `fillText` maxWidth squeezing instead of JIZURA's
 * tracker, and per-part plan parameters re-derived deterministically from the
 * cut seed.
 */

const TAU = Math.PI * 2;

interface X2TypoSurfaceDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

interface X2Point {
	readonly character: string;
	readonly x: number;
	readonly y: number;
}

// eslint-disable-next-line opencut/prefer-object-params
function clamp(value: number, minimum = 0, maximum = 1): number {
	return Math.min(maximum, Math.max(minimum, value));
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
}

function outExpo(value: number): number {
	const progress = clamp(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

// eslint-disable-next-line opencut/prefer-object-params
function outBack(value: number, overshoot = 1.70158): number {
	const progress = clamp(value) - 1;
	return 1 + (overshoot + 1) * progress ** 3 + overshoot * progress ** 2;
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function isPunct(character: string): boolean {
	return /\p{P}/u.test(character);
}

const SMALL_KANA = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮゕゖ";

function isSmallKana(character: string): boolean {
	return character.length === 1 && SMALL_KANA.includes(character);
}

/** Latin-word text (no kana/kanji/full-width) — JIZURA `isLatinT`. */
function isLatinText(text: string): boolean {
	return (
		/[A-Za-z]/u.test(text) && !/[぀-ヿ㐀-鿿＀-￯]/u.test(text)
	);
}

function glyphCountOf(text: string): number {
	return Array.from(text).filter((character) => !/\s/u.test(character))
		.length;
}

function cleanText(text: string): string {
	return String(text ?? "").replace(/\s+/gu, "");
}

function slotsOf(text: string): string[] {
	return [...String(text ?? "").trim().replace(/[\s\u3000]+/gu, " ")];
}

/** Width of one em of text at `size`, with JIZURA-style tracking (J.measure). */
// eslint-disable-next-line opencut/prefer-object-params
function measureW(text: string, size: number, track = 0): number {
	const characters = [...text];
	let unit = 0;
	for (const character of characters) {
		unit += /\s/u.test(character) ? 0.34 : 0.62;
	}
	unit += track * Math.max(0, characters.length - 1);
	return unit * size;
}

/** Largest size at which the (multi-line) text fits the given box (J.fitSize). */
function fitSize({
	lead = 1,
	maxH,
	maxW,
	text,
	track = 0,
}: {
	readonly lead?: number;
	readonly maxH: number;
	readonly maxW: number;
	readonly text: string;
	readonly track?: number;
}): number {
	const lines = String(text).split("\n");
	let unit = 0;
	for (const line of lines) {
		unit = Math.max(unit, measureW(line, 1, track));
	}
	return Math.min(
		maxW / Math.max(0.001, unit),
		maxH / Math.max(0.5, lines.length * lead),
	);
}

/** Even glyph split that never leaves a punctuation-only line (J.splitLines). */
// eslint-disable-next-line opencut/prefer-object-params
function splitLinesEven(text: string, per: number): string[] {
	const characters = [...String(text ?? "").trim()];
	if (characters.length === 0) return [""];
	const lineCount = Math.max(1, Math.ceil(characters.length / Math.max(1, per)));
	const perLine = Math.ceil(characters.length / lineCount);
	const lines: string[] = [];
	for (let index = 0; index < characters.length; index += perLine) {
		lines.push(characters.slice(index, index + perLine).join(""));
	}
	for (let index = lines.length - 1; index > 0; index -= 1) {
		const line = lines[index] ?? "";
		if ([...line].every((character) => isPunct(character) || character === " ")) {
			lines[index - 1] = `${lines[index - 1] ?? ""}${line}`;
			lines.splice(index, 1);
		}
	}
	return lines;
}

// eslint-disable-next-line opencut/prefer-object-params
function mainLines(
	text: string,
	width: number,
	height: number,
	perLandscape = 11,
	perPortrait = 5,
): string {
	const trimmed = String(text ?? "").trim();
	const count = glyphCountOf(trimmed);
	const per = width < height ? perPortrait : perLandscape;
	if (count <= per) return trimmed;
	return splitLinesEven(trimmed, Math.ceil(count / Math.ceil(count / per))).join(
		"\n",
	);
}

/** Glyph units that never begin with punctuation / small kana (JIZURA `charUnits`). */
function charUnits(text: string): string[] {
	const out: string[] = [];
	for (const character of [...cleanText(text)]) {
		if (
			out.length > 0 &&
			(isPunct(character) || isSmallKana(character) || character === "ー")
		) {
			out[out.length - 1] = `${out[out.length - 1] ?? ""}${character}`;
		} else {
			out.push(character);
		}
	}
	return out;
}

/** Word-like units: latin words with their leading space, else glued glyphs. */
function unitsOf(text: string): string[] {
	const trimmed = String(text ?? "").trim();
	if (isLatinText(trimmed)) {
		return trimmed
			.split(/\s+/u)
			.filter(Boolean)
			.map((word, index) => (index ? ` ${word}` : word));
	}
	return charUnits(trimmed);
}

/** Group units into lines at cumulative glyph fractions (JIZURA `groupFr`). */
// eslint-disable-next-line opencut/prefer-object-params
function groupFr(
	units: readonly string[],
	fractions: readonly number[],
): string[] {
	const lens = units.map((unit) => glyphCountOf(unit));
	const total = lens.reduce((sum, len) => sum + len, 0);
	const out: string[] = [];
	let current = "";
	let accumulated = 0;
	units.forEach((unit, index) => {
		current += unit;
		accumulated += lens[index] ?? 0;
		if (
			out.length < fractions.length - 1 &&
			index < units.length - 1 &&
			accumulated >=
				total * (fractions[out.length] ?? 1) - (lens[index + 1] ?? 0) * 0.5
		) {
			out.push(current.trim());
			current = "";
		}
	});
	if (current.trim()) out.push(current.trim());
	return out;
}

function evenFr(count: number): number[] {
	return Array.from({ length: count }, (_, index) => (index + 1) / count);
}

function okKey(character: string): boolean {
	return (
		character.length > 0 &&
		!/\s/u.test(character) &&
		!isPunct(character) &&
		!isSmallKana(character)
	);
}

/** Index of the "key" glyph: longest kanji run head, else a plain glyph. */
// eslint-disable-next-line opencut/prefer-object-params
function keyIndexOf(characters: readonly string[], mode: string): number {
	if (mode === "mid") {
		const mid = Math.floor((characters.length - 1) / 2);
		for (let distance = 0; distance < characters.length; distance += 1) {
			const after = characters[mid + distance];
			const before = characters[mid - distance];
			if (after !== undefined && okKey(after)) return mid + distance;
			if (before !== undefined && okKey(before)) return mid - distance;
		}
	}
	let best = -1;
	let bestLength = 0;
	for (let index = 0; index < characters.length; index += 1) {
		if (!x2IsKanji(characters[index] ?? "")) continue;
		let end = index;
		while (end < characters.length && x2IsKanji(characters[end] ?? "")) {
			end += 1;
		}
		if (end - index > bestLength) {
			bestLength = end - index;
			best = index;
		}
		index = end;
	}
	if (best >= 0) return best;
	for (let index = 0; index < characters.length; index += 1) {
		if (okKey(characters[index] ?? "")) return index;
	}
	return 0;
}

// eslint-disable-next-line opencut/prefer-object-params
function rectPoints(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): [number, number][] {
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1],
		[x0, y0],
	];
}

/** Axis-aligned fill with alpha gating (JIZURA `env.rect`). */
// eslint-disable-next-line opencut/prefer-object-params
function fillRectAt(ctx: MotionTextCanvasContext, x: number, y: number, width: number, height: number, color: string, alpha: number): void {
	if (width <= 0.05 || height <= 0.05 || alpha <= 0.003) return;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
	ctx.globalAlpha = base;
}

/** Hairline segment drawn as a rotated rect (JIZURA `env.line`). */
// eslint-disable-next-line opencut/prefer-object-params
function strokeSeg(ctx: MotionTextCanvasContext, x0: number, y0: number, x1: number, y1: number, color: string, width: number, alpha: number): void {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const length = Math.hypot(dx, dy);
	if (length <= 0.05 || width <= 0.05 || alpha <= 0.003) return;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.translate(x0, y0);
	ctx.rotate(Math.atan2(dy, dx));
	ctx.globalAlpha = base * clamp(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(0, -width / 2, length, width);
	ctx.restore();
	ctx.globalAlpha = base;
}

/** Dashed segment without setLineDash: repeated short strokes. */
// eslint-disable-next-line opencut/prefer-object-params
function dashSeg(ctx: MotionTextCanvasContext, x0: number, y0: number, x1: number, y1: number, color: string, width: number, alpha: number, on: number, off: number): void {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const length = Math.hypot(dx, dy);
	if (length <= 0.05 || alpha <= 0.003) return;
	const unit = Math.max(0.1, on + off);
	const steps = Math.ceil(length / unit);
	for (let index = 0; index < steps; index += 1) {
		const from = (index * unit) / length;
		const to = Math.min(1, (index * unit + on) / length);
		if (to <= from) continue;
		strokeSeg(
			ctx,
			x0 + dx * from,
			y0 + dy * from,
			x0 + dx * to,
			y0 + dy * to,
			color,
			width,
			alpha,
		);
	}
}

/** Polyline drawn up to a perimeter fraction (JIZURA `env.polyPartial`). */
// eslint-disable-next-line opencut/prefer-object-params
function polyPartial(ctx: MotionTextCanvasContext, points: readonly [number, number][], progress: number, color: string, width: number, alpha: number): void {
	if (alpha <= 0.003 || width <= 0.05 || points.length < 2) return;
	const lengths: number[] = [];
	let total = 0;
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index]!;
		const to = points[index + 1]!;
		const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
		lengths.push(length);
		total += length;
	}
	if (total <= 0.05) return;
	const limit = clamp(progress) * total;
	let accumulated = 0;
	for (let index = 0; index < lengths.length; index += 1) {
		const length = lengths[index]!;
		const reach = Math.min(length, Math.max(0, limit - accumulated));
		if (reach > 0.05) {
			const from = points[index]!;
			const to = points[index + 1]!;
			const fraction = reach / length;
			strokeSeg(
				ctx,
				from[0],
				from[1],
				lerpN(from[0], to[0], fraction),
				lerpN(from[1], to[1], fraction),
				color,
				width,
				alpha,
			);
		}
		accumulated += length;
		if (accumulated >= limit) break;
	}
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Small plain label in the frame font (JIZURA `label`). */
// eslint-disable-next-line opencut/prefer-object-params
function labelAt(
	ctx: MotionTextCanvasContext,
	frame: MotionTextRenderFrame,
	{
		align = "left",
		alpha = 1,
		color,
		rotation = 0,
		size,
		text,
		x,
		y,
	}: {
		readonly align?: CanvasTextAlign;
		readonly alpha?: number;
		readonly color?: string;
		readonly rotation?: number;
		readonly size: number;
		readonly text: string;
		readonly x: number;
		readonly y: number;
	},
): void {
	if (alpha <= 0.003) return;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.translate(x, y);
	if (rotation !== 0) ctx.rotate(rotation);
	ctx.globalAlpha = base * clamp(alpha);
	ctx.fillStyle = color ?? frame.palette.secondary;
	ctx.textAlign = align;
	ctx.textBaseline = "middle";
	ctx.font = `${frame.font.style} ${frame.font.weight} ${Math.max(8, size)}px ${quoteFamily(frame.font.family)}`;
	ctx.fillText(text, 0, 0);
	ctx.restore();
	ctx.globalAlpha = base;
}

/** Multi-line block through the layout's drawText (centre-anchored lines). */
// eslint-disable-next-line opencut/prefer-object-params
function drawBlock(
	options: TypographyLayoutOptions,
	{
		align,
		color,
		lead,
		maxWidth,
		size,
		text,
		x,
		y,
	}: {
		readonly align: CanvasTextAlign;
		readonly color: string;
		readonly lead: number;
		readonly maxWidth: number;
		readonly size: number;
		readonly text: string;
		readonly x: number;
		readonly y: number;
	},
): void {
	const lines = String(text).split("\n");
	options.ctx.fillStyle = color;
	options.ctx.textAlign = align;
	options.setFontSize(size);
	for (const [index, line] of lines.entries()) {
		options.drawText({
			maxWidth,
			size,
			text: line,
			x,
			y: y + (index - (lines.length - 1) / 2) * size * lead,
		});
	}
}

/** Glyph centres of a single laid-out line (JIZURA `glyphPts`). */
function lineGlyphs({
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
}): X2Point[] {
	const characters = [...text];
	const natural = measureW(text, size);
	const start =
		align === "left" ? x : align === "right" ? x - natural : x - natural / 2;
	const fit = Math.min(1, maxWidth / Math.max(0.001, natural));
	const out: X2Point[] = [];
	let position = start;
	for (const character of characters) {
		const advance = (/\s/u.test(character) ? 0.34 : 0.62) * size * fit;
		const center = position + advance / 2;
		position += advance;
		if (/\s/u.test(character)) continue;
		out.push({ character, x: center, y });
	}
	return out;
}

/** Estimated glyph boxes of the main line (JIZURA `glyphCells` grid branch). */
// eslint-disable-next-line opencut/prefer-object-params
function glyphCellsOf(
	text: string,
	bounds: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number },
): { readonly cells: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[]; readonly vertical: boolean } {
	const width = bounds.x1 - bounds.x0;
	const height = bounds.y1 - bounds.y0;
	const vertical = height > width * 1.2;
	const count = Math.max(1, Math.min(30, glyphCountOf(text)));
	let bestRows = 1;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let rows = 1; rows <= Math.min(6, count); rows += 1) {
		const perRow = Math.ceil(count / rows);
		const cellA = vertical ? width / rows : width / perRow;
		const cellB = vertical ? height / perRow : height / rows;
		const score = Math.abs(Math.log(cellA / cellB));
		if (score < bestScore - 1e-6) {
			bestScore = score;
			bestRows = rows;
		}
	}
	const per = Math.ceil(count / bestRows);
	const cells: { x: number; y: number; w: number; h: number }[] = [];
	for (let index = 0; index < count; index += 1) {
		const row = Math.floor(index / per);
		const column = index % per;
		if (!vertical) {
			cells.push({
				x: bounds.x0 + (column + 0.5) * (width / per),
				y: bounds.y0 + (row + 0.5) * (height / bestRows),
				w: width / per,
				h: height / bestRows,
			});
		} else {
			cells.push({
				x: bounds.x1 - (row + 0.5) * (width / bestRows),
				y: bounds.y0 + (column + 0.5) * (height / per),
				w: width / bestRows,
				h: height / per,
			});
		}
	}
	return { cells, vertical };
}

/** Estimated single-line bounds of the cut text (house decor heuristic). */
function textBoundsOf({
	frame,
	height,
	width,
}: X2TypoSurfaceDraw): {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
} {
	const characters = Array.from(frame.cut?.text ?? "");
	const baseSize = Math.min(
		height * 0.22,
		width / Math.max(4, characters.length * 0.72),
	);
	const textWidth = Math.min(
		width * 0.86,
		Math.max(baseSize, characters.length * baseSize * 0.62),
	);
	const textHeight = baseSize * 1.25;
	return {
		x0: width / 2 - textWidth / 2,
		x1: width / 2 + textWidth / 2,
		y0: height / 2 - textHeight / 2,
		y1: height / 2 + textHeight / 2,
	};
}

function formatTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	return `${pad2(Math.floor(safe / 60))}:${pad2(Math.floor(safe % 60))}`;
}

/** Stable per-cut stand-in for JIZURA `cut.line` (lyric line index). */
function lineNoOf(seed: number): number {
	return (x2Hash(Math.abs(seed), 901) % 12) + 1;
}

/** Stable per-cut stand-in for JIZURA `cut.index` (cut ordinal). */
function cutNoOf(seed: number): number {
	return (x2Hash(Math.abs(seed), 902) % 97) + 1;
}

/* ================================================================== LAYOUTS */

export function drawX2TypoLayout(options: TypographyLayoutOptions): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "tzAlignSpec":
			drawAlignSpec(options);
			return true;
		case "tzAxis":
			drawAxis(options);
			return true;
		case "tzCanon":
			drawCanon(options);
			return true;
		case "tzDetail":
			drawDetail(options);
			return true;
		case "tzFunnel":
			drawFunnel(options);
			return true;
		case "tzHook":
			drawHook(options);
			return true;
		case "tzHorizon":
			drawHorizon(options);
			return true;
		case "tzMetric":
			drawMetric(options);
			return true;
		case "tzPath":
			drawPath(options);
			return true;
		case "tzPointSym":
			drawPointSym(options);
			return true;
		case "tzSlash":
			drawSlash(options);
			return true;
		case "tzTrackClose":
			drawTrackClose(options);
			return true;
		case "tzWarichu":
			drawWarichu(options);
			return true;
		case "tzWideOne":
			drawWideOne(options);
			return true;
		case "tzZoomBox":
			drawZoomBox(options);
			return true;
		default:
			return false;
	}
}

/** 揃え見本 — the line set three times between margin rules: flush left, centred, flush right. */
function drawAlignSpec(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const portrait = width < height;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim().replace(/\s+/gu, " ");
	if (!text) return;
	const chosenRow = x2Hash(seed, 11) % 3;
	const accent = x2Unit(seed, 12) < 0.4;
	const outlineOthers = x2Hash(seed, 13) % 3 !== 2;
	const bandWidth = portrait ? width * 0.86 : width * 0.72;
	const leadK = 1.75;
	const track = 0.03;
	const size = Math.min(
		fitSize({ maxH: Number.POSITIVE_INFINITY, maxW: bandWidth * 0.64, text, track }),
		margin * 0.15,
		(height * 0.62) / (3 * leadK),
	);
	const x0 = width / 2 - bandWidth / 2;
	const x1 = width / 2 + bandWidth / 2;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	const names = ["FLUSH LEFT", "CENTERED", "FLUSH RIGHT"];
	const e0 = outExpo(clamp(lt / 0.7)) * out;
	if (e0 > 0) {
		const half = (size * leadK + size * 0.95) * e0;
		strokeSeg(ctx, x0, height / 2 - half, x0, height / 2 + half, frame.palette.secondary, lw, 0.8);
		strokeSeg(ctx, x1, height / 2 - half, x1, height / 2 + half, frame.palette.secondary, lw, 0.8);
	}
	const aligns: CanvasTextAlign[] = ["left", "center", "right"];
	for (let index = 0; index < 3; index += 1) {
		const y = height / 2 + (index - 1) * size * leadK;
		const e = outExpo(clamp((lt - 0.08 - index * 0.1) / 0.6)) * out;
		const align = aligns[index] ?? "center";
		const x = index === 0 ? x0 + size * 0.1 : index === 1 ? width / 2 : x1 - size * 0.1;
		if (index === chosenRow) {
			ctx.fillStyle = accent ? frame.palette.accent : frame.palette.foreground;
			ctx.textAlign = align;
			options.setFontSize(size);
			drawText({ maxWidth: bandWidth, size, text, x, y });
		} else if (e > 0) {
			ctx.save();
			ctx.textAlign = align;
			options.setFontSize(size);
			if (outlineOthers) {
				ctx.lineWidth = Math.max(1.2, size * 0.012);
				ctx.strokeStyle = frame.palette.secondary;
				ctx.strokeText(text, x, y, bandWidth);
			} else {
				ctx.fillStyle = mixHex({
					from: frame.palette.background,
					progress: 0.22,
					to: frame.palette.foreground,
				});
				ctx.globalAlpha *= clamp(e);
				ctx.fillText(text, x, y, bandWidth);
			}
			ctx.restore();
		}
		if (e > 0) {
			const yb = y + size * 0.64;
			const fromRight = index === 2;
			const from = fromRight ? x1 : x0;
			const to = fromRight ? lerpN(x1, x0, e) : lerpN(x0, x1, e);
			strokeSeg(ctx, from, yb, to, yb, frame.palette.secondary, lw, 0.4);
			labelAt(ctx, frame, {
				alpha: e * (index === chosenRow ? 1 : 0.7),
				color: index === chosenRow ? frame.palette.accent : frame.palette.secondary,
				size: ls,
				text: `${pad2(index + 1)} ${names[index] ?? ""}`,
				x: index === 0 ? x1 - ls * 0.5 : x0 + ls * 0.5,
				y: yb - ls * 0.95,
			});
		}
	}
}

/** 軸組 — the lines alternate flush right / flush left against one vertical hairline axis. */
function drawAxis(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const count = glyphCountOf(text);
	const wantedLines =
		width < height
			? count <= 3
				? 2
				: count <= 7
					? 3
					: count <= 11
						? 4
						: 5
			: count <= 4
				? 2
				: count <= 9
					? 3
					: 4;
	const firstLeft = x2Unit(seed, 21) < 0.5;
	const axisAccent = x2Hash(seed, 22) % 3 === 2;
	const showIndex = x2Unit(seed, 23) < 0.7;
	const accentRow = x2Hash(seed, 24) % 6;
	const units = unitsOf(text);
	const lineCount = Math.min(wantedLines, units.length);
	const lines = groupFr(units, evenFr(lineCount));
	const total = lines.length;
	const leadK = 1.3;
	const track = 0.03;
	const gap = 20;
	const onLeft = (index: number): boolean => (index % 2 === 0) === firstLeft;
	const widths = lines.map((line) => measureW(line, 100, track));
	let maxLeft = 0;
	let maxRight = 0;
	widths.forEach((lineWidth, index) => {
		if (onLeft(index)) maxLeft = Math.max(maxLeft, lineWidth);
		else maxRight = Math.max(maxRight, lineWidth);
	});
	const size = Math.min(
		(width * 0.86 * 100) / (maxLeft + maxRight + gap * 2),
		(height * 0.8) / (total * leadK),
		margin * 0.2,
	);
	const k = size / 100;
	const axisX = width / 2 + ((maxLeft - maxRight) * k) / 2;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	const e = outExpo(clamp(lt / 0.7)) * out;
	const half = total * size * leadK * 0.5 + size * 0.35;
	const axisColor = axisAccent ? frame.palette.accent : frame.palette.secondary;
	if (e > 0) {
		strokeSeg(
			ctx,
			axisX,
			height / 2 - half * e,
			axisX,
			height / 2 + half * e,
			axisColor,
			axisAccent ? lw * 1.6 : lw,
			0.85,
		);
	}
	lines.forEach((line, index) => {
		const y = height / 2 + (index - (total - 1) / 2) * size * leadK;
		const left = onLeft(index);
		ctx.fillStyle =
			total > 2 && index === accentRow % total
				? frame.palette.accent
				: frame.palette.foreground;
		ctx.textAlign = left ? "right" : "left";
		options.setFontSize(size);
		drawText({
			maxWidth: width,
			size,
			text: line,
			x: axisX + (left ? -1 : 1) * gap * k,
			y,
		});
		const a = outCubic(clamp((lt - 0.15 - index * 0.08) / 0.3)) * out;
		if (a > 0) {
			const direction = left ? 1 : -1;
			strokeSeg(
				ctx,
				axisX,
				y,
				axisX - direction * size * 0.12 * a,
				y,
				axisColor,
				lw,
				0.85,
			);
			if (showIndex) {
				labelAt(ctx, frame, {
					alpha: a * 0.85,
					size: ls,
					text: pad2(index + 1),
					x: axisX + direction * gap * k * 0.8,
					y,
				});
			}
		}
	});
}

/** 割り出し — the frame as a page: ninths ticked on the edges, diagonals, and the classic text block. */
function drawCanon(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const flip = x2Unit(seed, 31) < 0.5;
	const low = x2Unit(seed, 32) < 0.35;
	const blockAccent = x2Hash(seed, 33) % 3 === 2;
	const ticks = x2Unit(seed, 34) < 0.8;
	const px = width * 0.045;
	const py = height * 0.055;
	const pw = width - px * 2;
	const ph = height - py * 2;
	const fx = (value: number): number => px + pw * (flip ? 1 - value : value);
	const fy = (value: number): number => py + ph * value;
	const tx0 = Math.min(fx(1 / 9), fx(7 / 9));
	const tx1 = Math.max(fx(1 / 9), fx(7 / 9));
	const ty0 = fy(1 / 9);
	const ty1 = fy(7 / 9);
	const blockWidth = tx1 - tx0;
	const blockHeight = ty1 - ty0;
	const blockText = mainLines(text, width, height, 9, 5);
	const lead = 1.26;
	const size = Math.min(
		fitSize({
			lead,
			maxH: blockHeight * 0.7,
			maxW: blockWidth * 0.9,
			text: blockText,
			track: 0.03,
		}),
		margin * 0.165,
	);
	const lines = blockText.split("\n");
	const blockH = lines.length * lead * size;
	const inset = Math.min(blockWidth, blockHeight) * 0.06;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.8;
	const e1 = outExpo(clamp(lt / 0.8)) * out;
	const e2 = outCubic(clamp((lt - 0.15) / 0.6)) * out;
	const e3 = outExpo(clamp((lt - 0.3) / 0.7)) * out;
	if (e1 > 0) {
		polyPartial(ctx, rectPoints(px, py, px + pw, py + ph), e1, frame.palette.secondary, lw, 0.5);
	}
	if (e2 > 0) {
// eslint-disable-next-line opencut/prefer-object-params
		const diagonal = (
			a: readonly [number, number],
			b: readonly [number, number],
		): void => {
			strokeSeg(
				ctx,
				fx(a[0]),
				fy(a[1]),
				lerpN(fx(a[0]), fx(b[0]), e2),
				lerpN(fy(a[1]), fy(b[1]), e2),
				frame.palette.secondary,
				lw,
				0.4,
			);
		};
		diagonal([0, 0], [1 / 9, 1 / 9]);
		diagonal([1, 1], [7 / 9, 7 / 9]);
		diagonal([1, 0], [7 / 9, 2 / 9]);
		diagonal([0, 1], [2 / 9, 7 / 9]);
		if (ticks) {
			const t = margin * 0.012;
			for (let index = 1; index < 9; index += 1) {
				strokeSeg(ctx, px + (pw * index) / 9, py, px + (pw * index) / 9, py + t * e2, frame.palette.secondary, lw, 0.7);
				strokeSeg(ctx, px, py + (ph * index) / 9, px + t * e2, py + (ph * index) / 9, frame.palette.secondary, lw, 0.7);
			}
		}
	}
	if (e3 > 0) {
		polyPartial(
			ctx,
			rectPoints(tx0, ty0, tx1, ty1),
			e3,
			blockAccent ? frame.palette.accent : frame.palette.secondary,
			lw,
			0.85,
		);
		labelAt(ctx, frame, {
			alpha: e3 * 0.85,
			size: ls,
			text: "1/9",
			x: (fx(0) + fx(1 / 9)) / 2,
			y: ty0 + ls,
		});
		labelAt(ctx, frame, {
			alpha: e3 * 0.85,
			size: ls,
			text: "2/9",
			x: (fx(7 / 9) + fx(1)) / 2,
			y: ty1 - ls,
		});
		labelAt(ctx, frame, {
			alpha: e3 * 0.85,
			size: ls,
			text: `6/9 × 6/9   No.${pad2(cutNoOf(seed))}`,
			x: tx0,
			y: ty1 + ls * 1.3,
		});
	}
	drawBlock(options, {
		align: "left",
		color: frame.palette.foreground,
		lead,
		maxWidth: blockWidth,
		size,
		text: blockText,
		x: tx0 + inset,
		y: low ? ty1 - inset - blockH / 2 : ty0 + inset + blockH / 2,
	});
}

/** 部分拡大 — one key glyph blown up solid and cut by the frame; the line set small beside it. */
function drawDetail(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const portrait = width < height;
	const lt = secondsOf(frame);
	const outFade = inCubic(frame.exitProgress);
	const duration = Math.max(0.5, cut.duration / 120_000);
	const u = clamp(lt / duration) * 0.7;
	const text = String(cut.text).trim();
	if (!text) return;
	const characters = [...cleanText(text)];
	const keyCharacter = characters[keyIndexOf(characters, "kanji")] ?? "・";
	const sideA = x2Hash(seed, 41) % 2 === 0;
	const style = ["solid", "solid", "accent", "outline"][x2Hash(seed, 42) % 4] ?? "solid";
	const drift = x2Hash(seed, 43) % 2 === 0 ? 1 : -1;
	const e = outExpo(clamp(lt / 0.8));
	const og = outFade;
	const lead = 1.24;
	const blockText = mainLines(text, width, height, 6, 6);
	let bigSize: number;
	let bigX: number;
	let bigY: number;
	let blockSize: number;
	let blockX: number;
	let blockY: number;
	if (!portrait) {
		bigSize = Math.min(height * 1.3, width * 0.72);
		bigX = sideA ? width * 0.47 - bigSize / 2 : width * 0.53 + bigSize / 2;
		bigY = height * 0.5 + drift * bigSize * 0.02 * (u - 0.5);
		bigX += (sideA ? -1 : 1) * ((1 - e) + og) * bigSize * 0.14;
		blockSize = Math.min(
			fitSize({ lead, maxH: height * 0.56, maxW: width * 0.38, text: blockText, track: 0.04 }),
			margin * 0.125,
		);
		blockX = sideA ? width * 0.55 : width * 0.07;
		blockY = height / 2;
	} else {
		bigSize = Math.min(width * 1.2, height * 0.6);
		bigY = sideA ? height * 0.5 - bigSize / 2 : height * 0.5 + bigSize / 2;
		bigX = width * 0.5 + drift * bigSize * 0.02 * (u - 0.5) - drift * width * 0.06;
		bigY += (sideA ? -1 : 1) * ((1 - e) + og) * bigSize * 0.14;
		blockSize = Math.min(
			fitSize({ lead, maxH: height * 0.3, maxW: width * 0.84, text: blockText, track: 0.04 }),
			width * 0.15,
		);
		blockX = width * 0.08;
		blockY = sideA ? height * 0.74 : height * 0.26;
	}
	const alpha = clamp(e * 1.4) * (1 - og);
	if (alpha > 0.003) {
		ctx.save();
		ctx.globalAlpha *= alpha;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		options.setFontSize(bigSize);
		if (style === "outline") {
			ctx.lineWidth = Math.max(2, bigSize * 0.009);
			ctx.strokeStyle = frame.palette.foreground;
			ctx.strokeText(keyCharacter, bigX, bigY);
		} else {
			ctx.fillStyle = style === "accent" ? frame.palette.accent : frame.palette.foreground;
			ctx.fillText(keyCharacter, bigX, bigY);
		}
		ctx.restore();
	}
	const blockLines = blockText.split("\n");
	const blockH = blockLines.length * lead * blockSize;
	drawBlock(options, {
		align: "left",
		color: frame.palette.foreground,
		lead,
		maxWidth: width,
		size: blockSize,
		text: blockText,
		x: blockX,
		y: blockY,
	});
	const la = outCubic(clamp((lt - 0.3) / 0.35)) * (1 - outFade);
	if (la <= 0) return;
	const ls = clamp(margin * 0.018, 11, 22);
	const topY = blockY - blockH / 2 - ls * 1.7;
	labelAt(ctx, frame, {
		alpha: la,
		color: frame.palette.accent,
		size: ls,
		text: `×${(bigSize / blockSize).toFixed(1)}`,
		x: blockX,
		y: topY,
	});
	const ruleX = blockX + ls * 4.2;
	const ruleLength =
		Math.max(ls * 2, Math.min(blockH * 0.6, width * 0.3)) *
		outExpo(clamp((lt - 0.3) / 0.6));
	strokeSeg(ctx, ruleX, topY, ruleX + ruleLength, topY, frame.palette.secondary, Math.max(1, margin * 0.0014), 0.7 * la);
	labelAt(ctx, frame, {
		alpha: la * 0.8,
		size: ls * 0.85,
		text: `U+${(keyCharacter.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
		x: blockX,
		y: blockY + blockH / 2 + ls * 1.5,
	});
}

/** 逆三角組 — centred lines that shorten step by step, with converging hairlines and an end mark. */
function drawFunnel(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const count = glyphCountOf(text);
	const down = x2Hash(seed, 51) % 3 !== 2;
	const sides = x2Unit(seed, 52) < 0.8;
	const mark = ["sq", "sq", "none"][x2Hash(seed, 53) % 3] ?? "none";
	const initialLines = count <= 5 ? 2 : count <= 11 ? 3 : 4;
	const fractionsOf = (total: number): number[] => {
		const weights = Array.from(
			{ length: total },
			(_, index) => (down ? total - index : index + 1) + 0.4,
		);
		const sum = weights.reduce((a, b) => a + b, 0);
		let accumulated = 0;
		return weights.map((value) => (accumulated += value) / sum);
	};
	let units = unitsOf(text);
	let lines = groupFr(units, fractionsOf(Math.min(initialLines, units.length)));
	if (!isLatinText(text) && lines.length < 2) {
		units = charUnits(text);
		lines = groupFr(units, fractionsOf(Math.min(initialLines, units.length)));
	}
	const total = lines.length;
	const leadK = 1.5;
	const track = 0.1;
	let size = Math.min((height * 0.74) / (total * leadK), margin * 0.2);
	for (const line of lines) {
		size = Math.min(size, fitSize({ maxH: Number.POSITIVE_INFINITY, maxW: width * 0.8, text: line, track }));
	}
	const widths = lines.map((line) => measureW(line, size, track));
	const yOf = (index: number): number =>
		height / 2 + (index - (total - 1) / 2) * size * leadK;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	options.setFontSize(size);
	for (const [index, line] of lines.entries()) {
		drawText({ maxWidth: width, size, text: line, x: width / 2, y: yOf(index) });
	}
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	const e = outExpo(clamp((lt - 0.12) / 0.8)) * out;
	if (e <= 0) return;
	const y0 = yOf(0) - size * 0.62;
	const y1 = yOf(total - 1) + size * 0.62;
	const pad = size * 0.3;
	if (sides && total > 1) {
		let h0 = (widths[0] ?? 0) / 2 + pad;
		let h1 = (widths[total - 1] ?? 0) / 2 + pad;
		let extra = 0;
		for (let index = 1; index < total - 1; index += 1) {
			const t = (yOf(index) - y0) / Math.max(1, y1 - y0);
			extra = Math.max(extra, (widths[index] ?? 0) / 2 + pad - lerpN(h0, h1, t));
		}
		h0 += extra;
		h1 += extra;
		const limit = width * 0.47;
		h0 = Math.min(h0, limit);
		h1 = Math.min(h1, limit);
		for (const direction of [-1, 1]) {
			strokeSeg(
				ctx,
				width / 2 + direction * h0,
				y0,
				width / 2 + direction * lerpN(h0, h1, e),
				lerpN(y0, y1, e),
				frame.palette.secondary,
				lw,
				0.6,
			);
		}
	}
	const ym = down ? y1 + size * 0.16 : y0 - size * 0.16;
	const q = Math.max(4, size * 0.085);
	if (mark === "sq") {
		fillRectAt(ctx, width / 2 - q / 2, ym - q / 2, q, q, frame.palette.accent, e);
	}
	labelAt(ctx, frame, {
		alpha: e * 0.85,
		size: ls,
		align: "center",
		text: lines.map((line) => String(glyphCountOf(line))).join(" · "),
		x: width / 2,
		y: ym + (down ? 1 : -1) * (q + ls * 1.1),
	});
}

/** 鉤組 — the line runs horizontally, turns at one glyph and continues vertically. */
function drawHook(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const flip = x2Unit(seed, 61) < 0.4;
	const mode = ["kanji", "mid", "mid"][x2Hash(seed, 62) % 3] ?? "mid";
	const keyAccent = x2Hash(seed, 63) % 3 !== 2;
	const ext = x2Unit(seed, 64) < 0.75;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22);
	const e = outExpo(clamp((lt - 0.12) / 0.7)) * out;
	const keyColor = keyAccent ? frame.palette.accent : frame.palette.foreground;
	if (isLatinText(text)) {
		const track = 0.04;
		const parts = groupFr(unitsOf(text), [(width >= height) !== flip ? 0.62 : 0.4, 1]);
		if (parts.length < 2) {
			const single = parts[0] ?? text;
			const size = Math.min(fitSize({ maxH: height * 0.5, maxW: width * 0.8, text: single, track }), margin * 0.24);
			ctx.fillStyle = frame.palette.foreground;
			ctx.textAlign = "center";
			options.setFontSize(size);
			drawText({ maxWidth: width * 0.8, size, text: single, x: width / 2, y: height / 2 });
			return;
		}
		const horizontal = flip ? parts[1]! : parts[0]!;
		const turned = flip ? parts[0]! : parts[1]!;
		const wH = measureW(horizontal, 100, track);
		const wV = measureW(turned, 100, track);
		const gap = 34;
		const totalW = wH + gap + 100;
		const totalH = Math.max(100, wV);
		const size = Math.min(
			(width * 0.84 * 100) / totalW,
			(height * 0.82 * 100) / totalH,
			margin * 0.2,
		);
		const k = size / 100;
		const left = width / 2 - (totalW * k) / 2;
		const top = height / 2 - (totalH * k) / 2;
		const vx = flip ? left + size / 2 : left + totalW * k - size / 2;
		const vy = top + (wV * k) / 2;
		const hy = flip ? top + wV * k - size / 2 : top + size / 2;
		const hx = flip ? left + size + gap * k : left;
		if (e > 0 && ext) {
			if (!flip) {
				strokeSeg(ctx, vx + size * 0.6, hy, lerpN(vx + size * 0.6, width * 0.96, e), hy, frame.palette.secondary, lw, 0.32);
				strokeSeg(ctx, vx - size * 0.62, top - size * 0.1, vx - size * 0.62, top - size * 0.1 + (wV * k + size * 0.2) * e, frame.palette.secondary, lw, 0.6);
			} else {
				strokeSeg(ctx, vx, top + wV * k + size * 0.15, vx, lerpN(top + wV * k + size * 0.15, height * 0.96, e), frame.palette.secondary, lw, 0.32);
				strokeSeg(ctx, hx, hy - size * 0.66, hx + wH * k * e, hy - size * 0.66, frame.palette.secondary, lw, 0.6);
			}
		}
		if (e > 0) {
			labelAt(ctx, frame, {
				alpha: e * 0.9,
				size: ls * 0.85,
				align: flip ? "left" : "right",
				text: "90°",
				x: flip ? vx + size * 0.7 : vx - size * 0.75,
				y: flip ? top + ls * 0.6 : top + wV * k - ls * 0.3,
			});
		}
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "left";
		options.setFontSize(size);
		drawText({ maxWidth: width, size, text: horizontal, x: hx, y: hy });
		ctx.save();
		ctx.translate(vx, vy);
		ctx.rotate(Math.PI / 2);
		ctx.fillStyle = flip ? frame.palette.foreground : keyColor;
		ctx.textAlign = "center";
		drawText({ maxWidth: height, size, text: turned, x: 0, y: 0 });
		ctx.restore();
		return;
	}
	const slots = slotsOf(text);
	const n = slots.length;
	if (n < 2) {
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		options.setFontSize(margin * 0.3);
		drawText({ maxWidth: width, size: margin * 0.3, text: slots.join(""), x: width / 2, y: height / 2 });
		return;
	}
	let keyPosition = keyIndexOf(slots, mode);
	const want = clamp(
		Math.round(
			(n - 1) *
				(width >= height ? (flip ? 0.3 : 0.62) : flip ? 0.6 : 0.34),
		),
		1,
		Math.max(1, n - 2),
	);
	if (
		keyPosition < 1 ||
		keyPosition > n - 2 ||
		Math.abs(keyPosition - want) > Math.max(1, n * 0.25)
	) {
		keyPosition = -1;
		for (let distance = 0; distance < n && keyPosition < 0; distance += 1) {
			for (const candidate of [want + distance, want - distance]) {
				if (
					keyPosition < 0 &&
					candidate >= 1 &&
					candidate <= n - 2 &&
					okKey(slots[candidate] ?? "")
				) {
					keyPosition = candidate;
				}
			}
		}
		if (keyPosition < 0) keyPosition = Math.min(n - 1, Math.max(1, want));
	}
	const track = 0.06;
	const before = slots.slice(0, keyPosition).join("").trim();
	const keyCharacter = slots[keyPosition] ?? "・";
	const after = slots.slice(keyPosition + 1).join("").trim();
	const widthOf = (value: string): number => (value ? measureW(value, 100, track) : 0);
	const keyWidth = Math.max(60, widthOf(keyCharacter));
	const gap = 100 * track + 6;
	const armWidth = flip ? widthOf(after) : widthOf(before);
	const armHeight = flip ? widthOf(before) : widthOf(after);
	const totalW = keyWidth + (armWidth > 0 ? armWidth + gap : 0);
	const totalH = 100 + (armHeight > 0 ? armHeight + gap : 0);
	const size = Math.min(
		(width * 0.84 * 100) / totalW,
		(height * 0.84 * 100) / totalH,
		margin * 0.22,
	);
	const k = size / 100;
	const left = width / 2 - (totalW * k) / 2;
	const top = height / 2 - (totalH * k) / 2;
	const kx = flip ? left + (keyWidth * k) / 2 : left + totalW * k - (keyWidth * k) / 2;
	const ky = flip ? top + totalH * k - size / 2 : top + size / 2;
	const half = size * 0.58;
	if (e > 0) {
		if (ext) {
			if (!flip) {
				strokeSeg(ctx, kx + half, ky, lerpN(kx + half, width * 0.96, e), ky, frame.palette.secondary, lw, 0.32);
				strokeSeg(ctx, kx, ky - half, kx, lerpN(ky - half, height * 0.04, e), frame.palette.secondary, lw, 0.32);
			} else {
				strokeSeg(ctx, kx - half, ky, lerpN(kx - half, width * 0.04, e), ky, frame.palette.secondary, lw, 0.32);
				strokeSeg(ctx, kx, ky + half, kx, lerpN(ky + half, height * 0.96, e), frame.palette.secondary, lw, 0.32);
			}
		}
		polyPartial(ctx, rectPoints(kx - half, ky - half, kx + half, ky + half), e, frame.palette.secondary, lw, 0.8);
		labelAt(ctx, frame, {
			alpha: e * 0.9,
			size: ls * 0.85,
			align: flip ? "left" : "right",
			text: `${pad2(keyPosition + 1)} ⁄ 90°`,
			x: flip ? kx - half : kx + half,
			y: flip ? ky + half + ls : ky - half - ls,
		});
	}
	options.setFontSize(size);
	if (!flip) {
		if (before) {
			ctx.fillStyle = frame.palette.foreground;
			ctx.textAlign = "right";
			drawText({
				maxWidth: width,
				size,
				text: before,
				x: kx - (keyWidth * k) / 2 - gap * k,
				y: ky,
			});
		}
		ctx.fillStyle = keyColor;
		ctx.textAlign = "center";
		drawText({ maxWidth: size, size, text: keyCharacter, x: kx, y: ky });
		if (after) {
			ctx.save();
			ctx.translate(kx, ky + size / 2 + gap * k + (armHeight * k) / 2);
			ctx.rotate(Math.PI / 2);
			ctx.fillStyle = frame.palette.foreground;
			ctx.textAlign = "center";
			drawText({ maxWidth: height, size, text: after, x: 0, y: 0 });
			ctx.restore();
		}
	} else {
		if (before) {
			ctx.save();
			ctx.translate(kx, top + (armHeight * k) / 2);
			ctx.rotate(Math.PI / 2);
			ctx.fillStyle = frame.palette.foreground;
			ctx.textAlign = "center";
			drawText({ maxWidth: height, size, text: before, x: 0, y: 0 });
			ctx.restore();
		}
		ctx.fillStyle = keyColor;
		ctx.textAlign = "center";
		drawText({ maxWidth: size, size, text: keyCharacter, x: kx, y: ky });
		if (after) {
			ctx.fillStyle = frame.palette.foreground;
			ctx.textAlign = "left";
			drawText({
				maxWidth: width,
				size,
				text: after,
				x: kx + (keyWidth * k) / 2 + gap * k,
				y: ky,
			});
		}
	}
}

/** 沈む基線 — the big line cut by a horizon hairline; the caption repeats it small. */
function drawHorizon(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const sink = x2Hash(seed, 71) % 3 !== 2;
	const crop = 0.16 + x2Unit(seed, 72) * 0.08;
	const caption = x2Unit(seed, 73) < 0.85;
	const lineColor = ["accent", "sub", "fg"][x2Hash(seed, 74) % 3] ?? "sub";
	const c = sink ? crop : crop * 0.7;
	const duration = Math.max(0.6, cut.duration / 120_000);
	const u = clamp(lt / duration) * 0.7;
	const blockText = mainLines(text, width, height, 8, 5);
	const lines = blockText.split("\n");
	const total = lines.length;
	const lead = 1.5;
	const size = Math.min(
		fitSize({ lead, maxH: height * 0.64, maxW: width * 0.84, text: blockText, track: 0.03 }),
		margin * 0.27,
	);
	const shiftY = (sink ? 1 : -1) * size * 0.03 * u;
	const centers: number[] = [];
	const horizons: number[] = [];
	for (let index = 0; index < total; index += 1) {
		const yc = height / 2 + (index - (total - 1) / 2) * size * lead;
		centers.push(yc);
		horizons.push(sink ? yc + size * (0.5 - c) : yc - size * (0.5 - c));
	}
	ctx.save();
	ctx.beginPath();
	for (let index = 0; index < total; index += 1) {
		const yc = centers[index] ?? height / 2;
		const hz = horizons[index] ?? yc;
		const topEdge = index === 0 ? -height : yc - (size * lead) / 2;
		const bottomEdge =
			index === total - 1 ? height * 2 : yc + (size * lead) / 2;
		if (sink) {
			ctx.rect(-width, topEdge, width * 3, hz - topEdge);
		} else {
			ctx.rect(-width, hz, width * 3, bottomEdge - hz);
		}
	}
	ctx.clip();
	drawBlock(options, {
		align: "center",
		color: frame.palette.foreground,
		lead,
		maxWidth: width * 0.84,
		size,
		text: blockText,
		x: width / 2,
		y: height / 2 + shiftY,
	});
	ctx.restore();
	const lw = Math.max(1, margin * 0.0014);
	const ls = clamp(margin * 0.018, 11, 22);
	const color =
		lineColor === "accent"
			? frame.palette.accent
			: lineColor === "fg"
				? frame.palette.foreground
				: frame.palette.secondary;
	horizons.forEach((y, index) => {
		const e = outExpo(clamp((lt - index * 0.08) / 0.7)) * out;
		if (e <= 0) return;
		strokeSeg(
			ctx,
			width / 2 - width * 0.46 * e,
			y,
			width / 2 + width * 0.46 * e,
			y,
			index === 0 || lineColor !== "accent" ? color : frame.palette.secondary,
			Math.max(1.2, lw * 1.3),
			0.9,
		);
	});
	const la = outCubic(clamp((lt - 0.3) / 0.35)) * out;
	if (la <= 0) return;
	const lineWidth = Math.min(
		width * 0.84,
		Math.max(size, glyphCountOf(text) * size * 0.62),
	);
	const xa = Math.max(width * 0.06, width / 2 - lineWidth / 2);
	const xb = Math.min(width * 0.94, width / 2 + lineWidth / 2);
	const y = sink ? (horizons[total - 1] ?? height) + ls * 1.5 : (horizons[0] ?? 0) - ls * 1.4;
	const captionText = text.replace(/\s+/gu, " ");
	if (caption) {
		labelAt(ctx, frame, {
			alpha: la,
			color: frame.palette.foreground,
			size: Math.min(
				ls * 1.05,
				(xb - xa) * 0.7 / Math.max(1, [...captionText].length),
			),
			text: captionText,
			x: xa,
			y,
		});
	}
	labelAt(ctx, frame, {
		alpha: la * 0.85,
		size: ls * 0.85,
		align: "right",
		text: `${sink ? "−" : "+"}${Math.round(c * 100)}%`,
		x: xb,
		y,
	});
}

/** 字面線 — each line runs through its metric lines (top, centre, baseline, bottom), named. */
function drawMetric(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const em = x2Unit(seed, 81) < 0.8;
	const baselineAccent = x2Hash(seed, 82) % 3 !== 2;
	const right = x2Unit(seed, 83) < 0.3;
	const blockText = mainLines(text, width, height, 8, 4);
	const lines = blockText.split("\n");
	const total = lines.length;
	const lead = 1.56;
	const size = Math.min(
		fitSize({ lead, maxH: height * 0.78, maxW: width * 0.72, text: blockText, track: 0.04 }),
		margin * 0.26,
	);
	const align: CanvasTextAlign = right ? "right" : "left";
	const x = right ? width * 0.86 : width * 0.14;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.75;
	const baselineColor = baselineAccent ? frame.palette.accent : frame.palette.foreground;
	const xa = width * 0.03;
	const xb = width * 0.97;
	for (let index = 0; index < total; index += 1) {
		const yc = height / 2 + (index - (total - 1) / 2) * size * lead;
		const rows: [number, string, number, string][] = [
			[yc - size * 0.5, frame.palette.secondary, 0.5, "TOP"],
			[yc, frame.palette.secondary, 0.3, "CTR"],
			[yc + size * 0.38, baselineColor, 0.85, "BASE"],
			[yc + size * 0.5, frame.palette.secondary, 0.5, "BTM"],
		];
		rows.forEach(([y, color, alpha, name], rowIndex) => {
			const e = outExpo(clamp((lt - index * 0.08 - rowIndex * 0.05) / 0.7)) * out;
			if (e <= 0) return;
			const from = (index + rowIndex) % 2 === 1 ? xb : xa;
			const to = lerpN(from, from === xa ? xb : xa, e);
			if (rowIndex === 1) {
				dashSeg(ctx, from, y, to, y, color, lw, alpha, size * 0.05, size * 0.05);
			} else {
				strokeSeg(
					ctx,
					from,
					y,
					to,
					y,
					color,
					rowIndex === 2 ? Math.max(1.2, lw * 1.3) : lw,
					alpha,
				);
			}
			if (index === 0 || total <= 2) {
				const leftSide = right ? rowIndex % 2 === 1 : rowIndex % 2 === 0;
				labelAt(ctx, frame, {
					alpha: e * 0.85,
					align: leftSide ? "left" : "right",
					color: rowIndex === 2 ? baselineColor : frame.palette.secondary,
					size: ls,
					text: name,
					x: leftSide ? xa + ls * 0.3 : xb - ls * 0.3,
					y: y - ls * 0.85,
				});
			}
		});
	}
	drawBlock(options, {
		align,
		color: frame.palette.foreground,
		lead,
		maxWidth: width,
		size,
		text: blockText,
		x,
		y: height / 2,
	});
	if (!em) return;
	const glyphs = lineGlyphs({ align, maxWidth: width, size, text: blockText.split("\n")[0] ?? "", x, y: height / 2 });
	const first = glyphs[0];
	if (!first) return;
	const e = outExpo(clamp((lt - 0.3) / 0.6)) * out;
	if (e <= 0) return;
	const halfWidth = Math.max(size * 0.62, size * 0.9) / 2;
	const top = first.y - size * 0.5 - size * 0.2 * e;
	const bottom = first.y + size * 0.5 + size * 0.2 * e;
	strokeSeg(ctx, first.x - halfWidth, top, first.x - halfWidth, bottom, frame.palette.secondary, lw, 0.6 * e);
	strokeSeg(ctx, first.x + halfWidth, top, first.x + halfWidth, bottom, frame.palette.secondary, lw, 0.6 * e);
	if (top - ls > height * 0.04) {
		labelAt(ctx, frame, {
			alpha: e * 0.9,
			align: "center",
			size: ls,
			text: `EM ${Math.round(size / (margin / 1080))}`,
			x: first.x,
			y: top - ls * 0.9,
		});
	}
}

/** 順路 — the glyphs stand loosely apart, numbered, a hairline walking between them. */
function drawPath(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const portrait = width < height;
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const numbered = x2Unit(seed, 91) < 0.85;
	const endMark = x2Unit(seed, 92) < 0.7;
	const lineAccent = x2Hash(seed, 93) % 3 === 2;
	let units = isLatinText(text)
		? text.split(/\s+/u).filter(Boolean)
		: charUnits(text);
	if (units.length > 12) units = groupFr(units, evenFr(12));
	const n = units.length;
	if (n === 0) return;
	const columns = portrait
		? Math.min(n, n <= 4 ? 2 : 3)
		: Math.min(n, n <= 6 ? n : Math.ceil(n / 2));
	const rows = Math.ceil(n / columns);
	const areaWidth = width * 0.86;
	const areaHeight = Math.min(
		height * 0.78,
		rows === 1 ? margin * 0.5 : Number.POSITIVE_INFINITY,
	);
	const cellWidth = areaWidth / columns;
	const cellHeight = areaHeight / rows;
	let size = Math.min(cellHeight * 0.58, margin * 0.24);
	for (const unit of units) {
		size = Math.min(size, (cellWidth * 0.62) / Math.max(0.2, measureW(unit, 1)));
	}
	const runSeed = Math.abs(seed) || 1;
	const points: [number, number][] = units.map((unit, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const lastRow = row === rows - 1;
		const inRow = lastRow ? n - row * columns : columns;
		const x0 = width / 2 - (inRow * cellWidth) / 2;
		return [
			x0 +
				(column + 0.5) * cellWidth +
				x2Signed(runSeed, index, 1) * cellWidth * 0.1,
			height / 2 -
				areaHeight / 2 +
				(row + 0.5) * cellHeight +
				x2Signed(runSeed, index, 2) * cellHeight * 0.19,
		];
	});
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(Math.min(margin * 0.018, 22) * 0.85, size * 0.3);
	const lineColor = lineAccent ? frame.palette.accent : frame.palette.secondary;
	const halves = units.map(
		(unit) => measureW(unit, size) / 2 + size * 0.14,
	);
	for (let index = 0; index < n - 1; index += 1) {
		const e = outCubic(clamp((lt - 0.2 - index * 0.07) / 0.35)) * out;
		if (e <= 0) continue;
		const a = points[index]!;
		const b = points[index + 1]!;
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
// eslint-disable-next-line opencut/prefer-object-params
		const cutAt = (hw: number, hh: number): number =>
			Math.min(
				Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : 1e9,
				Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : 1e9,
			);
		const t0 = cutAt(halves[index] ?? size, size * 0.62);
		const t1 = 1 - cutAt(halves[index + 1] ?? size, size * 0.62);
		if (t1 - t0 < 0.04) continue;
		const reach = lerpN(t0, t1, e);
		strokeSeg(ctx, a[0] + dx * t0, a[1] + dy * t0, a[0] + dx * reach, a[1] + dy * reach, lineColor, lw, 0.75);
	}
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	options.setFontSize(size);
	for (const [index, unit] of units.entries()) {
		const point = points[index]!;
		drawText({ maxWidth: cellWidth, size, text: unit, x: point[0], y: point[1] });
		const a = outCubic(clamp((lt - 0.1 - index * 0.07) / 0.3)) * out;
		if (numbered && a > 0) {
			labelAt(ctx, frame, {
				align: "right",
				alpha: a * 0.9,
				color: index === 0 ? frame.palette.accent : frame.palette.secondary,
				size: ls,
				text: pad2(index + 1),
				x: point[0] - (halves[index] ?? size) + size * 0.1,
				y: point[1] - size * 0.62 - ls * 0.2,
			});
		}
	}
	if (!endMark) return;
	const a = outBack(clamp((lt - 0.25 - n * 0.07) / 0.3), 2) * out;
	const last = points[n - 1];
	if (a <= 0 || !last) return;
	const q = Math.max(4, size * 0.09);
	fillRectAt(
		ctx,
		last[0] + (halves[n - 1] ?? size) + q * 0.4,
		last[1] + size * 0.36 - q * a,
		q * a,
		q * a,
		frame.palette.accent,
		1,
	);
}

/** 点対称 — the line and a second setting of it turned 180° face each other. */
function drawPointSym(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const top = x2Unit(seed, 101) < 0.75;
	const edge = x2Hash(seed, 102) % 3 !== 2;
	const outline = x2Hash(seed, 103) % 3 !== 2;
	const mark = x2Unit(seed, 104) < 0.8;
	const lead = 1.2;
	const blockText = mainLines(text, width, height, 9, 5);
	const size = Math.min(
		fitSize({ lead, maxH: height * 0.33, maxW: width * 0.8, text: blockText, track: 0.03 }),
		margin * 0.17,
	);
	const lines = blockText.split("\n");
	const blockH = lines.length * lead * size;
	const blockW = Math.max(...lines.map((line) => measureW(line, size, 0.03)), 1);
	const side = top ? -1 : 1;
	const cx = edge
		? top
			? width * 0.08 + blockW / 2
			: width * 0.92 - blockW / 2
		: width / 2;
	const cy = height / 2 + side * (size * 0.34 + blockH / 2);
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	const e = outExpo(clamp(lt / 0.8)) * out;
	if (e > 0) {
		strokeSeg(ctx, width / 2 - width * 0.46 * e, height / 2, width / 2 + width * 0.46 * e, height / 2, frame.palette.secondary, lw, 0.7);
		if (mark) {
			const r = Math.max(4, size * 0.07) * e;
			ctx.save();
			const base = ctx.globalAlpha;
			if (ctx.arc && ctx.stroke && ctx.beginPath && ctx.moveTo) {
				ctx.beginPath();
				ctx.arc(width / 2, height / 2, r, 0, TAU);
				ctx.fillStyle = frame.palette.background;
				ctx.fill?.();
				ctx.lineWidth = Math.max(1.2, lw * 1.3);
				ctx.strokeStyle = frame.palette.accent;
				ctx.stroke();
			} else {
				fillRectAt(ctx, width / 2 - r, height / 2 - r, r * 2, r * 2, frame.palette.accent, 1);
			}
			ctx.globalAlpha = base;
			ctx.restore();
			labelAt(ctx, frame, {
				align: top ? "right" : "left",
				alpha: e * 0.9,
				size: ls,
				text: "180°",
				x: top ? width * 0.94 : width * 0.06,
				y: height / 2 + side * ls * 1.1,
			});
		}
	}
	const a = outCubic(clamp((lt - 0.15) / 0.5)) * out;
	if (a > 0) {
		ctx.save();
		ctx.translate(width - cx, height - cy);
		ctx.rotate(Math.PI);
		ctx.textAlign = "center";
		ctx.globalAlpha *= clamp(a);
		if (outline) {
			options.setFontSize(size);
			lines.forEach((line, index) => {
				ctx.lineWidth = Math.max(1.2, size * 0.012);
				ctx.strokeStyle = frame.palette.secondary;
				ctx.strokeText(
					line,
					0,
					(index - (lines.length - 1) / 2) * size * lead,
					width * 0.8,
				);
			});
		} else {
			ctx.fillStyle = mixHex({
				from: frame.palette.background,
				progress: 0.24,
				to: frame.palette.foreground,
			});
			options.setFontSize(size);
			lines.forEach((line, index) => {
				ctx.fillText(
					line,
					0,
					(index - (lines.length - 1) / 2) * size * lead,
					width * 0.8,
				);
			});
		}
		ctx.restore();
	}
	drawBlock(options, {
		align: "center",
		color: frame.palette.foreground,
		lead,
		maxWidth: width * 0.8,
		size,
		text: blockText,
		x: cx,
		y: cy,
	});
}

/** 斜線区切り — word groups stepping down the frame, parted by long thin slashes. */
function drawSlash(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const portrait = width < height;
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const count = glyphCountOf(text);
	const groupCount = count <= 4 ? 2 : count <= 10 ? 3 : 4;
	const step = x2Unit(seed, 111) < 0.7;
	const tall = x2Unit(seed, 112) < 0.6;
	const accentIndex = x2Hash(seed, 113) % 4;
	const numbered = x2Unit(seed, 114) < 0.7;
	const track = 0.03;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	const accentColor = frame.palette.accent;
	const groups = groupFr(unitsOf(text), evenFr(Math.min(groupCount, Math.max(2, count))));
	const total = groups.length;
	const widths = groups.map((group) => measureW(group, 100, track));
	if (!portrait) {
		const gap = step ? 90 : 64;
		const stepK = step ? 0.5 : 0;
		const sum = widths.reduce((a, b) => a + b, 0) + (total - 1) * gap;
		const size = Math.min(
			(width * 0.86 * 100) / sum,
			(height * 0.72) / (1 + (total - 1) * stepK),
			margin * 0.24,
		);
		const k = size / 100;
		const slashHeight = tall ? height * 0.84 : size * (2 + (total - 1) * stepK);
		const tangent = Math.tan((16 * Math.PI) / 180);
		let x = width / 2 - (sum * k) / 2;
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "left";
		options.setFontSize(size);
		groups.forEach((group, index) => {
			const y = height / 2 + (index - (total - 1) / 2) * size * stepK;
			drawText({ maxWidth: width, size, text: group, x, y });
			x += (widths[index] ?? 0) * k;
			if (index < total - 1) {
				const xs = x + (gap * k) / 2;
				const ym = height / 2 + (index + 0.5 - (total - 1) / 2) * size * stepK;
				const e = outExpo(clamp((lt - 0.1 - index * 0.1) / 0.6)) * out;
				if (e > 0) {
					const hh = (slashHeight / 2) * e;
					const isAccent = index === accentIndex % Math.max(1, total - 1);
					strokeSeg(
						ctx,
						xs + hh * tangent,
						ym - hh,
						xs - hh * tangent,
						ym + hh,
						isAccent ? accentColor : frame.palette.secondary,
						isAccent ? lw * 1.6 : lw,
						0.9,
					);
					if (numbered) {
						labelAt(ctx, frame, {
							alpha: e * 0.85,
							size: ls,
							text: pad2(index + 1),
							x: xs + (slashHeight / 2) * tangent + ls * 0.7,
							y: ym - slashHeight / 2 + ls * 0.8,
						});
					}
				}
				x += gap * k;
			}
		});
		return;
	}
	const pitchK = 1.75;
	let size = Math.min((height * 0.76) / (total * pitchK), margin * 0.24);
	for (const groupWidth of widths) {
		size = Math.min(size, (width * 0.8 * 100) / Math.max(1, groupWidth));
	}
	const slant = width * 0.44 * Math.tan((5 * Math.PI) / 180);
	options.setFontSize(size);
	groups.forEach((group, index) => {
		const y = height / 2 + (index - (total - 1) / 2) * size * pitchK;
		const align: CanvasTextAlign = step
			? index % 2 === 1
				? "right"
				: "left"
			: "center";
		const x =
			align === "left" ? width * 0.1 : align === "right" ? width * 0.9 : width / 2;
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = align;
		drawText({ maxWidth: width * 0.8, size, text: group, x, y });
		if (index < total - 1) {
			const ym = y + (size * pitchK) / 2;
			const e = outExpo(clamp((lt - 0.1 - index * 0.1) / 0.6)) * out;
			if (e <= 0) return;
			const isAccent = index === accentIndex % Math.max(1, total - 1);
			const direction = index % 2 === 1 ? -1 : 1;
			strokeSeg(
				ctx,
				width / 2 - width * 0.44 * e,
				ym + slant * e * direction,
				width / 2 + width * 0.44 * e,
				ym - slant * e * direction,
				isAccent ? accentColor : frame.palette.secondary,
				isAccent ? lw * 1.6 : lw,
				0.9,
			);
			if (numbered) {
				labelAt(ctx, frame, {
					align: direction > 0 ? "right" : "left",
					alpha: e * 0.85,
					size: ls,
					text: pad2(index + 1),
					x: direction > 0 ? width * 0.94 : width * 0.06,
					y: ym - slant - ls * 0.9,
				});
			}
		}
	});
}

/** 詰まる字間 — the glyphs start spread across the frame and the tracking closes (or opens). */
function drawTrackClose(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const open = x2Hash(seed, 121) % 3 === 2;
	const ticks = x2Unit(seed, 122) < 0.8;
	const duration = Math.max(0.5, cut.duration / 120_000);
	const lines = mainLines(text, width, height, 14, 6).split("\n");
	const total = lines.length;
	const leadK = 1.6;
	let size = Math.min(margin * 0.19, (height * 0.68) / (total * leadK));
	for (const line of lines) {
		size = Math.min(size, fitSize({ maxH: Number.POSITIVE_INFINITY, maxW: width * 0.66, text: line, track: 0.02 }));
	}
	const spanT = clamp(duration * 0.55, 0.5, 1.6);
	const q = inOutCubic(clamp((lt - 0.1) / spanT));
	const u = open ? 1 - q : q;
	const span = width * 0.88 - size;
	const lw = Math.max(1, margin * 0.0014);
	const ls = clamp(margin * 0.018, 11, 22);
	let value = 0;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	options.setFontSize(size);
	lines.forEach((line, lineIndex) => {
		const y =
			height / 2 +
			(lineIndex - (total - 1) / 2) * size * leadK -
			(total > 1 ? 0 : size * 0.05);
		const glyphs = lineGlyphs({ align: "center", maxWidth: width, size, text: line, x: width / 2, y });
		const m = glyphs.length;
		if (m === 0) return;
		const xs = glyphs.map((glyph, index) =>
			width / 2 +
			lerpN(m > 1 ? ((index / (m - 1) - 0.5) * span) : 0, glyph.x - width / 2, u),
		);
		for (const [index, glyph] of glyphs.entries()) {
			drawText({
				maxWidth: size,
				size,
				text: glyph.character,
				x: xs[index] ?? width / 2,
				y,
			});
		}
		const e = outExpo(clamp((lt - 0.05 - lineIndex * 0.08) / 0.6)) * out;
		if (e <= 0) return;
		const xa = (xs[0] ?? 0) - size * 0.5;
		const xb = (xs[m - 1] ?? 0) + size * 0.5;
		const yb = y + size * 0.68;
		const c = size * 0.09;
		strokeSeg(ctx, lerpN((xa + xb) / 2, xa, e), yb, lerpN((xa + xb) / 2, xb, e), yb, frame.palette.secondary, lw, 0.6);
		if (ticks) {
			for (const x of xs) {
				strokeSeg(ctx, x, yb, x, yb + c * e, frame.palette.secondary, lw, 0.7);
			}
		}
		const direction = open ? -1 : 1;
		const xl = xa - size * 0.28;
		const xr = xb + size * 0.28;
		const accentColor = frame.palette.accent;
		if (xl > width * 0.03) {
			strokeSeg(ctx, xl - c * direction, y - c, xl, y, accentColor, lw * 1.4, e);
			strokeSeg(ctx, xl, y, xl - c * direction, y + c, accentColor, lw * 1.4, e);
		}
		if (xr < width * 0.97) {
			strokeSeg(ctx, xr + c * direction, y - c, xr, y, accentColor, lw * 1.4, e);
			strokeSeg(ctx, xr, y, xr + c * direction, y + c, accentColor, lw * 1.4, e);
		}
		if (lineIndex === 0 && m > 1) {
			value = Math.round(
				(((xs[m - 1] ?? 0) - (xs[0] ?? 0)) -
					((glyphs[m - 1]?.x ?? 0) - (glyphs[0]?.x ?? 0))) /
					(m - 1) /
					size *
					1000,
			);
		}
	});
	const la = outCubic(clamp((lt - 0.1) / 0.3)) * out;
	if (la <= 0) return;
	const latin = isLatinText(text);
	const y = height / 2 + ((total - 1) / 2) * size * leadK + size * 0.68 + ls * 1.7;
	labelAt(ctx, frame, {
		align: "center",
		alpha: la,
		size: ls * 0.9,
		text: `${latin ? "TRACKING" : "字送り"}  +${String(Math.max(0, value)).padStart(3, "0")}`,
		x: width / 2,
		y,
	});
}

/** 割り書き — the head of the line set large, the rest as a two-line note beside it. */
function drawWarichu(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const lead = x2Unit(seed, 131) < 0.3;
	const mark = ["paren", "paren", "rule", "none"][x2Hash(seed, 132) % 4] ?? "none";
	const accent = x2Unit(seed, 133) < 0.4;
	const ratio = 0.38 + x2Unit(seed, 134) * 0.12;
	const units = unitsOf(text);
	const total = units.reduce((sum, unit) => sum + glyphCountOf(unit), 0);
	const parts = groupFr(units, [lead ? 1 - ratio : ratio, 1]);
	if (parts.length < 2) {
		const size = Math.min(
			fitSize({ maxH: height * 0.5, maxW: width * 0.8, text }),
			margin * 0.3,
		);
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		options.setFontSize(size);
		drawText({ maxWidth: width * 0.8, size, text, x: width / 2, y: height / 2 });
		return;
	}
	const big = lead ? parts[1]! : parts[0]!;
	const small = lead ? parts[0]! : parts[1]!;
	const smallCount = glyphCountOf(small);
	let smallText = small;
	if (isLatinText(small)) {
		const words = small.split(/\s+/u);
		if (words.length >= 2) {
			smallText = groupFr(
				words.map((word, index) => (index ? ` ${word}` : word)),
				[0.5, 1],
			).join("\n");
		}
	} else if (smallCount >= 2) {
		smallText = splitLinesEven(small, Math.ceil(smallCount / 2)).join("\n");
	}
	const two = smallText.includes("\n");
	const smallScale = two ? 0.44 : 0.5;
	const smallLead = 1.14;
	const wb = measureW(big, 100, 0.02);
	const ms = Math.max(
		...smallText.split("\n").map((line) => measureW(line, 100 * smallScale, 0.04)),
		1,
	);
	const gap = 16;
	const padB = mark === "paren" ? 12 : 0;
	const total100 = wb + gap + ms + padB * 2;
	const size = Math.min(margin * 0.32, (width * 0.86 * 100) / total100, height * 0.5);
	const k = size / 100;
	const x0 = width / 2 - (total100 * k) / 2;
	const cy = height / 2;
	const xBig = lead ? x0 + (ms + padB * 2 + gap) * k : x0;
	const xSmall = lead ? x0 + padB * k : x0 + (wb + gap + padB) * k;
	drawBlock(options, {
		align: "left",
		color: frame.palette.foreground,
		lead: 1.1,
		maxWidth: width,
		size,
		text: big,
		x: xBig,
		y: cy,
	});
	drawBlock(options, {
		align: "left",
		color: accent ? frame.palette.accent : frame.palette.foreground,
		lead: smallLead,
		maxWidth: width,
		size: size * smallScale,
		text: smallText,
		x: xSmall,
		y: two ? cy + size * 0.01 : cy + size * 0.2,
	});
	const e = outExpo(clamp((lt - 0.18) / 0.6)) * out;
	if (e <= 0) return;
	const lw = Math.max(1, margin * 0.0014);
	const ls = clamp(margin * 0.018, 11, 22);
	if (mark === "paren") {
		const xa = xSmall - padB * 0.55 * k;
		const xb = xSmall + ms * k + padB * 0.55 * k;
		const t = size * 0.07;
		const hh = size * 0.47 * e;
		strokeSeg(ctx, xa + t, cy - hh, xa, cy - hh, frame.palette.secondary, lw, 0.85);
		strokeSeg(ctx, xa, cy - hh, xa, cy + hh, frame.palette.secondary, lw, 0.85);
		strokeSeg(ctx, xa, cy + hh, xa + t, cy + hh, frame.palette.secondary, lw, 0.85);
		strokeSeg(ctx, xb - t, cy - hh, xb, cy - hh, frame.palette.secondary, lw, 0.85);
		strokeSeg(ctx, xb, cy - hh, xb, cy + hh, frame.palette.secondary, lw, 0.85);
		strokeSeg(ctx, xb, cy + hh, xb - t, cy + hh, frame.palette.secondary, lw, 0.85);
	} else if (mark === "rule") {
		const y = cy + size * 0.62;
		strokeSeg(ctx, x0, y, lerpN(x0, x0 + total100 * k, e), y, frame.palette.secondary, lw, 0.7);
		const xm = lead ? xBig - (gap * k) / 2 : xSmall - (gap * k) / 2;
		strokeSeg(ctx, xm, y, xm, y - size * 0.12 * e, frame.palette.secondary, lw, 0.7);
	}
	const bigCount = total - smallCount;
	labelAt(ctx, frame, {
		alpha: e * 0.9,
		size: ls * 0.85,
		text: lead
			? `${pad2(smallCount)} : ${pad2(bigCount)}`
			: `${pad2(bigCount)} : ${pad2(smallCount)}`,
		x: xSmall,
		y: cy + size * 0.62 + ls * 1.2,
	});
}

/** 平体一字 — one glyph stretched sideways until the line fills the measure. */
function drawWideOne(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const portrait = width < height;
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim().replace(/\s+/gu, " ");
	if (!text) return;
	const mode = ["kanji", "mid", "last"][x2Hash(seed, 141) % 3] ?? "mid";
	const accent = x2Unit(seed, 142) < 0.5;
	const dim = x2Unit(seed, 143) < 0.8;
	const lines = (portrait ? mainLines(text, width, height, 99, 5) : text).split("\n");
	const total = lines.length;
	const flat: { character: string; line: number; column: number }[] = [];
	lines.forEach((line, lineIndex) => {
		[...line].forEach((character, columnIndex) => {
			if (!/\s/u.test(character)) {
				flat.push({ character, column: columnIndex, line: lineIndex });
			}
		});
	});
	if (flat.length === 0) return;
	let flatIndex = flat.findIndex(
		(entry, index) =>
			index > 0 && (entry.character === "ー" || entry.character === "〜" || entry.character === "～"),
	);
	if (flatIndex < 0 && isLatinText(text)) {
		flatIndex = flat.findIndex(
			(entry, index) => index > 0 && "oOaeuQ0".includes(entry.character),
		);
	}
	if (flatIndex < 0) {
		if (mode === "last") {
			for (let index = flat.length - 1; index >= 0; index -= 1) {
				if (okKey(flat[index]?.character ?? "")) {
					flatIndex = index;
					break;
				}
			}
			if (flatIndex < 0) flatIndex = 0;
		} else {
			flatIndex = keyIndexOf(
				flat.map((entry) => entry.character),
				mode,
			);
		}
	}
	const key = flat[flatIndex ?? 0];
	if (!key) return;
	const track = 0.03;
	const measure = width * 0.86;
	const leadK = 1.32;
	const size = Math.min(
		margin * 0.2,
		(height * 0.72) / (total * leadK),
		...lines.map((line) =>
			fitSize({ maxH: Number.POSITIVE_INFINITY, maxW: measure * 0.7, text: line, track }),
		),
	);
	const widthOf = (value: string): number => (value ? measureW(value, size, track) : 0);
	const keyLine = [...(lines[key.line] ?? "")];
	const before = keyLine.slice(0, key.column).join("");
	const after = keyLine.slice(key.column + 1).join("");
	const beforeText = before.replace(/\s+$/u, "");
	const afterText = after.replace(/^\s+/u, "");
	const spaceWidth = size * 0.3;
	const gapWidth = size * track;
	const beforeWidth =
		widthOf(beforeText) +
		(beforeText.length > 0 && beforeText.length < before.length ? spaceWidth : beforeText.length > 0 ? gapWidth : 0);
	const afterWidth =
		widthOf(afterText) +
		(afterText.length > 0 && afterText.length < after.length ? spaceWidth : afterText.length > 0 ? gapWidth : 0);
	const keyWidth = widthOf(key.character);
	const stretch = clamp((measure - beforeWidth - afterWidth) / Math.max(1, keyWidth), 1, 4);
	const e = outExpo(clamp((lt - 0.12) / 0.8));
	const sx = lerpN(1, stretch, e);
	let blockWidth = beforeWidth + keyWidth * stretch + afterWidth;
	lines.forEach((line, lineIndex) => {
		if (lineIndex !== key.line) blockWidth = Math.max(blockWidth, widthOf(line));
	});
	const left = width / 2 - blockWidth / 2;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	options.setFontSize(size);
	lines.forEach((line, lineIndex) => {
		const y = height / 2 + (lineIndex - (total - 1) / 2) * size * leadK;
		if (lineIndex !== key.line) {
			drawText({ maxWidth: width, size, text: line, x: left, y });
			return;
		}
		if (beforeText) {
			drawText({ maxWidth: width, size, text: beforeText, x: left, y });
		}
		const keyX = left + beforeWidth + (keyWidth * sx) / 2;
		ctx.save();
		ctx.translate(keyX, y);
		ctx.scale(sx, 1);
		ctx.textAlign = "center";
		ctx.fillStyle = accent ? frame.palette.accent : frame.palette.foreground;
		drawText({ maxWidth: size, size, text: key.character, x: 0, y: 0 });
		ctx.restore();
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "left";
		if (afterText) {
			drawText({
				maxWidth: width,
				size,
				text: afterText,
				x: left + beforeWidth + keyWidth * sx + (afterWidth - widthOf(afterText)),
				y,
			});
		}
		const a = outCubic(clamp((lt - 0.2) / 0.3)) * out;
		if (!dim || a <= 0) return;
		const yd = y + size * 0.64;
		const xa = keyX - (keyWidth * sx) / 2;
		const xb = keyX + (keyWidth * sx) / 2;
		const t = size * 0.07;
		strokeSeg(ctx, xa, yd, xb, yd, frame.palette.secondary, lw, 0.8 * a);
		strokeSeg(ctx, xa, yd - t, xa, yd + t, frame.palette.secondary, lw, 0.8 * a);
		strokeSeg(ctx, xb, yd - t, xb, yd + t, frame.palette.secondary, lw, 0.8 * a);
		if (lineIndex === total - 1 || size * (leadK - 1) > ls * 2.4) {
			const latin = isLatinText(text);
			labelAt(ctx, frame, {
				align: "center",
				alpha: a,
				size: ls,
				text: `${latin ? "WIDTH" : "平体"} ${Math.round(sx * 100)}%`,
				x: (xa + xb) / 2,
				y: yd + ls * 1.1,
			});
		}
	});
}

/** 拡大図 — a small box on one glyph is projected to a large frame holding the glyph enlarged. */
function drawZoomBox(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const margin = Math.min(width, height);
	const portrait = width < height;
	const out = 1 - inCubic(frame.exitProgress);
	const lt = secondsOf(frame);
	const text = String(cut.text).trim();
	if (!text) return;
	const flip = x2Unit(seed, 151) < 0.4;
	const outline = x2Hash(seed, 152) % 3 !== 2;
	const mode = ["kanji", "kanji", "mid"][x2Hash(seed, 153) % 3] ?? "kanji";
	const cross = x2Unit(seed, 154) < 0.7;
	const lead = 1.3;
	const blockText = mainLines(text, width, height, 7, 6);
	const lines = blockText.split("\n");
	let blockSize: number;
	let boxSize: number;
	let boxX: number;
	let boxY: number;
	let blockX: number;
	let blockY: number;
	if (!portrait) {
		blockSize = Math.min(
			fitSize({ lead, maxH: height * 0.5, maxW: width * 0.36, text: blockText, track: 0.04 }),
			margin * 0.115,
		);
		boxSize = Math.min(height * 0.62, width * 0.36);
		blockX = flip ? width * 0.56 : width * 0.08;
		blockY = height / 2;
		boxX = flip ? width * 0.08 + boxSize / 2 : width * 0.92 - boxSize / 2;
		boxY = height / 2;
	} else {
		blockSize = Math.min(
			fitSize({ lead, maxH: height * 0.22, maxW: width * 0.84, text: blockText, track: 0.04 }),
			width * 0.135,
		);
		boxSize = Math.min(width * 0.68, height * 0.4);
		blockX = width * 0.08;
		blockY = flip ? height * 0.8 : height * 0.2;
		boxX = width / 2;
		boxY = flip ? height * 0.38 : height * 0.62;
	}
	const glyphs = lineGlyphs({
		align: "left",
		maxWidth: width,
		size: blockSize,
		text: lines[0] ?? "",
		x: blockX,
		y: blockY - ((lines.length - 1) / 2) * blockSize * lead,
	});
	drawBlock(options, {
		align: "left",
		color: frame.palette.foreground,
		lead,
		maxWidth: width,
		size: blockSize,
		text: blockText,
		x: blockX,
		y: blockY,
	});
	if (glyphs.length === 0) return;
	const key = glyphs[Math.min(glyphs.length - 1, keyIndexOf(glyphs.map((glyph) => glyph.character), mode))];
	if (!key) return;
	const lw = Math.max(1, margin * 0.0014);
	const ls = Math.min(margin * 0.018, 22) * 0.85;
	const accentColor = frame.palette.accent;
	const halfSmall = blockSize * 0.57;
	const halfBig = boxSize / 2;
	const e1 = outExpo(clamp((lt - 0.2) / 0.45)) * out;
	const e2 = outCubic(clamp((lt - 0.35) / 0.5)) * out;
	const e3 = outExpo(clamp((lt - 0.5) / 0.6)) * out;
	if (e1 > 0) {
		polyPartial(
			ctx,
			rectPoints(key.x - halfSmall, key.y - halfSmall, key.x + halfSmall, key.y + halfSmall),
			e1,
			accentColor,
			Math.max(1.2, lw * 1.3),
			1,
		);
	}
	if (e2 > 0) {
		const horizontal = Math.abs(boxX - key.x) > Math.abs(boxY - key.y);
		const direction = horizontal
			? Math.sign(boxX - key.x)
			: Math.sign(boxY - key.y);
		const pairs = horizontal
			? [
					[[key.x + direction * halfSmall, key.y - halfSmall], [boxX - direction * halfBig, boxY - halfBig]],
					[[key.x + direction * halfSmall, key.y + halfSmall], [boxX - direction * halfBig, boxY + halfBig]],
				]
			: [
					[[key.x - halfSmall, key.y + direction * halfSmall], [boxX - halfBig, boxY - direction * halfBig]],
					[[key.x + halfSmall, key.y + direction * halfSmall], [boxX + halfBig, boxY - direction * halfBig]],
				];
		for (const [from, to] of pairs) {
			strokeSeg(
				ctx,
				from[0],
				from[1],
				lerpN(from[0], to[0], e2),
				lerpN(from[1], to[1], e2),
				frame.palette.secondary,
				lw,
				0.55,
			);
		}
	}
	if (e3 <= 0) return;
	polyPartial(
		ctx,
		rectPoints(boxX - halfBig, boxY - halfBig, boxX + halfBig, boxY + halfBig),
		e3,
		frame.palette.secondary,
		lw,
		0.9,
	);
	if (cross) {
		dashSeg(ctx, boxX - halfBig * e3, boxY, boxX + halfBig * e3, boxY, frame.palette.secondary, lw, 0.35, boxSize * 0.012, boxSize * 0.012);
		dashSeg(ctx, boxX, boxY - halfBig * e3, boxX, boxY + halfBig * e3, frame.palette.secondary, lw, 0.35, boxSize * 0.012, boxSize * 0.012);
	}
	ctx.save();
	ctx.globalAlpha *= outline ? clamp(out) : clamp(e3);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	options.setFontSize(boxSize * 0.84);
	if (outline) {
		ctx.lineWidth = Math.max(1.5, boxSize * 0.007);
		ctx.strokeStyle = frame.palette.foreground;
		ctx.strokeText(key.character, boxX, boxY);
	} else {
		ctx.fillStyle = mixHex({
			from: frame.palette.background,
			progress: 0.3,
			to: frame.palette.foreground,
		});
		ctx.fillText(key.character, boxX, boxY);
	}
	ctx.restore();
	labelAt(ctx, frame, {
		alpha: e3,
		color: accentColor,
		size: ls,
		text: `×${((boxSize * 0.84) / blockSize).toFixed(1)}`,
		x: boxX - halfBig,
		y: boxY + halfBig + ls * 1.2,
	});
	labelAt(ctx, frame, {
		align: "right",
		alpha: e3 * 0.85,
		size: ls,
		text: `U+${(key.character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
		x: boxX + halfBig,
		y: boxY + halfBig + ls * 1.2,
	});
}

/* ================================================================== DECORS */

/** JIZURA 追加分2 "x2typoA" decor pack — quiet typographic margin furniture. */
export function drawX2TypoDecor(options: X2TypoSurfaceDraw): void {
	const decors = options.frame.cut?.preset.decor ?? [];
	for (const decor of decors) {
		switch (decor) {
			case "tzCornerNums":
				drawCornerNums(options);
				break;
			case "tzDotLeader":
				drawDotLeader(options);
				break;
			case "tzEmBox":
				drawEmBox(options);
				break;
			case "tzHeadEnd":
				drawHeadEnd(options);
				break;
			case "tzNoteMark":
				drawNoteMark(options);
				break;
			case "tzNumStrip":
				drawNumStrip(options);
				break;
			case "tzProgRule":
				drawProgRule(options);
				break;
			case "tzReadCaret":
				drawReadCaret(options);
				break;
			case "tzSideCaption":
				drawSideCaption(options);
				break;
			case "tzTrackMarks":
				drawTrackMarks(options);
				break;
			default:
				break;
		}
	}
}

/** 四隅の数字 — small live numerals in the frame corners, each on a short hairline. */
function drawCornerNums(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const duration = cut.duration / 120_000;
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit);
	const bounds = textBoundsOf(options);
	const count = glyphCountOf(cut.text);
	const two = x2Hash(seed, 201) % 2 === 0;
	const right = x2Unit(seed, 202) < 0.5;
	const items: [number, number, string][] = [
		[0, 0, `L.${pad2(lineNoOf(seed))}`],
		[1, 0, formatTime((cut.startTime / 120_000) + Math.min(lt, duration))],
		[0, 1, `${pad2(count)} CH`],
		[1, 1, String(cutNoOf(seed)).padStart(3, "0")],
	];
	const lw = Math.max(1, unit);
	items.forEach(([right_, bottom, label], index) => {
		if (two && (right ? right_ === bottom : right_ !== bottom)) return;
		const x = right_ ? width - m : m;
		const y = bottom ? height - m - fs * 0.5 : m + fs * 0.5;
		const w = measureW(label, fs) + fs;
		const rectX0 = right_ ? x - w : x;
		const rectX1 = right_ ? x : x + w;
		const overlaps =
			!(
				rectX1 < bounds.x0 - 8 * unit ||
				rectX0 > bounds.x1 + 8 * unit ||
				y - fs * 1.6 > bounds.y1 + 8 * unit ||
				y + fs * 1.6 < bounds.y0 - 8 * unit
			);
		if (overlaps) return;
		const e = outExpo(clamp((lt - index * 0.07) / 0.5)) * out;
		if (e <= 0) return;
		const yl = y + (bottom ? -1 : 1) * fs * 1.05;
		const direction = right_ ? -1 : 1;
		strokeSeg(ctx, x, yl, x + direction * fs * 2.6 * e, yl, index === 0 ? frame.palette.accent : frame.palette.secondary, index === 0 ? Math.max(1.5, 2 * unit) : lw, 0.9);
		const characters = [...label];
		const k =
			index === 1
				? characters.length
				: Math.ceil(characters.length * clamp((lt - 0.1 - index * 0.07) / 0.35));
		if (k > 0) {
			labelAt(ctx, frame, {
				align: right_ ? "right" : "left",
				alpha: e * 0.95,
				color: index === 1 ? frame.palette.foreground : frame.palette.secondary,
				size: fs,
				text: characters.slice(0, k).join(""),
				x,
				y,
			});
		}
	});
}

/** リーダー罫 — a dot leader from the end of the lyric out to a small page numeral. */
function drawDotLeader(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit);
	const bounds = textBoundsOf(options);
	const cells = glyphCellsOf(cut.text, bounds).cells;
	const first = cells[0];
	const last = cells.at(-1);
	if (!first || !last) return;
	const page = x2Hash(seed, 211) % 2 === 0;
	const num = page ? `p.${cutNoOf(seed)}` : pad2(lineNoOf(seed));
	const ns = fs * 1.25;
	const nw = measureW(num, ns, 0.08);
	const gap = 14 * unit + Math.min(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * 0.06;
	let direction = 0;
	let xa = 0;
	let xb = 0;
	let y = 0;
	const tryRight = (): void => {
		const a = bounds.x1 + gap;
		const b = width - m - nw - fs * 0.7;
		if (b - a > width * 0.07) {
			direction = 1;
			xa = a;
			xb = b;
			y = last.y + last.h * 0.3;
		}
	};
	const tryLeft = (): void => {
		const a = bounds.x0 - gap;
		const b = m + nw + fs * 0.7;
		if (a - b > width * 0.07) {
			direction = -1;
			xa = a;
			xb = b;
			y = first.y + first.h * 0.3;
		}
	};
	if (x2Unit(seed, 212) < 0.5) {
		tryLeft();
		if (direction === 0) tryRight();
	} else {
		tryRight();
		if (direction === 0) tryLeft();
	}
	if (direction === 0) return;
	y = Math.max(m, Math.min(height - m, y));
	const pitch = Math.max(fs * 0.8, Math.abs(xb - xa) / 90);
	const count = Math.max(1, Math.floor(Math.abs(xb - xa) / pitch));
	const r = Math.max(1.3 * unit, fs * 0.08);
	const e = outCubic(clamp((lt - 0.1) / 0.8));
	const visible = Math.floor(count * e);
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * 0.8 * out;
	ctx.fillStyle = frame.palette.secondary;
	for (let index = 0; index <= visible; index += 1) {
		ctx.fillRect(xa + direction * index * pitch - r, y - r, r * 2, r * 2);
	}
	ctx.globalAlpha = base;
	const a = outCubic(clamp((lt - 0.75) / 0.3)) * out;
	if (a > 0) {
		labelAt(ctx, frame, {
			align: direction > 0 ? "right" : "left",
			alpha: a,
			color: frame.palette.foreground,
			size: ns,
			text: num,
			x: direction > 0 ? width - m : m,
			y: y - ns * 0.12,
		});
	}
}

/** 仮想ボディ — the body of every glyph as a hairline box with side-middle ticks. */
function drawEmBox(options: X2TypoSurfaceDraw): void {
	const { ctx, frame } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const unit = Math.min(options.width, options.height) / 1080;
	const bounds = textBoundsOf(options);
	const cells = glyphCellsOf(cut.text, bounds).cells.slice(0, 34);
	const lw = Math.max(1, unit);
	const fs = Math.max(11, 16 * unit) * 0.8;
	const pad = 1.02 + (x2Hash(seed, 221) % 2) * 0.05;
	cells.forEach((cell, index) => {
		const e = outExpo(clamp((lt - 0.1 - index * 0.035) / 0.6));
		if (e <= 0) return;
		const hw = (cell.w * pad) / 2;
		const hh = (cell.h * pad) / 2;
		const t = Math.max(4 * unit, Math.min(hw, hh) * 0.09) * e;
		polyPartial(ctx, rectPoints(cell.x - hw, cell.y - hh, cell.x + hw, cell.y + hh), e, frame.palette.secondary, lw, 0.6 * out);
		strokeSeg(ctx, cell.x, cell.y - hh, cell.x, cell.y - hh - t, frame.palette.secondary, lw, 0.8 * out);
		strokeSeg(ctx, cell.x, cell.y + hh, cell.x, cell.y + hh + t, frame.palette.secondary, lw, 0.8 * out);
		strokeSeg(ctx, cell.x - hw, cell.y, cell.x - hw + t * 0.6, cell.y, frame.palette.secondary, lw, 0.8 * out);
		strokeSeg(ctx, cell.x + hw, cell.y, cell.x + hw - t * 0.6, cell.y, frame.palette.secondary, lw, 0.8 * out);
	});
	const first = cells[0];
	if (!first) return;
	const a = outCubic(clamp((lt - 0.35) / 0.3)) * out;
	if (a > 0 && first.y - (first.h * pad) / 2 - fs * 2.2 > 0) {
		labelAt(ctx, frame, {
			alpha: a * 0.9,
			color: x2Unit(seed, 222) < 0.5 ? frame.palette.accent : frame.palette.secondary,
			size: fs,
			text: `EM ${Math.round(Math.max(first.w, first.h) / unit)}`,
			x: first.x - (first.w * pad) / 2,
			y: first.y - (first.h * pad) / 2 - fs * 1.3,
		});
	}
}

/** 行頭記号 — a pilcrow (or section sign) before the head of the lyric and a small end mark. */
function drawHeadEnd(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const bounds = textBoundsOf(options);
	const cells = glyphCellsOf(cut.text, bounds).cells;
	const first = cells[0];
	const last = cells.at(-1);
	if (!first || !last) return;
	const headHeight = Math.min(first.h, first.w * 1.4);
	const s = Math.max(30 * unit, Math.min(headHeight * 0.5, 96 * unit));
	const gap = 10 * unit + s * 0.18;
	const accentColor = frame.palette.accent;
	const mark = ["¶", "§", "¶"][x2Hash(seed, 231) % 3] ?? "¶";
	const a = outCubic(clamp(lt / 0.45)) * out;
	const slide = (1 - outExpo(clamp(lt / 0.5))) * s * 0.5;
	let x = bounds.x0 - gap - s * 0.3;
	let y = first.y - first.h / 2 + s * 0.5;
	if (x - s * 0.4 < m * 0.6) {
		x = bounds.x0 + s * 0.3;
		y = bounds.y0 - gap - s * 0.45;
	}
	if (y - s * 0.5 > m * 0.4 && a > 0) {
		labelAt(ctx, frame, {
			alpha: a,
			color: x2Unit(seed, 232) < 0.5 ? accentColor : frame.palette.secondary,
			size: s,
			text: mark,
			x: x - slide,
			y,
		});
	}
	const q = Math.max(8 * unit, Math.min(headHeight * 0.13, 22 * unit));
	const p = outBack(clamp((lt - 0.3) / 0.35), 2) * out;
	let ex = bounds.x1 + gap * 0.8;
	let ey = last.y + last.h / 2 - q - headHeight * 0.1;
	if (ex + q > width - m * 0.6) {
		ex = bounds.x1 - q;
		ey = bounds.y1 + gap * 0.8;
	}
	if (ey + q < height - m * 0.4 && p > 0) {
		const size = q * Math.min(1.2, Math.max(0, p));
		const cx = ex + q / 2;
		const cy = ey + q / 2;
		if (x2Hash(seed, 233) % 2 === 1) {
			polyPartial(ctx, rectPoints(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2), Math.min(1, p), frame.palette.foreground, Math.max(1.5, 2 * unit), out);
		} else {
			fillRectAt(ctx, cx - size / 2, cy - size / 2, size, size, x2Unit(seed, 234) < 0.5 ? frame.palette.foreground : accentColor, out);
		}
	}
}

/** 注記号 — a reference mark at the lyric's shoulder and a typed footnote line in the margin. */
function drawNoteMark(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit);
	const bounds = textBoundsOf(options);
	const mark = ["※", "＊", "†"][x2Hash(seed, 241) % 3] ?? "※";
	const num = String(Math.max(1, Math.min(3, (x2Hash(seed, 242) % 3) + 1)));
	const accentColor = frame.palette.accent;
	const ms = fs * 1.9;
	const a = outBack(clamp((lt - 0.15) / 0.35), 1.6) * out;
	let x = bounds.x1 + ms * 0.55;
	let y = bounds.y0 + ms * 0.15;
	if (x + ms * 1.2 > width - m * 0.5) {
		x = bounds.x1 - ms * 0.6;
		y = bounds.y0 - ms * 0.75;
	}
	if (y > m * 0.5 && a > 0) {
		labelAt(ctx, frame, {
			align: "center",
			alpha: clamp(a),
			color: accentColor,
			size: ms * (0.6 + 0.4 * clamp(a)),
			text: mark,
			x,
			y,
		});
		labelAt(ctx, frame, {
			alpha: clamp(a),
			color: accentColor,
			size: ms * 0.55,
			text: num,
			x: x + ms * 0.62,
			y: y - ms * 0.22,
		});
	}
	const note = `${num}  ${formatTime(cut.startTime / 120_000)} — L${pad2(lineNoOf(seed))} / ${pad2(glyphCountOf(cut.text))}`;
	const nw = measureW(note, fs * 0.9) + fs * 1.4;
	const right = x2Unit(seed, 243) < 0.5;
	const rows = x2Unit(seed, 244) < 0.3
		? [m + fs * 1.4, height - m - fs * 0.5]
		: [height - m - fs * 0.5, m + fs * 1.4];
	for (const yF of rows) {
		const x0 = right ? width - m - nw : m;
		const overlaps =
			!(x0 + nw < bounds.x0 - 10 * unit || x0 > bounds.x1 + 10 * unit) &&
			!(yF - fs * 2 > bounds.y1 + 10 * unit || yF + fs < bounds.y0 - 10 * unit);
		if (overlaps) continue;
		const e = outExpo(clamp((lt - 0.25) / 0.6)) * out;
		if (e <= 0) return;
		strokeSeg(ctx, x0, yF - fs * 1.25, x0 + Math.min(nw, width * 0.16) * e, yF - fs * 1.25, frame.palette.secondary, Math.max(1, unit), 0.7 * out);
		labelAt(ctx, frame, {
			align: "center",
			alpha: e,
			color: accentColor,
			size: fs * 0.95,
			text: mark,
			x: x0 + fs * 0.45,
			y: yF,
		});
		const characters = [...note];
		const k = Math.floor(characters.length * clamp((lt - 0.3) / 0.5));
		if (k > 0) {
			labelAt(ctx, frame, {
				alpha: out * 0.9,
				color: frame.palette.secondary,
				size: fs * 0.9,
				text: characters.slice(0, k).join(""),
				x: x0 + fs * 1.2,
				y: yF,
			});
		}
		return;
	}
}

/** 番号列 — a strip of small running numerals in the margin; the current one is underlined. */
function drawNumStrip(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit);
	const bounds = textBoundsOf(options);
	const vertical = x2Hash(seed, 251) % 3 === 2 && width > height;
	const pitch = vertical ? fs * 2.3 : fs * 3.5;
	const length = vertical ? height : width;
	const k = Math.max(
		1,
		Math.min(5, Math.floor((length * 0.5 - m) / pitch - 0.5)),
	);
	let c = 0;
	let placed = false;
	for (const lowSide of vertical
		? [x2Unit(seed, 252) < 0.5, x2Unit(seed, 252) >= 0.5]
		: [x2Unit(seed, 253) >= 0.5, x2Unit(seed, 253) < 0.5]) {
		c = vertical
			? lowSide
				? width - m - fs * 1.3
				: m + fs * 1.3
			: lowSide
				? height - m - fs * 0.5
				: m + fs * 0.5;
		const overlaps = vertical
			? !(c + fs * 1.6 < bounds.x0 - 8 * unit || c - fs * 1.6 > bounds.x1 + 8 * unit) &&
				!(height / 2 + (k + 1) * pitch < bounds.y0 - 8 * unit || height / 2 - (k + 1) * pitch > bounds.y1 + 8 * unit)
			: !(width / 2 + (k + 1) * pitch < bounds.x0 - 8 * unit || width / 2 - (k + 1) * pitch > bounds.x1 + 8 * unit) &&
				!(c + fs * 1.4 < bounds.y0 - 8 * unit || c - fs * 1.4 > bounds.y1 + 8 * unit);
		if (!overlaps) {
			placed = true;
			break;
		}
	}
	if (!placed) return;
	const index = cutNoOf(seed);
	const slide = (1 - outExpo(clamp(lt / 0.55))) * pitch;
	const a0 = outCubic(clamp(lt / 0.3)) * out;
	for (let offset = -k - 1; offset <= k + 1; offset += 1) {
		const value = index + offset;
		if (value < 1) continue;
		const d = offset * pitch + slide;
		const fade = clamp(1 - Math.abs(d) / ((k + 0.6) * pitch));
		if (fade <= 0) continue;
		const current = offset === 0;
		labelAt(ctx, frame, {
			align: "center",
			alpha: (current ? 1 : 0.55 * fade) * a0,
			color: current ? frame.palette.foreground : frame.palette.secondary,
			size: fs * (current ? 1.05 : 0.9),
			text: String(value).padStart(3, "0"),
			x: vertical ? c : width / 2 + d,
			y: vertical ? height / 2 + d : c,
		});
	}
	const e = outExpo(clamp((lt - 0.2) / 0.5)) * out;
	if (e <= 0) return;
	const lw = Math.max(1.5, 2 * unit);
	const accentColor = frame.palette.accent;
	if (vertical) {
		const x = c + (c > width / 2 ? -1 : 1) * fs * 1.5;
		strokeSeg(ctx, x, height / 2 - fs * 0.8 * e, x, height / 2 + fs * 0.8 * e, accentColor, lw, 1);
	} else {
		const y = c + (c > height / 2 ? -1 : 1) * fs;
		strokeSeg(ctx, width / 2 - fs * 1.2 * e, y, width / 2 + fs * 1.2 * e, y, accentColor, lw, 1);
	}
}

/** 進行罫 — a hairline as long as the lyric; a heavier rule grows along it with the cut's time. */
function drawProgRule(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const duration = cut.duration / 120_000;
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit);
	const bounds = textBoundsOf(options);
	const horizontal = bounds.x1 - bounds.x0 >= (bounds.y1 - bounds.y0) * 0.8;
	const gap = 16 * unit + (horizontal ? bounds.y1 - bounds.y0 : bounds.x1 - bounds.x0) * 0.07;
	const e = outExpo(clamp(lt / 0.6));
	const q = clamp(lt / Math.max(0.3, duration));
	const lw = Math.max(1, unit);
	const color = x2Unit(seed, 261) < 0.5 ? frame.palette.accent : frame.palette.foreground;
	let a0: number;
	let a1: number;
	let c: number;
	if (horizontal) {
		const mid = (bounds.x0 + bounds.x1) / 2;
		const half = Math.max(bounds.x1 - bounds.x0, width * 0.24) / 2;
		a0 = Math.max(m, mid - half);
		a1 = Math.min(width - m, mid + half);
		let side = x2Unit(seed, 262) >= 0.5 ? 1 : -1;
		c = side > 0 ? bounds.y1 + gap : bounds.y0 - gap;
		if (c > height - m - fs * 2 || c < m + fs * 2) {
			side = -side;
			c = side > 0 ? bounds.y1 + gap : bounds.y0 - gap;
		}
		if (c > height - m * 0.6 || c < m * 0.6) return;
	} else {
		const mid = (bounds.y0 + bounds.y1) / 2;
		const half = Math.max(bounds.y1 - bounds.y0, height * 0.24) / 2;
		a0 = Math.max(m, mid - half);
		a1 = Math.min(height - m, mid + half);
		let side = x2Unit(seed, 263) < 0.5 ? 1 : -1;
		c = side > 0 ? bounds.x1 + gap : bounds.x0 - gap;
		if (c > width - m - fs * 3 || c < m + fs * 3) {
			side = -side;
			c = side > 0 ? bounds.x1 + gap : bounds.x0 - gap;
		}
		if (c > width - m * 0.6 || c < m * 0.6) return;
	}
// eslint-disable-next-line opencut/prefer-object-params
	const px = (a: number, b: number): [number, number] =>
		horizontal ? [a, b] : [b, a];
	const aE = lerpN(a0, a1, e);
	const aQ = lerpN(a0, a1, q * e);
	const t = 5 * unit;
	strokeSeg(ctx, px(a0, c)[0], px(a0, c)[1], px(aE, c)[0], px(aE, c)[1], frame.palette.secondary, lw, 0.45 * out);
	strokeSeg(ctx, px(a0, c - t)[0], px(a0, c - t)[1], px(a0, c + t)[0], px(a0, c + t)[1], frame.palette.secondary, lw, 0.8 * out);
	if (e > 0.98) {
		strokeSeg(ctx, px(a1, c - t)[0], px(a1, c - t)[1], px(a1, c + t)[0], px(a1, c + t)[1], frame.palette.secondary, lw, 0.8 * out);
	}
	if (aQ - a0 > 1) {
		strokeSeg(ctx, px(a0, c)[0], px(a0, c)[1], px(aQ, c)[0], px(aQ, c)[1], color, Math.max(2, 3 * unit), out);
	}
	const la = outCubic(clamp((lt - 0.15) / 0.3)) * out;
	if (la <= 0) return;
	const text = x2Hash(seed, 264) % 2 === 1
		? formatTime(cut.startTime / 120_000 + lt)
		: pad2(Math.round(q * 100));
	labelAt(ctx, frame, {
		align: "center",
		alpha: la,
		color: frame.palette.foreground,
		size: fs,
		text,
		x: horizontal ? Math.max(a0 + fs, Math.min(a1 - fs, aQ)) : c,
		y: horizontal ? c : Math.max(a0 + fs, Math.min(a1 - fs, aQ)),
	});
}

/** 読み位置 — a small caret steps from glyph to glyph under the lyric as the cut plays. */
function drawReadCaret(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const lt = secondsOf(frame);
	const duration = cut.duration / 120_000;
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit) * 0.88;
	const bounds = textBoundsOf(options);
	const { cells, vertical } = glyphCellsOf(cut.text, bounds);
	const n = cells.length;
	if (n === 0) return;
	const accentColor = frame.palette.accent;
	const f =
		(clamp((lt - 0.1) / Math.max(0.3, duration * 0.86 - 0.1)) * n);
	const index = Math.min(n - 1, Math.floor(f));
	const step = outCubic(clamp((f - index) * 3.5));
	const cell = cells[index] ?? cells[0]!;
	const previous = cells[Math.max(0, index - 1)] ?? cell;
	const t = Math.max(
		7 * unit,
		Math.min(14 * unit, (vertical ? cell.w : cell.h) * 0.1),
	);
	const gap = 8 * unit + t;
	const a = outBack(clamp(lt / 0.35), 1.8) * out;
	if (a <= 0) return;
	const jumped = vertical
		? Math.abs(cell.x - previous.x) > cell.w * 0.5
		: Math.abs(cell.y - previous.y) > cell.h * 0.5;
	const k = jumped ? 1 : step;
	if (!vertical) {
		const x = lerpN(previous.x, cell.x, k);
		const y = lerpN(previous.y + previous.h / 2, cell.y + cell.h / 2, k) + gap;
		if (y + t * 2 > height - m * 0.4) return;
		fillTriangle(
			ctx,
			[
				[x, y],
				[x - t, y + t * 1.7],
				[x + t, y + t * 1.7],
			],
			accentColor,
			clamp(a),
		);
		const row = cells.filter((candidate) => Math.abs(candidate.y - cell.y) < cell.h * 0.5);
		const x0 = Math.min(...row.map((candidate) => candidate.x - candidate.w / 2));
		const x1 = Math.max(...row.map((candidate) => candidate.x + candidate.w / 2));
		strokeSeg(ctx, x0, y - t * 0.35, lerpN(x0, x1, outExpo(clamp(lt / 0.6))), y - t * 0.35, frame.palette.secondary, Math.max(1, unit), 0.5 * out);
		if (y + t * 1.7 + fs * 1.6 < height - m * 0.4) {
			labelAt(ctx, frame, {
				align: "center",
				alpha: clamp(a) * 0.9,
				size: fs,
				text: `${pad2(index + 1)}/${pad2(n)}`,
				x,
				y: y + t * 1.7 + fs * 0.95,
			});
		}
		return;
	}
	const side =
		cell.x + cell.w / 2 + gap + t * 2 + fs * 3 < width - m * 0.4 ? 1 : -1;
	const y = lerpN(previous.y, cell.y, k);
	const x = lerpN(previous.x, cell.x, k) + side * (cell.w / 2 + gap);
	fillTriangle(
		ctx,
		[
			[x, y],
			[x + side * t * 1.7, y - t],
			[x + side * t * 1.7, y + t],
		],
		accentColor,
		clamp(a),
	);
	labelAt(ctx, frame, {
		align: side > 0 ? "left" : "right",
		alpha: clamp(a) * 0.9,
		size: fs,
		text: `${pad2(index + 1)}/${pad2(n)}`,
		x: x + side * (t * 1.7 + fs * 0.5),
		y,
	});
}

/** Filled triangle via the optional path API, squares as fallback. */
// eslint-disable-next-line opencut/prefer-object-params
function fillTriangle(
	ctx: MotionTextCanvasContext,
	points: readonly [number, number][],
	color: string,
	alpha: number,
): void {
	if (alpha <= 0.003 || points.length < 3) return;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = base * clamp(alpha);
	ctx.fillStyle = color;
	if (ctx.beginPath && ctx.moveTo && ctx.lineTo && ctx.fill) {
		ctx.beginPath();
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		ctx.fill();
	} else {
		const xs = points.map(([x]) => x);
		const ys = points.map(([, y]) => y);
		const left = Math.min(...xs);
		const top = Math.min(...ys);
		ctx.fillRect(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
	}
	ctx.restore();
	ctx.globalAlpha = base;
}

/** 縦キャプション — a figure caption turned 90° and typed along the side of the lyric. */
function drawSideCaption(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const seed = cut.seed;
	const lt = secondsOf(frame);
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit);
	const bounds = textBoundsOf(options);
	const gap = 18 * unit + Math.min(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * 0.05;
	let side = x2Unit(seed, 271) < 0.5 ? 1 : -1;
	let x = 0;
	let ok = false;
	for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
		x = side > 0 ? bounds.x1 + gap + fs : bounds.x0 - gap - fs;
		ok = x > m * 0.7 && x < width - m * 0.7;
		if (!ok) side = -side;
	}
	if (!ok) return;
	let caption = `FIG.${pad2(cutNoOf(seed))} — ${formatTime(cut.startTime / 120_000)} — ${pad2(glyphCountOf(cut.text))} GLYPHS`;
	if (measureW(caption, fs, 0.16) > height - m * 2) {
		caption = `FIG.${pad2(cutNoOf(seed))} — ${formatTime(cut.startTime / 120_000)}`;
	}
	const total = measureW(caption, fs, 0.16);
	const y0 = Math.max(m, bounds.y0);
	const y1 = Math.min(height - m, bounds.y1);
	const cy = Math.max(m + total / 2, Math.min(height - m - total / 2, (y0 + y1) / 2));
	const e = outExpo(clamp(lt / 0.6)) * out;
	if (e > 0) {
		const ya = Math.min(y0, cy - total / 2);
		const yb = Math.max(y1, cy + total / 2);
		strokeSeg(
			ctx,
			x - side * fs * 0.95,
			side > 0 ? ya : yb,
			x - side * fs * 0.95,
			side > 0 ? lerpN(ya, yb, e) : lerpN(yb, ya, e),
			frame.palette.secondary,
			Math.max(1, unit),
			0.7,
		);
		const t = 5 * unit;
		strokeSeg(ctx, x - side * fs * 0.95, side > 0 ? ya : yb, x - side * fs * 0.95 + side * t * 2, side > 0 ? ya : yb, frame.palette.accent, Math.max(1.5, 2 * unit), e);
	}
	const characters = [...caption];
	const k = Math.floor(characters.length * clamp((lt - 0.12) / 0.6));
	if (k <= 0) return;
	const part = characters.slice(0, k).join("");
	const partWidth = measureW(part, fs, 0.16);
	const yc = side > 0 ? cy - total / 2 + partWidth / 2 : cy + total / 2 - partWidth / 2;
	labelAt(ctx, frame, {
		align: "center",
		alpha: out * 0.9,
		rotation: (side > 0 ? 90 : -90) * (Math.PI / 180),
		size: fs,
		text: part,
		x,
		y: yc,
	});
}

/** 字送り記号 — a short rule per glyph, a caret in every gap, spacing values in numerals. */
function drawTrackMarks(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0.003) return;
	const lt = secondsOf(frame);
	const unit = Math.min(width, height) / 1080;
	const m = Math.round(Math.min(width, height) * 0.05);
	const fs = Math.max(11, 16 * unit) * 0.88;
	const bounds = textBoundsOf(options);
	const { cells, vertical } = glyphCellsOf(cut.text, bounds);
	let row = cells;
	if (!vertical) {
		const yl = Math.max(...cells.map((cell) => cell.y));
		row = cells
			.filter((cell) => Math.abs(cell.y - yl) < cell.h * 0.5)
			.sort((a, b) => a.x - b.x);
	} else {
		const xl = Math.max(...cells.map((cell) => cell.x));
		row = cells
			.filter((cell) => Math.abs(cell.x - xl) < cell.w * 0.5)
			.sort((a, b) => a.y - b.y);
	}
	const n = row.length;
	if (n === 0) return;
	const size = vertical ? row[0]!.w : row[0]!.h;
	const gap = 12 * unit + size * 0.1;
	const lw = Math.max(1, unit);
	const accentColor = frame.palette.accent;
	let side = vertical ? 1 : x2Unit(cut.seed, 281) >= 0.5 ? 1 : -1;
	let c = vertical
		? bounds.x1 + gap
		: side > 0
			? bounds.y1 + gap
			: bounds.y0 - gap;
	if (!vertical && (c > height - m - fs * 2.4 || c < m + fs * 2.4)) {
		side = -side;
		c = side > 0 ? bounds.y1 + gap : bounds.y0 - gap;
	}
	if (vertical && c > width - m - fs * 3) {
		side = -1;
		c = bounds.x0 - gap;
	}
	if ((vertical ? width : height) - c < m * 0.6 || c < m * 0.6) return;
	const low = (cell: { x: number; y: number; w: number; h: number }): number =>
		vertical ? cell.y - cell.h / 2 : cell.x - cell.w / 2;
	const high = (cell: { x: number; y: number; w: number; h: number }): number =>
		vertical ? cell.y + cell.h / 2 : cell.x + cell.w / 2;
	const t = 4 * unit;
	row.forEach((cell, index) => {
		const e = outExpo(clamp((lt - 0.08 - index * 0.03) / 0.45)) * out;
		if (e <= 0) return;
		const a0 = low(cell) + size * 0.06;
		const a1 = high(cell) - size * 0.06;
		const mid = (a0 + a1) / 2;
	// eslint-disable-next-line opencut/prefer-object-params
	const point = (a: number, b: number): [number, number] =>
			vertical ? [b, a] : [a, b];
		strokeSeg(
			ctx,
			point(lerpN(mid, a0, e), c)[0],
			point(lerpN(mid, a0, e), c)[1],
			point(lerpN(mid, a1, e), c)[0],
			point(lerpN(mid, a1, e), c)[1],
			frame.palette.secondary,
			lw,
			0.85,
		);
		const next = row[index + 1];
		if (next) {
			const gm = (high(cell) + low(next)) / 2;
			const g0 = point(gm - t, c + side * t * 1.5);
			const g1 = point(gm, c);
			const g2 = point(gm + t, c + side * t * 1.5);
			strokeSeg(ctx, g0[0], g0[1], g1[0], g1[1], accentColor, lw, e);
			strokeSeg(ctx, g1[0], g1[1], g2[0], g2[1], accentColor, lw, e);
			if (n <= 9) {
				const value = Math.round(((low(next) - high(cell)) / size) * 1000);
				const text = `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
				if (!vertical) {
					labelAt(ctx, frame, {
						align: "center",
						alpha: e * 0.9,
						color: frame.palette.secondary,
						size: fs,
						text,
						x: gm,
						y: c + side * (t * 1.5 + fs),
					});
				} else {
					labelAt(ctx, frame, {
						align: side > 0 ? "left" : "right",
						alpha: e * 0.9,
						color: frame.palette.secondary,
						size: fs,
						text,
						x: c + side * (t * 1.5 + fs * 0.5),
						y: gm,
					});
				}
			}
		}
	});
	if (n > 9 || n === 1) {
		const e = outCubic(clamp((lt - 0.3) / 0.3)) * out;
		if (e <= 0) return;
		const span = Math.round((high(row[n - 1]!) - low(row[0]!)) / unit);
		if (!vertical) {
			labelAt(ctx, frame, {
				alpha: e * 0.9,
				color: frame.palette.secondary,
				size: fs,
				text: `W ${span}`,
				x: low(row[0]!),
				y: c + side * fs * 1.5,
			});
		} else {
			labelAt(ctx, frame, {
				align: side > 0 ? "left" : "right",
				alpha: e * 0.9,
				color: frame.palette.secondary,
				size: fs,
				text: `H ${span}`,
				x: c + side * fs * 0.8,
				y: low(row[0]!) + fs,
			});
		}
	}
}

/* ============================================================== BACKGROUNDS */

/** JIZURA 追加分2 "x2typoA" background pack — type-only frame furniture. */
export function drawX2TypoBackground(options: X2TypoSurfaceDraw): void {
	switch (options.frame.cut?.preset.bg) {
		case "tzBgBaseGrid":
			drawBgBaseGrid(options);
			break;
		case "tzBgBigDigits":
			drawBgBigDigits(options);
			break;
		case "tzBgColumns":
			drawBgColumns(options);
			break;
		case "tzBgGlyphField":
			drawBgGlyphField(options);
			break;
		case "tzBgNumField":
			drawBgNumField(options);
			break;
		case "tzBgRules":
			drawBgRules(options);
			break;
		default:
			break;
	}
}

// eslint-disable-next-line opencut/prefer-object-params
function quoteFont(frame: MotionTextRenderFrame, size: number): string {
	return `${frame.font.style} ${frame.font.weight} ${Math.max(8, size)}px ${quoteFamily(frame.font.family)}`;
}

/** 基線グリッド — a faint baseline grid drifting slowly, every few lines stronger and numbered. */
function drawBgBaseGrid(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const t = secondsOf(frame);
	const margin = Math.min(width, height);
	const e = outCubic(clamp(t / 0.8));
	const rows = 22 + (x2Hash(seed, 301) % 9);
	const every = [4, 4, 5][x2Hash(seed, 302) % 3] ?? 4;
	const k = (0.1 + x2Unit(seed, 303) * 0.035) * e;
	const drift = (5 + x2Unit(seed, 304) * 5) * (x2Hash(seed, 305) % 2 === 0 ? 1 : -1);
	const right = x2Unit(seed, 306) < 0.3;
	const showNums = x2Unit(seed, 307) < 0.8;
	const grid = Math.max(width, height) / rows;
	const scroll = t * drift * (margin / 1080);
	const k0 = Math.ceil(-scroll / grid);
	const k1 = Math.floor((height - scroll) / grid);
	const mx = right ? width * 0.92 : width * 0.08;
	const fs = Math.max(9, margin * 0.013);
	ctx.lineWidth = Math.max(1, margin * 0.0014);
	const wrap100 = (value: number): number => ((value % 100) + 100) % 100;
	for (const strong of [false, true]) {
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * clamp(strong ? k * 1.8 : k);
		ctx.strokeStyle = frame.palette.foreground;
		ctx.beginPath();
		if (ctx.moveTo && ctx.lineTo && ctx.stroke) {
			for (let index = k0; index <= k1 && index - k0 < 80; index += 1) {
				if ((wrap100(index) % every === 0) !== strong) continue;
				const y = index * grid + scroll;
				ctx.moveTo(0, y);
				ctx.lineTo(width * e, y);
			}
			ctx.stroke();
		} else {
			for (let index = k0; index <= k1 && index - k0 < 80; index += 1) {
				if ((wrap100(index) % every === 0) !== strong) continue;
				fillRectAt(ctx, 0, index * grid + scroll, width * e, ctx.lineWidth ?? 1, frame.palette.foreground, strong ? k * 1.8 : k);
			}
		}
		ctx.globalAlpha = base;
	}
	fillRectAt(ctx, mx, 0, Math.max(1, margin * 0.0014), height * e, frame.palette.accent, k * 2.4);
	if (!showNums) return;
	ctx.font = quoteFont(frame, fs);
	ctx.textBaseline = "middle";
	ctx.textAlign = right ? "left" : "right";
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp(k * 2.6);
	ctx.fillStyle = frame.palette.foreground;
	for (let index = k0; index <= k1 && index - k0 < 80; index += 1) {
		if (wrap100(index) % every !== 0) continue;
		ctx.fillText(
			pad2(wrap100(-index)),
			mx + (right ? 1 : -1) * fs * 0.7,
			index * grid + scroll - fs * 0.9,
		);
	}
	ctx.globalAlpha = base;
}

/** 数字の野 — a field of small two-digit numerals; single cells tick over, one row reads clearer. */
function drawBgNumField(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const t = secondsOf(frame);
	const margin = Math.min(width, height);
	const e = outCubic(clamp(t / 0.8));
	const s = Math.abs(seed) || 1;
	const fs = margin * (0.016 + x2Unit(seed, 311) * 0.005);
	const rh = fs * 2.5;
	const k = (0.075 + x2Unit(seed, 312) * 0.025) * e;
	const rate = 0.2 + x2Unit(seed, 313) * 0.3;
	const band = x2Unit(seed, 314) < 0.7;
	const cellWidth = Math.max(fs * 1.2, fs * 2.4);
	const columns = Math.min(64, Math.ceil(width / cellWidth) + 1);
	const rows = Math.min(60, Math.ceil(height / rh) + 1);
	const hot = band ? Math.floor(t * 0.4 + x2Hash(s, 7) % rows) % rows : -1;
	ctx.font = quoteFont(frame, fs);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	const base = ctx.globalAlpha;
	for (let row = 0; row < rows; row += 1) {
		let line = "";
		for (let column = 0; column < columns; column += 1) {
			const phase = Math.floor(
				t * rate * (0.2 + 1.8 * x2Unit(s * 31 + column * 7 + row * 131, 9)) +
					x2Unit(s * 17 + column * 3 + row * 57, 3) * 10,
			);
			const value = x2Hash(s, column, row, phase) % 100;
			line += `${value < 10 ? "0" : ""}${value}  `;
		}
		ctx.globalAlpha =
			base *
			clamp(row === hot ? k * 2.1 : k * (0.75 + 0.5 * x2Unit(s + row * 11, 5)));
		ctx.fillStyle = frame.palette.foreground;
		ctx.fillText(line, fs * 0.6 - (row % 2) * cellWidth * 0.5, (row + 0.5) * rh);
	}
	ctx.globalAlpha = base;
}

/** 段組ガイド — the column guides of a page layout; one column lights faintly in turn. */
function drawBgColumns(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const t = secondsOf(frame);
	const margin = Math.min(width, height);
	const e = outCubic(clamp(t / 0.9));
	const k = 0.035 + x2Unit(seed, 321) * 0.015;
	const columnsWanted = [4, 6, 6, 8][x2Hash(seed, 322) % 4] ?? 6;
	const step = 1.8 + x2Unit(seed, 323);
	const showNums = x2Unit(seed, 324) < 0.75;
	const fill = x2Unit(seed, 325) < 0.7;
	const n = width < height ? Math.max(3, Math.round(columnsWanted / 2)) : columnsWanted;
	const mx = width * 0.05;
	const gutter = margin * 0.016;
	const columnWidth = (width - mx * 2 - (n - 1) * gutter) / n;
	const y0 = height * 0.045;
	const y1 = height * 0.955;
	const fs = Math.max(9, margin * 0.011);
	const f = t / step;
	const active = Math.floor(f) % n;
	const pulse = Math.sin(Math.PI * (f % 1));
	ctx.lineWidth = Math.max(1, margin * 0.001);
	for (let index = 0; index < n; index += 1) {
		const x = mx + index * (columnWidth + gutter);
		const alpha =
			(fill && index % 2 === 0 ? k * 0.55 : 0) +
			(index === active ? k * 0.9 * pulse : 0);
		if (alpha > 0) {
			fillRectAt(ctx, x, y0, columnWidth, (y1 - y0) * e, frame.palette.foreground, alpha * e);
		}
	}
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp(k * 2.2 * e);
	ctx.strokeStyle = frame.palette.foreground;
	ctx.beginPath();
	if (ctx.moveTo && ctx.lineTo && ctx.stroke) {
		for (let index = 0; index < n; index += 1) {
			const x = mx + index * (columnWidth + gutter);
			ctx.moveTo(x, y0);
			ctx.lineTo(x, y0 + (y1 - y0) * e);
			ctx.moveTo(x + columnWidth, y0);
			ctx.lineTo(x + columnWidth, y0 + (y1 - y0) * e);
		}
		ctx.stroke();
	} else {
		for (let index = 0; index < n; index += 1) {
			const x = mx + index * (columnWidth + gutter);
			fillRectAt(ctx, x, y0, 1, (y1 - y0) * e, frame.palette.foreground, k * 2.2 * e);
			fillRectAt(ctx, x + columnWidth - 1, y0, 1, (y1 - y0) * e, frame.palette.foreground, k * 2.2 * e);
		}
	}
	ctx.globalAlpha = base;
	fillRectAt(ctx, 0, y0, width * e, Math.max(1, margin * 0.001), frame.palette.accent, k * 2.6 * e);
	fillRectAt(ctx, width - width * e, y1, width * e, Math.max(1, margin * 0.001), frame.palette.accent, k * 2.6 * e);
	if (!showNums) return;
	ctx.font = quoteFont(frame, fs);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.globalAlpha = base * clamp(k * 4 * e);
	ctx.fillStyle = frame.palette.foreground;
	for (let index = 0; index < n; index += 1) {
		ctx.fillText(
			pad2(index + 1),
			mx + index * (columnWidth + gutter) + fs * 0.4,
			y0 + fs * 1.1,
		);
	}
	ctx.globalAlpha = base;
}

/** 淡い大数字 — the line number (or the running second) as huge pale digits cut by the frame edge. */
function drawBgBigDigits(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const t = secondsOf(frame);
	const k = 0.055 + x2Unit(seed, 331) * 0.025;
	const side = x2Hash(seed, 332) % 2 === 0 ? 1 : -1;
	const what = ["line", "line", "sec"][x2Hash(seed, 333) % 3] ?? "line";
	const low = x2Unit(seed, 334) < 0.6;
	const outline = x2Unit(seed, 335) < 0.6;
	const seconds = what === "sec";
	const text = seconds
		? pad2(Math.floor(t) % 100)
		: pad2(lineNoOf(seed) % 100);
	const size = Math.max(width, height) * 0.6;
	const e0 = outCubic(clamp(t / 0.7));
	const roll = seconds
		? 1 - outExpo(clamp((t % 1) / 0.4))
		: 1 - outExpo(clamp(t / 0.8));
	const x = width / 2 + side * width * 0.2;
	const y = height * (low ? 0.62 : 0.4) + roll * size * (seconds ? 0.05 : 0.16);
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = quoteFont(frame, size);
	if (outline) {
		ctx.globalAlpha = base * clamp(Math.min(0.24, k * 2.4) * e0);
		ctx.lineWidth = Math.max(2, size * 0.004);
		ctx.strokeStyle = frame.palette.foreground;
		ctx.strokeText(text, x, y);
	} else {
		ctx.globalAlpha = base * clamp(k * e0);
		ctx.fillStyle = frame.palette.foreground;
		ctx.fillText(text, x, y);
	}
	ctx.restore();
	ctx.globalAlpha = base;
}

/** 字の地紋 — the glyphs of the current line, small and widely spaced, tiled over the frame. */
function drawBgGlyphField(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const t = secondsOf(frame);
	const margin = Math.min(width, height);
	const e = outCubic(clamp(t / 0.9));
	const seed = cut.seed;
	const fs = margin * (0.03 + x2Unit(seed, 341) * 0.012);
	const k = 0.06 + x2Unit(seed, 342) * 0.025;
	const v = 8 + x2Unit(seed, 343) * 8;
	const characters = [...cleanText(cut.text)]
		.filter((character) => !isPunct(character))
		.slice(0, 24);
	if (characters.length === 0) return;
	const rowHeight = fs * 2.3;
	ctx.font = quoteFont(frame, fs);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	const unit = `${characters.join("\u3000")}\u3000`;
	const per = Math.max(fs, measureW(unit, fs));
	const text = unit.repeat(Math.min(40, Math.ceil(width / per) + 2));
	const rows = Math.min(48, Math.ceil(height / rowHeight) + 1);
	const speed = v * (margin / 1080);
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp(k * e);
	ctx.fillStyle = frame.palette.foreground;
	for (let row = 0; row < rows; row += 1) {
		const offset = ((t * speed * (row % 2 === 1 ? 1 : -1) + row * fs * 1.37 + x2Unit(seed + row * 13, 345) * per) % per + per) % per;
		ctx.fillText(text, offset - per, (row + 0.5) * rowHeight);
	}
	ctx.globalAlpha = base;
}

/** 罫線の呼吸 — a few typographic rules reach in from the edges and slowly lengthen and shorten. */
function drawBgRules(options: X2TypoSurfaceDraw): void {
	const { ctx, frame, height, width } = options;
	const cut = frame.cut;
	if (!cut) return;
	const seed = cut.seed;
	const t = secondsOf(frame);
	const margin = Math.min(width, height);
	const s = Math.abs(seed) || 1;
	const n = 6 + (x2Hash(s, 351) % 4);
	const e = outExpo(clamp(t / 1.1));
	const k = 0.12 + x2Unit(s, 352) * 0.04;
	const unit = margin / 1080;
	const lw = Math.max(1, unit * 1.5);
	for (let index = 0; index < n; index += 1) {
		const y =
			height * (0.07 + (0.86 * (index + 0.5)) / n) +
			x2Signed(s, index, 1) * height * 0.025;
		const kind = x2Hash(s, index, 2) % 4;
		const fromLeft = x2Unit(s * 7 + index * 3) < 0.5;
		const length =
			width *
			(0.22 +
				0.62 *
					(0.5 +
						0.5 *
							Math.sin(
								t * (0.12 + 0.2 * x2Unit(s * 11 + index * 5, 4)) +
									x2Unit(s * 13 + index * 7, 5) * TAU,
							))) *
			e;
		const xa = fromLeft ? 0 : width;
		const xb = fromLeft ? length : width - length;
		const color = index === s % n ? frame.palette.accent : frame.palette.foreground;
// eslint-disable-next-line opencut/prefer-object-params
		const seg = (dy: number, weight: number): void => {
			fillRectAt(
				ctx,
				Math.min(xa, xb),
				y + dy - weight / 2,
				Math.abs(xb - xa),
				weight,
				color,
				k,
			);
		};
		if (kind === 0) {
			seg(0, lw);
		} else if (kind === 1) {
			seg(-3 * unit, lw);
			seg(3 * unit, lw);
		} else if (kind === 2) {
			seg(-3.5 * unit, lw * 3.2);
			seg(3.5 * unit, lw);
		} else {
			const dashUnit = lw * 1.6 + lw * 4.5;
			const steps = Math.floor(Math.abs(xb - xa) / dashUnit);
			for (let step = 0; step <= steps; step += 1) {
				const dashStart = Math.min(xa, xb) + step * dashUnit;
				fillRectAt(ctx, dashStart, y - lw * 0.8, lw * 1.6, lw * 1.6, color, k);
			}
		}
		fillRectAt(ctx, xb - lw / 2, y - 7 * unit, lw, 14 * unit, color, k);
	}
}
