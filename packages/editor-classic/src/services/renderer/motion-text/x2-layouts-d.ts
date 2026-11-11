import {
	clamp01,
	degrees,
	frameStep,
	inCubic,
	inOutCubic,
	inOutSine,
	mixHex,
	outCubic,
	secondsOf,
	TICKS_PER_SECOND,
} from "./exit-hold-geometry";
import { outBack, outExpo } from "./kinetic-layout-utils";
import { layoutADrawLine } from "./layouts-a-utils";
import { x2Hash, x2Signed, x2Unit } from "./x2-drawing";
import type { TypographyLayoutOptions } from "./typography-layout-types";

/**
 * JIZURA 追加分2 layouts D (`11p_x2_layD.js`) — arrangements of the glyphs
 * themselves, multi-copy settings and layouts with built-in motion.
 *
 * Each part is a transliteration of its JIZURA `render` body onto rocut's
 * layout contract. Planner-side `plan(rng, …)` params are re-derived
 * deterministically from the cut seed; `env.lt/ltb/step` map to the cut's
 * local seconds / frame counter; `pOut` maps to `frame.exitProgress`.
 * Simplifications match the house precedent for x2 ports: one font family,
 * pattern fills (lines/dots/stripes) collapse to a dim fill, progressive
 * stroke-dash reveals are approximated with a left-to-right clip, vertical
 * writing branches take the horizontal branch, and the beat/energy fields
 * fall back to 0.
 */

/* eslint-disable opencut/prefer-object-params -- this file transliterates JIZURA's compact positional call shape (env, x, y, w, h, color, alpha) helper-for-helper */

type Pt = readonly [number, number];

interface MainItem {
	text: string;
	size: number;
	x: number;
	y: number;
	alpha?: number;
	color?: string;
	fill?: boolean;
	lead?: number;
	rot?: number;
	skew?: number;
	stroke?: number;
	strokeColor?: string;
	strokeUnder?: boolean;
	sx?: number;
	sy?: number;
	track?: number;
}

interface LabelItem {
	align?: "left" | "center" | "right";
	alpha?: number;
	color?: string;
	size?: number;
	track?: number;
}

interface RowOpts {
	cap?: number;
	lead?: number;
	maxR?: number;
	mono?: number;
	spw?: number;
	track?: number;
}

interface RowGlyph {
	t: string;
	i: number;
	r: number;
	j: number;
	ex: number;
	ey: number;
	a: number;
}

interface RowLayout {
	g: RowGlyph[];
	size: number;
	R: number;
	ws: number[];
	n: number;
	lead: number;
}

const TAU = Math.PI * 2;

function isSp(character: string): boolean {
	return character === " " || character === "\u3000";
}

function isLatinText(text: string): boolean {
	const stripped = String(text ?? "").replace(/\s/g, "");
	if (!stripped) return false;
	const letters = (
		stripped.match(/[A-Za-zÀ-ɏḀ-ỿ]/g) ?? []
	).length;
	return letters / [...stripped].length >= 0.6;
}

const OPENS = /[「『（(［【〈《"']/u;
const LATINCH = /[A-Za-zÀ-ɏ0-9가-힯]/u;
const SMALLKANA = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/u;
const PUNCT =
	/[、。，．,.!?！？…‥・「」『』（）()【】〈〉《》〔〕［］[\]'"“”‘’ー〜～:：;；\-—―]/u;

function closePunct(character: string): boolean {
	return PUNCT.test(character) && !OPENS.test(character);
}

function frac(value: number): number {
	return value - Math.floor(value);
}

function splitWordsBalanced(text: string, maxPer: number): string {
	const words = text.trim().split(/\s+/);
	const count = words.length;
	const total =
		words.reduce((sum, word) => sum + [...word].length, 0) + count - 1;
	const lineCount = Math.min(count, Math.ceil(total / maxPer));
	if (lineCount <= 1) return words.join(" ");
	const ideal = total / lineCount;
	const lines: string[] = [];
	let current: string[] = [];
	let length = 0;
	for (const word of words) {
		const wordLength = [...word].length;
		if (current.length && length + 1 + wordLength > ideal + 1) {
			lines.push(current.join(" "));
			current = [];
			length = 0;
		}
		current.push(word);
		length = current.length > 1 ? length + 1 + wordLength : wordLength;
	}
	if (current.length) lines.push(current.join(" "));
	return lines.join("\n");
}

function splitLinesOf(text: string, maxPer: number): string {
	const characters = [...text];
	if (characters.length <= maxPer) return text;
	if (isLatinText(text)) {
		return /\s/.test(text.trim())
			? splitWordsBalanced(text.trim(), maxPer)
			: text;
	}
	const lineCount = Math.ceil(characters.length / maxPer);
	const per = characters.length / lineCount;
	const lines: string[] = [];
	let start = 0;
	for (let line = 1; line < lineCount; line++) {
		const target = Math.round(per * line);
		let best = target;
		let bestScore = -Infinity;
		for (
			let k = Math.max(start + 1, target - 3);
			k <= Math.min(characters.length - 1, target + 3);
			k++
		) {
			const before = characters[k - 1];
			const after = characters[k];
			let score = 3 - Math.abs(k - target);
			if (PUNCT.test(before) && !OPENS.test(before)) score += 5;
			if (before === " " || before === "\u3000") score += 5;
			if (OPENS.test(before)) score -= 8;
			if (",.!?!?…、。".includes(after)) score -= 8;
			if (LATINCH.test(before) && LATINCH.test(after)) score -= 4;
			if (SMALLKANA.test(after) || "ーっ、。".includes(after)) score -= 6;
			if (score > bestScore) {
				bestScore = score;
				best = k;
			}
		}
		lines.push(characters.slice(start, best).join("").trim());
		start = best;
	}
	lines.push(characters.slice(start).join("").trim());
	return lines.join("\n");
}

function splitL(text: string, per: number): string {
	const lines = splitLinesOf(String(text), Math.max(1, per)).split("\n");
	const out: string[] = [];
	for (const line of lines) {
		if (
			out.length &&
			[...line].every(
				(character) => PUNCT.test(character) || character === " ",
			)
		) {
			out[out.length - 1] += line;
		} else {
			out.push(line);
		}
	}
	return out.join("\n");
}

function linesOfText(text: string, lineCount: number): string {
	const trimmed = String(text ?? "").trim();
	const length = [...trimmed].length;
	return lineCount <= 1
		? trimmed
		: splitL(trimmed, Math.ceil(length / lineCount));
}

/** Glyph cells: closing punctuation rides with the glyph before it; ' ' marks a word gap (Latin lyrics only). */
function cellsOf(text: string): string[] {
	let s = String(text ?? "")
		.trim()
		.replace(/[\s\u3000]+/gu, " ");
	if (!(isLatinText(s) && s.includes(" "))) s = s.replace(/ /g, "");
	const out: string[] = [];
	for (const ch of [...s]) {
		const last = out[out.length - 1];
		if (last && !isSp(last) && closePunct(ch) && [...last].length < 2) {
			out[out.length - 1] += ch;
		} else {
			out.push(ch);
		}
	}
	return out;
}

function visibleCells(text: string): string[] {
	return cellsOf(text).filter((cell) => !isSp(cell));
}

/** Split into R rows of (almost) equal length, longer rows first. */
function chunkBal(cells: string[], R: number): string[][] {
	const out: string[][] = [];
	const n = cells.length;
	const rows = Math.max(1, Math.min(R, n));
	let at = 0;
	for (let r = 0; r < rows; r++) {
		const k = Math.ceil((n - at) / (rows - r));
		out.push(cells.slice(at, at + k));
		at += k;
	}
	return out;
}

/** Rows of cells: Latin lyrics break between words, anything else into even runs. */
function rowCells(text: string, RN: number): string[][] {
	const all = cellsOf(text);
	if (RN <= 1) return [all];
	if (all.includes(" ")) {
		return linesOfText(
			String(text ?? "")
				.trim()
				.replace(/\s+/g, " "),
			RN,
		)
			.split("\n")
			.map(cellsOf)
			.filter((row) => row.length);
	}
	return chunkBal(all, RN);
}

function glyphWidth(character: string, size: number): number {
	return isSp(character) ? 0.34 * size : 0.62 * size;
}

function textWidth(text: string, size: number, track = 0): number {
	const characters = [...text];
	let width = 0;
	for (const character of characters) width += glyphWidth(character, size);
	return width + track * size * Math.max(0, characters.length - 1);
}

/** Per-glyph row setting (JIZURA `layRows`): advances in em, glyph offsets from the block centre. */
function advOf(cell: string, o: RowOpts): number {
	if (isSp(cell)) {
		return o.spw ?? (o.mono ? o.mono * 0.5 : 0.34);
	}
	return o.mono ?? 0.62;
}

function rowWidth(row: readonly string[], o: RowOpts): number {
	let sum = 0;
	for (const cell of row) sum += advOf(cell, o);
	return sum + (o.track ?? 0) * Math.max(0, row.length - 1);
}

function layRows(text: string, bw: number, bh: number, o: RowOpts = {}): RowLayout {
	const lead = o.lead ?? 1.2;
	const maxR = o.maxR ?? 1;
	const track = o.track ?? 0;
	let best: { rows: string[][]; ws: number[]; size: number } | null = null;
	for (let R = 1; R <= maxR; R++) {
		const rows = rowCells(text, R);
		if (best && rows.length <= best.rows.length) continue;
		const ws = rows.map((row) => Math.max(0.3, rowWidth(row, o)));
		const size = Math.min(
			bw / Math.max(...ws),
			bh / (rows.length * lead - (lead - 1)),
			o.cap ?? 1e9,
		);
		if (!best || size > best.size * 1.04) best = { rows, ws, size };
	}
	const rows = best?.rows ?? [[]];
	const ws = best?.ws ?? [1];
	const size = best?.size ?? 10;
	const glyphs: RowGlyph[] = [];
	const R = rows.length;
	let gi = 0;
	rows.forEach((row, r) => {
		let x = -ws[r] / 2;
		row.forEach((cell, j) => {
			const a = advOf(cell, o);
			if (!isSp(cell)) {
				glyphs.push({
					t: cell,
					i: gi++,
					r,
					j,
					ex: x + a / 2,
					ey: (r - (R - 1) / 2) * lead,
					a,
				});
			}
			x += a + track;
		});
	});
	return { g: glyphs, size, R, ws, n: gi, lead };
}

/** A cell that carries its closing punctuation is squeezed to stay inside a fixed-width cell. */
function sqz(cell: string): number {
	return [...cell].length > 1 ? 0.68 : 1;
}

/** The JIZURA `env` for one frame: geometry, palette mapping, easing and text. */
class X2DEnv {
	readonly options: TypographyLayoutOptions;
	readonly W: number;
	readonly H: number;
	readonly M: number;
	readonly port: boolean;
	readonly txt: string;
	readonly seed: number;
	readonly lt: number;
	readonly ltb: number;
	readonly step: number;
	readonly dur: number;
	readonly out: number;
	readonly lw: number;
	readonly ls: number;

	constructor(options: TypographyLayoutOptions) {
		this.options = options;
		const { frame, height, width } = options;
		this.W = width;
		this.H = height;
		this.M = Math.min(width, height);
		this.port = height > width * 1.08;
		this.txt = String(frame.cut?.text ?? "").trim();
		this.seed = frame.cut?.seed ?? 0;
		this.lt = secondsOf(frame);
		this.ltb = this.lt;
		this.step = frameStep(frame);
		this.dur = Math.max(
			0.2,
			(frame.cut?.duration ?? TICKS_PER_SECOND) / TICKS_PER_SECOND,
		);
		this.out = 1 - inCubic(frame.exitProgress);
		this.lw = Math.max(1, this.M * 0.0016);
		this.ls = Math.min(24, Math.max(11, this.M * 0.019));
	}

	get bg(): string {
		return this.options.frame.palette.background;
	}

	get fg(): string {
		return this.options.frame.palette.foreground;
	}

	get sub(): string {
		return this.options.frame.palette.secondary;
	}

	get ac(): string {
		return this.options.frame.palette.accent;
	}

	get dim(): string {
		return mixHex({ from: this.bg, progress: 0.17, to: this.fg });
	}

	accentOn(): string {
		return contrastOf(this.ac, this.bg) >= 2
			? this.ac
			: contrastOf(this.sub, this.bg) >= 2
				? this.sub
				: this.fg;
	}

	subOn(): string {
		return contrastOf(this.sub, this.bg) >= 1.6
			? this.sub
			: mixHex({ from: this.bg, progress: 0.6, to: this.fg });
	}

	inE(d = 0.35, delay = 0): number {
		return outExpo(clamp01((this.lt - delay) / d));
	}

	inC(d = 0.35, delay = 0): number {
		return outCubic(clamp01((this.lt - delay) / d));
	}

	inB(d = 0.4, delay = 0, s = 1.4): number {
		const k = clamp01((this.lt - delay) / d);
		return k <= 0 ? 0 : k >= 1 ? 1 : outBack({ overshoot: s, value: k });
	}

	stg(i: number, step = 0.05, d = 0.4): number {
		return outExpo(clamp01((this.lt - i * step) / d));
	}

	clamp(value: number): number {
		return clamp01(value);
	}

	lerpN(a: number, b: number, k: number): number {
		return a + (b - a) * k;
	}

	unit(...salts: number[]): number {
		return x2Unit(this.seed, ...salts);
	}

	signed(...salts: number[]): number {
		return x2Signed(this.seed, ...salts);
	}

	hash(...salts: number[]): number {
		return x2Hash(this.seed, ...salts);
	}

	pick(salt: number, list: readonly string[]): string {
		return list[this.hash(salt) % list.length] ?? list[0];
	}

	int(salt: number, lo: number, hi: number): number {
		return lo + (this.hash(salt) % Math.max(1, hi - lo + 1));
	}

	chance(salt: number, probability: number): boolean {
		return this.unit(salt) < probability;
	}

	range(salt: number, a: number, b: number): number {
		return a + this.unit(salt) * (b - a);
	}

	glyphCountOf(text: string): number {
		return [...String(text).replace(/\s/g, "")].length;
	}

	fitSizeOf(text: string, bw: number, bh: number, lead = 1.2, track = 0.02): number {
		const lines = text.split("\n");
		let w = 0;
		for (const line of lines) w = Math.max(w, textWidth(line, 100, track));
		const h = Math.max(1, lines.length * lead * 100);
		const k = Math.min(bw / Math.max(1, w), bh / Math.max(1, h));
		return 100 * k;
	}

	fitBox(
		text: string,
		bw: number,
		bh: number,
		lead = 1.2,
		track = 0.02,
		maxL = 4,
	): { text: string; size: number } {
		const trimmed = String(text ?? "").trim();
		const length = [...trimmed].length;
		let best: { text: string; size: number } | null = null;
		for (let L = 1; L <= Math.min(maxL, Math.max(1, length)); L++) {
			const candidate = linesOfText(trimmed, L);
			if (candidate.split("\n").length < L && best) continue;
			const size = this.fitSizeOf(candidate, bw, bh, lead, track);
			if (!best || size > best.size * 1.04) best = { text: candidate, size };
		}
		return best ?? { text: trimmed, size: 10 };
	}

	measure(item: MainItem): { w: number; h: number } {
		const lead = item.lead ?? 1.2;
		const track = item.track ?? 0;
		const lines = item.text.split("\n");
		let w = 0;
		for (const line of lines) w = Math.max(w, textWidth(line, item.size, track));
		const h = Math.max(item.size, lines.length * lead * item.size);
		return { w: w * (item.sx ?? 1), h: h * (item.sy ?? 1) };
	}

	main(item: MainItem): void {
		const alpha = item.alpha ?? 1;
		if (alpha <= 0.003) return;
		const { ctx, drawText, setFontSize } = this.options;
		const lead = item.lead ?? 1.2;
		const track = item.track ?? 0;
		const lines = item.text.split("\n");
		const rows = lines.length;
		const size = item.size;
		const color = item.color ?? this.fg;
		const limit = (line: string) => textWidth(line, size, track) * 2 + size;
		ctx.save();
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * alpha;
		ctx.translate(item.x, item.y);
		if (item.rot) ctx.rotate(degrees(item.rot));
		if (item.skew) ctx.transform(1, 0, Math.tan(degrees(item.skew)), 1, 0, 0);
		if (item.sx != null || item.sy != null) {
			const sy = Math.abs(item.sy ?? 1) < 0.001 ? 0.001 : (item.sy ?? 1);
			ctx.scale(item.sx ?? 1, sy);
		}
		ctx.textAlign = "center";
		if ((item.strokeUnder || item.fill === false) && item.stroke) {
			setFontSize(size);
			ctx.lineWidth = item.stroke;
			ctx.strokeStyle = item.strokeColor ?? color;
			for (const [row, line] of lines.entries()) {
				ctx.strokeText(line, 0, (row - (rows - 1) / 2) * lead * size, limit(line));
			}
		}
		if (item.fill !== false) {
			ctx.fillStyle = color;
			for (const [row, line] of lines.entries()) {
				drawText({
					text: line,
					x: 0,
					y: (row - (rows - 1) / 2) * lead * size,
					maxWidth: limit(line),
					size,
				});
			}
		}
		ctx.restore();
	}

	/** Draw one glyph cell (JIZURA `put`): the squeeze keeps punctuation cells inside their slot. */
	put(g: RowGlyph, item: Partial<MainItem> & { size: number; x: number; y: number }): void {
		this.main({
			text: g.t,
			color: this.fg,
			sx: sqz(g.t),
			...item,
		});
	}

	/** Secondary copy style (JIZURA `copyStyle`): patterns collapse to a dim fill, outline stays a stroke. */
	copyStyle(kind: string, size: number, k: number): Partial<MainItem> {
		const dim = mixHex({ from: this.bg, progress: 0.3, to: this.fg });
		if (kind === "dim") return { alpha: 0.9 * k, color: dim };
		if (kind === "outline") {
			return {
				alpha: 0.75 * k,
				color: this.fg,
				fill: false,
				stroke: Math.max(1.5, size * 0.016),
				strokeColor: this.fg,
			};
		}
		if (kind === "stripes") return { alpha: 0.85 * k, color: this.accentOn() };
		return { alpha: 0.78 * k, color: dim };
	}

	label(text: string, x: number, y: number, item: LabelItem = {}): void {
		const alpha = item.alpha ?? 1;
		if (alpha <= 0.003) return;
		const { ctx, drawText } = this.options;
		const size = item.size ?? this.ls;
		const value = String(text);
		ctx.save();
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * alpha;
		ctx.translate(x, y);
		ctx.fillStyle = item.color ?? this.subOn();
		ctx.textAlign = item.align ?? "center";
		drawText({
			text: value,
			x: 0,
			y: 0,
			maxWidth: textWidth(value, size, item.track ?? 0.08) * 1.6 + 8,
			size,
		});
		ctx.restore();
	}

	rc(x: number, y: number, w: number, h: number, c: string, a = 1): void {
		if (a <= 0.003 || w <= 0 || h <= 0) return;
		const ctx = this.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * a;
		ctx.fillStyle = c;
		ctx.fillRect(x, y, w, h);
		ctx.globalAlpha = base;
	}

	ln(x0: number, y0: number, x1: number, y1: number, c: string, lw: number, a = 1): void {
		if (a <= 0.003) return;
		layoutADrawLine({
			alpha: a,
			color: c,
			ctx: this.options.ctx,
			fromX: x0,
			fromY: y0,
			thickness: lw,
			toX: x1,
			toY: y1,
		});
	}

	polyline(points: readonly Pt[], c: string, lw: number, a = 1): void {
		if (a <= 0.003 || points.length < 2) return;
		for (let index = 1; index < points.length; index++) {
			this.ln(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1], c, lw, a);
		}
	}

	polyPartial(points: readonly Pt[], reveal: number, c: string, lw: number, a = 1): void {
		if (a <= 0.003 || points.length < 2 || reveal <= 0) return;
		let total = 0;
		for (let index = 1; index < points.length; index++) {
			total += Math.hypot(
				points[index][0] - points[index - 1][0],
				points[index][1] - points[index - 1][1],
			);
		}
		if (total <= 0) return;
		const limit = total * clamp01(reveal);
		let drawn = 0;
		for (let index = 1; index < points.length; index++) {
			const from = points[index - 1];
			const to = points[index];
			const segment = Math.hypot(to[0] - from[0], to[1] - from[1]);
			if (drawn >= limit) break;
			const f = Math.min(1, (limit - drawn) / Math.max(1e-6, segment));
			this.ln(
				from[0],
				from[1],
				from[0] + (to[0] - from[0]) * f,
				from[1] + (to[1] - from[1]) * f,
				c,
				lw,
				a,
			);
			drawn += segment;
		}
	}

	disc(x: number, y: number, r: number, c: string, a = 1): void {
		if (a <= 0.003 || r <= 0) return;
		const ctx = this.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * a;
		ctx.fillStyle = c;
		if (ctx.arc && ctx.fill) {
			ctx.beginPath();
			ctx.arc(x, y, r, 0, TAU);
			ctx.fill();
		} else {
			ctx.fillRect(x - r, y - r, r * 2, r * 2);
		}
		ctx.globalAlpha = base;
	}

	ringS(x: number, y: number, r: number, c: string, lw: number, a = 1): void {
		if (a <= 0.003 || r <= 0) return;
		const ctx = this.options.ctx;
		if (!(ctx.arc && ctx.stroke)) {
			this.ln(x - r, y, x + r, y, c, lw, a);
			return;
		}
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * a;
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.stroke();
		ctx.globalAlpha = base;
	}

	ringRect(x: number, y: number, r: number, c: string, lw: number, a = 1): void {
		if (a <= 0.003 || r <= 0) return;
		const ctx = this.options.ctx;
		if (!(ctx.moveTo && ctx.lineTo && ctx.arc)) {
			this.rc(x - r, y - r, r * 2, r * 2, c, a * 0.2);
			return;
		}
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * a;
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.moveTo(x - r + r * 0.16, y - r);
		ctx.lineTo(x + r - r * 0.16, y - r);
		ctx.arc(x + r - r * 0.16, y - r + r * 0.16, r * 0.16, -Math.PI / 2, 0);
		ctx.lineTo(x + r, y + r - r * 0.16);
		ctx.arc(x + r - r * 0.16, y + r - r * 0.16, r * 0.16, 0, Math.PI / 2);
		ctx.lineTo(x - r + r * 0.16, y + r);
		ctx.arc(x - r + r * 0.16, y + r - r * 0.16, r * 0.16, Math.PI / 2, Math.PI);
		ctx.lineTo(x - r, y - r + r * 0.16);
		ctx.arc(x - r + r * 0.16, y - r + r * 0.16, r * 0.16, Math.PI, Math.PI * 1.5);
		ctx.closePath?.();
		ctx.stroke?.();
		ctx.globalAlpha = base;
	}

	polyF(points: readonly Pt[], c: string, a = 1): void {
		if (a <= 0.003 || points.length < 3) return;
		const ctx = this.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * a;
		ctx.fillStyle = c;
		if (ctx.moveTo && ctx.lineTo && ctx.fill) {
			ctx.beginPath();
			ctx.moveTo(points[0][0], points[0][1]);
			for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
			ctx.closePath?.();
			ctx.fill();
		} else {
			const xs = points.map(([x]) => x);
			const ys = points.map(([, y]) => y);
			ctx.fillRect(
				Math.min(...xs),
				Math.min(...ys),
				Math.max(...xs) - Math.min(...xs),
				Math.max(...ys) - Math.min(...ys),
			);
		}
		ctx.globalAlpha = base;
	}

	arcS(x: number, y: number, r: number, a0: number, a1: number, c: string, lw: number, a = 1): void {
		if (a <= 0.003 || a1 <= a0 || r <= 0) return;
		const ctx = this.options.ctx;
		if (!(ctx.arc && ctx.stroke)) {
			this.ln(
				x + Math.cos(degrees(a0)) * r,
				y + Math.sin(degrees(a0)) * r,
				x + Math.cos(degrees(a1)) * r,
				y + Math.sin(degrees(a1)) * r,
				c,
				lw,
				a,
			);
			return;
		}
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * a;
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc(x, y, r, degrees(a0), degrees(a1));
		ctx.stroke();
		ctx.globalAlpha = base;
	}

	/** Run fn clipped to a rectangle (canvas `rect` + `clip` are always available). */
	clipRect(x: number, y: number, w: number, h: number, fn: () => void): void {
		const ctx = this.options.ctx;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		fn();
		ctx.restore();
	}

	/** Run fn clipped to the inside of a polygon path (unclipped if path ops are unavailable). */
	clipped(points: readonly Pt[], fn: () => void): void {
		const ctx = this.options.ctx;
		if (!(ctx.moveTo && ctx.lineTo)) {
			fn();
			return;
		}
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(points[0][0], points[0][1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		ctx.clip();
		fn();
		ctx.restore();
	}

	/** Run fn clipped to the outside of a polygon path (evenodd). */
	clippedOut(points: readonly Pt[], fn: () => void): void {
		const ctx = this.options.ctx;
		if (!(ctx.moveTo && ctx.lineTo)) {
			fn();
			return;
		}
		ctx.save();
		ctx.beginPath();
		ctx.rect(-this.W * 3, -this.H * 3, this.W * 7, this.H * 7);
		ctx.moveTo(points[0][0], points[0][1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		ctx.clip("evenodd");
		fn();
		ctx.restore();
	}
}

function contrastOf(a: string, b: string): number {
	const la = luminanceOf(a);
	const lb = luminanceOf(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminanceOf(color: string): number {
	const rgb = hexOf(color);
	if (!rgb) return 0.5;
	return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function hexOf(color: string): [number, number, number] | null {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(color);
	if (!match?.[1]) return null;
	const digits =
		match[1].length === 3
			? Array.from(match[1], (component) => component + component).join("")
			: match[1];
	return [
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	];
}

export function drawX2LayoutD(options: TypographyLayoutOptions): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "xdAxisAlt":
		case "xdBentRoad":
		case "xdBrick":
		case "xdChecker":
		case "xdColumnEcho":
		case "xdConstellation":
		case "xdCyclic":
		case "xdDrum":
		case "xdFourUp":
		case "xdHelix":
		case "xdKaraoke":
		case "xdMirrorAxis":
		case "xdOverlap":
		case "xdPassing":
		case "xdPivotFan":
		case "xdPointSym":
		case "xdRipple":
		case "xdSkewSweep":
		case "xdSkyline":
		case "xdSlowSpread":
		case "xdSpiralEcho":
		case "xdSquareWave":
		case "xdStaff":
		case "xdStitch":
		case "xdStretchEcho":
		case "xdSunShadow":
		case "xdTide":
		case "xdTrace":
		case "xdUpSide":
		case "xdWindSway":
			drawX2LayoutDPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2LayoutDPart(options: TypographyLayoutOptions): void {
	switch (options.frame.cut?.preset.layout) {
		case "xdHelix":
			drawHelix(options);
			return;
		case "xdConstellation":
			drawConstellation(options);
			return;
		case "xdBrick":
			drawBrick(options);
			return;
		case "xdMirrorAxis":
			drawMirrorAxis(options);
			return;
		case "xdUpSide":
			drawUpSide(options);
			return;
		case "xdPivotFan":
			drawPivotFan(options);
			return;
		case "xdDrum":
			drawDrum(options);
			return;
		case "xdSlowSpread":
			drawSlowSpread(options);
			return;
		case "xdBentRoad":
			drawBentRoad(options);
			return;
		case "xdStaff":
			drawStaff(options);
			return;
		case "xdOverlap":
			drawOverlap(options);
			return;
		case "xdCyclic":
			drawCyclic(options);
			return;
		case "xdKaraoke":
			drawKaraoke(options);
			return;
		case "xdPassing":
			drawPassing(options);
			return;
		case "xdChecker":
			drawChecker(options);
			return;
		case "xdSquareWave":
			drawSquareWave(options);
			return;
		case "xdAxisAlt":
			drawAxisAlt(options);
			return;
		case "xdPointSym":
			drawPointSym(options);
			return;
		case "xdWindSway":
			drawWindSway(options);
			return;
		case "xdSunShadow":
			drawSunShadow(options);
			return;
		case "xdSkewSweep":
			drawSkewSweep(options);
			return;
		case "xdStretchEcho":
			drawStretchEcho(options);
			return;
		case "xdColumnEcho":
			drawColumnEcho(options);
			return;
		case "xdSkyline":
			drawSkyline(options);
			return;
		case "xdSpiralEcho":
			drawSpiralEcho(options);
			return;
		case "xdRipple":
			drawRipple(options);
			return;
		case "xdFourUp":
			drawFourUp(options);
			return;
		case "xdTrace":
			drawTrace(options);
			return;
		case "xdTide":
			drawTide(options);
			return;
		case "xdStitch":
			drawStitch(options);
			return;
		default:
			return;
	}
}

/** 二重らせん — the glyphs ride one strand of a slowly turning double helix (near glyphs grow, far ones shrink); the other strand is dots and rungs. */
function drawHelix(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw } = env;
	const turns = env.range(1, 0.9, 1.5);
	const speed = env.range(2, 16, 30) * (env.chance(3, 0.5) ? 1 : -1);
	const rungs = env.chance(4, 0.75);
	const dot = env.pick(5, ["dot", "ring"]);
	const sl = cellsOf(txt);
	const N = sl.length;
	const K = 1.08;
	const size = port
		? Math.min((H * 0.8) / (N * K), W * 0.24)
		: Math.min((W * 0.84) / (N * K), M * 0.2);
	const amp = port
		? Math.min(size * 0.7, W * 0.44 - size * 0.62)
		: size * 0.62;
	const ph0 = env.ltb * speed * degrees(1);
	const acc = env.accentOn();
	const at = (s: number) => {
		const ph = (N > 1 ? s / (N - 1) : 0.5) * turns * TAU + ph0;
		const a = (s - (N - 1) / 2) * size * K;
		const o = Math.sin(ph) * amp;
		const c = Math.cos(ph);
		return port
			? { x: W / 2 + o, y: H / 2 + a, xb: W / 2 - o, yb: H / 2 + a, c }
			: { x: W / 2 + a, y: H / 2 + o, xb: W / 2 + a, yb: H / 2 - o, c };
	};
	const pts: Pt[] = [];
	for (let k = 0; k <= 48; k++) {
		const p = at(-0.4 + ((N - 0.2) * k) / 48);
		pts.push([p.xb, p.yb]);
	}
	env.polyPartial(pts, env.inE(0.8), env.sub, lw * 1.2, 0.45 * env.out);
	const items: { t: string; p: ReturnType<typeof at> }[] = [];
	sl.forEach((cell, s) => {
		const p = at(s);
		const e = env.stg(s, 0.03, 0.4) * env.out;
		if (rungs) env.ln(p.x, p.y, p.xb, p.yb, env.sub, lw, 0.28 * e);
		const r = size * 0.075 * (1 - 0.4 * p.c) * e;
		if (dot === "ring") env.ringS(p.xb, p.yb, r * 1.2, acc, lw * 1.5, 0.9 * env.out);
		else env.disc(p.xb, p.yb, r, acc, 0.9 * env.out);
		if (!isSp(cell)) items.push({ t: cell, p });
	});
	items.sort((a, b) => a.p.c - b.p.c);
	for (const item of items) {
		env.main({
			text: item.t,
			size: size * (1 + 0.16 * item.p.c),
			sx: sqz(item.t),
			x: item.p.x,
			y: item.p.y,
		});
	}
}

/** 星座つなぎ — glyphs sit loosely like stars of different magnitude, joined in reading order by thin lines; the whole sky turns very slowly. */
function drawConstellation(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const jit = env.range(1, 0.18, 0.28);
	const star = env.pick(2, ["dot", "cross"]);
	const extra = env.int(3, 6, 11);
	const turn = env.range(4, 0.5, 1.1) * (env.chance(5, 0.5) ? 1 : -1);
	const L = layRows(txt, W * 0.74, H * 0.56, {
		cap: M * 0.19,
		lead: 1.8,
		maxR: port ? 5 : 3,
		mono: 1,
		track: 0.42,
	});
	const size = L.size;
	const rot = (lt - env.dur / 2) * turn * degrees(1);
	const cr = Math.cos(rot);
	const sr = Math.sin(rot);
	const pt = L.g.map((g) => {
		const x = (g.ex + env.signed(g.i, 1) * jit) * size;
		const y = (g.ey + env.signed(g.i, 2) * jit * 1.5) * size;
		return {
			g,
			k: 0.8 + 0.4 * env.unit(g.i, 3),
			x: W / 2 + x * cr - y * sr,
			y: H / 2 + x * sr + y * cr,
		};
	});
	for (let k = 0; k < extra; k++) {
		const x0 = (env.unit(k, 11) - 0.5) * W * 0.88;
		const y0 = (env.unit(k, 12) - 0.5) * H * 0.84;
		const x = W / 2 + x0 * cr - y0 * sr;
		const y = H / 2 + x0 * sr + y0 * cr;
		const a =
			(0.3 + 0.3 * Math.sin(lt * 2.2 + k * 1.7)) *
			env.inC(0.5, k * 0.04) *
			env.out;
		const r = lw * (1.4 + 1.6 * env.unit(k, 13));
		if (pt.some((p) => Math.hypot(p.x - x, p.y - y) < size * 0.6)) continue;
		if (star === "cross") {
			env.ln(x - r * 2.4, y, x + r * 2.4, y, env.sub, lw, a);
			env.ln(x, y - r * 2.4, x, y + r * 2.4, env.sub, lw, a);
		} else {
			env.disc(x, y, r, env.sub, a);
		}
	}
	for (let i = 0; i < pt.length - 1; i++) {
		const a = pt[i];
		const b = pt[i + 1];
		const d = Math.hypot(b.x - a.x, b.y - a.y);
		const ra = size * a.k * 0.6;
		const rb = size * b.k * 0.6;
		if (d < ra + rb + size * 0.08) continue;
		const ux = (b.x - a.x) / d;
		const uy = (b.y - a.y) / d;
		const e = env.stg(i, 0.07, 0.45);
		const x0 = a.x + ux * ra;
		const y0 = a.y + uy * ra;
		const x1 = env.lerpN(x0, b.x - ux * rb, e);
		const y1 = env.lerpN(y0, b.y - uy * rb, e);
		env.ln(x0, y0, x1, y1, env.sub, lw * 1.2, (a.g.r === b.g.r ? 0.7 : 0.3) * env.out);
		env.disc(x0, y0, lw * 2, env.accentOn(), env.out * e);
		env.disc(x1, y1, lw * 2, env.accentOn(), env.out * e);
	}
	for (const p of pt) {
		env.main({
			text: p.g.t,
			size: size * p.k,
			sx: sqz(p.g.t),
			x: p.x,
			y: p.y,
		});
	}
}

/** レンガ積み — one glyph per brick in running bond: every other course is shifted by half a brick. */
function drawBrick(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const style = env.pick(1, ["line", "line", "fill"]);
	const acc = env.chance(2, 0.65);
	const off = Number.parseInt(env.pick(3, ["0", "1"]));
	let best: { rows: string[][]; per: number; s: number } | null = null;
	for (let R = 1; R <= (port ? 6 : 3); R++) {
		const rows = rowCells(txt, R);
		if (best && rows.length <= best.rows.length) continue;
		const per = Math.max(...rows.map((row) => row.length));
		const s = Math.min(
			(W * 0.86) / ((per + 0.5) * 1.22),
			(H * 0.74) / (rows.length * 1.3),
			M * 0.26,
		);
		if (!best || s > best.s * 1.04) best = { rows, per, s };
	}
	const rows = best?.rows ?? [[]];
	const per = best?.per ?? 1;
	const s = best?.s ?? 10;
	const R = rows.length;
	const bw = s * 1.22;
	const bh = s * 1.3;
	const ww = (per + 0.5) * bw;
	const left = W / 2 - ww / 2;
	const top = H / 2 - (R * bh) / 2;
	const col = env.subOn();
	const gap = Math.max(lw * 2, s * 0.035);
	const x0r = (r: number) => left + (((r + off) % 2) * bw) / 2;
	if (style === "line") {
		for (let r = 0; r <= R; r++) {
			const e = env.inE(0.5, r * 0.05);
			env.ln(left, top + r * bh, left + ww * e, top + r * bh, col, lw * 1.4, 0.8 * env.out);
		}
		for (let r = 0; r < R; r++) {
			const xs = [left, left + ww];
			for (let j = 0; j <= per; j++) xs.push(x0r(r) + j * bw);
			xs.forEach((x, j) => {
				const e = env.inE(0.35, 0.12 + r * 0.05 + j * 0.02);
				env.ln(x, top + r * bh, x, top + r * bh + bh * e, col, lw * 1.4, 0.8 * env.out);
			});
		}
	} else {
		for (let r = 0; r < R; r++) {
			const x0 = x0r(r);
			const cells: [number, number][] = [];
			if (x0 > left + 1) cells.push([left, x0]);
			for (let j = 0; j < per; j++) cells.push([x0 + j * bw, x0 + (j + 1) * bw]);
			if (x0 + per * bw < left + ww - 1) cells.push([x0 + per * bw, left + ww]);
			cells.forEach((cellRange, j) => {
				const e = outBack({ overshoot: 1.4, value: clamp01((lt - r * 0.05 - j * 0.025) / 0.35) }) * env.out;
				if (e > 0.01) {
					env.rc(
						cellRange[0] + gap / 2,
						top + r * bh + gap / 2 + ((bh - gap) * (1 - e)) / 2,
						cellRange[1] - cellRange[0] - gap,
						(bh - gap) * e,
						env.dim,
						1,
					);
				}
			});
		}
	}
	if (acc) {
		const r = env.hash(5) % R;
		const onL = (r + off) % 2 === 1;
		const e = outBack({ overshoot: 1.6, value: clamp01((lt - 0.3) / 0.35) }) * env.out;
		if (e > 0.01) {
			env.rc(
				(onL ? left : left + ww - bw / 2) + gap / 2,
				top + r * bh + gap / 2,
				bw / 2 - gap,
				(bh - gap) * e,
				env.accentOn(),
				1,
			);
		}
	}
	rows.forEach((row, r) => {
		row.forEach((cell, j) => {
			if (isSp(cell)) return;
			env.main({
				text: cell,
				size: s,
				sx: sqz(cell),
				x: x0r(r) + (j + 0.5) * bw,
				y: top + (r + 0.5) * bh,
			});
		});
	});
}

/** 鏡合わせ — the lyric stands against a vertical centre line and a left-right flipped copy unfolds on the other side. */
function drawMirrorAxis(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, txt, lw } = env;
	const side = Number.parseInt(env.pick(1, ["-1", "-1", "1"]));
	const copy = env.pick(2, ["outline", "dim", "lines"]);
	const ticks = env.chance(3, 0.6);
	const fb = env.fitBox(txt, W * 0.4, H * 0.62, 1.2, 0.02, 4);
	const size = Math.min(fb.size, M * 0.3);
	const gap = Math.max(size * 0.14, M * 0.022);
	const it = {
		text: fb.text,
		size,
		x: W / 2 + side * gap,
		y: H / 2,
		align: (side < 0 ? "right" : "left") as "left" | "right",
		lead: 1.2,
		track: 0.02,
		color: env.fg,
	};
	const e = env.inE(0.6);
	const L = H * 0.4 * e;
	env.ln(W / 2, H / 2 - L, W / 2, H / 2 + L, env.accentOn(), lw * 2, env.out);
	if (ticks) {
		for (let k = -6; k <= 6; k++) {
			const y = H / 2 + k * H * 0.06;
			if (Math.abs(y - H / 2) < L) {
				env.ln(W / 2 - M * 0.012, y, W / 2 + M * 0.012, y, env.accentOn(), lw, 0.7 * env.out);
			}
		}
	}
	const kf = env.inE(0.7, 0.12);
	if (kf > 0.01) {
		const ctx = env.options.ctx;
		ctx.save();
		ctx.translate(W / 2, 0);
		ctx.scale(-kf, 1);
		ctx.translate(-W / 2, 0);
		env.main({ ...it, ...env.copyStyle(copy, size, kf * env.out) });
		ctx.restore();
	}
	env.main(it);
}

/** 縦横交互 — every other glyph lies on its side; half-way through the cut the two groups trade places with a quarter turn. */
function drawUpSide(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const mode = env.pick(1, ["alt", "alt", "pairs"]);
	const sgn = Number.parseInt(env.pick(2, ["1", "-1"]));
	const marks = env.chance(3, 0.7);
	const swap = env.chance(4, 0.55);
	const L = layRows(txt, W * 0.84, H * 0.62, {
		cap: M * 0.26,
		lead: 1.3,
		maxR: port ? 4 : 2,
		mono: 1.12,
	});
	const size = L.size;
	const tw = swap && env.dur > 1.8 ? inOutCubic(clamp01((lt - env.dur * 0.5) / 0.45)) : 0;
	const acc = env.accentOn();
	for (const g of L.g) {
		const side = mode === "alt" ? g.i % 2 === 1 : (g.i >> 1) % 2 === 1;
		const f = side ? 1 - tw : tw;
		const x = W / 2 + g.ex * size;
		const y = H / 2 + g.ey * size;
		if (marks) {
			const e = env.stg(g.i, 0.04, 0.35) * env.out;
			const d = size * 0.6;
			const h = size * 0.26;
			env.ln(x - h, y + d, x + h, y + d, acc, lw * 2, e * (1 - f));
			env.ln(x - sgn * d, y - h, x - sgn * d, y + h, acc, lw * 2, e * f);
		}
		env.put(g, { size, x, y, rot: 90 * sgn * f });
	}
}

/** 回転コピー — outlined copies of the line swing open around a pivot at the end of the solid line, and keep opening slowly. */
function drawPivotFan(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const dir = env.pick(1, ["up", "down", "both"]);
	const K = env.int(2, 4, 6);
	const step = env.range(3, 6.5, 10);
	const pv = env.pick(4, ["l", "l", "r"]);
	const style = env.pick(5, ["outline", "outline", "dim"]);
	const fb = env.fitBox(txt, W * (port ? 0.76 : 0.6), H * 0.26, 1.15, 0.02, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.2);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2 + (dir === "up" ? 1 : dir === "down" ? -1 : 0) * H * (port ? 0.1 : 0.15),
		lead: 1.15,
		track: 0.02,
		color: env.fg,
	};
	const m = env.measure(it);
	const sp = pv === "l" ? -1 : 1;
	const px = W / 2 + sp * (m.w / 2 + size * 0.2);
	const py = it.y;
	it.x -= sp * size * 0.1;
	const a = step * (0.15 + 0.85 * env.inE(0.8)) + lt * 0.45;
	let amax = 0;
	let amin = 0;
	const ctx = env.options.ctx;
	for (let k = K; k >= 1; k--) {
		const up = dir === "up" ? 1 : dir === "down" ? -1 : k % 2 ? 1 : -1;
		const mag = dir === "both" ? Math.ceil(k / 2) : k;
		const ang = up * mag * a * sp;
		amax = Math.max(amax, ang);
		amin = Math.min(amin, ang);
		const al = (0.85 - 0.11 * mag) * env.inC(0.4, 0.05 * mag) * env.out;
		if (al > 0.01) {
			ctx.save();
			ctx.translate(px, py);
			ctx.rotate(degrees(ang));
			ctx.translate(-px, -py);
			env.main({ ...it, ...env.copyStyle(style, size, al) });
			ctx.restore();
		}
	}
	const base0 = sp < 0 ? 0 : 180;
	if (amax - amin > 0.5) {
		env.arcS(px, py, size * 0.55, base0 + amin, base0 + amax, env.accentOn(), lw * 1.5, 0.8 * env.out);
	}
	env.disc(px, py, size * 0.05 * env.inE(0.3), env.accentOn(), env.out);
	env.main(it);
}

/** 回転ドラム — the line sits on the face of a slowly rolling drum; flattened copies curve away above and below. */
function drawDrum(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const dir = Number.parseInt(env.pick(1, ["1", "-1"]));
	const style = env.pick(2, ["outline", "dim", "outline"]);
	const rails = env.chance(3, 0.75);
	const K = port ? 3 : 2;
	const D = 27;
	const maxP = H * (K === 2 ? 0.215 : 0.185);
	const fb = env.fitBox(txt, W * 0.76, maxP * 0.72, 1.1, 0.03, port ? 2 : 1);
	const size = Math.min(fb.size, M * 0.2);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2,
		lead: 1.1,
		track: 0.03,
		color: env.fg,
	};
	const m = env.measure(it);
	const pitch = Math.min(maxP, m.h + size * 0.38);
	const Rd = pitch / Math.sin(degrees(D));
	const drift = ((lt / Math.max(0.5, env.dur)) - 0.5) * D * 0.7 * dir;
	const hw = m.w / 2 + size * 0.45;
	if (rails) {
		const e = env.inE(0.6);
		const top = H / 2 - Rd * 0.99 * e;
		const bot = H / 2 + Rd * 0.99 * e;
		for (const sx of [-1, 1]) {
			env.ln(W / 2 + sx * hw, top, W / 2 + sx * hw, bot, env.sub, lw * 1.2, 0.6 * env.out);
			for (let k = -8; k <= 8; k++) {
				const th = degrees(k * (D / 2) + drift);
				if (Math.abs(th) > 1.5) continue;
				const y = H / 2 + Rd * Math.sin(th) * e;
				const c = Math.cos(th);
				env.ln(W / 2 + sx * hw, y, W / 2 + sx * (hw + size * 0.12), y, env.sub, lw * 1.2, 0.7 * c * env.out);
			}
		}
	}
	for (let k = -K; k <= K; k++) {
		if (!k) continue;
		const th = degrees(k * D + drift);
		if (Math.abs(th) > 1.5) continue;
		const c = Math.cos(th);
		const al = c ** 1.2 * env.inC(0.4, Math.abs(k) * 0.07) * env.out;
		env.main({
			...it,
			y: H / 2 + Rd * Math.sin(th),
			sy: c,
			...env.copyStyle(style, size, al),
		});
	}
	const y0 = H / 2 + Rd * Math.sin(degrees(drift));
	const e = env.inE(0.5, 0.1);
	for (const s of [-1, 1]) {
		env.ln(W / 2 - hw * e, y0 + (s * pitch) / 2, W / 2 + hw * e, y0 + (s * pitch) / 2, env.accentOn(), lw * 1.5, env.out);
	}
	env.main({ ...it, y: y0, sy: Math.cos(degrees(drift)) });
}

/** じわ開き — the line starts tightly set and its letter-spacing keeps opening for the whole cut (or closes, the other way round). */
function drawSlowSpread(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const mode = env.pick(1, ["open", "open", "close"]);
	const dots = env.chance(2, 0.6);
	const arrows = env.chance(3, 0.7);
	const L = layRows(txt, W * 0.5, H * 0.6, {
		cap: M * 0.19,
		lead: 1.4,
		maxR: port ? 4 : 2,
		track: 0.03,
	});
	const size = L.size;
	const wmax = Math.max(...L.ws) * size;
	const fmax = Math.min(2.3, Math.max(1.15, (W * 0.87 - size) / Math.max(1, wmax - size)));
	const u = clamp01(lt / Math.max(0.6, env.dur * 0.9));
	const k0 = 0.35 * outCubic(u) + 0.65 * u;
	const k = mode === "close" ? 1 - k0 : k0;
	const f = env.lerpN(1, fmax, k);
	const acc = env.accentOn();
	const q = env.inE(0.4) * env.out;
	let prev: { x: number; r: number } | null = null;
	for (const g of L.g) {
		const x = W / 2 + g.ex * size * f;
		const y = H / 2 + g.ey * size;
		if (dots && prev && prev.r === g.r) {
			env.disc(
				(prev.x + x) / 2,
				y,
				Math.max(lw * 1.6, size * 0.022),
				env.sub,
				clamp01(((f - 1) / (fmax - 1)) * 1.6 - 0.15) * env.out,
			);
		}
		prev = { x, r: g.r };
		env.put(g, { size, x, y });
	}
	if (arrows) {
		L.ws.forEach((w, r) => {
			const y = H / 2 + (r - (L.R - 1) / 2) * L.lead * size;
			const hx = ((w * size - size) / 2) * f + size * 0.5 + size * 0.34;
			const a = size * 0.11;
			const d = mode === "close" ? -1 : 1;
			for (const s of [-1, 1]) {
				env.polyline(
					[
						[W / 2 + s * (hx - a * d), y - a],
						[W / 2 + s * hx, y],
						[W / 2 + s * (hx - a * d), y + a],
					],
					acc,
					lw * 2,
					q,
				);
			}
		});
	}
}

/** 曲がり道 — the glyphs follow a road that runs right, turns down and turns right again (reading never goes backwards). */
function drawBentRoad(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lt } = env;
	const road = env.pick(1, ["dim", "dim", "accent"]);
	const arrow = env.chance(2, 0.75);
	const sl = cellsOf(txt);
	const N = sl.length;
	let h1: number;
	let h2: number;
	let v: number;
	if (port) {
		h1 = Math.min(3, Math.max(1, Math.round(N * 0.2)));
		h2 = N >= 5 ? Math.min(3, Math.max(1, Math.round(N * 0.2))) : 0;
		v = N - h1 - h2;
	} else {
		v = Math.min(4, Math.max(1, Math.round(N * 0.22)));
		h1 = Math.ceil((N - v) / 2);
		h2 = N - v - h1;
	}
	const cols = h1 + h2;
	const rowsN = v + 1;
	const cell = Math.min((W * 0.86) / cols, (H * 0.8) / rowsN, M * 0.25);
	const size = cell * 0.82;
	const ox = W / 2 - ((cols - 1) * cell) / 2;
	const oy = H / 2 - ((rowsN - 1) * cell) / 2;
	const at = (s: number): [number, number] =>
		s < h1
			? [s, 0]
			: s < h1 + v
				? [h1 - 1, s - h1 + 1]
				: [h1 + (s - h1 - v), v];
	const XY = (c: readonly [number, number]): Pt => [ox + c[0] * cell, oy + c[1] * cell];
	const pts: Pt[] = [[ox - cell / 2, oy], XY([h1 - 1, 0]), XY([h1 - 1, v])];
	if (h2 > 0) {
		pts.push([ox + (cols - 1) * cell + cell / 2, oy + v * cell]);
	} else {
		pts[2] = [pts[2][0], pts[2][1] + cell / 2];
	}
	const e = inOutCubic(clamp01(lt / 0.6));
	const rc = road === "accent"
		? mixHex({ from: env.bg, progress: 0.32, to: env.accentOn() })
		: env.dim;
	env.polyPartial(pts, e, rc, cell * 0.96, env.out);
	if (arrow) {
		const end = pts[pts.length - 1];
		const hz = h2 > 0;
		const a = cell * 0.2;
		const q = outBack({ overshoot: 1.6, value: clamp01((lt - 0.45) / 0.3) }) * env.out;
		const g = cell * 0.12;
		if (q > 0.01) {
			env.polyF(
				hz
					? [
							[end[0] + g, end[1] - a * q],
							[end[0] + g + a * 1.1 * q, end[1]],
							[end[0] + g, end[1] + a * q],
						]
					: [
							[end[0] - a * q, end[1] + g],
							[end[0], end[1] + g + a * 1.1 * q],
							[end[0] + a * q, end[1] + g],
						],
				env.accentOn(),
				1,
			);
		}
		env.disc(pts[0][0] - cell * 0.14, pts[0][1], cell * 0.05 * env.inE(0.3), env.accentOn(), env.out);
	}
	sl.forEach((cellText, s) => {
		if (isSp(cellText)) return;
		const p = XY(at(s));
		env.main({
			text: cellText,
			size,
			sx: sqz(cellText),
			x: p[0],
			y: p[1],
		});
	});
}

/** 五線譜 — glyphs are set like notes at different heights on a five-line staff while a playhead crosses it. */
function drawStaff(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const play = env.chance(1, 0.75);
	const stems = env.chance(2, 0.65);
	const sig = env.chance(3, 0.6);
	const ph = env.range(4, 0, 6);
	const sl = cellsOf(txt);
	const N = sl.length;
	const R = port ? Math.min(4, Math.max(1, Math.ceil(N / 4.5))) : N > 9 ? 2 : 1;
	const per = Math.ceil(N / R);
	const sg = sig ? 1.5 : 0.7;
	const size = Math.min((W * 0.86) / (per * 1.2 + sg), (H * 0.8) / (R * 3.5), M * 0.2);
	const g = size / 2.5;
	const pitch = size * 1.2;
	const sw = per * pitch + sg * size;
	const left = W / 2 - sw / 2;
	const rowH = size * 3.5;
	const acc = env.accentOn();
	const col = env.subOn();
	for (let r = 0; r < R; r++) {
		const cy = H / 2 + (r - (R - 1) / 2) * rowH;
		const e = env.inE(0.6, r * 0.08);
		for (let k = 0; k < 5; k++) {
			env.ln(left, cy + (k - 2) * g, left + sw * e, cy + (k - 2) * g, col, lw * 1.2, 0.55 * env.out);
		}
		env.ln(left, cy - 2 * g, left, cy + 2 * g, col, lw * 1.5, 0.8 * env.out * e);
		if (e > 0.98) {
			env.ln(left + sw, cy - 2 * g, left + sw, cy + 2 * g, col, lw * (r === R - 1 ? 4 : 1.5), 0.8 * env.out);
			if (r === R - 1) {
				env.ln(left + sw - g * 0.45, cy - 2 * g, left + sw - g * 0.45, cy + 2 * g, col, lw * 1.2, 0.8 * env.out);
			}
		}
		if (sig && r === 0) {
			const a = env.inC(0.4, 0.15) * env.out;
			env.label(String(N), left + size * 0.5, cy - g, { alpha: a, color: col, size: g * 1.9, track: 0 });
			env.label("4", left + size * 0.5, cy + g, { alpha: a, color: col, size: g * 1.9, track: 0 });
		}
		for (let j = 0; j < per; j++) {
			const s = r * per + j;
			if (s >= N) break;
			const cell = sl[s];
			if (isSp(cell)) continue;
			const lv = Math.min(3, Math.max(-3, Math.round(2.6 * Math.sin(s * 1.25 + ph) + env.signed(s, 4))));
			const x = left + (sg - 0.1) * size + (j + 0.5) * pitch;
			const y = cy - lv * g * 0.5;
			if (stems) {
				const up = lv <= 0;
				const q = env.stg(s, 0.04, 0.35) * env.out;
				const sx = x + (up ? 1 : -1) * size * 0.5;
				env.ln(sx, y, sx, y + (up ? -1 : 1) * size * 0.95 * q, env.fg, lw * 1.6, 0.7 * env.out);
			}
			env.main({ text: cell, size, sx: sqz(cell), x, y });
		}
	}
	if (play) {
		const u = clamp01(lt / Math.max(0.5, env.dur)) * R;
		const r = Math.min(R - 1, Math.floor(u));
		const f = u - r;
		const cy = H / 2 + (r - (R - 1) / 2) * rowH;
		const x = left + sw * clamp01(f);
		env.ln(x, cy - 3.2 * g, x, cy + 3.2 * g, acc, lw * 2, 0.9 * env.out * env.inC(0.3));
		env.polyF(
			[
				[x - g * 0.4, cy - 3.9 * g],
				[x + g * 0.4, cy - 3.9 * g],
				[x, cy - 3.2 * g],
			],
			acc,
			env.out * env.inC(0.3),
		);
	}
}

/** 重なり連鎖 — big glyphs overlap each other like chain links; a background-coloured edge keeps every glyph legible and the spacing breathes. */
function drawOverlap(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lt } = env;
	const ov = env.range(1, 0.22, 0.32);
	const cols = env.pick(2, ["alt", "alt", "mono", "tri"]);
	const breathe = env.chance(3, 0.75);
	const order = env.pick(4, ["fwd", "fwd", "rev"]);
	const L = layRows(txt, W * 0.82, H * 0.6, {
		cap: M * 0.36,
		lead: 1.0,
		maxR: port ? 4 : 2,
		spw: 0.6,
		track: -ov,
	});
	const size = L.size;
	const f = breathe ? 1 + 0.045 * Math.sin(lt * 1.1) : 1;
	const acc = env.accentOn();
	const colOf = (i: number) =>
		cols === "mono"
			? env.fg
			: cols === "alt"
				? i % 2
					? acc
					: env.fg
				: [env.fg, acc, env.subOn()][i % 3];
	const gs = order === "rev" ? L.g.slice().reverse() : L.g;
	for (const g of gs) {
		env.put(g, {
			size,
			x: W / 2 + g.ex * size * f,
			y: H / 2 + g.ey * size,
			color: colOf(g.i),
			stroke: size * 0.075,
			strokeColor: env.bg,
			strokeUnder: true,
		});
	}
}

/** 巡回ずらし — the line with its cyclic shifts above and below (ABCD / BCDA / CDAB …); the shifted rows step one glyph further at intervals. */
function drawCyclic(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, txt, lw, lt } = env;
	const style = env.pick(1, ["dim", "outline", "dim"]);
	const move = env.chance(2, 0.75);
	const per = env.range(3, 1.0, 1.6);
	const dir = Number.parseInt(env.pick(4, ["1", "-1"]));
	const marks = env.chance(5, 0.7);
	const sl = cellsOf(txt);
	const N = sl.length;
	const R = N >= 5 ? 5 : 3;
	let cw = Math.min((W * 0.86) / N, M * 0.22);
	let chh = cw * 1.2;
	if (R * chh > H * 0.8) {
		chh = (H * 0.8) / R;
		cw = chh / 1.2;
	}
	const size = Math.min(cw, chh) * 0.84;
	const mid = (R - 1) / 2;
	const u = Math.max(0, lt - 0.6) / per;
	const c = move ? Math.floor(u) + inOutCubic(clamp01(frac(u) * 2.6 - 1.6)) : 0;
	const XY = (a: number, k: number): Pt => [
		W / 2 + (a - (N - 1) / 2) * cw,
		H / 2 + k * chh,
	];
	for (let r = 0; r < R; r++) {
		const k = r - mid;
		if (!k) continue;
		const ra = (0.62 - 0.17 * (Math.abs(k) - 1)) * env.inC(0.4, 0.08 * Math.abs(k)) * env.out;
		if (ra <= 0.01) continue;
		const o = k * (1 + c) * dir;
		const stl = env.copyStyle(style, size, 1);
		sl.forEach((cell, s) => {
			if (isSp(cell)) return;
			const col = (((s + o) % N) + N) % N;
			const over = clamp01(col - (N - 1));
			const one = (a: number, al: number) => {
				if (al <= 0.01) return;
				const p = XY(a, k);
				env.main({
					text: cell,
					size,
					sx: sqz(cell),
					x: p[0],
					y: p[1],
					...stl,
					alpha: (stl.alpha ?? 1) * ra * al,
				});
			};
			one(col - over * 0.6, 1 - over);
			if (over > 0) one(-0.4 + over * 0.4, over);
		});
	}
	if (marks) {
		const e = env.inE(0.5);
		const a0 = XY(-0.62, 0);
		const a1 = XY(N - 0.38, 0);
		const acc = env.accentOn();
		for (const s of [-1, 1]) {
			env.ln(
				a0[0],
				H / 2 + s * chh * 0.5,
				env.lerpN(a0[0], a1[0], e),
				H / 2 + s * chh * 0.5,
				acc,
				lw * 1.6,
				env.out,
			);
		}
	}
	sl.forEach((cell, s) => {
		if (isSp(cell)) return;
		const p = XY(s, 0);
		env.main({ text: cell, size, sx: sqz(cell), x: p[0], y: p[1] });
	});
}

/** カラオケ送り — the line waits as an outline and fills with colour from left to right over the length of the cut, like a karaoke subtitle. */
function drawKaraoke(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const un = env.pick(1, ["outline", "dim", "outline"]);
	const bar = env.chance(2, 0.6);
	const clock = env.chance(3, 0.6);
	const col = env.pick(4, ["accent", "accent", "fg"]);
	const fb = env.fitBox(txt, W * 0.84, H * 0.5, 1.3, 0.03, port ? 4 : 2);
	const size = Math.min(fb.size, M * 0.3);
	const lines = fb.text.split("\n");
	const LN = lines.length;
	const cnt = lines.map((l) => Math.max(1, env.glyphCountOf(l)));
	const total = cnt.reduce((a, b) => a + b, 0);
	const t0 = Math.min(0.35, env.dur * 0.25) * 0.6;
	const p =
		clamp01((lt - t0) / Math.max(0.3, env.dur - t0 - 0.3 - 0.12)) * total;
	const acc = env.accentOn();
	const dim = un === "dim";
	const sung = col === "accent" && acc !== env.fg ? acc : env.fg;
	const unCol = dim ? mixHex({ from: env.bg, progress: 0.34, to: env.fg }) : env.fg;
	let at = 0;
	let barAt: [number, number] | null = null;
	lines.forEach((l, i) => {
		const y = H / 2 + (i - (LN - 1) / 2) * size * 1.3;
		const w = textWidth(l, size, 0.03);
		const pl = clamp01((p - at) / cnt[i]);
		const xs = W / 2 - w / 2 - size * 0.05 + (w + size * 0.1) * pl;
		at += cnt[i];
		if (pl > 0 && pl < 1) barAt = [xs, y];
		if (pl < 1) {
			env.clipRect(xs, -H, W * 3, H * 3, () => {
				env.main(
					dim
						? { text: l, size, x: W / 2, y, track: 0.03, color: unCol }
						: {
								text: l,
								size,
								x: W / 2,
								y,
								track: 0.03,
								color: env.fg,
								fill: false,
								stroke: Math.max(1.5, size * 0.022),
								strokeColor: unCol,
							},
				);
			});
		}
		if (pl > 0) {
			env.clipRect(-W, -H, xs + W, H * 3, () => {
				env.main({ text: l, size, x: W / 2, y, track: 0.03, color: sung });
			});
		}
	});
	if (bar && barAt) {
		env.rc(barAt[0] - lw * 1.5, barAt[1] - size * 0.6, lw * 3, size * 1.2, acc, env.out);
	}
	if (clock) {
		const fmt = (t: number) =>
			Math.floor(t / 60) +
			":" +
			String(Math.floor(t % 60)).padStart(2, "0") +
			"." +
			Math.floor((t * 10) % 10);
		env.label(
			fmt(Math.min(lt, env.dur)) + " / " + fmt(env.dur),
			W / 2,
			H / 2 + (LN / 2) * size * 1.3 + env.ls * 1.6,
			{ alpha: env.inC(0.4, 0.1) * env.out, color: env.subOn() },
		);
	}
}

/** すれ違い — the line is split into rows that slide slowly past each other in opposite directions for the whole cut. */
function drawPassing(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const travel = env.range(1, 0.08, 0.12);
	const rails = env.chance(2, 0.75);
	const dir = Number.parseInt(env.pick(3, ["1", "-1"]));
	const accHot = env.chance(4, 0.35);
	const n = env.glyphCountOf(txt);
	const T = travel * W;
	let lines: string[] | null = null;
	let size = 0;
	for (let k = 2; k <= (port && n > 6 ? 4 : 2); k++) {
		const ls = linesOfText(txt, k).split("\n");
		const s = Math.min(
			...ls.map((l) => env.fitSizeOf(l, W * 0.9 - T, H * 0.3, 1.2, 0.03)),
			M * 0.25,
			(H * 0.7) / (ls.length * 1.5),
		);
		if (!lines || s > size * 1.04) {
			lines = ls;
			size = s;
		}
	}
	const rows = lines ?? [txt];
	const Rn = rows.length;
	const pitch = size * 1.5;
	const u = clamp01(lt / Math.max(0.5, env.dur)) - 0.5;
	const acc = env.accentOn();
	const e = env.inE(0.6);
	rows.forEach((l, i) => {
		const sg = (i % 2 ? -1 : 1) * dir;
		const y = H / 2 + (i - (Rn - 1) / 2) * pitch;
		if (rails) {
			const ry = y + size * 0.68;
			const x0 = W * 0.05;
			const x1 = W * 0.95;
			const a = size * 0.07;
			env.ln(
				sg > 0 ? x0 : x1,
				ry,
				sg > 0 ? env.lerpN(x0, x1, e) : env.lerpN(x1, x0, e),
				ry,
				env.subOn(),
				lw * 1.2,
				0.6 * env.out,
			);
			for (let k = 0; k < 4; k++) {
				const x = x0 + frac(k / 4 + sg * env.ltb * 0.09) * (x1 - x0);
				const al = Math.sin((Math.PI * (x - x0)) / (x1 - x0)) * e * env.out;
				if (al > 0.01) {
					env.polyline(
						[
							[x - sg * a, ry - a],
							[x, ry],
							[x - sg * a, ry + a],
						],
						acc,
						lw * 1.6,
						al,
					);
				}
			}
		}
		env.main({
			text: l,
			size,
			x: W / 2 + sg * u * T,
			y,
			track: 0.03,
			color: accHot && i === 1 ? acc : env.fg,
		});
	});
}

/** チェッカー — glyphs take the light squares of a checkerboard; the other squares are solid blocks that pop in and blink. */
function drawChecker(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, txt, lw, lt } = env;
	const sq = env.pick(1, ["solid", "solid", "outline", "dot"]);
	const col = env.pick(2, ["fg", "accent", "dim"]);
	const start = Number.parseInt(env.pick(3, ["0", "0", "1"]));
	const blink = env.chance(4, 0.65);
	const gl = visibleCells(txt);
	const n = gl.length;
	let best: { C: number; R: number; cell: number; score: number } | null = null;
	for (let C = 2; C <= 9; C++) {
		for (let R = 1; R <= 9; R++) {
			const cap = start === 0 ? Math.ceil((C * R) / 2) : Math.floor((C * R) / 2);
			if (cap < n) continue;
			const cell = Math.min((W * 0.86) / C, (H * 0.8) / R, M * 0.3);
			const score = cell * (1 - 0.07 * (cap - n)) * (R === 1 ? 0.8 : 1);
			if (!best || score > best.score) best = { C, R, cell, score };
		}
	}
	const C = best?.C ?? 4;
	const R = best?.R ?? 2;
	const cell = best?.cell ?? 10;
	const ox = W / 2 - (C * cell) / 2;
	const oy = H / 2 - (R * cell) / 2;
	const size = cell * 0.8;
	const pc = col === "accent" ? env.accentOn() : col === "dim" ? mixHex({ from: env.bg, progress: 0.3, to: env.fg }) : env.fg;
	const acc = col === "accent" ? env.fg : env.accentOn();
	const blocks: { x: number; y: number; d: number }[] = [];
	let gi = 0;
	for (let r = 0; r < R; r++) {
		for (let c = 0; c < C; c++) {
			const x = ox + (c + 0.5) * cell;
			const y = oy + (r + 0.5) * cell;
			if ((r + c) % 2 === start) {
				if (gi < n) {
					env.main({ text: gl[gi], size, sx: sqz(gl[gi]), x, y });
					gi++;
				}
			} else {
				blocks.push({ x, y, d: r + c });
			}
		}
	}
	const hot = blink && blocks.length ? env.hash(Math.floor(lt / 0.55), 3) % blocks.length : -1;
	blocks.forEach((b, k) => {
		const e =
			outBack({ overshoot: 1.5, value: clamp01((lt - b.d * 0.035) / 0.32) }) *
			(1 - inCubic(env.options.frame.exitProgress));
		const h = cell * 0.46 * e;
		const on = k === hot && lt > 0.6;
		const color = on ? acc : pc;
		if (e <= 0.01) return;
		if (sq === "dot") env.disc(b.x, b.y, h * 0.86, color, 1);
		else if (sq === "outline") env.ringRect(b.x, b.y, h, color, lw * 2, 1);
		else env.rc(b.x - h, b.y - h, h * 2, h * 2, color, 1);
	});
}

/** 矩形波 — glyphs sit on the high and low levels of a square-wave signal that keeps travelling, so they step up and down in turn. */
function drawSquareWave(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw } = env;
	const wl = Number.parseInt(env.pick(1, ["2", "4", "4", "6"]));
	const speed = env.range(2, 0.1, 0.2) * (env.chance(3, 0.5) ? 1 : -1);
	const line = env.chance(4, 0.85);
	const amp = env.range(5, 0.36, 0.44);
	const bits = env.chance(6, 0.6);
	const n0 = env.glyphCountOf(txt);
	const L = layRows(txt, W * 0.8, H * 0.76, {
		cap: M * 0.19,
		lead: 2.35,
		maxR: port ? 4 : n0 > 10 ? 2 : 1,
		mono: 1.12,
		spw: 1.12,
	});
	const size = L.size;
	const sg = (xc: number) =>
		Math.min(1, Math.max(-1, Math.sin(TAU * (xc / wl - env.ltb * speed) + 0.4) * 6));
	const acc = env.accentOn();
	if (line) {
		for (let r = 0; r < L.R; r++) {
			const y = H / 2 + (r - (L.R - 1) / 2) * L.lead * size;
			const w = L.ws[r];
			const pts: Pt[] = [];
			const K = Math.min(160, Math.ceil((w / 1.12) * 10) + 10);
			for (let k = 0; k <= K; k++) {
				const xe = -w / 2 - 0.5 + ((w + 1) * k) / K;
				pts.push([
					W / 2 + xe * size,
					y - sg((xe + w / 2) / 1.12 - 0.5 + r * 1.7) * size * 0.15,
				]);
			}
			env.polyPartial(pts, env.inE(0.7, r * 0.08), acc, lw * 2, 0.9 * env.out);
			if (bits) {
				const a = env.inC(0.4, 0.2) * env.out;
				const x = W / 2 - (w / 2 + 0.85) * size;
				env.label("1", x, y - amp * size, { alpha: a });
				env.label("0", x, y + amp * size, { alpha: a });
			}
		}
	}
	for (const g of L.g) {
		const w = L.ws[g.r];
		const s = sg((g.ex + w / 2) / 1.12 - 0.5 + g.r * 1.7);
		env.put(g, {
			size,
			x: W / 2 + g.ex * size,
			y: H / 2 + g.ey * size + s * amp * size,
		});
	}
}

/** 軸振り分け — glyphs branch off a centre axis alternately to either side (above / below, or left / right in portrait); a marker runs along the axis. */
function drawAxisAlt(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const first = Number.parseInt(env.pick(1, ["1", "-1"]));
	const marker = env.chance(2, 0.75);
	const nums = env.chance(3, 0.4);
	const sl = cellsOf(txt);
	const N = sl.length;
	const K = 1.0;
	const size = port
		? Math.min((H * 0.84) / ((N - 1) * K + 1), W * 0.28)
		: Math.min((W * 0.86) / ((N - 1) * K + 1), H * 0.27, M * 0.26);
	const pitch = size * K;
	const off = size * 0.62;
	const acc = env.accentOn();
	const col = env.subOn();
	const A = (s: number) => (s - (N - 1) / 2) * pitch;
	const P2 = (a: number, d: number): Pt => (port ? [W / 2 + d, H / 2 + a] : [W / 2 + a, H / 2 + d]);
	const e = env.inE(0.7);
	const a0 = A(-0.9);
	const a1 = env.lerpN(a0, A(N - 0.1), e);
	const p0 = P2(a0, 0);
	const p1 = P2(a1, 0);
	env.ln(p0[0], p0[1], p1[0], p1[1], col, lw * 1.6, 0.85 * env.out);
	if (e > 0.9) {
		const h = size * 0.07;
		const q = P2(a1 - h * 1.4, h);
		const q2 = P2(a1 - h * 1.4, -h);
		env.polyline([q, p1, q2], col, lw * 1.6, 0.85 * env.out);
	}
	let gi = 0;
	sl.forEach((cell, s) => {
		if (isSp(cell)) return;
		const side = first * (s % 2 ? -1 : 1);
		const nd = P2(A(s), 0);
		const gp = P2(A(s), side * off);
		const st0 = P2(A(s), side * size * 0.13);
		const q = env.stg(s, 0.04, 0.35) * env.out;
		env.ln(nd[0], nd[1], env.lerpN(nd[0], st0[0], q), env.lerpN(nd[1], st0[1], q), col, lw * 1.2, 0.8 * env.out);
		env.disc(nd[0], nd[1], size * 0.035 * q, env.fg, 1);
		if (nums) {
			const np = P2(A(s), -side * size * 0.17);
			env.label(String(gi + 1).padStart(2, "0"), np[0], np[1], {
				alpha: q * 0.9,
				size: size * 0.11,
			});
		}
		env.main({
			text: cell,
			size,
			sx: sqz(cell),
			x: gp[0],
			y: gp[1],
		});
		gi++;
	});
	if (marker) {
		const u = clamp01(lt / Math.max(0.5, env.dur));
		const m = P2(env.lerpN(A(-0.5), A(N - 0.5), u), 0);
		env.ringS(m[0], m[1], size * 0.085, acc, lw * 2.2, env.inC(0.3, 0.2) * env.out);
	}
}

/** 回転コピー対 — like a playing card: the line upright in one half and a copy turned 180° about the screen centre in the other. */
function drawPointSym(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw } = env;
	const mode = env.pick(1, ["tb", "tb", "corner"]);
	const copy = env.pick(2, ["outline", "dim", "lines"]);
	const mark = env.pick(3, ["diamond", "dot"]);
	const corner = mode === "corner";
	const fb = env.fitBox(
		txt,
		W * (corner ? 0.62 : 0.8),
		H * (corner ? 0.3 : 0.31),
		1.15,
		0.02,
		port ? 4 : 2,
	);
	const size = Math.min(fb.size, M * 0.26);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2,
		align: "center" as "left" | "center" | "right",
		lead: 1.15,
		track: 0.02,
		color: env.fg,
	};
	const m = env.measure(it);
	const acc = env.accentOn();
	if (corner) {
		it.align = "left";
		it.x = W * 0.07;
		it.y = H * 0.08 + m.h / 2;
	} else {
		it.y = H / 2 - m.h / 2 - Math.max(size * 0.32, H * 0.04);
	}
	const sw = env.inE(0.8, 0.05);
	const al = env.inC(0.4, 0.05) * env.out;
	if (al > 0.01) {
		const ctx = env.options.ctx;
		ctx.save();
		ctx.translate(W / 2, H / 2);
		ctx.rotate(Math.PI * sw);
		ctx.translate(-W / 2, -H / 2);
		env.main({ ...it, ...env.copyStyle(copy, size, al) });
		ctx.restore();
	}
	const e = env.inE(0.6, 0.1);
	const r = M * 0.016 * e;
	if (corner) {
		const dx = W * 0.5 - (it.x + m.w);
		const dy = H * 0.5 - (it.y + m.h / 2);
		const k = 0.55;
		env.ln(
			W / 2 - dx * k * e,
			H / 2 - dy * k * e,
			W / 2 + dx * k * e,
			H / 2 + dy * k * e,
			env.subOn(),
			lw * 1.2,
			0.6 * env.out,
		);
	} else {
		for (const s of [-1, 1]) {
			env.ln(
				W / 2 + s * r * 2.2,
				H / 2,
				W / 2 + s * (r * 2.2 + W * 0.3 * e),
				H / 2,
				env.subOn(),
				lw * 1.2,
				0.6 * env.out,
			);
		}
	}
	if (mark === "dot") {
		env.disc(W / 2, H / 2, r * 0.8, acc, env.out);
	} else {
		env.polyF(
			[
				[W / 2 - r, H / 2],
				[W / 2, H / 2 - r * 1.4],
				[W / 2 + r, H / 2],
				[W / 2, H / 2 + r * 1.4],
			],
			acc,
			env.out,
		);
	}
	env.main(it);
}

/** なびく字 — every glyph stands on the ground line and leans with a gust that travels along the line, like grass in the wind. */
function drawWindSway(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw } = env;
	const amp = env.range(1, 11, 18);
	const speed = env.range(2, 1.2, 1.9);
	const dir = Number.parseInt(env.pick(3, ["1", "-1"]));
	const streaks = env.chance(4, 0.7);
	const ground = env.chance(5, 0.75);
	const L = layRows(txt, W * 0.78, H * 0.58, {
		cap: M * 0.26,
		lead: 1.5,
		maxR: port ? 4 : 2,
		track: 0.07,
	});
	const size = L.size;
	const t = env.ltb;
	const gust = 0.7 + 0.3 * Math.sin(t * 0.7 + (env.seed % 7));
	if (ground) {
		L.ws.forEach((w, r) => {
			const y = H / 2 + (r - (L.R - 1) / 2) * L.lead * size + size * 0.56;
			const e = env.inE(0.6, r * 0.06);
			const hw = (w / 2 + 0.3) * size;
			env.ln(W / 2 - hw * e, y, W / 2 + hw * e, y, env.subOn(), lw * 1.4, 0.7 * env.out);
		});
	}
	if (streaks) {
		for (let k = 0; k < 4; k++) {
			const u = frac(t * 0.16 * (0.8 + 0.3 * env.unit(k, 2)) + env.unit(k, 1));
			const x = W * (dir > 0 ? -0.1 + 1.2 * u : 1.1 - 1.2 * u);
			const y = H * (0.16 + 0.68 * env.unit(k, 3));
			const len = W * (0.05 + 0.06 * env.unit(k, 4));
			env.ln(x, y, x + len, y, env.sub, lw * 1.2, 0.4 * Math.sin(Math.PI * u) * env.inC(0.5) * env.out);
		}
	}
	for (const g of L.g) {
		const sk =
			dir *
			amp *
			gust *
			(0.3 +
				0.7 * (0.5 + 0.5 * Math.sin(t * speed - dir * g.j * 0.55 + g.r * 1.3)));
		const tn = Math.tan(degrees(-sk));
		env.put(g, {
			size,
			x: W / 2 + g.ex * size - tn * size * 0.5,
			y: H / 2 + g.ey * size,
			skew: -sk,
		});
	}
}

/** 動く影 — the line casts a long shadow on the ground; a small sun crosses the sky during the cut and the shadow swings round with it. */
function drawSunShadow(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const dir = Number.parseInt(env.pick(1, ["1", "-1"]));
	const sun = env.chance(2, 0.75);
	const style = env.pick(3, ["fill", "fill", "lines"]);
	const fb = env.fitBox(txt, W * 0.7, H * 0.28, 1.12, 0.02, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.24);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H * 0.43,
		lead: 1.12,
		track: 0.02,
		color: env.fg,
	};
	const m = env.measure(it);
	const by = it.y + m.h / 2 - size * 0.04;
	const u = clamp01(lt / Math.max(0.5, env.dur));
	const sh = dir * env.lerpN(1.15, 0.3, u);
	const len = 0.5 + 0.34 * Math.abs(sh);
	const a = env.inC(0.5) * env.out;
	const e = env.inE(0.6);
	const gw = Math.min(W * 0.45, m.w / 2 + size * 1.2);
	env.ln(W / 2 - gw * e, by, W / 2 + gw * e, by, env.subOn(), lw * 1.4, 0.7 * env.out);
	if (a > 0.01) {
		const ctx = env.options.ctx;
		ctx.save();
		ctx.transform(1, 0, -sh, -len, sh * by, by * (1 + len));
		env.main({
			...it,
			color:
				style === "lines"
					? mixHex({ from: env.bg, progress: 0.4, to: env.fg })
					: mixHex({ from: env.bg, progress: 0.27, to: env.fg }),
			alpha: a,
		});
		ctx.restore();
	}
	if (sun) {
		const Rs = by - H * 0.09;
		const rx = Math.min(Rs, W * 0.42);
		const ph = -sh * 50 * degrees(1);
		const acc = env.accentOn();
		const sx = W / 2 + Math.sin(ph) * rx;
		const sy = by - Math.cos(ph) * Rs;
		const r = M * 0.02 * env.inE(0.4, 0.1);
		for (let k = -6; k <= 6; k++) {
			const p2 = k * 8.5 * degrees(1);
			env.disc(
				W / 2 + Math.sin(p2) * rx,
				by - Math.cos(p2) * Rs,
				lw * 1.3,
				env.sub,
				0.45 * env.inC(0.5, 0.03 * (k + 6)) * env.out,
			);
		}
		env.disc(sx, sy, r, acc, env.out);
		env.ringS(sx, sy, r * 1.9, acc, lw * 1.4, 0.6 * env.out);
	}
	env.main(it);
}

/** 斜体の残像 — outlined copies lean further and further from the same baseline, like the afterimages of a line falling into italics. */
function drawSkewSweep(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const dir = Number.parseInt(env.pick(1, ["1", "-1"]));
	const K = env.int(2, 4, 6);
	const total = env.range(3, 36, 50);
	const style = env.pick(4, ["outline", "outline", "dim"]);
	const fb = env.fitBox(txt, W * (port ? 0.7 : 0.6), H * 0.3, 1.15, 0.02, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.24);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2,
		lead: 1.15,
		track: 0.02,
		color: env.fg,
	};
	const m = env.measure(it);
	const by = it.y + m.h / 2 - size * 0.05;
	it.x = W / 2 - dir * Math.min(m.h * 0.3, W * 0.06);
	const a = (total / K) * (0.12 + 0.88 * env.inE(0.8)) * (0.86 + 0.14 * Math.sin(lt * 0.9));
	const ctx = env.options.ctx;
	for (let k = K; k >= 1; k--) {
		const sk = Math.tan(degrees(k * a)) * dir;
		const al = (0.9 - 0.12 * k) * env.inC(0.4, 0.04 * k) * env.out;
		if (al > 0.01) {
			ctx.save();
			ctx.transform(1, 0, -sk, 1, sk * by, 0);
			env.main({ ...it, ...env.copyStyle(style, size, al) });
			ctx.restore();
		}
	}
	const e = env.inE(0.6);
	const hw = m.w / 2 + size * 0.3;
	env.ln(it.x - hw * e, by + size * 0.08, it.x + hw * e, by + size * 0.08, env.accentOn(), lw * 2, env.out);
	env.main(it);
}

/** 縦伸びエコー — outlined copies of the line are pulled taller and taller from the same foot (or the same middle) and breathe. */
function drawStretchEcho(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lt } = env;
	const mode = env.pick(1, ["up", "up", "both"]);
	const K = env.int(2, 3, 4);
	const q = env.range(3, 0.42, 0.58);
	const style = env.pick(4, ["outline", "outline", "dim"]);
	const maxSy = 1 + K * q;
	const fb = env.fitBox(txt, W * 0.84, (H * 0.7) / maxSy, 1.08, 0.03, port ? 3 : 1);
	const size = Math.min(fb.size, M * 0.2);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2,
		lead: 1.08,
		track: 0.03,
		color: env.fg,
	};
	const m = env.measure(it);
	const up = mode === "up";
	const by = H / 2 + (m.h * maxSy) / 2;
	for (let k = K; k >= 1; k--) {
		const sy =
			1 +
			k * q * env.inE(0.7, k * 0.06) * (1 + 0.06 * Math.sin(lt * 1.3 + k * 0.9));
		const al = (0.85 - 0.15 * k) * env.inC(0.3, k * 0.05) * env.out;
		if (al > 0.01) {
			env.main({
				...it,
				sy,
				y: up ? by - (m.h * sy) / 2 : H / 2,
				...env.copyStyle(style, size, al),
			});
		}
	}
	if (up) it.y = by - m.h / 2;
	env.main(it);
}

/** 縦こだま — every glyph keeps sending small outlined echoes of itself away from the line — odd glyphs one way, even glyphs the other. */
function drawColumnEcho(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt } = env;
	const speed = env.range(1, 0.22, 0.36);
	const style = env.pick(2, ["outline", "outline", "dim"]);
	const mode = env.pick(3, ["alt", "alt", "pair"]);
	const sl = cellsOf(txt);
	const N = sl.length;
	const K = 3;
	const pk = 1.08;
	const size = port
		? Math.min((H * 0.82) / (N * pk), W * 0.165)
		: Math.min((W * 0.86) / (N * pk), H * 0.165, M * 0.2);
	const XY = (s: number, d: number): Pt =>
		port
			? [W / 2 + d, H / 2 + (s - (N - 1) / 2) * size * pk]
			: [W / 2 + (s - (N - 1) / 2) * size * pk, H / 2 + d];
	const q = env.inC(0.5, 0.15) * env.out;
	let gi = 0;
	sl.forEach((cell, s) => {
		if (isSp(cell)) return;
		const i = gi++;
		const sgn = (mode === "alt" ? i % 2 : (i >> 1) % 2) ? 1 : -1;
		if (q > 0.01) {
			for (let k = 0; k < K; k++) {
				const u = k + frac(env.ltb * speed + i * 0.37);
				const d = size * (0.3 + 0.6 * u);
				const al = (1 - u / K) * clamp01(u * 2.2) * q;
				if (al <= 0.01) continue;
				const p = XY(s, sgn * d);
				env.main({
					text: cell,
					size: size * (1 - 0.1 * u),
					sx: sqz(cell),
					x: p[0],
					y: p[1],
					...env.copyStyle(style, size, al),
				});
			}
		}
		const p = XY(s, 0);
		env.main({ text: cell, size, sx: sqz(cell), x: p[0], y: p[1] });
	});
}

/** 伸び縮み — glyphs stand on a ground line and are stretched to different heights like a skyline that keeps changing. */
function drawSkyline(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw } = env;
	const mode = env.pick(1, ["wave", "wave", "rand"]);
	const A = env.range(2, 0.8, 1.25);
	const speed = env.range(3, 0.8, 1.3);
	const sxP = Number.parseFloat(env.pick(4, ["0.82", "0.9", "1"]));
	const ground = env.chance(5, 0.8);
	const n0 = env.glyphCountOf(txt);
	const rowK = 1 + A;
	const lead = rowK + 0.32;
	const L = layRows(txt, (W * 0.84) / sxP, H * 0.78, {
		cap: M * 0.2,
		lead,
		maxR: port ? 3 : n0 > 9 ? 2 : 1,
		track: 0.03,
	});
	const size = L.size;
	const t = env.ltb;
	const top = H / 2 - ((L.R * lead - 0.32) * size) / 2;
	const lvl = (g: RowGlyph) =>
		mode === "wave"
			? 0.5 + 0.5 * Math.sin(t * speed * 1.6 - g.i * 0.95)
			: 0.5 +
				0.27 * Math.sin(t * speed * 1.9 + env.unit(g.i, 1) * 6.3) +
				0.23 * Math.sin(t * speed * 1.1 + env.unit(g.i, 2) * 6.3);
	if (ground) {
		L.ws.forEach((w, r) => {
			const y = top + r * lead * size + rowK * size + size * 0.07;
			const e = env.inE(0.6, r * 0.06);
			const hw = ((w * sxP) / 2 + 0.2) * size;
			env.ln(W / 2 - hw * e, y, W / 2 + hw * e, y, env.accentOn(), lw * 2.4, env.out);
		});
	}
	for (const g of L.g) {
		const sy = 1 + A * lvl(g);
		const by = top + g.r * lead * size + rowK * size;
		env.put(g, {
			size,
			sx: sxP,
			sy,
			x: W / 2 + g.ex * size * sxP,
			y: by - (size * sy) / 2,
		});
	}
}

/** 渦巻きコピー — copies of the line turn and shrink around a pivot below it, winding into a nautilus-like spiral. */
function drawSpiralEcho(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lt } = env;
	const dir = Number.parseInt(env.pick(1, ["1", "-1"]));
	const K = env.int(2, 6, 8);
	const th = env.range(3, 17, 24);
	const q = env.range(4, 0.8, 0.85);
	const style = env.pick(5, ["outline", "outline", "dim"]);
	const fb = env.fitBox(txt, W * (port ? 0.74 : 0.5), H * 0.2, 1.12, 0.02, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.19);
	const it = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2,
		lead: 1.12,
		track: 0.02,
		color: env.fg,
	};
	const m = env.measure(it);
	const r0 = Math.max(m.h * 1.25, Math.min(H * 0.26, m.w * 0.5));
	it.y = H / 2 - r0 * 0.5;
	it.x = W / 2 - dir * m.w * 0.12;
	const px = it.x - dir * m.w * 0.16;
	const py = it.y + r0;
	const open = (0.15 + 0.85 * env.inE(0.9)) * (1 + 0.07 * Math.sin(lt * 0.8));
	const ctx = env.options.ctx;
	for (let k = K; k >= 1; k--) {
		const al = (0.9 - 0.09 * k) * env.inC(0.4, 0.04 * k) * env.out;
		const sc2 = q ** k;
		if (al > 0.01) {
			ctx.save();
			ctx.translate(px, py);
			ctx.rotate(dir * k * th * open * degrees(1));
			ctx.scale(sc2, sc2);
			ctx.translate(-px, -py);
			env.main({ ...it, ...env.copyStyle(style, size, al) });
			ctx.restore();
		}
	}
	env.disc(px, py, size * 0.045 * env.inE(0.3), env.accentOn(), env.out);
	env.main(it);
}

/** 波紋の字 — loosely spaced glyphs, each the centre of thin rings that keep spreading like drops on water. */
function drawRipple(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw } = env;
	const shape = env.pick(1, ["ring", "ring", "square"]);
	const sync = env.pick(2, ["wave", "rand"]);
	const speed = env.range(3, 0.32, 0.5);
	const K = Number.parseInt(env.pick(4, ["2", "3"]));
	const L = layRows(txt, W * 0.76, H * 0.6, {
		cap: M * 0.19,
		lead: 1.62,
		maxR: port ? 5 : 3,
		mono: 1,
		track: 0.34,
	});
	const size = L.size;
	const q = env.inC(0.6, 0.1) * env.out;
	const col = env.subOn();
	for (const g of L.g) {
		const x = W / 2 + g.ex * size;
		const y = H / 2 + g.ey * size;
		const ph = sync === "wave" ? -g.i * 0.14 : env.unit(g.i, 5);
		if (q > 0.01) {
			for (let k = 0; k < K; k++) {
				const u = frac(env.ltb * speed + k / K + ph);
				const r = size * (0.5 + 0.62 * u);
				const a = (1 - u) ** 1.2 * clamp01(u * 5) * 0.95 * q;
				if (shape === "ring") env.ringS(x, y, r, col, lw * 2, a);
				else env.ringRect(x, y, r, col, lw * 2, a);
			}
		}
		env.put(g, { size, x, y });
	}
}

/** 四面刷り — the line printed four times in a grid — once solid, the others outlined, striped and dotted, and the fills keep swapping. */
function drawFourUp(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, txt, lw, lt } = env;
	const mainIndex = env.int(1, 0, 3);
	const cyc = env.chance(2, 0.65);
	const cross = env.chance(3, 0.8);
	const rot = env.int(4, 0, 3);
	const per = env.range(5, 0.7, 1.1);
	const n = env.glyphCountOf(txt);
	const col1 = env.port && n > 4;
	const C = col1 ? 1 : 2;
	const R = col1 ? 4 : 2;
	const cw = (W * 0.92) / C;
	const ch = (H * 0.9) / R;
	const fb = env.fitBox(txt, cw * 0.84, ch * 0.7, 1.12, 0.02, 3);
	const size = Math.min(fb.size, M * 0.2);
	const kinds = ["outline", "stripes", "dots", "lines", "dim"];
	const stp = cyc ? Math.floor(Math.max(0, lt - 0.5) / per) : 0;
	if (cross) {
		const e = env.inE(0.6);
		const col = env.subOn();
		for (let c = 1; c < C; c++) {
			env.ln(W / 2, H / 2 - H * 0.45 * e, W / 2, H / 2 + H * 0.45 * e, col, lw * 1.3, 0.7 * env.out);
		}
		for (let r = 1; r < R; r++) {
			const y = H / 2 + (r - R / 2) * ch;
			env.ln(W / 2 - W * 0.46 * e, y, W / 2 + W * 0.46 * e, y, col, lw * 1.3, 0.7 * env.out);
		}
	}
	let k = 0;
	for (let i = 0; i < C * R; i++) {
		const x = W / 2 + ((i % C) - (C - 1) / 2) * cw;
		const y = H / 2 + (Math.floor(i / C) - (R - 1) / 2) * ch;
		const it = {
			text: fb.text,
			size,
			x,
			y,
			lead: 1.12,
			track: 0.02,
			color: env.fg,
		};
		if (i === mainIndex % (C * R)) {
			env.main(it);
			continue;
		}
		const al = env.inC(0.35, 0.1 + k * 0.1) * env.out;
		if (al > 0.01) {
			env.main({ ...it, ...env.copyStyle(kinds[(k + rot + stp) % kinds.length] ?? "dim", size, al) });
		}
		k++;
	}
}

/** なぞり書き — the solid line on top; below it outlined copies are traced stroke by stroke, glyph after glyph, during the cut. */
function drawTrace(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const copies = Number.parseInt(env.pick(1, ["2", "2", "3"]));
	const guide = env.chance(2, 0.8);
	const col = env.pick(3, ["fg", "accent", "fg"]);
	const n0 = env.glyphCountOf(txt);
	const o: RowOpts = {
		lead: 1.2,
		maxR: port ? (n0 > 10 ? 3 : n0 > 5 ? 2 : 1) : 1,
		track: 0.06,
	};
	const R0 = layRows(txt, W * 0.84, H, o).R;
	const C = Math.max(1, Math.min(copies, R0 >= 3 ? 1 : R0 === 2 ? 2 : 3));
	const gapK = 1.3;
	const L = layRows(txt, W * 0.84, (H * 0.8) / ((C + 1) * gapK), {
		...o,
		cap: M * 0.19,
	});
	const size = L.size;
	const hb = (L.R * 1.2 - 0.2) * size;
	const pit = hb * gapK;
	const top = H / 2 - ((C + 1) * pit - (pit - hb)) / 2;
	const tc = col === "accent" ? env.accentOn() : env.fg;
	const dt = Math.min(0.16, Math.max(0.03, (env.dur * 0.82 - 0.35) / Math.max(1, C * L.n)));
	for (let b = 0; b <= C; b++) {
		const cy = top + b * pit + hb / 2;
		if (guide) {
			L.ws.forEach((w, r) => {
				const y = cy + (r - (L.R - 1) / 2) * 1.2 * size + size * 0.56;
				const e = env.inE(0.5, b * 0.08);
				const hw = (Math.max(...L.ws) / 2) * size + size * 0.2;
				env.ln(W / 2 - hw * e, y, W / 2 + hw * e, y, env.sub, lw, 0.5 * env.out);
			});
		}
		for (const g of L.g) {
			const x = W / 2 + g.ex * size;
			const y = cy + g.ey * size;
			if (b === 0) {
				env.put(g, { size, x, y });
				continue;
			}
			env.main({
				text: g.t,
				size,
				sx: sqz(g.t),
				x,
				y,
				alpha: env.inC(0.4, 0.1) * env.out,
				color: mixHex({ from: env.bg, progress: 0.12, to: env.fg }),
			});
			const p = clamp01((lt - 0.35 - ((b - 1) * L.n + g.i) * dt) / (dt * 2.4));
			if (p > 0.002) {
				env.clipRect(x - size, y - size * 0.75, size * 2 * p, size * 1.5, () => {
					env.main({
						text: g.t,
						size,
						sx: sqz(g.t),
						x,
						y,
						alpha: env.out,
						color: tc,
						fill: false,
						stroke: Math.max(1.6, size * 0.022),
						strokeColor: tc,
					});
				});
			}
		}
	}
}

/** 満ち潮 — a waving water line rises through the line during the cut; the submerged part of the glyphs takes the water colour. */
function drawTide(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const lvl = env.range(1, 0.5, 0.78);
	const col = env.pick(2, ["accent", "accent", "accent2"]);
	const speed = env.range(3, 1.4, 2.2) * (env.chance(4, 0.5) ? 1 : -1);
	const body = env.chance(5, 0.8);
	const fb = env.fitBox(txt, W * 0.84, H * 0.5, 1.2, 0.02, port ? 4 : 2);
	const size = Math.min(fb.size, M * 0.32);
	const item = {
		text: fb.text,
		size,
		x: W / 2,
		y: H / 2,
		lead: 1.2,
		track: 0.02,
		color: env.fg,
	};
	const m = env.measure(item);
	const y1 = H / 2 + m.h / 2;
	let wc =
		col === "accent2" && contrastOf(env.sub, env.bg) >= 2
			? env.sub
			: env.accentOn();
	if (wc === env.fg) wc = mixHex({ from: env.fg, progress: 0.45, to: env.bg });
	const u = inOutSine(clamp01(lt / Math.max(0.6, env.dur * 0.85)));
	const ys = env.lerpN(y1 + size * 0.3, y1 - m.h * lvl, u);
	const A = size * 0.05;
	const t = env.ltb * speed;
	const pts: Pt[] = [];
	for (let k = 0; k <= 40; k++) {
		const x = -W * 0.05 + (W * 1.1 * k) / 40;
		pts.push([
			x,
			ys +
				A * Math.sin(((x / W) * TAU * 2.2 + t)) +
				A * 0.45 * Math.sin((x / W) * TAU * 5.1 - t * 1.6),
		]);
	}
	const q = env.inC(0.5) * env.out;
	const poly: Pt[] = [
		...pts,
		[W * 1.05, H * 1.2],
		[-W * 0.05, H * 1.2],
	];
	if (body && q > 0.01) env.polyF(poly, wc, 0.13 * q);
	env.polyline(pts, wc, lw * 2, 0.85 * q);
	env.clippedOut(poly, () => {
		env.main(item);
	});
	env.clipped(poly, () => {
		env.main({ ...item, color: wc });
	});
}

/** 縫い目 — a dashed thread weaves over and under the glyphs like a running stitch; the stitches keep crawling along it. */
function drawStitch(options: TypographyLayoutOptions): void {
	const env = new X2DEnv(options);
	const { W, H, M, port, txt, lw, lt } = env;
	const style = env.pick(1, ["dash", "dash", "knot"]);
	const speed = env.range(2, 0.5, 0.9) * (env.chance(3, 0.5) ? 1 : -1);
	const first = Number.parseInt(env.pick(4, ["1", "-1"]));
	const colPick = env.pick(5, ["accent", "accent", "sub"]);
	const n0 = env.glyphCountOf(txt);
	const pk = 1.3;
	const L = layRows(txt, W * 0.78, H * 0.6, {
		cap: M * 0.19,
		lead: 2.0,
		maxR: port ? 4 : n0 > 9 ? 2 : 1,
		mono: pk,
		spw: pk,
	});
	const size = L.size;
	const A = size * 0.68;
	const col = colPick === "accent" ? env.accentOn() : env.subOn();
	const dx = size * 0.15;
	for (let r = 0; r < L.R; r++) {
		const cy = H / 2 + (r - (L.R - 1) / 2) * L.lead * size;
		const w = L.ws[r] * size;
		const x0 = W / 2 - w / 2 + (pk * size) / 2;
		const xa = x0 - pk * size * 0.75;
		const xb = x0 + w - pk * size * 0.25;
		const yAt = (x: number) => cy - first * A * Math.cos((Math.PI * (x - x0)) / (pk * size));
		const e = inOutCubic(clamp01((lt - r * 0.1) / 0.8));
		const xe = env.lerpN(xa, xb, e);
		if (style === "knot") {
			const pts: Pt[] = [];
			for (let x = xa; x <= xe; x += dx) pts.push([x, yAt(x)]);
			if (pts.length > 1) env.polyline(pts, col, lw * 1.6, 0.85 * env.out);
			for (let j = 0; j * pk * size + x0 - (pk * size) / 2 <= xe; j++) {
				const x = x0 + (j - 0.5) * pk * size;
				env.disc(x, cy, lw * 3, col, env.out);
			}
		} else {
			const off = frac(env.ltb * speed) * 2 * dx;
			for (let x = xa - 2 * dx + off; x < xe; x += 2 * dx) {
				const a = Math.max(xa, x);
				const b = Math.min(xe, x + dx * 1.15);
				if (b - a > dx * 0.2) {
					env.polyline(
						[
							[a, yAt(a)],
							[(a + b) / 2, yAt((a + b) / 2)],
							[b, yAt(b)],
						],
						col,
						lw * 2.2,
						0.9 * env.out,
					);
				}
			}
		}
		if (e > 0.02 && e < 1) {
			const s2 = (yAt(xe + 1) - yAt(xe - 1)) / 2;
			const d = Math.hypot(1, s2);
			env.ln(xe, yAt(xe), xe + size * 0.3 / d, yAt(xe) + (size * 0.3 * s2) / d, env.fg, lw * 1.6, env.out);
		}
	}
	for (const g of L.g) {
		const sgn =
			(Math.round(g.ex / pk + L.ws[g.r] / pk / 2 - 0.5) % 2 ? -1 : 1) * first;
		env.put(g, {
			size,
			x: W / 2 + g.ex * size,
			y: H / 2 + g.ey * size + sgn * size * 0.07,
		});
	}
}



