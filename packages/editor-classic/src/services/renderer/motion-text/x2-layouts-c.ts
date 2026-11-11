import {
	clamp01,
	degrees,
	frameStep,
	inCubic,
	mixHex,
	outCubic,
	secondsOf,
	smoothNoise,
	TICKS_PER_SECOND,
} from "./exit-hold-geometry";
import { outBack, outExpo } from "./kinetic-layout-utils";
import { layoutADrawLine } from "./layouts-a-utils";
import { x2Hash, x2Signed, x2Unit } from "./x2-drawing";
import type { TypographyLayoutOptions } from "./typography-layout-types";

/**
 * JIZURA 追加分2 layouts C (`11p_x2_layC.js`) — the lyric inside everyday
 * objects, screens and interfaces drawn with simple shapes.
 *
 * Each part is a transliteration of its JIZURA `render` body onto rocut's
 * layout contract. Planner-side `plan(rng, …)` params are re-derived
 * deterministically from the cut seed; `env.lt/ltb/step` map to the cut's
 * local seconds / frame counter; `pOut` maps to `frame.exitProgress`.
 * Simplifications match the house precedent for x2 ports: one font family
 * (mono/body/display roles collapse to the cut font), single-pass drawing,
 * `accent2` stands in as the palette's secondary slot, and the beat/energy
 * fields fall back to 0.
 */

/* eslint-disable opencut/prefer-object-params -- this file transliterates JIZURA's compact positional call shape (env, x, y, w, h, color, alpha) helper-for-helper */

type Pt = readonly [number, number];

interface PoseMove {
	dx?: number;
	dy?: number;
	rot?: number;
	s?: number;
	sx?: number;
	sy?: number;
}

interface FitOpts {
	lead?: number;
	track?: number;
}

interface MainItem {
	text: string;
	size: number;
	x: number;
	y: number;
	align?: "left" | "center" | "right";
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
	rot?: number;
	size?: number;
	track?: number;
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

function luminanceOf(color: string): number {
	const rgb = hexOf(color);
	if (!rgb) return 0.5;
	return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function contrastOf(a: string, b: string): number {
	const la = luminanceOf(a);
	const lb = luminanceOf(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function mmss(seconds: number): string {
	const value = Math.max(0, seconds);
	return `${Math.floor(value / 60)}:${pad2(Math.floor(value % 60))}`;
}

function shortOf(text: string, limit: number): string {
	const characters = [...String(text ?? "")
		.replace(/\s+/g, " ")
		.trim()];
	return characters.length > limit
		? characters.slice(0, limit).join("") + "…"
		: characters.join("");
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
			[...line].every((character) => PUNCT.test(character) || character === " ")
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

function chunkRows(text: string, maxPer: number): string[][] {
	const normalized = String(text ?? "")
		.trim()
		.replace(/[\s\u3000]+/gu, " ");
	if (isLatinText(normalized) && normalized.includes(" ")) {
		const out: string[][] = [];
		let current: string[] = [];
		for (const word of normalized.split(" ")) {
			let characters = [...word];
			while (characters.length > maxPer) {
				if (current.length) {
					out.push(current);
					current = [];
				}
				out.push(characters.slice(0, maxPer));
				characters = characters.slice(maxPer);
			}
			if (current.length && current.length + 1 + characters.length > maxPer) {
				out.push(current);
				current = [];
			}
			current = current.length
				? current.concat([" "], characters)
				: characters;
		}
		if (current.length) out.push(current);
		return out;
	}
	const characters = [...normalized.replace(/ /g, "")];
	const length = characters.length;
	const rows = Math.max(1, Math.ceil(length / maxPer));
	const out: string[][] = [];
	let start = 0;
	for (let index = 1; index <= rows; index++) {
		let cut =
			index === rows ? length : Math.round((index * length) / rows);
		if (
			cut < length &&
			cut > start &&
			(PUNCT.test(characters[cut]) ||
				SMALLKANA.test(characters[cut]) ||
				characters[cut] === "ー")
		) {
			cut++;
		}
		if (cut > start) out.push(characters.slice(start, cut));
		start = cut;
	}
	return out;
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

function boxIn(
	width: number,
	height: number,
	aspect: number,
	fw: number,
	fh: number,
): [number, number] {
	const w = Math.min(width * fw, height * fh * aspect);
	return [w, w / aspect];
}

/** The JIZURA `env` for one frame: geometry, palette mapping, easing and text. */
class X2CEnv {
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
	readonly no: number;

	constructor(options: TypographyLayoutOptions) {
		this.options = options;
		const { frame, height, width } = options;
		this.W = width;
		this.H = height;
		this.M = Math.min(width, height);
		this.port = width < height;
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
		this.no = 1 + (x2Hash(this.seed, 0) % 8);
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

	clamp(value: number): number {
		return clamp01(value);
	}

	lerpN(a: number, b: number, k: number): number {
		return a + (b - a) * k;
	}

	smooth(a: number, b: number, x: number): number {
		const t = clamp01((x - a) / (b - a || 1e-6));
		return t * t * (3 - 2 * t);
	}

	noise(value: number, salt: number): number {
		return smoothNoise({ salt, seed: this.seed, value });
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

	onCol(fill: string): string {
		let best = "";
		let bestValue = 0;
		for (const color of [this.bg, this.fg, this.fg, this.sub]) {
			if (!color || color === fill) continue;
			const k = contrastOf(color, fill);
			if (k > bestValue) {
				bestValue = k;
				best = color;
			}
		}
		return bestValue >= 3
			? best
			: luminanceOf(fill) > 0.45
				? "#000"
				: "#fff";
	}

	plateCol(preferences: readonly string[]): string {
		for (const color of preferences) {
			if (color && contrastOf(color, this.bg) >= 1.7) return color;
		}
		return this.fg;
	}

	paperOf(): string {
		return this.plateCol([this.fg, this.fg, this.ac]);
	}

	pickPlate(kind: string): string {
		return this.plateCol(
			kind === "accent"
				? [this.ac, this.fg]
				: kind === "ink"
					? [this.fg, this.ac]
					: [this.fg, this.fg],
		);
	}

	accOn(fill: string): string {
		return contrastOf(this.ac, fill) >= 2
			? this.ac
			: contrastOf(this.sub, fill) >= 2
				? this.sub
				: this.onCol(fill);
	}

	acc2On(fill: string): string {
		return contrastOf(this.sub, fill) >= 2
			? this.sub
			: this.accOn(fill);
	}

	pose(cx: number, cy: number, move: PoseMove, fn: () => void): void {
		const ctx = this.options.ctx;
		ctx.save();
		ctx.translate(cx + (move.dx ?? 0), cy + (move.dy ?? 0));
		if (move.rot) ctx.rotate(degrees(move.rot));
		if (move.s != null || move.sx != null || move.sy != null) {
			const kx = (move.s ?? 1) * (move.sx ?? 1);
			const ky = (move.s ?? 1) * (move.sy ?? 1);
			ctx.scale(
				Math.abs(kx) < 0.001 ? 0.001 : kx,
				Math.abs(ky) < 0.001 ? 0.001 : ky,
			);
		}
		ctx.translate(-cx, -cy);
		fn();
		ctx.restore();
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
		ctx.textAlign = item.align ?? "center";
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
		if (item.rot) ctx.rotate(degrees(item.rot));
		ctx.fillStyle = item.color ?? this.sub;
		ctx.textAlign = item.align ?? "left";
		drawText({
			text: value,
			x: 0,
			y: 0,
			maxWidth: textWidth(value, size, item.track ?? 0.1) * 1.6 + 8,
			size,
		});
		ctx.restore();
	}

	fitSizeOf(text: string, bw: number, bh: number, o: FitOpts = {}): number {
		const lead = o.lead ?? 1.2;
		const track = o.track ?? 0.02;
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
		o: FitOpts = {},
		maxL = 4,
	): { text: string; size: number } {
		const trimmed = String(text ?? "").trim();
		const length = [...trimmed].length;
		let best: { text: string; size: number } | null = null;
		for (let L = 1; L <= Math.min(maxL, Math.max(1, length)); L++) {
			const candidate = linesOfText(trimmed, L);
			if (candidate.split("\n").length < L && best) continue;
			const size = this.fitSizeOf(candidate, bw, bh, o);
			if (!best || size > best.size * 1.04) best = { text: candidate, size };
		}
		return best ?? { text: trimmed, size: 10 };
	}

	fitMain(
		text: string,
		x: number,
		y: number,
		bw: number,
		bh: number,
		color: string,
		o: FitOpts | null = null,
		maxL = 3,
		cap = 1e9,
		extra: Partial<MainItem> = {},
	): void {
		const oo: FitOpts = { lead: 1.2, track: 0.02, ...(o ?? {}) };
		const fitted = this.fitBox(text, bw, bh, oo, maxL);
		this.main({
			text: fitted.text,
			size: Math.min(fitted.size, cap),
			x,
			y,
			color,
			...oo,
			...extra,
		});
	}

	toLines(text: string, lineCount: number): string[] {
		return linesOfText(text, lineCount)
			.split("\n")
			.filter((line) => line.trim().length > 0);
	}

	glyphCountOf(text: string): number {
		return [...String(text).replace(/\s/g, "")].length;
	}

	polyPartial(
		points: readonly Pt[],
		reveal: number,
		color: string,
		thickness: number,
		alpha = 1,
	): void {
		if (alpha <= 0.003 || points.length < 2 || reveal <= 0) return;
		const { ctx } = this.options;
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
			layoutADrawLine({
				alpha,
				color,
				ctx,
				fromX: from[0],
				fromY: from[1],
				thickness,
				toX: from[0] + (to[0] - from[0]) * f,
				toY: from[1] + (to[1] - from[1]) * f,
			});
			drawn += segment;
		}
	}
}

/** The JIZURA `G(env, a)` shape set: secondary graphics with a baked-in alpha. */
class X2CShapes {
	readonly a: number;
	private readonly env: X2CEnv;

	constructor(env: X2CEnv, a: number) {
		this.env = env;
		this.a = a;
	}

	r(x: number, y: number, w: number, h: number, c: string, k = 1): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || w <= 0 || h <= 0) return;
		const ctx = this.env.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
		ctx.fillStyle = c;
		ctx.fillRect(x, y, w, h);
		ctx.globalAlpha = base;
	}

	private traceRRect(
		x: number,
		y: number,
		w: number,
		h: number,
		rad: number,
	): boolean {
		const ctx = this.env.options.ctx;
		if (!(ctx.moveTo && ctx.lineTo && ctx.arc && ctx.closePath)) {
			return false;
		}
		const r = Math.max(0, Math.min(rad, w / 2, h / 2));
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
		ctx.lineTo(x + w, y + h - r);
		ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
		ctx.lineTo(x + r, y + h);
		ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
		ctx.lineTo(x, y + r);
		ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
		ctx.closePath();
		return true;
	}

	rr(
		x: number,
		y: number,
		w: number,
		h: number,
		rad: number,
		c: string,
		k = 1,
	): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || w <= 0 || h <= 0) return;
		const ctx = this.env.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
		ctx.fillStyle = c;
		if (this.traceRRect(x, y, w, h, rad) && ctx.fill) {
			ctx.fill();
		} else {
			ctx.fillRect(x, y, w, h);
		}
		ctx.globalAlpha = base;
	}

	rs(
		x: number,
		y: number,
		w: number,
		h: number,
		rad: number,
		c: string,
		lw: number,
		k = 1,
	): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || w <= 0 || h <= 0) return;
		const ctx = this.env.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		if (this.traceRRect(x, y, w, h, rad) && ctx.stroke) {
			ctx.stroke();
		} else {
			ctx.fillStyle = c;
			ctx.fillRect(x, y, w, lw);
			ctx.fillRect(x, y + h - lw, w, lw);
			ctx.fillRect(x, y, lw, h);
			ctx.fillRect(x + w - lw, y, lw, h);
		}
		ctx.globalAlpha = base;
	}

	c(x: number, y: number, r: number, c: string, k = 1): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || r <= 0) return;
		const ctx = this.env.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
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

	cs(x: number, y: number, r: number, c: string, lw: number, k = 1): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || r <= 0) return;
		const ctx = this.env.options.ctx;
		if (!(ctx.arc && ctx.stroke)) {
			this.l(x - r, y, x + r, y, c, lw, k);
			return;
		}
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.stroke();
		ctx.globalAlpha = base;
	}

	l(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		c: string,
		lw: number,
		k = 1,
	): void {
		const alpha = this.a * k;
		if (alpha <= 0.003) return;
		layoutADrawLine({
			alpha,
			color: c,
			ctx: this.env.options.ctx,
			fromX: x0,
			fromY: y0,
			thickness: lw,
			toX: x1,
			toY: y1,
		});
	}

	pl(points: readonly Pt[], c: string, lw: number, k = 1): void {
		this.env.polyPartial(points, 1, c, lw, this.a * k);
	}

	p(points: readonly Pt[], c: string, k = 1): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || points.length < 3) return;
		const ctx = this.env.options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
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

	arc(
		x: number,
		y: number,
		r: number,
		a0: number,
		a1: number,
		c: string,
		lw: number,
		k = 1,
	): void {
		const alpha = this.a * k;
		if (alpha <= 0.003 || a1 <= a0 || r <= 0) return;
		const ctx = this.env.options.ctx;
		if (!(ctx.arc && ctx.stroke)) {
			this.l(
				x + Math.cos(degrees(a0)) * r,
				y + Math.sin(degrees(a0)) * r,
				x + Math.cos(degrees(a1)) * r,
				y + Math.sin(degrees(a1)) * r,
				c,
				lw,
				k,
			);
			return;
		}
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * alpha;
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc(x, y, r, degrees(a0), degrees(a1));
		ctx.stroke();
		ctx.globalAlpha = base;
	}

	t(text: string, x: number, y: number, item: LabelItem = {}): void {
		this.env.label(text, x, y, {
			...item,
			alpha: this.a * (item.alpha ?? 1),
		});
	}

	greek(
		x: number,
		y: number,
		w: number,
		rows: number,
		pitch: number,
		c: string,
		seed: number,
		e = 1,
		th = 0.36,
		k0 = 1,
	): void {
		for (let row = 0; row < Math.min(rows, 40); row++) {
			const k =
				row === rows - 1 && rows > 1
					? 0.35 + 0.3 * x2Unit(seed, row, 3)
					: 0.8 + 0.2 * x2Unit(seed, row, 5);
			this.r(x, y + row * pitch, w * k * e, pitch * th, c, k0);
		}
	}

	skyIcon(
		type: string,
		x: number,
		y: number,
		u: number,
		c1: string,
		c2: string,
		back: string,
	): void {
		const env = this.env;
		if (type === "sun") {
			this.c(x, y, u * 0.5, c1);
			for (let i = 0; i < 8; i++) {
				const a = (env.ltb * 0.5 + (i * TAU)) / 8;
				this.l(
					x + Math.cos(a) * u * 0.68,
					y + Math.sin(a) * u * 0.68,
					x + Math.cos(a) * u * 0.98,
					y + Math.sin(a) * u * 0.98,
					c1,
					u * 0.09,
				);
			}
			return;
		}
		if (type === "moon") {
			this.c(x, y, u * 0.72, c1);
			this.c(x + u * 0.34, y - u * 0.2, u * 0.62, back);
			for (let i = 0; i < 3; i++) {
				this.c(
					x + u * (0.5 + 0.3 * x2Signed(i, 5)),
					y + u * (0.5 * x2Signed(i, 7)),
					u * 0.05 * (1 + ((env.step + i) % 2)),
					c2,
				);
			}
			return;
		}
		const dx = Math.sin(env.ltb * 0.8) * u * 0.06;
		if (type === "cloudsun") this.c(x + u * 0.4, y - u * 0.36, u * 0.36, c1);
		this.c(x - u * 0.38 + dx, y + u * 0.12, u * 0.36, c2);
		this.c(x + u * 0.05 + dx, y - u * 0.12, u * 0.48, c2);
		this.c(x + u * 0.48 + dx, y + u * 0.16, u * 0.32, c2);
		this.r(x - u * 0.38 + dx, y + u * 0.12, u * 0.86, u * 0.36, c2);
		if (type === "rain") {
			for (let i = 0; i < 4; i++) {
				const k = (((env.ltb * 1.3 + i * 0.27) % 1) + 1) % 1;
				const rx = x - u * 0.45 + i * u * 0.3;
				const ry = y + u * (0.6 + k * 0.45);
				this.l(rx, ry, rx - u * 0.08, ry + u * 0.2, c1, u * 0.07, 1 - k);
			}
		}
	}
}

export function drawX2LayoutC(options: TypographyLayoutOptions): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "xcAwning":
		case "xcBattery":
		case "xcBlackboard":
		case "xcBrowser":
		case "xcBunting":
		case "xcChipCard":
		case "xcDrawers":
		case "xcDropdown":
		case "xcFloppy":
		case "xcFolder":
		case "xcGauge":
		case "xcHandheld":
		case "xcIncoming":
		case "xcLoading":
		case "xcMapPin":
		case "xcMegaphone":
		case "xcPaperCup":
		case "xcPlate":
		case "xcPlayer":
		case "xcPoll":
		case "xcPopups":
		case "xcRadio":
		case "xcScoreboard":
		case "xcSelect":
		case "xcSheet":
		case "xcSignpost":
		case "xcTruck":
		case "xcTshirt":
		case "xcVending":
		case "xcWeather":
			drawX2LayoutCPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2LayoutCPart(options: TypographyLayoutOptions): void {
	switch (options.frame.cut?.preset.layout) {
		case "xcBrowser":
			drawBrowser(options);
			return;
		case "xcPlayer":
			drawPlayer(options);
			return;
		case "xcLoading":
			drawLoading(options);
			return;
		case "xcMapPin":
			drawMapPin(options);
			return;
		case "xcSignpost":
			drawSignpost(options);
			return;
		case "xcVending":
			drawVending(options);
			return;
		case "xcFolder":
			drawFolder(options);
			return;
		case "xcScoreboard":
			drawScoreboard(options);
			return;
		case "xcWeather":
			drawWeather(options);
			return;
		case "xcBattery":
			drawBattery(options);
			return;
		case "xcPopups":
			drawPopups(options);
			return;
		case "xcIncoming":
			drawIncoming(options);
			return;
		case "xcGauge":
			drawGauge(options);
			return;
		case "xcSheet":
			drawSheet(options);
			return;
		case "xcChipCard":
			drawChipCard(options);
			return;
		case "xcPaperCup":
			drawPaperCup(options);
			return;
		case "xcTshirt":
			drawTshirt(options);
			return;
		case "xcHandheld":
			drawHandheld(options);
			return;
		case "xcBlackboard":
			drawBlackboard(options);
			return;
		case "xcTruck":
			drawTruck(options);
			return;
		case "xcPlate":
			drawPlate(options);
			return;
		case "xcDropdown":
			drawDropdown(options);
			return;
		case "xcSelect":
			drawSelect(options);
			return;
		case "xcRadio":
			drawRadio(options);
			return;
		case "xcFloppy":
			drawFloppy(options);
			return;
		case "xcMegaphone":
			drawMegaphone(options);
			return;
		case "xcBunting":
			drawBunting(options);
			return;
		case "xcDrawers":
			drawDrawers(options);
			return;
		case "xcPoll":
			drawPoll(options);
			return;
		case "xcAwning":
			drawAwning(options);
			return;
		default:
			return;
	}
}

/** ブラウザ窓 — a browser window: tab strip, address bar being typed, page loading bar; the lyric is the page headline. */
function drawBrowser(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, lt, ls } = env;
	const tabs = env.int(1, 2, 3);
	const page = env.pick(2, ["hero", "article", "hero"]);
	const ctl = env.pick(3, ["mac", "win"]);
	const ww = W * (port ? 0.9 : 0.84);
	const wh = H * (port ? 0.62 : 0.8);
	const x0 = (W - ww) / 2;
	const y0 = (H - wh) / 2;
	const win = env.paperOf();
	const ink = env.onCol(win);
	const chrome = mixHex({ from: win, progress: 0.16, to: ink });
	const faint = mixHex({ from: win, progress: 0.2, to: ink });
	const ac = env.accOn(win);
	const e = env.inE(0.45);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const r = M * 0.018;
	const th = M * 0.058;
	const uh = M * 0.064;
	env.pose(
		W / 2,
		H / 2,
		{ dy: (1 - e) * M * 0.03, s: 0.94 + 0.06 * e },
		() => {
			g.rr(x0 + M * 0.014, y0 + M * 0.018, ww, wh, r, env.dim, 0.6);
			g.rr(x0, y0, ww, wh, r, chrome);
			g.rr(x0, y0 + th, ww, wh - th, r, win);
			g.r(x0, y0 + th, ww, r, win);
			const mac = ctl === "mac";
			const tw = Math.min(ww * 0.26, M * 0.3);
			const tx0 = x0 + (mac ? M * 0.15 : M * 0.02);
			for (let i = 0; i < tabs; i++) {
				const tx = tx0 + i * (tw + M * 0.008);
				const te = env.inE(0.35, 0.08 + i * 0.07);
				if (tx + tw > x0 + ww - (mac ? 0 : M * 0.16)) break;
				if (i === 0) {
					g.rr(tx, y0 + th * 0.2, tw * te, th, r * 0.7, win);
					g.t(shortOf(txt, 7), tx + tw * 0.1, y0 + th * 0.62, {
						color: ink,
						size: ls * 0.95,
						alpha: env.inC(0.3, 0.25),
						track: 0.02,
					});
				} else {
					g.r(tx + tw * 0.1, y0 + th * 0.52, tw * 0.5 * te, th * 0.14, faint, 1.6);
				}
			}
			if (mac) {
				[ac, env.acc2On(chrome), mixHex({ from: chrome, progress: 0.4, to: ink })].forEach((c, i) =>
					g.c(x0 + M * 0.035 + i * M * 0.032, y0 + th * 0.52, M * 0.01, c),
				);
			} else {
				const cx = x0 + ww - M * 0.03;
				const cy = y0 + th * 0.5;
				const u = M * 0.008;
				g.l(cx - u, cy - u, cx + u, cy + u, ink, env.lw * 1.6);
				g.l(cx - u, cy + u, cx + u, cy - u, ink, env.lw * 1.6);
				g.rs(cx - M * 0.045 - u, cy - u, u * 2, u * 2, 0, ink, env.lw * 1.4);
				g.l(cx - M * 0.09 - u, cy + u, cx - M * 0.09 + u, cy + u, ink, env.lw * 1.6);
			}
			const uy = y0 + th + uh / 2;
			const ux = x0 + ww * 0.13;
			const uw = ww * 0.74;
			g.rr(ux, uy - uh * 0.3, uw, uh * 0.6, uh * 0.3, chrome);
			for (const s of [0, 1]) {
				const ax = x0 + ww * (0.035 + s * 0.045);
				const d = (s ? 1 : -1) * M * 0.007;
				g.pl(
					[
						[ax - d, uy - M * 0.009],
						[ax + d, uy],
						[ax - d, uy + M * 0.009],
					],
					ink,
					env.lw * 1.6,
					s ? 0.4 : 1,
				);
			}
			const url = `https://lyrics/line-${pad2(env.no)}`;
			const nu = Math.floor(env.clamp((lt - 0.1) / 0.5) * url.length);
			g.t(
				url.slice(0, nu) + (nu < url.length ? "|" : ""),
				ux + uh * 0.35,
				uy,
				{ color: ink, size: ls * 0.95, track: 0.04 },
			);
			g.c(x0 + ww - ww * 0.06, uy, M * 0.012, faint, 1.6);
			const pl = env.clamp(lt / 0.9);
			g.r(
				x0,
				y0 + th + uh - env.lw * 1.5,
				ww * outCubic(pl),
				env.lw * 3,
				ac,
				1 - env.smooth(1.0, 1.3, lt),
			);
			g.l(x0, y0 + th + uh, x0 + ww, y0 + th + uh, faint, env.lw);
			const py = y0 + th + uh;
			const ph = wh - th - uh;
			const article = page === "article" && !port;
			const ge = env.inE(0.5, 0.2);
			if (article) {
				const ix = x0 + ww * 0.68;
				const iy = py + ph * 0.1;
				const iw = ww * 0.27;
				const ih = ph * 0.8;
				g.rr(ix, iy, iw, ih * ge, r * 0.6, faint);
				g.c(ix + iw * 0.7, iy + ih * 0.22 * ge, iw * 0.09, win, 0.8);
				g.p(
					[
						[ix, iy + ih * ge],
						[ix + iw * 0.4, iy + ih * 0.5 * ge],
						[ix + iw * 0.62, iy + ih * 0.74 * ge],
						[ix + iw * 0.8, iy + ih * 0.6 * ge],
						[ix + iw, iy + ih * 0.8 * ge],
						[ix + iw, iy + ih * ge],
					],
					mixHex({ from: win, progress: 0.34, to: ink }),
				);
				g.r(x0 + ww * 0.05, py + ph * 0.1, ww * 0.1 * ge, ph * 0.035, ac);
				g.greek(x0 + ww * 0.05, py + ph * 0.76, ww * 0.56, 3, ph * 0.055, faint, env.seed, ge);
				env.fitMain(
					txt,
					x0 + ww * 0.05,
					py + ph * 0.44,
					ww * 0.58,
					ph * 0.5,
					ink,
					null,
					3,
					ph * 0.3,
					{ align: "left" },
				);
				return;
			}
			g.r(x0 + ww * 0.05, py + ph * 0.07, M * 0.03, M * 0.03, ac);
			for (let i = 0; i < 3; i++) {
				g.r(
					x0 + ww * 0.95 - (i + 1) * ww * 0.09,
					py + ph * 0.07 + M * 0.01,
					ww * 0.06 * ge,
					M * 0.01,
					faint,
					1.5,
				);
			}
			for (let i = 0; i < 2; i++) {
				const bw = ww * (i ? 0.3 : 0.44) * ge;
				g.r(W / 2 - bw / 2, py + ph * (0.75 + i * 0.045), bw, ph * 0.016, faint, 1.5);
			}
			g.rr(W / 2 - ww * 0.09 * ge, py + ph * 0.86, ww * 0.18 * ge, ph * 0.075, ph * 0.04, ac);
			env.fitMain(txt, W / 2, py + ph * 0.44, ww * 0.86, ph * 0.5, ink, null, port ? 4 : 2, ph * 0.34);
		},
	);
}

/** 再生画面 — a music player: cover art, the lyric as the track title, a progress bar that really runs, transport buttons. */
function drawPlayer(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, txt, ls } = env;
	const port = W < H * 1.2;
	const art = env.pick(1, ["disc", "sun", "bars"]);
	const card = env.chance(2, 0.6);
	const flip = env.chance(3, 0.3);
	const at = env.range(4, 0.15, 0.5);
	const cw = W * 0.86;
	const ch = H * (W < H ? 0.76 : port ? 0.8 : 0.62);
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const win = card ? env.paperOf() : env.bg;
	const ink = card ? env.onCol(win) : env.fg;
	const faint = mixHex({ from: win, progress: 0.22, to: ink });
	const ac = env.accOn(win);
	const e = env.inE(0.45);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const pd = M * 0.045;
	if (card) g.rr(x0, y0 + (1 - e) * M * 0.04, cw, ch, M * 0.03, win);
	const as = port ? Math.min(cw * 0.66, ch * 0.4) : Math.min(ch - pd * 2, cw * 0.36);
	const ax = port ? W / 2 - as / 2 : flip ? x0 + cw - pd - as : x0 + pd;
	const ay = port ? y0 + pd : y0 + (ch - as) / 2;
	const rx0 = port ? x0 + pd : flip ? x0 + pd : ax + as + pd;
	const rx1 = port ? x0 + cw - pd : flip ? ax - pd : x0 + cw - pd;
	const rw = rx1 - rx0;
	const ae = env.inB(0.5, 0.05, 1.2);
	const acx = ax + as / 2;
	const acy = ay + as / 2;
	const hs = (as * ae) / 2;
	const dk = mixHex({ from: ac, progress: 0.75, to: env.onCol(ac) });
	if (ae > 0) {
		g.rr(acx - hs, acy - hs, hs * 2, hs * 2, as * 0.05, ac);
		if (art === "disc") {
			for (let i = 0; i < 4; i++) g.cs(acx, acy, hs * (0.82 - i * 0.16), dk, env.lw * 1.5, 0.8);
			g.c(acx, acy, hs * 0.2, dk);
			g.c(acx, acy, hs * 0.05, ac);
			const ra = env.ltb * 1.6;
			g.l(
				acx + Math.cos(ra) * hs * 0.26,
				acy + Math.sin(ra) * hs * 0.26,
				acx + Math.cos(ra) * hs * 0.8,
				acy + Math.sin(ra) * hs * 0.8,
				dk,
				env.lw * 2,
				0.7,
			);
		} else if (art === "sun") {
			g.c(acx, acy - hs * 0.08, hs * 0.5, dk);
			for (let i = 0; i < 5; i++) {
				g.r(
					acx - hs * 0.6,
					acy + hs * (0.02 + i * 0.105),
					hs * 1.2,
					hs * (0.028 + i * 0.012),
					ac,
				);
			}
			g.r(acx - hs * 0.8, acy + hs * 0.62, hs * 1.6, hs * 0.03, dk);
		} else {
			for (let i = 0; i < 9; i++) {
				const bh = hs * (0.3 + 1.1 * env.noise(env.ltb * 2.2 + i * 3.1, i));
				g.r(acx - hs * 0.72 + i * hs * 0.165, acy + hs * 0.7 - bh, hs * 0.1, bh, dk);
			}
		}
	}
	const py = port ? y0 + ch * 0.76 : y0 + ch * 0.66;
	const total = Math.max(env.dur / Math.max(0.2, 1 - at), env.dur + 1);
	const t0 = total * at * 0.6;
	const p = env.clamp((t0 + env.lt) / total);
	const pe = env.inE(0.5, 0.15);
	g.rr(rx0, py - env.lw * 2, rw * pe, env.lw * 4, env.lw * 2, faint, 1.6);
	g.rr(rx0, py - env.lw * 2, rw * p * pe, env.lw * 4, env.lw * 2, ac);
	g.c(rx0 + rw * p * pe, py, M * 0.011, ink);
	const la = env.inC(0.3, 0.3);
	g.t(mmss(t0 + env.lt), rx0, py + ls * 1.5, { color: ink, alpha: la * 0.8, size: ls * 0.9 });
	g.t(mmss(total), rx1, py + ls * 1.5, { color: ink, alpha: la * 0.8, align: "right", size: ls * 0.9 });
	const cy = port ? y0 + ch * 0.89 : y0 + ch * 0.85;
	const cx = (rx0 + rx1) / 2;
	const u = M * 0.022;
	const be = env.inB(0.4, 0.25);
	g.c(cx, cy, u * 2 * be, ink);
	const pc = env.onCol(ink);
	if (options.frame.exitProgress > 0) {
		g.p(
			[
				[cx - u * 0.5, cy - u * 0.8],
				[cx + u * 0.9, cy],
				[cx - u * 0.5, cy + u * 0.8],
			],
			pc,
			be,
		);
	} else {
		g.r(cx - u * 0.6, cy - u * 0.75, u * 0.42, u * 1.5, pc, be);
		g.r(cx + u * 0.18, cy - u * 0.75, u * 0.42, u * 1.5, pc, be);
	}
	for (const s of [-1, 1]) {
		const bx = cx + s * Math.min(rw * 0.3, u * 6);
		g.p(
			[
				[bx - s * u * 0.9, cy - u * 0.7],
				[bx + s * u * 0.2, cy],
				[bx - s * u * 0.9, cy + u * 0.7],
			],
			ink,
			be,
		);
		g.r(bx + s * u * 0.35 - u * 0.13, cy - u * 0.7, u * 0.26, u * 1.4, ink, be);
	}
	g.t("♪", rx0, port ? ay + as + pd * 0.75 : y0 + pd + ls * 0.4, {
		color: ac,
		alpha: la,
		size: ls * 1.2,
	});
	g.r(
		rx0 + ls * 1.6,
		(port ? ay + as + pd * 0.75 : y0 + pd + ls * 0.4) - ls * 0.18,
		Math.min(rw * 0.3, M * 0.2) * pe,
		ls * 0.36,
		faint,
		1.6,
	);
	if (port) {
		env.fitMain(
			txt,
			W / 2,
			(ay + as + pd * 1.2 + py - pd * 0.5) / 2,
			rw,
			py - pd * 0.5 - (ay + as + pd * 1.2),
			ink,
			null,
			3,
			as * 0.4,
		);
		return;
	}
	const ty0 = y0 + pd + ls * 1.6;
	const ty1 = py - pd * 0.6;
	env.fitMain(txt, rx0, (ty0 + ty1) / 2, rw, ty1 - ty0, ink, null, 3, ch * 0.3, {
		align: "left",
	});
}

/** 読み込み中 — a system dialog: title bar, the lyric as the message, a progress bar that fills during the cut, a button. */
function drawLoading(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const bar = env.pick(1, ["bar", "blocks", "ring"]);
	const bw = env.int(2, 0, 1);
	const end = Number.parseFloat(env.pick(3, ["0.87", "0.99", "1", "1"]));
	const dw = W * (port ? 0.88 : 0.62);
	const dh = port ? H * 0.44 : H * 0.66;
	const x0 = (W - dw) / 2;
	const y0 = (H - dh) / 2;
	const win = env.paperOf();
	const ink = env.onCol(win);
	const tb = bw ? ink : env.accOn(win);
	const ton = env.onCol(tb);
	const faint = mixHex({ from: win, progress: 0.22, to: ink });
	const ac = env.accOn(win);
	const e = env.inB(0.4, 0, 1.3);
	const g = new X2CShapes(env, env.inC(0.15) * env.out);
	const th = M * 0.062;
	const sh = M * 0.016;
	env.pose(W / 2, H / 2, { s: 0.8 + 0.2 * e }, () => {
		g.r(x0 + sh, y0 + sh, dw, dh, env.dim, 0.8);
		g.r(x0, y0, dw, dh, win);
		g.rs(x0, y0, dw, dh, 0, ink, env.lw * 2);
		g.r(x0, y0, dw, th, tb);
		g.t("NOW LOADING", x0 + th * 0.4, y0 + th / 2, { color: ton, size: ls, track: 0.25 });
		const bx = x0 + dw - th * 0.5;
		const by = y0 + th / 2;
		const u = th * 0.16;
		g.l(bx - u, by - u, bx + u, by + u, ton, env.lw * 2);
		g.l(bx - u, by + u, bx + u, by - u, ton, env.lw * 2);
		const bh = dh - th;
		const p = outCubic(env.clamp(env.lt / Math.max(0.5, env.dur * 0.8))) * end;
		const pct = `${Math.round(p * 100)}%`;
		const px = x0 + dw * 0.08;
		const pw = dw * 0.84;
		const py = y0 + th + bh * 0.68;
		const phh = bh * 0.1;
		if (bar === "bar") {
			g.rs(px, py, pw, phh, 0, ink, env.lw * 1.6);
			g.r(px + env.lw * 3, py + env.lw * 3, (pw - env.lw * 6) * p, phh - env.lw * 6, ac);
		} else if (bar === "blocks") {
			const nb = port ? 12 : 18;
			const cw2 = pw / nb;
			g.rs(px, py, pw, phh, 0, ink, env.lw * 1.6);
			for (let i = 0; i < Math.floor(p * nb + 0.001); i++) {
				g.r(px + i * cw2 + env.lw * 3, py + env.lw * 3, cw2 - env.lw * 4, phh - env.lw * 6, ac);
			}
		} else {
			const rr = phh * 0.62;
			const cx = px + rr + env.lw * 2;
			const cy = py + phh / 2;
			g.cs(cx, cy, rr, faint, env.lw * 5);
			g.arc(cx, cy, rr, -90, -90 + 360 * p, ac, env.lw * 5);
			const sa = env.ltb * 300;
			g.arc(cx, cy, rr * 0.5, sa, sa + 100, ink, env.lw * 2);
			g.greek(cx + rr * 1.8, cy - phh * 0.24, pw * 0.4, 2, phh * 0.44, faint, env.seed, env.inE(0.4, 0.2), 0.36, 1.5);
		}
		g.t(pct, px + pw, py - ls * 0.9, { color: ink, align: "right", size: ls * 1.1 });
		g.t(
			p >= 1 ? "DONE" : "PLEASE WAIT" + ".".repeat(env.step % 4),
			px,
			py - ls * 0.9,
			{ color: ink, size: ls * 0.9, alpha: 0.75 },
		);
		const bw2 = Math.min(dw * 0.26, M * 0.24);
		const bh2 = bh * 0.11;
		g.rs(x0 + dw * 0.92 - bw2, y0 + dh - bh2 - bh * 0.05, bw2, bh2, bh2 * 0.15, ink, env.lw * 1.6);
		g.t(p >= 1 ? "OK" : "CANCEL", x0 + dw * 0.92 - bw2 / 2, y0 + dh - bh2 / 2 - bh * 0.05, {
			color: ink,
			align: "center",
			size: ls * 0.95,
		});
		env.fitMain(txt, W / 2, y0 + th + bh * 0.3, dw * 0.86, bh * 0.44, ink, null, 3, bh * 0.3);
	});
}

/** 地図ピン — a street map draws itself, a pin drops, and the lyric opens in the pin's callout. */
function drawMapPin(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const seed = env.seed;
	const px01 = Number.parseFloat(env.pick(1, ["0.26", "0.5", "0.74"]));
	const tone = env.pick(2, ["paper", "accent", "paper"]);
	const la = env.int(3, 10, 59);
	const lo = env.int(4, 100, 159);
	const road = env.dim;
	const g0 = new X2CShapes(env, env.out);
	g0.rr(
		W * (0.08 + 0.5 * x2Unit(seed, 1)),
		H * (0.1 + 0.3 * x2Unit(seed, 2)),
		W * 0.26,
		H * 0.24,
		M * 0.03,
		mixHex({ from: env.bg, progress: 0.13, to: env.ac }),
		env.inC(0.5, 0.1),
	);
	for (let i = 0; i < 7; i++) {
		const re = env.inE(0.7, i * 0.05);
		const hz = i % 2 === 0;
		const k = (Math.floor(i / 2) + 0.2 + 0.6 * x2Unit(seed, i, 9)) / 4;
		const rw = M * (i < 2 ? 0.03 : 0.014);
		const sl = x2Signed(seed, i, 4) * 0.08;
		if (hz) g0.l(0, H * (k + sl), W * re, H * (k - sl), road, rw);
		else g0.l(W * (k + sl), H, W * (k - sl), H * (1 - re), road, rw);
	}
	g0.l(0, H * 0.2, W * env.inE(0.9, 0.1), H * (0.9 - 0.4 * x2Unit(seed, 7)), road, M * 0.02);
	const pr = M * 0.042;
	const px = W * (port ? 0.5 + (px01 - 0.5) * 0.7 : px01);
	const py = H * (port ? 0.8 : 0.88);
	const pe = env.clamp((env.lt - 0.05) / 0.4);
	const drop = pe >= 1 ? 0 : (1 - outBack({ overshoot: 1.6, value: pe })) * H * 0.5;
	const pa = env.clamp(pe * 4) * env.out;
	const gp = new X2CShapes(env, pa);
	const pc = env.accOn(env.bg);
	const hy = py - pr * 2.5 - drop;
	for (let i = 0; i < 2; i++) {
		const k = (((env.ltb * 0.6 + i * 0.5) % 1) + 1) % 1;
		if (env.lt > 0.4) g0.cs(px, py, pr * (0.3 + k * 1.6), pc, env.lw * 2, (1 - k) * 0.7);
	}
	gp.p(
		[
			[px - pr * 0.82, hy + pr * 0.58],
			[px + pr * 0.82, hy + pr * 0.58],
			[px, py - drop],
		],
		pc,
	);
	gp.c(px, hy, pr, pc);
	gp.c(px, hy, pr * 0.4, env.bg);
	const cw = W * (port ? 0.88 : 0.7);
	const chh = H * (port ? 0.36 : 0.48);
	const cx = W / 2 + (px - W / 2) * 0.3;
	const by = py - pr * 4.6;
	const cy0 = by - chh;
	const win = tone === "accent" ? env.pickPlate("accent") : env.paperOf();
	const ink = env.onCol(win);
	const faint = mixHex({ from: win, progress: 0.3, to: ink });
	const ce = env.inB(0.42, 0.22, 1.25);
	const g = new X2CShapes(env, env.clamp((env.lt - 0.22) / 0.12) * env.out);
	env.pose(px, by + pr * 0.9, { s: Math.max(0.01, ce) }, () => {
		g.rr(cx - cw / 2, cy0, cw, chh, M * 0.03, win);
		g.p(
			[
				[px - pr * 0.9, by - 1],
				[px + pr * 0.9, by - 1],
				[px, by + pr * 0.95],
			],
			win,
		);
		const fy = cy0 + chh * 0.87;
		g.l(cx - cw * 0.44, cy0 + chh * 0.76, cx + cw * 0.44, cy0 + chh * 0.76, faint, env.lw);
		g.t(`N 35.${la}°  E 139.${lo}°`, cx - cw * 0.44, fy, { color: ink, size: ls * 0.95, alpha: 0.8 });
		g.t(`${(1 + x2Unit(seed, 5) * 8).toFixed(1)} km`, cx + cw * 0.44, fy, {
			color: ink,
			size: ls * 0.95,
			align: "right",
			alpha: 0.8,
		});
		env.fitMain(txt, cx, cy0 + chh * 0.4, cw * 0.86, chh * 0.58, ink, null, 3, chh * 0.4);
	});
}

/** 道しるべ — a signpost: every line of the lyric on its own arrow board, pointing left and right in turn. */
function drawSignpost(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const first = env.int(1, 0, 1);
	const c0 = env.int(2, 0, 2);
	const tilt = env.chance(3, 0.5);
	const n = env.glyphCountOf(txt);
	const L = port
		? n <= 3
			? 1
			: n <= 7
				? 2
				: n <= 12
					? 3
					: 4
		: n <= 5
			? 1
			: n <= 10
				? 2
				: 3;
	const lines = env.toLines(txt, L);
	const k = lines.length;
	const o = { track: 0.03 };
	const bh = Math.min(M * (port ? 0.23 : 0.25), (H * 0.7) / k / 1.16);
	const gap = bh * 0.16;
	const maxT = W * (port ? 0.52 : 0.5);
	const size = Math.min(
		...lines.map((s) => env.fitSizeOf(s, maxT, bh * 0.62, o)),
	);
	const tot = k * bh + (k - 1) * gap;
	const sy0 = H * 0.45 - tot / 2;
	const off = W * (port ? 0.025 : 0.06);
	const tl = bh * 0.42;
	const plates = [env.paperOf(), env.pickPlate("accent"), env.pickPlate("ink")];
	const pw = M * 0.022;
	const pe = env.inE(0.5);
	const g0 = new X2CShapes(env, env.out);
	const pole = mixHex({ from: env.bg, progress: 0.45, to: env.fg });
	g0.r(W / 2 - pw / 2, H * 0.97 - (H * 0.97 - sy0 + bh * 0.25) * pe, pw, (H * 0.97 - sy0 + bh * 0.25) * pe, pole);
	g0.c(W / 2, sy0 - bh * 0.25, pw * 0.9 * pe, pole);
	g0.l(W / 2 - M * 0.16 * pe, H * 0.97, W / 2 + M * 0.16 * pe, H * 0.97, pole, env.lw * 3);
	lines.forEach((s, i) => {
		const dir = (i + first) % 2 ? 1 : -1;
		const plate = plates[(i + c0) % 3];
		const ink = env.onCol(plate);
		const tw = textWidth(s, size, o.track);
		const bw = tw + bh * 0.7;
		const cx = W / 2 + dir * off;
		const yc = sy0 + i * (bh + gap) + bh / 2;
		const xa = cx - bw / 2;
		const xb = cx + bw / 2;
		const e = env.inE(0.5, 0.06 + i * 0.09);
		const g = new X2CShapes(env, env.clamp((env.lt - 0.06 - i * 0.09) / 0.15) * env.out);
		env.pose(
			W / 2,
			yc,
			{ dx: -dir * (1 - e) * W * 0.3, rot: tilt ? dir * (1.2 + (1 - e) * 6) : 0 },
			() => {
				const pts: Pt[] =
					dir > 0
						? [
								[xa, yc - bh / 2],
								[xb, yc - bh / 2],
								[xb + tl, yc],
								[xb, yc + bh / 2],
								[xa, yc + bh / 2],
							]
						: [
								[xb, yc - bh / 2],
								[xa, yc - bh / 2],
								[xa - tl, yc],
								[xa, yc + bh / 2],
								[xb, yc + bh / 2],
							];
				g.p(pts, plate);
				const ins = bh * 0.09;
				const q: Pt[] =
					dir > 0
						? [
								[xa + ins, yc - bh / 2 + ins],
								[xb - ins * 0.4, yc - bh / 2 + ins],
								[xb + tl - ins * 1.4, yc],
								[xb - ins * 0.4, yc + bh / 2 - ins],
								[xa + ins, yc + bh / 2 - ins],
								[xa + ins, yc - bh / 2 + ins],
							]
						: [
								[xb - ins, yc - bh / 2 + ins],
								[xa + ins * 0.4, yc - bh / 2 + ins],
								[xa - tl + ins * 1.4, yc],
								[xa + ins * 0.4, yc + bh / 2 - ins],
								[xb - ins, yc + bh / 2 - ins],
								[xb - ins, yc - bh / 2 + ins],
							];
				g.pl(q, ink, env.lw * 1.5, 0.5);
				for (const dy of [-0.3, 0.3]) g.c(W / 2, yc + dy * bh, bh * 0.028, ink, 0.55);
				env.main({ text: s, size, track: o.track, x: cx, y: yc, color: ink });
			},
		);
	});
}

/** 自販機 — a vending machine: the lyric in the lit display window, a row of priced buttons lighting in turn, coin slot and tray. */
function drawVending(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const c = env.pick(1, ["paper", "accent", "ink"]);
	const nbPlan = env.int(2, 5, 8);
	const round = env.chance(3, 0.5);
	const price = Number.parseInt(env.pick(4, ["100", "120", "150"]));
	const bw = W * (port ? 0.86 : 0.8);
	const bh = H * (port ? 0.74 : 0.86);
	const x0 = (W - bw) / 2;
	const y0 = (H - bh) / 2;
	const body = env.pickPlate(c);
	const on = env.onCol(body);
	const mid = mixHex({ from: body, progress: 0.28, to: on });
	const dk = mixHex({ from: body, progress: 0.8, to: on });
	const ac = env.accOn(body);
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const m = M * 0.035;
	const wh = bh * (port ? 0.52 : 0.56);
	const nb = port ? Math.min(5, nbPlan) : nbPlan;
	env.pose(W / 2, H / 2, { dy: (1 - e) * H * 0.08 }, () => {
		g.rr(x0, y0, bw, bh, M * 0.025, body);
		const lit = env.clamp((env.lt - 0.2) / 0.25) * (env.lt < 0.55 && env.step % 2 ? 0.6 : 1);
		g.r(x0 + m, y0 + m, bw - m * 2, wh, dk);
		g.r(x0 + m + env.lw * 3, y0 + m + env.lw * 3, bw - m * 2 - env.lw * 6, wh - env.lw * 6, env.bg, lit);
		const ry = y0 + m + wh + bh * 0.035;
		const rh = bh * (port ? 0.15 : 0.16);
		const cw = (bw - m * 2) / nb;
		const hot = Math.floor(env.ltb * 2.2 + (env.seed % 7)) % nb;
		for (let i = 0; i < nb; i++) {
			const cx = x0 + m + cw * (i + 0.5);
			const be = env.inB(0.3, 0.2 + i * 0.04);
			g.rr(cx - cw * 0.36, ry, cw * 0.72, rh * 0.36, rh * 0.05, mid, be);
			g.t(String(price + (env.hash(i, 3) % 4) * 10), cx, ry + rh * 0.18, {
				color: on,
				align: "center",
				size: Math.min(ls, cw * 0.22),
				track: 0.02,
				alpha: be,
			});
			const lc = i === hot ? ac : dk;
			const br = Math.min(cw * 0.3, rh * 0.22) * be;
			if (round) g.c(cx, ry + rh * 0.72, br, lc);
			else g.rr(cx - br * 1.2, ry + rh * 0.72 - br * 0.7, br * 2.4, br * 1.4, br * 0.3, lc);
		}
		const ty = ry + rh + bh * 0.03;
		const th = y0 + bh - m - ty;
		g.rr(x0 + m, ty, bw * 0.56, th, th * 0.12, dk);
		g.r(x0 + m + bw * 0.03, ty + th * 0.22, bw * 0.5, th * 0.5, mixHex({ from: dk, progress: 0.25, to: body }));
		g.t("PUSH", x0 + m + bw * 0.28, ty + th * 0.47, {
			color: body,
			align: "center",
			size: Math.min(ls, th * 0.3),
			track: 0.4,
			alpha: 0.9,
		});
		const sx = x0 + bw - m - bw * 0.1;
		g.rr(sx - bw * 0.02, ty + th * 0.08, bw * 0.014, th * 0.5, bw * 0.005, dk);
		g.c(sx - bw * 0.1, ty + th * 0.33, Math.min(th * 0.24, bw * 0.03), mid);
		g.rr(sx - bw * 0.16, ty + th * 0.72, bw * 0.2, th * 0.2, th * 0.05, mid);
		env.fitMain(txt, W / 2, y0 + m + wh / 2, (bw - m * 2) * 0.88, wh * 0.78, env.fg, null, port ? 4 : 3, wh * 0.5);
	});
}

/** フォルダ — a file folder with a tab; sheets slide up out of it and the lyric is written on the front. */
function drawFolder(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const c = env.pick(1, ["accent", "ink", "paper"]);
	const right = env.chance(2, 0.4);
	const sheets = env.int(3, 1, 3);
	const tilt = Number.parseFloat(env.pick(4, ["0", "-2", "2"]));
	const [fw, fh] = boxIn(W, H, port ? 1.05 : 1.55, 0.86, 0.68);
	const x0 = (W - fw) / 2;
	const y0 = (H - fh) / 2 + fh * 0.07;
	const front = env.pickPlate(c);
	const ink = env.onCol(front);
	const back = mixHex({ from: front, progress: 0.3, to: ink });
	const paper = mixHex({ from: ink, progress: 0.12, to: front });
	const pfaint = mixHex({ from: paper, progress: 0.5, to: front });
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const th = fh * 0.1;
	const tw = fw * 0.36;
	const r = M * 0.02;
	env.pose(W / 2, H / 2, { dy: (1 - e) * H * 0.06, rot: tilt * e }, () => {
		const ta = right ? x0 + fw - tw : x0;
		const sgn = right ? -1 : 1;
		const tA = right ? x0 + fw : x0;
		g.p(
			[
				[tA, y0 + r],
				[tA, y0 - th],
				[tA + sgn * (tw - th * 0.7), y0 - th],
				[tA + sgn * tw, y0],
				[tA + sgn * tw, y0 + r],
			],
			back,
		);
		g.rr(x0, y0, fw, fh, r, back);
		g.t(`FILE_${pad2(env.no)}`, ta + tw * 0.45, y0 - th * 0.45, {
			color: env.onCol(back),
			align: "center",
			size: Math.min(ls, th * 0.42),
		});
		for (let i = sheets - 1; i >= 0; i--) {
			const se = env.inE(0.55, 0.18 + i * 0.1);
			const sw = fw * (0.8 - i * 0.05);
			const sx = x0 + fw * 0.08 + i * fw * 0.05;
			const rise = fh * (0.09 + i * 0.05) * se;
			env.pose(
				sx + sw / 2,
				y0 + fh * 0.4,
				{ rot: (i % 2 ? 1 : -1) * (1.5 + i) * se },
				() => {
					g.r(sx, y0 - rise + fh * 0.03, sw, fh * 0.5, i ? mixHex({ from: paper, progress: 0.25, to: front }) : paper);
					g.greek(sx + sw * 0.07, y0 - rise + fh * 0.065, sw * 0.6, 2, fh * 0.035, pfaint, env.seed + i, se);
				},
			);
		}
		const fy = y0 + fh * 0.15;
		g.rr(x0, fy, fw, fh - (fy - y0), r, front);
		g.l(x0 + fw * 0.05, fy + fh * 0.07, x0 + fw * 0.95, fy + fh * 0.07, ink, env.lw, 0.3);
		env.fitMain(txt, W / 2, fy + (fh - (fy - y0)) * 0.54, fw * 0.84, (fh - (fy - y0)) * 0.66, ink, null, 3, fh * 0.36);
	});
}

/** 得点板 — a stadium scoreboard: two scores counting up either side of the lyric, an innings row filling in. */
function drawScoreboard(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const c = env.pick(1, ["ink", "ink", "paper"]);
	const s1 = env.int(2, 0, 9);
	const s2 = env.int(3, 0, 9);
	const legs = env.chance(4, 0.6);
	const bw = W * 0.88;
	const bh = H * (port ? 0.62 : 0.7);
	const x0 = (W - bw) / 2;
	const y0 = (H - bh) / 2 - (legs ? H * 0.03 : 0);
	const board = env.pickPlate(c);
	const on = env.onCol(board);
	const rec = mixHex({ from: board, progress: 0.14, to: on });
	const ac = env.accOn(board);
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const cnt = (v: number) =>
		String(Math.round(v * outCubic(env.clamp((env.lt - 0.2) / 0.8))));
	const score = (x: number, y: number, w: number, h: number, lab: string, v: number) => {
		g.t(lab, x + w / 2, y + h * 0.1, {
			color: on,
			align: "center",
			size: Math.min(ls * 1.1, h * 0.12),
			track: 0.3,
		});
		g.r(x, y + h * 0.22, w, h * 0.78, rec);
		g.t(cnt(v), x + w / 2, y + h * 0.62, {
			color: ac,
			align: "center",
			size: Math.min(h * 0.6, w * 0.9),
			track: 0,
		});
	};
	env.pose(W / 2, H / 2, { dy: -(1 - e) * H * 0.07 }, () => {
		if (legs) {
			for (const fx of [0.22, 0.78]) {
				g.r(x0 + bw * fx - M * 0.012, y0 + bh, M * 0.024, H - y0 - bh, mixHex({ from: env.bg, progress: 0.4, to: env.fg }));
			}
		}
		g.r(x0, y0, bw, bh, board);
		g.rs(x0 + M * 0.012, y0 + M * 0.012, bw - M * 0.024, bh - M * 0.024, 0, on, env.lw * 1.5, 0.5);
		const nI = port ? 7 : 9;
		const iy = y0 + bh * (port ? 0.8 : 0.76);
		const ih = bh * (port ? 0.13 : 0.17);
		const ix = x0 + bw * 0.05;
		const iw = (bw * 0.9) / nI;
		for (let i = 0; i < nI; i++) {
			g.rs(ix + i * iw, iy, iw, ih, 0, on, env.lw, 0.5);
			g.t(String(i + 1), ix + i * iw + iw * 0.14, iy + ih * 0.2, {
				color: on,
				size: Math.min(ls * 0.7, ih * 0.22),
				alpha: 0.6,
			});
			if (env.lt > 0.35 + i * 0.16) {
				g.t(String(env.hash(i, 8) % 4), ix + (i + 0.5) * iw, iy + ih * 0.58, {
					color: on,
					align: "center",
					size: ih * 0.5,
					track: 0,
				});
			}
		}
		if (port) {
			score(x0 + bw * 0.06, y0 + bh * 0.05, bw * 0.4, bh * 0.2, "HOME", s1);
			score(x0 + bw * 0.54, y0 + bh * 0.05, bw * 0.4, bh * 0.2, "GUEST", s2);
			env.fitMain(txt, W / 2, y0 + bh * 0.535, bw * 0.86, bh * 0.4, on, null, 4, bh * 0.2);
			return;
		}
		score(x0 + bw * 0.05, y0 + bh * 0.1, bw * 0.14, bh * 0.56, "HOME", s1);
		score(x0 + bw * 0.81, y0 + bh * 0.1, bw * 0.14, bh * 0.56, "GUEST", s2);
		env.fitMain(txt, W / 2, y0 + bh * 0.4, bw * 0.5, bh * 0.52, on, null, 3, bh * 0.34);
	});
}

/** 天気予報 — a weather widget: animated sky icon and temperature, the lyric as today's forecast, a small week row. */
function drawWeather(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, txt, ls } = env;
	const port = W < H * 1.2;
	const sky = env.pick(1, ["sun", "moon", "rain", "cloudsun"]);
	const t = env.int(2, -3, 34);
	const c = env.pick(3, ["paper", "paper", "ink"]);
	const flip = env.chance(4, 0.3);
	const cw = W * (port ? 0.86 : 0.84);
	const ch = H * (W < H ? 0.72 : port ? 0.8 : 0.74);
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const win = env.pickPlate(c);
	const ink = env.onCol(win);
	const faint = mixHex({ from: win, progress: 0.25, to: ink });
	const ac = env.accOn(win);
	const cl = mixHex({ from: win, progress: 0.45, to: ink });
	const e = env.inE(0.45);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	env.pose(W / 2, H / 2, { s: 0.92 + 0.08 * e }, () => {
		g.rr(x0, y0, cw, ch, M * 0.05, win);
		const ie = env.inB(0.5, 0.1, 1.3);
		const gi = new X2CShapes(env, g.a * env.clamp((env.lt - 0.1) / 0.15));
		const latin = isLatinText(txt);
		const days = latin
			? ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
			: ["月", "火", "水", "木", "金", "土", "日"];
		const d0 = env.hash(6) % 7;
		const kinds = ["sun", "cloud", "rain", "cloudsun"];
		const week = (wx: number, wy: number, ww: number, wh: number, nd: number) => {
			g.l(wx, wy, wx + ww * env.inE(0.5, 0.2), wy, faint, env.lw);
			for (let i = 0; i < nd; i++) {
				const cx = wx + (ww / nd) * (i + 0.5);
				const a = env.inC(0.3, 0.3 + i * 0.06);
				const g2 = new X2CShapes(env, g.a * a);
				g2.t(days[(d0 + i) % 7], cx, wy + wh * 0.2, {
					color: ink,
					align: "center",
					size: Math.min(ls, wh * 0.16),
					track: 0.05,
					alpha: 0.8,
				});
				g2.skyIcon(
					kinds[env.hash(i, 2) % 4],
					cx,
					wy + wh * 0.5,
					Math.min(wh * 0.16, (ww / nd) * 0.26),
					ac,
					cl,
					win,
				);
				g2.t(`${t - 2 + (env.hash(i, 4) % 6)}°`, cx, wy + wh * 0.84, {
					color: ink,
					align: "center",
					size: Math.min(ls, wh * 0.16),
					alpha: 0.8,
				});
			}
		};
		if (port) {
			const u = ch * 0.085;
			env.pose(x0 + cw * 0.24, y0 + ch * 0.14, { s: ie }, () =>
				gi.skyIcon(sky, x0 + cw * 0.24, y0 + ch * 0.14, u, ac, cl, win),
			);
			g.t(`${t}°`, x0 + cw * 0.9, y0 + ch * 0.13, {
				color: ink,
				align: "right",
				size: ch * 0.11,
				track: 0,
			});
			week(x0 + cw * 0.06, y0 + ch * 0.74, cw * 0.88, ch * 0.22, 5);
			env.fitMain(txt, W / 2, y0 + ch * 0.49, cw * 0.86, ch * 0.4, ink, null, 4, ch * 0.2);
			return;
		}
		const lx = flip ? x0 + cw * 0.7 : x0;
		const lw2 = cw * 0.3;
		const rx = flip ? x0 + cw * 0.06 : x0 + cw * 0.32;
		const rw = cw * 0.62;
		const u = ch * 0.15;
		env.pose(lx + lw2 / 2, y0 + ch * 0.3, { s: ie }, () =>
			gi.skyIcon(sky, lx + lw2 / 2, y0 + ch * 0.3, u, ac, cl, win),
		);
		g.t(`${t}°`, lx + lw2 / 2 + ch * 0.02, y0 + ch * 0.66, {
			color: ink,
			align: "center",
			size: ch * 0.2,
			track: 0,
		});
		g.t(`H ${t + 3}°  L ${t - 5}°`, lx + lw2 / 2, y0 + ch * 0.85, {
			color: ink,
			align: "center",
			size: ls,
			alpha: 0.7,
		});
		week(rx, y0 + ch * 0.68, rw, ch * 0.27, 5);
		env.fitMain(txt, rx + rw / 2, y0 + ch * 0.36, rw, ch * 0.5, ink, null, 3, ch * 0.32);
	});
}

/** 電池残量 — a big battery outline charging cell by cell behind the lyric (upright in portrait). */
function drawBattery(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const cells = Number.parseInt(env.pick(1, ["4", "5", "1", "8"]));
	const level = Number.parseFloat(env.pick(2, ["0.25", "0.5", "0.75", "1", "1"]));
	const bolt = env.chance(3, 0.6);
	const bw = W * (port ? 0.72 : 0.76);
	const bh = H * (port ? 0.66 : 0.6);
	const nub = M * 0.035;
	const x0 = (W - bw) / 2 - (port ? 0 : nub / 2);
	const y0 = (H - bh) / 2 + (port ? nub / 2 : 0) - H * 0.02;
	const st2 = M * 0.014;
	const ac = env.accOn(env.bg);
	const low = level <= 0.25;
	const fc = low ? env.acc2On(env.bg) : ac;
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const r = M * 0.04;
	const pd = st2 * 2.2;
	const ix = x0 + pd;
	const iy = y0 + pd;
	const iw = bw - pd * 2;
	const ih = bh - pd * 2;
	const nc = cells;
	const gp = nc > 1 ? st2 * 0.9 : 0;
	const litN = Math.max(1, Math.round(level * nc));
	const long = port ? ih : iw;
	const cl = (long - gp * (nc - 1)) / nc;
	for (let k = 0; k < (nc > 1 ? litN : 1); k++) {
		const ce = nc > 1 ? env.inE(0.3, 0.2 + k * 0.13) : env.inE(0.9, 0.2) * level;
		const blink = nc > 1 && k === litN - 1 && level < 1 && env.lt > 0.6 ? (env.step % 4 < 2 ? 1 : 0.35) : 1;
		if (port) {
			const hh = cl * ce;
			g.rr(ix, iy + ih - k * (cl + gp) - hh, iw, hh, r * 0.4, fc, 0.3 * blink);
		} else {
			g.rr(ix + k * (cl + gp), iy, cl * ce, ih, r * 0.4, fc, 0.3 * blink);
		}
	}
	g.rs(x0, y0, bw, bh, r, env.fg, st2, e);
	if (port) g.rr(W / 2 - bw * 0.16, y0 - nub - st2 * 0.2, bw * 0.32, nub, nub * 0.3, env.fg, e);
	else g.rr(x0 + bw + st2 * 0.2, y0 + bh * 0.33, nub, bh * 0.34, nub * 0.3, env.fg, e);
	const pct = Math.round(level * 100 * outCubic(env.clamp((env.lt - 0.2) / (0.3 + 0.13 * litN))));
	const ly = y0 + bh + ls * 2.2;
	g.t(`${pct}%`, x0 + bw, ly, { color: env.fg, align: "right", size: ls * 1.5, track: 0.05 });
	g.t(low ? "LOW BATTERY" : bolt ? "CHARGING" : "BATTERY", x0, ly, {
		color: low ? fc : env.sub,
		size: ls,
		track: 0.25,
		alpha: low && env.step % 4 < 1 ? 0.3 : 1,
	});
	if (bolt && !low) {
		const bx = x0 + bw - ls * 5.2;
		const u = ls * 0.9;
		g.p(
			[
				[bx + u * 0.2, ly - u],
				[bx - u * 0.5, ly + u * 0.15],
				[bx - u * 0.02, ly + u * 0.15],
				[bx - u * 0.25, ly + u],
				[bx + u * 0.5, ly - u * 0.2],
				[bx + u * 0.02, ly - u * 0.2],
			],
			ac,
		);
	}
	env.fitMain(txt, x0 + bw / 2, y0 + bh / 2, iw * 0.9, ih * 0.8, env.fg, null, port ? 5 : 3, (port ? iw : ih) * 0.5);
}

/** 重なる窓 — error pop-ups cascade across the screen one after another; the last one on top carries the lyric. */
function drawPopups(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const k = env.int(1, 3, 6);
	const CASCADE_DIRECTIONS = [
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1],
	] as const;
	const [dirX, dirY] = CASCADE_DIRECTIONS[env.hash(2) % 4];
	const icon = env.pick(3, ["warn", "info", "stop"]);
	const dw = W * (port ? 0.74 : 0.56);
	const dh = H * (port ? 0.3 : 0.52);
	const stx = M * 0.042 * dirX;
	const sty = M * 0.036 * dirY;
	const win = env.paperOf();
	const ink = env.onCol(win);
	const ac = env.accOn(win);
	const tb0 = mixHex({ from: win, progress: 0.55, to: ink });
	const faint = mixHex({ from: win, progress: 0.22, to: ink });
	const th = M * 0.05;
	for (let i = 0; i < k; i++) {
		const top = i === k - 1;
		const d = i * 0.085;
		const e = env.inB(0.3, d, 1.5);
		const a = env.clamp((env.lt - d) / 0.08) * env.out;
		if (a <= 0) continue;
		const cx = W / 2 + (i - (k - 1) / 2) * stx;
		const cy = H / 2 + (i - (k - 1) / 2) * sty;
		const x0 = cx - dw / 2;
		const y0 = cy - dh / 2;
		const g = new X2CShapes(env, a);
		env.pose(cx, cy, { s: 0.7 + 0.3 * e }, () => {
			g.r(x0, y0, dw, dh, win);
			g.r(x0, y0, dw, th, top ? ac : tb0);
			g.rs(x0, y0, dw, dh, 0, ink, env.lw * 2);
			const on = env.onCol(top ? ac : tb0);
			const bx = x0 + dw - th * 0.5;
			const u = th * 0.17;
			g.l(bx - u, y0 + th / 2 - u, bx + u, y0 + th / 2 + u, on, env.lw * 2);
			g.l(bx - u, y0 + th / 2 + u, bx + u, y0 + th / 2 - u, on, env.lw * 2);
			g.t(top ? "ERROR" : `ERROR (${i + 1})`, x0 + th * 0.4, y0 + th / 2, {
				color: on,
				size: ls * 0.95,
				track: 0.2,
			});
			if (!top) {
				g.greek(x0 + dw * 0.08, y0 + th + dh * 0.1, dw * 0.5, 2, dh * 0.07, faint, env.seed + i, 1, 0.36, 1.5);
				return;
			}
			const bh = dh - th;
			const ix = x0 + dw * 0.1;
			const iy = y0 + th + bh * 0.82;
			const ir = Math.min(bh * 0.085, M * 0.03);
			if (icon === "warn") {
				g.p(
					[
						[ix, iy - ir * 1.1],
						[ix + ir * 1.2, iy + ir * 0.9],
						[ix - ir * 1.2, iy + ir * 0.9],
					],
					ac,
				);
			} else if (icon === "stop") {
				g.rr(ix - ir, iy - ir, ir * 2, ir * 2, ir * 0.5, ac);
			} else {
				g.c(ix, iy, ir, ac);
			}
			g.t(icon === "info" ? "i" : "!", ix, iy + (icon === "warn" ? ir * 0.25 : 0), {
				color: env.onCol(ac),
				align: "center",
				size: ir * 1.2,
				track: 0,
			});
			const bw2 = Math.min(dw * 0.24, M * 0.22);
			const bh2 = bh * 0.14;
			g.r(x0 + dw * 0.93 - bw2, iy - bh2 / 2, bw2, bh2, ink);
			g.t("OK", x0 + dw * 0.93 - bw2 / 2, iy, {
				color: win,
				align: "center",
				size: Math.min(ls, bh2 * 0.5),
			});
			g.rs(x0 + dw * 0.9 - bw2 * 2, iy - bh2 / 2, bw2 * 0.9, bh2, 0, ink, env.lw * 1.5);
			env.fitMain(txt, cx, y0 + th + bh * 0.36, dw * 0.86, bh * 0.56, ink, null, 3, bh * 0.36);
		});
	}
}

/** 着信画面 — an incoming call: ringing avatar with ripples, the lyric as the caller's name, decline / accept buttons. */
function drawIncoming(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const flip = env.chance(1, 0.35);
	const ring = Number.parseInt(env.pick(2, ["2", "3"]));
	const who = env.pick(3, ["person", "heart", "q"]);
	const ac = env.accOn(env.bg);
	const ac2 = env.acc2On(env.bg);
	const plate = env.paperOf();
	const pin = env.onCol(plate);
	const ar = M * (port ? 0.12 : 0.13);
	const ax = port ? W / 2 : W * (flip ? 0.79 : 0.21);
	const ay = port ? H * 0.2 : H * 0.44;
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const ae = env.inB(0.45, 0, 1.4);
	for (let i = 0; i < ring; i++) {
		const k = (((env.ltb * 0.7 + i / ring) % 1) + 1) % 1;
		g.cs(ax, ay, ar * (1 + k * 0.75), ac, env.lw * 2.5, (1 - k) * 0.8 * env.clamp(env.lt / 0.3));
	}
	g.c(ax, ay, ar * ae, plate);
	if (ae > 0.5) {
		if (who === "person") {
			g.c(ax, ay - ar * 0.2, ar * 0.3, pin, 0.85);
			g.rr(ax - ar * 0.52, ay + ar * 0.24, ar * 1.04, ar * 0.56, ar * 0.3, pin, 0.85);
		} else if (who === "heart") {
			const u = ar * 0.3;
			g.c(ax - u * 0.62, ay - u * 0.3, u * 0.75, ac);
			g.c(ax + u * 0.62, ay - u * 0.3, u * 0.75, ac);
			g.p(
				[
					[ax - u * 1.3, ay + u * 0.08],
					[ax + u * 1.3, ay + u * 0.08],
					[ax, ay + u * 1.5],
				],
				ac,
			);
		} else {
			g.t("?", ax, ay, { color: pin, align: "center", size: ar * 1.1, track: 0 });
		}
	}
	const tx = port ? W / 2 : W * (flip ? 0.35 : 0.65);
	const tw = port ? W * 0.86 : W * 0.52;
	const ty = port ? H * 0.5 : H * 0.42;
	const thh = port ? H * 0.28 : H * 0.36;
	const dots = env.step % 4 > 2 ? 3 : env.step % 4;
	g.t("INCOMING CALL" + ".".repeat(dots), tx, ty - thh / 2 - ls * 2, {
		color: ac,
		align: "center",
		size: ls * 1.1,
		track: 0.3,
		alpha: env.inC(0.3, 0.2),
	});
	const br = M * 0.058;
	const by = port ? H * 0.84 : H * 0.8;
	const bdx = port ? W * 0.24 : Math.min(tw * 0.3, M * 0.24);
	for (const [s, c, ok] of [
		[-1, ac2, 0],
		[1, ac, 1],
	] as const) {
		const be = env.inB(0.4, 0.25 + ok * 0.08, 1.6);
		const bx = tx + s * bdx;
		const wob = ok ? 1 + 0.05 * Math.sin(env.ltb * 9) : 1;
		const on = env.onCol(c);
		if (be <= 0) continue;
		env.pose(
			bx,
			by,
			{
				rot: ok
					? Math.sin(env.ltb * 18) *
						5 *
						env.smooth(0.2, 0, (((env.ltb * 0.9) % 1) + 1) % 1 - 0.5)
					: 0,
				s: be * wob,
			},
			() => {
				g.c(bx, by, br, c);
				if (ok) {
					g.arc(bx, by - br * 0.3, br * 0.52, 35, 145, on, br * 0.24);
					g.c(bx - br * 0.44, by, br * 0.15, on);
					g.c(bx + br * 0.44, by, br * 0.15, on);
				} else {
					g.l(bx - br * 0.32, by - br * 0.32, bx + br * 0.32, by + br * 0.32, on, br * 0.16);
					g.l(bx - br * 0.32, by + br * 0.32, bx + br * 0.32, by - br * 0.32, on, br * 0.16);
				}
			},
		);
	}
	for (let i = 0; i < 3; i++) {
		const k = (env.step + i) % 3 === 0 ? 1 : 0.35;
		g.pl(
			[
				[tx - br * 0.5 + i * br * 0.4, by - br * 0.22],
				[tx - br * 0.3 + i * br * 0.4, by],
				[tx - br * 0.5 + i * br * 0.4, by + br * 0.22],
			],
			env.sub,
			env.lw * 2,
			k * env.clamp((env.lt - 0.4) / 0.2),
		);
	}
	const cutStart =
		(options.frame.cut?.startTime ?? 0) / TICKS_PER_SECOND;
	g.t(mmss(cutStart), tx, ty + thh / 2 + ls * 1.6, {
		color: env.sub,
		align: "center",
		size: ls,
		alpha: env.inC(0.3, 0.3),
	});
	env.fitMain(txt, tx, ty, tw, thh, env.fg, null, port ? 4 : 3, M * 0.24);
}

/** 速度計 — a ring gauge winds up around the lyric: ticks, red zone, a marker riding the arc, digital read-out in the gap. */
function drawGauge(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, txt, ls } = env;
	const v0 = env.range(1, 0.55, 0.98);
	const unit = env.pick(2, ["km/h", "rpm", "bpm"]);
	const max = Number.parseInt(env.pick(3, ["180", "240", "320"]));
	const seg = env.chance(4, 0.4);
	const cx = W / 2;
	const cy = H * 0.5;
	const Rr = M * 0.39;
	const A0 = 135;
	const SW = 270;
	const ac = env.accOn(env.bg);
	const ac2 = env.acc2On(env.bg);
	const faint = env.dim;
	const e = env.inE(0.6);
	const g = new X2CShapes(env, env.out);
	const th = M * 0.03;
	const wind = env.clamp((env.lt - 0.1) / 0.75);
	const v = env.clamp(
		v0 * (wind >= 1 ? 1 : outBack({ overshoot: 1.2, value: wind })) +
			(wind >= 1 ? env.noise(env.ltb * 3, 9) * 0.025 : 0),
	);
	g.arc(cx, cy, Rr, A0, A0 + SW * e, faint, th);
	g.arc(cx, cy, Rr + th * 0.95, A0 + SW * 0.8, A0 + SW * Math.max(0.8, e), ac2, th * 0.25);
	const nT = 36;
	for (let i = 0; i <= nT; i++) {
		if (i / nT > e) break;
		const a = degrees(A0 + (SW * i) / nT);
		const major = i % 4 === 0;
		const r0 = Rr + th * 0.75;
		const r1 = r0 + th * (major ? 0.9 : 0.45);
		g.l(
			cx + Math.cos(a) * r0,
			cy + Math.sin(a) * r0,
			cx + Math.cos(a) * r1,
			cy + Math.sin(a) * r1,
			i / nT >= 0.8 ? ac2 : env.sub,
			env.lw * (major ? 2.5 : 1.3),
			major ? 1 : 0.7,
		);
	}
	if (seg) {
		const ns = 27;
		for (let i = 0; i < Math.round(v * ns); i++) {
			g.arc(cx, cy, Rr, A0 + (SW * i) / ns + 0.8, A0 + (SW * (i + 1)) / ns - 0.8, i / ns >= 0.8 ? ac2 : ac, th);
		}
	} else {
		g.arc(cx, cy, Rr, A0, A0 + SW * v, ac, th);
	}
	const ma = degrees(A0 + SW * v);
	const mr = Rr - th * 0.75;
	const ux = Math.cos(ma);
	const uy = Math.sin(ma);
	if (env.lt > 0.1) {
		g.p(
			[
				[cx + ux * (mr + th * 0.2), cy + uy * (mr + th * 0.2)],
				[cx + ux * (mr - th * 0.9) - uy * th * 0.5, cy + uy * (mr - th * 0.9) + ux * th * 0.5],
				[cx + ux * (mr - th * 0.9) + uy * th * 0.5, cy + uy * (mr - th * 0.9) - ux * th * 0.5],
			],
			env.fg,
		);
	}
	const la = env.inC(0.3, 0.2);
	g.t(String(Math.round(v * max)).padStart(3, "0"), cx, cy + Rr * 0.74, {
		color: env.fg,
		align: "center",
		size: Rr * 0.17,
		track: 0.08,
		alpha: la,
	});
	g.t(unit, cx, cy + Rr * 0.93, { color: env.sub, align: "center", size: ls, track: 0.2, alpha: la });
	g.t("0", cx - Rr * 0.52, cy + Rr * 0.62, { color: env.sub, align: "center", size: ls, alpha: la });
	g.t(String(max), cx + Rr * 0.52, cy + Rr * 0.62, { color: ac2, align: "center", size: ls, alpha: la });
	env.fitMain(txt, cx, cy - Rr * 0.08, Rr * 1.42, Rr * 0.86, env.fg, null, 3, Rr * 0.5);
}

/** 表計算 — a spreadsheet fills the screen; the lyric sits in the selected (merged) cell, echoed in the formula bar. */
function drawSheet(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const sv = env.int(2, 0, 1);
	const fill = env.chance(3, 0.4);
	const data = env.range(4, 0.2, 0.45);
	const hw = M * 0.06;
	const hh = M * 0.048;
	const fbh = M * 0.075;
	const nC = port ? 4 : 6;
	const nR = port ? 11 : 7;
	const cw = (W - hw) / nC;
	const rh = (H - fbh - hh) / nR;
	const gy = fbh + hh;
	const grid = env.dim;
	const head = mixHex({ from: env.bg, progress: 0.09, to: env.fg });
	const ac = env.accOn(env.bg);
	const g = new X2CShapes(env, env.inC(0.25) * env.out);
	const c0 = port ? 0 : 1;
	const c1 = port ? nC - 1 : 4;
	const r0 = port ? 3 + sv : 1 + sv;
	const r1 = port ? r0 + 4 : r0 + 3;
	g.r(0, fbh, W, hh, head);
	g.r(0, gy, hw, H - gy, head);
	g.r(hw + c0 * cw, fbh, (c1 - c0 + 1) * cw, hh, ac, 0.3);
	g.r(0, gy + r0 * rh, hw, (r1 - r0 + 1) * rh, ac, 0.3);
	for (let c = 0; c <= nC; c++) {
		const x = hw + c * cw;
		g.l(x, fbh, x, fbh + (H - fbh) * env.inE(0.6, c * 0.03), grid, env.lw);
		if (c < nC) g.t(String.fromCharCode(65 + c), x + cw / 2, fbh + hh / 2, { color: env.sub, size: ls, align: "center" });
	}
	for (let r = 0; r <= nR; r++) {
		const y = gy + r * rh;
		g.l(0, y, W * env.inE(0.6, r * 0.03), y, grid, env.lw);
		if (r < nR) g.t(String(r + 1), hw / 2, y + rh / 2, { color: env.sub, size: ls * 0.9, track: 0, align: "center" });
	}
	for (let c = 0; c < nC; c++) {
		for (let r = 0; r < nR; r++) {
			if (c >= c0 && c <= c1 && r >= r0 && r <= r1) continue;
			if (env.unit(c, r, 5) > data) continue;
			const a = env.inC(0.3, 0.15 + (c + r) * 0.03);
			const num = env.unit(c, r, 6) < 0.5;
			if (num) {
				g.t(String((env.hash(c, r, 8) % 9000) + 100), hw + (c + 0.92) * cw, gy + (r + 0.5) * rh, {
					align: "right",
					color: env.sub,
					size: Math.min(ls, rh * 0.3),
					alpha: a * 0.8,
					track: 0.02,
				});
			} else {
				g.r(hw + (c + 0.08) * cw, gy + (r + 0.5) * rh - rh * 0.07, cw * (0.3 + 0.5 * env.unit(c, r, 7)) * a, rh * 0.14, grid, 1.5);
			}
		}
	}
	g.l(0, fbh, W, fbh, grid, env.lw * 1.5);
	g.rs(M * 0.015, fbh * 0.2, M * 0.1, fbh * 0.6, 0, grid, env.lw * 1.5);
	g.t(`${String.fromCharCode(65 + c0)}${r0 + 1}`, M * 0.065, fbh / 2, { color: env.fg, size: ls, align: "center" });
	g.t("fx", M * 0.145, fbh / 2, { color: env.sub, size: ls * 1.1, track: 0 });
	const ft = [...shortOf(txt.replace(/\s+/g, " "), port ? 12 : 30)];
	const nf = Math.floor(env.clamp((env.lt - 0.1) / 0.5) * ft.length);
	g.t("=" + ft.slice(0, nf).join(""), M * 0.2, fbh / 2, { color: env.fg, size: ls * 1.15, track: 0.04 });
	const sx = hw + c0 * cw;
	const sy = gy + r0 * rh;
	const sw = (c1 - c0 + 1) * cw;
	const shh = (r1 - r0 + 1) * rh;
	const bl = M * 0.006;
	const ins = port ? bl : 0;
	g.r(sx + env.lw, sy + env.lw, sw - env.lw * 2, shh - env.lw * 2, fill ? mixHex({ from: env.bg, progress: 0.14, to: env.ac }) : env.bg);
	if (env.out > 0) {
		env.polyPartial(
			[
				[sx + ins, sy],
				[sx + sw - ins, sy],
				[sx + sw - ins, sy + shh],
				[sx + ins, sy + shh],
				[sx + ins, sy - bl / 2],
			],
			env.inE(0.6, 0.1),
			ac,
			bl,
			env.out,
		);
	}
	const he = env.inB(0.3, 0.55, 1.6);
	g.r(sx + sw - ins - bl * 2 * he, sy + shh - bl * 2 * he, bl * 4 * he, bl * 4 * he, ac);
	g.rs(sx + sw - ins - bl * 2 * he, sy + shh - bl * 2 * he, bl * 4 * he, bl * 4 * he, 0, env.bg, env.lw * 1.5);
	env.fitMain(txt, sx + sw / 2, sy + shh / 2, Math.min(sw * 0.88, W * 0.86), shh * 0.8, env.fg, null, port ? 4 : 3, shh * 0.5);
}

/** ICカード — a plastic chip card flips in: gold chip, contactless waves, dotted number; the lyric where the name is embossed. */
function drawChipCard(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const c = env.pick(1, ["accent", "ink", "paper"]);
	const tilt = Number.parseFloat(env.pick(2, ["-4", "0", "3", "0"]));
	const band = env.chance(3, 0.5);
	const last = env.int(4, 1000, 9999);
	const [cw, ch] = port ? boxIn(W, H, 0.66, 0.82, 0.8) : boxIn(W, H, 1.586, 0.84, 0.8);
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const m = Math.min(cw, ch);
	const card = env.pickPlate(c);
	const ink = env.onCol(card);
	const ac = env.accOn(card);
	const faint = mixHex({ from: card, progress: 0.18, to: ink });
	const e = env.inB(0.5, 0, 1.2);
	const g = new X2CShapes(env, env.inC(0.15) * env.out);
	env.pose(
		W / 2,
		H / 2,
		{ dy: (1 - env.clamp(e)) * M * 0.03, rot: tilt, sx: Math.max(0.02, e) },
		() => {
			g.rr(x0 + M * 0.012, y0 + M * 0.016, cw, ch, m * 0.06, env.dim, 0.6);
			g.rr(x0, y0, cw, ch, m * 0.06, card);
			if (band) {
				g.r(x0, y0 + ch * (port ? 0.26 : 0.3), cw * env.inE(0.6, 0.15), ch * (port ? 0.48 : 0.44), faint);
			}
			const cs = m * 0.17;
			const cxp = x0 + cw * 0.08;
			const cyp = y0 + ch * (port ? 0.08 : 0.1);
			const chh = cs * 0.76;
			g.rr(cxp, cyp, cs, chh, cs * 0.14, ac);
			const cl = mixHex({ from: ac, progress: 0.6, to: env.onCol(ac) });
			g.l(cxp + cs * 0.34, cyp, cxp + cs * 0.34, cyp + chh, cl, env.lw * 1.3);
			g.l(cxp + cs * 0.66, cyp, cxp + cs * 0.66, cyp + chh, cl, env.lw * 1.3);
			g.l(cxp, cyp + chh * 0.5, cxp + cs * 0.34, cyp + chh * 0.5, cl, env.lw * 1.3);
			g.l(cxp + cs * 0.66, cyp + chh * 0.5, cxp + cs, cyp + chh * 0.5, cl, env.lw * 1.3);
			for (let i = 0; i < 3; i++) {
				g.arc(cxp + cs * 1.25, cyp + chh / 2, cs * (0.16 + i * 0.13), -42, 42, ink, env.lw * 2.4, (env.step + 3 - i) % 4 < 3 ? 0.9 : 0.3);
			}
			g.t(`VALID ${pad2((1 + env.hash(3) % 12))}/${26 + (env.hash(4) % 5)}`, x0 + cw * 0.92, cyp + chh / 2, {
				color: ink,
				align: "right",
				size: ls * 0.95,
				alpha: 0.8,
			});
			const ny = y0 + ch * (port ? 0.86 : 0.83);
			const nx = x0 + cw * 0.08;
			const nw = cw * (port ? 0.84 : 0.6);
			const dr = Math.min(nw * 0.016, m * 0.014);
			for (let k = 0; k < 12; k++) {
				if (env.lt < 0.25 + k * 0.03) break;
				g.c(nx + (Math.floor(k / 4) * 0.26 + (k % 4) * 0.05) * nw + dr, ny, dr, ink);
			}
			g.t(String(last), nx + nw * 0.78, ny, {
				color: ink,
				size: dr * 3.4,
				track: 0.14,
				alpha: env.clamp((env.lt - 0.6) / 0.15),
			});
			const lr = m * 0.055;
			const lx = x0 + cw * 0.92 - lr * 1.6;
			if (!port) {
				g.c(lx, ny - lr * 0.1, lr, ac, 0.9);
				g.c(lx + lr * 1.1, ny - lr * 0.1, lr, ink, 0.55);
			}
			env.fitMain(txt, W / 2, y0 + ch * (port ? 0.5 : 0.52), cw * 0.84, ch * (port ? 0.42 : 0.36), ink, null, port ? 4 : 2, ch * (port ? 0.2 : 0.3));
		},
	);
}

/** 紙コップ — a take-away cup with lid and rising steam; the lyric is written on the sleeve. */
function drawPaperCup(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, port, txt } = env;
	const c = env.pick(1, ["accent", "ink"]);
	const steam = env.int(2, 2, 3);
	const ring = env.chance(3, 0.5);
	const chh = H * (port ? 0.56 : 0.7);
	const tw = Math.min(W * 0.8, chh * (port ? 1.1 : 1.02));
	const bwd = tw * 0.74;
	const cx = W / 2;
	const y0 = H * (port ? 0.26 : 0.2);
	const y1 = y0 + chh;
	const paper = env.paperOf();
	const pin = env.onCol(paper);
	let sl = env.pickPlate(c);
	if (contrastOf(sl, paper) < 1.5) sl = mixHex({ from: paper, progress: 0.85, to: pin });
	const ink = env.onCol(sl);
	const lid = mixHex({ from: paper, progress: 0.2, to: pin });
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const wAt = (f: number) => tw + (bwd - tw) * f;
	env.pose(cx, y1, { dy: (1 - e) * H * 0.07, sy: 0.9 + 0.1 * e }, () => {
		for (let i = 0; i < steam; i++) {
			const sx = cx + ((i - (steam - 1) / 2) * tw * 0.2);
			const pts: Pt[] = [];
			const se = env.inE(0.8, 0.3 + i * 0.1);
			for (let k = 0; k <= 12; k++) {
				const f = k / 12;
				pts.push([
					sx + Math.sin(f * 5 - env.ltb * 2.2 + i * 1.7) * tw * 0.025 * (0.3 + f),
					y0 - chh * 0.1 - f * chh * 0.2 * se,
				]);
			}
			g.pl(pts, env.sub, env.lw * 3, 0.6 * se);
		}
		g.p(
			[
				[cx - tw / 2, y0],
				[cx + tw / 2, y0],
				[cx + bwd / 2, y1],
				[cx - bwd / 2, y1],
			],
			paper,
		);
		const f0 = 0.2;
		const f1 = 0.82;
		const ys0 = y0 + chh * f0;
		const ys1 = y0 + chh * f1;
		const w0 = wAt(f0) * 1.03;
		const w1 = wAt(f1) * 1.03;
		const se2 = env.inE(0.5, 0.12);
		g.p(
			[
				[cx - w0 / 2, ys0],
				[cx - w0 / 2 + w0 * se2, ys0],
				[cx - w1 / 2 + w1 * se2, ys1],
				[cx - w1 / 2, ys1],
			],
			sl,
		);
		if (ring) {
			for (const f of [0.06, 0.94]) {
				const yy = ys0 + (ys1 - ys0) * f;
				const ww = (w0 + (w1 - w0) * f) * se2;
				g.l(cx - ww / 2, yy, cx + ww / 2, yy, ink, env.lw * 1.5, 0.5);
			}
		}
		g.rr(cx - tw * 0.54, y0 - chh * 0.055, tw * 1.08, chh * 0.075, chh * 0.025, lid);
		g.rr(cx - tw * 0.45, y0 - chh * 0.095, tw * 0.9, chh * 0.055, chh * 0.02, lid);
		g.rr(cx + tw * 0.2, y0 - chh * 0.082, tw * 0.1, chh * 0.018, chh * 0.009, pin, 0.6);
		env.fitMain(txt, cx, (ys0 + ys1) / 2, w1 * 0.84, (ys1 - ys0) * (ring ? 0.72 : 0.8), ink, null, 4, chh * 0.3);
	});
}

/** Tシャツ — a T-shirt drops in swinging; the lyric is the chest print. */
function drawTshirt(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, txt } = env;
	const c = env.pick(1, ["paper", "ink", "accent"]);
	const neckStyle = env.pick(2, ["round", "v"]);
	const stripe = env.chance(3, 0.5);
	const hang = env.chance(4, 0.5);
	const [sw, sh] = boxIn(W, H, 1.18, 0.92, 0.8);
	const cx = W / 2;
	const y0 = (H - sh) / 2 + (hang ? sh * 0.03 : 0);
	const shirt = env.pickPlate(c);
	const ink = env.onCol(shirt);
	const ac = env.accOn(shirt);
	const rib = mixHex({ from: shirt, progress: 0.25, to: ink });
	const k = env.clamp(env.lt / 0.9);
	const e = env.inE(0.45);
	const swing = Math.sin(k * 9) * (1 - k) * (1 - k) * 9;
	const g = new X2CShapes(env, env.inC(0.15) * env.out);
	const X = (f: number) => cx + f * sw;
	const Y = (f: number) => y0 + f * sh;
	env.pose(cx, y0 - sh * 0.08, { dy: -(1 - e) * H * 0.2, rot: swing }, () => {
		if (hang) {
			const hc = mixHex({ from: env.bg, progress: 0.5, to: env.fg });
			g.arc(cx, Y(-0.07), sh * 0.025, 180, 450, hc, env.lw * 3);
			g.l(cx, Y(-0.045), cx, Y(-0.01), hc, env.lw * 3);
			g.pl([[X(-0.3), Y(0.09)], [cx, Y(-0.01)], [X(0.3), Y(0.09)]], hc, env.lw * 3);
		}
		const neck: Pt[] = [];
		if (neckStyle === "round") {
			for (let q = 0; q <= 10; q++) {
				const a = Math.PI * (1 - q / 10);
				neck.push([cx + Math.cos(a) * sw * 0.13, Y(0) + Math.sin(a) * sw * 0.085]);
			}
		} else {
			neck.push([X(-0.13), Y(0)], [cx, Y(0.15)], [X(0.13), Y(0)]);
		}
		g.p(
			[
				...neck,
				[X(0.5), Y(0.2)],
				[X(0.42), Y(0.4)],
				[X(0.31), Y(0.31)],
				[X(0.31), Y(1)],
				[X(-0.31), Y(1)],
				[X(-0.31), Y(0.31)],
				[X(-0.42), Y(0.4)],
				[X(-0.5), Y(0.2)],
			],
			shirt,
		);
		g.pl(
			neck.map(([px, py]) => [px, py + sh * 0.014] as Pt),
			rib,
			sh * 0.028,
		);
		if (stripe) {
			for (const s of [-1, 1]) {
				g.pl([[X(s * 0.455), Y(0.24)], [X(s * 0.385), Y(0.345)]], ac, sh * 0.03);
			}
		}
		g.r(X(-0.31) + sw * 0.03, Y(0.93), sw * 0.07, sh * 0.03, ac, env.inC(0.3, 0.4));
		env.fitMain(txt, cx, Y(0.6), sw * 0.53, sh * 0.5, ink, null, 4, sh * 0.3);
	});
}

/** 携帯ゲーム機 — a handheld console (sideways in landscape, upright in portrait): the lyric on its screen, pad and buttons being pressed. */
function drawHandheld(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, port, txt } = env;
	const c = env.pick(1, ["paper", "accent", "ink"]);
	const lines = env.chance(2, 0.5);
	const bw = W * (port ? 0.86 : 0.9);
	const bh = H * (port ? 0.8 : 0.76);
	const x0 = (W - bw) / 2;
	const y0 = (H - bh) / 2;
	const m = Math.min(bw, bh);
	const body = env.pickPlate(c);
	const on = env.onCol(body);
	const dk = mixHex({ from: body, progress: 0.78, to: on });
	const mid = mixHex({ from: body, progress: 0.3, to: on });
	const ac = env.accOn(body);
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const hot = (env.step >> 1) % 4;
	const sw = port ? bw * 0.84 : bw * 0.5;
	const shh = port ? bh * 0.44 : bh * 0.72;
	const sx = W / 2 - sw / 2;
	const sy = port ? y0 + bh * 0.07 : H / 2 - shh / 2;
	env.pose(W / 2, H / 2, { dy: (1 - e) * H * 0.06, s: 0.95 + 0.05 * e }, () => {
		g.rr(x0, y0, bw, bh, m * (port ? 0.08 : 0.16), body);
		g.rr(sx - m * 0.03, sy - m * 0.03, sw + m * 0.06, shh + m * 0.06, m * 0.03, dk);
		const on2 = env.clamp((env.lt - 0.15) / 0.2) * (env.lt < 0.5 && env.step % 2 ? 0.5 : 1);
		g.r(sx, sy, sw, shh, env.bg, on2);
		if (lines) {
			for (let i = 1; i < 14; i++) {
				g.l(sx, sy + (shh * i) / 14, sx + sw, sy + (shh * i) / 14, env.fg, env.lw, 0.06 * on2);
			}
		}
		const dx = port ? x0 + bw * 0.25 : x0 + bw * 0.125;
		const dy = port ? y0 + bh * 0.74 : H / 2;
		const al = m * (port ? 0.26 : 0.3);
		const aw = al * 0.34;
		g.rr(dx - al / 2, dy - aw / 2, al, aw, aw * 0.2, dk);
		g.rr(dx - aw / 2, dy - al / 2, aw, al, aw * 0.2, dk);
		const dirs = [
			[1, 0],
			[0, 1],
			[-1, 0],
			[0, -1],
		][hot] ?? [0, 0];
		g.c(dx + dirs[0] * al * 0.33, dy + dirs[1] * al * 0.33, aw * 0.26, ac, env.clamp((env.lt - 0.4) / 0.1));
		const br = m * (port ? 0.065 : 0.075);
		const ax = port ? x0 + bw * 0.82 : x0 + bw * 0.915;
		const ay = port ? y0 + bh * 0.7 : H / 2 - br * 0.9;
		const bx = port ? x0 + bw * 0.64 : x0 + bw * 0.815;
		const by = port ? y0 + bh * 0.76 : H / 2 + br * 0.9;
		g.c(ax, ay, br * env.inB(0.3, 0.2), hot === 1 ? ac : dk);
		g.c(bx, by, br * env.inB(0.3, 0.27), hot === 3 ? ac : dk);
		g.t("A", ax, ay, { color: body, align: "center", size: br * 0.8, track: 0 });
		g.t("B", bx, by, { color: body, align: "center", size: br * 0.8, track: 0 });
		const py = y0 + bh * 0.9;
		const px = port ? W / 2 : x0 + bw * 0.125;
		for (const s of [-1, 1]) {
			env.pose(px + s * m * 0.07, py, { rot: -25 }, () => {
				g.rr(px + s * m * 0.07 - m * 0.045, py - m * 0.012, m * 0.09, m * 0.024, m * 0.012, mid);
			});
		}
		const spx = port ? x0 + bw * 0.8 : x0 + bw * 0.865;
		const spy = port ? y0 + bh * 0.9 : y0 + bh * 0.84;
		for (let i = 0; i < 4; i++) {
			env.pose(spx, spy, { rot: -25 }, () => {
				g.rr(spx - m * 0.05 + i * m * 0.03, spy - m * 0.04, m * 0.012, m * 0.08, m * 0.006, mid);
			});
		}
		g.c(sx - m * 0.012, sy + shh + m * 0.05, m * 0.008, ac, env.step % 6 < 5 ? 1 : 0.3);
		env.fitMain(txt, W / 2, sy + shh / 2, sw * 0.88, shh * 0.8, env.fg, null, port ? 4 : 3, shh * 0.46);
	});
}

/** 黒板 — a classroom board with frame, chalk tray, chalks and eraser; a chalk underline is drawn under the lyric. */
function drawBlackboard(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const ul = env.pick(1, ["wave", "double", "circle"]);
	const doodle = env.pick(2, ["star", "arrow", "none"]);
	const tilt = Number.parseFloat(env.pick(3, ["0", "0", "-1.5"]));
	const bw = W * 0.86;
	const bh = H * (port ? 0.56 : 0.7);
	const x0 = (W - bw) / 2;
	const y0 = (H - bh) / 2 - H * 0.025;
	const board = env.pickPlate("ink");
	const ink = env.onCol(board);
	const ac = env.accOn(board);
	const ac2 = env.acc2On(board);
	const wood = mixHex({ from: env.bg, progress: 0.5, to: env.fg });
	const fr = M * 0.014;
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const o = { lead: 1.25, track: 0.03 };
	env.pose(W / 2, H / 2, { dy: (1 - e) * H * 0.05, rot: tilt }, () => {
		g.r(x0, y0, bw, bh, board);
		g.rs(x0 - fr / 2, y0 - fr / 2, bw + fr, bh + fr, 0, wood, fr);
		g.r(x0 - fr, y0 + bh + fr * 0.9, bw + fr * 2, fr * 1.2, wood);
		const ty = y0 + bh + fr * 0.9;
		const chalks: [number, string, number][] = [
			[0.1, ink, 0.07],
			[0.19, ac, 0.05],
			[0.26, ac2, 0.04],
		];
		chalks.forEach(([fx, col, wl], i) => {
			g.rr(x0 + bw * fx, ty - fr * 0.7, bw * wl * env.inE(0.4, 0.2 + i * 0.06), fr * 0.7, fr * 0.2, col);
		});
		g.r(x0 + bw * 0.8, ty - fr * 1.9, bw * 0.11, fr * 1.9, wood);
		g.r(x0 + bw * 0.8, ty - fr * 0.8, bw * 0.11, fr * 0.8, mixHex({ from: wood, progress: 0.5, to: ink }));
		g.t(`No.${pad2(env.no)}`, x0 + bw * 0.04, y0 + bh * 0.09, {
			color: ink,
			size: ls * 1.2,
			alpha: 0.7 * env.inC(0.3, 0.25),
		});
		const f = env.fitBox(txt, bw * 0.8, bh * 0.52, o, port ? 4 : 3);
		const size = Math.min(f.size, bh * 0.3);
		const item = {
			text: f.text,
			size,
			x: W / 2,
			y: y0 + bh * 0.47,
			lead: o.lead,
			track: o.track,
			color: ink,
		};
		const m = env.measure(item);
		const ue = env.inC(0.5, 0.35);
		const uy = item.y + m.h / 2 + size * 0.2;
		const ux = W / 2 - m.w / 2;
		const cw2 = Math.max(3, size * 0.045);
		if (env.out > 0 && ue > 0) {
			const wav = (yy: number, amp: number, sd: number): Pt[] => {
				const pts: Pt[] = [];
				for (let k = 0; k <= 24; k++) {
					pts.push([
						ux + (m.w * k) / 24,
						yy +
							(ul === "wave" ? Math.sin(k * 0.9) * amp : 0) +
							env.signed(k, sd) * cw2 * 0.4,
					]);
				}
				return pts;
			};
			if (ul === "circle") {
				const pts: Pt[] = [];
				for (let k = 0; k <= 40; k++) {
					const a = -1.9 + (k / 40) * TAU * 1.06;
					pts.push([
						W / 2 +
							Math.cos(a) *
								(m.w / 2 + size * 0.45) *
								(1 + 0.02 * env.signed(k, 2)),
						item.y + Math.sin(a) * (m.h / 2 + size * 0.3),
					]);
				}
				env.polyPartial(pts, ue, ac, cw2, env.out * 0.9);
			} else {
				env.polyPartial(wav(uy, size * 0.05, 1), ue, ac, cw2, env.out * 0.9);
				if (ul === "double") {
					env.polyPartial(wav(uy + cw2 * 2.4, 0, 3), env.inC(0.5, 0.55), ac, cw2 * 0.7, env.out * 0.9);
				}
			}
		}
		const de = env.inC(0.5, 0.5);
		const qx = x0 + bw * 0.9;
		const qy = y0 + bh * 0.87;
		const u = bh * 0.05;
		if (env.out > 0 && de > 0 && doodle === "star") {
			const pts: Pt[] = [];
			for (let k = 0; k <= 5; k++) {
				const a = -Math.PI / 2 + (k * TAU * 2) / 5;
				pts.push([qx + Math.cos(a) * u, qy + Math.sin(a) * u]);
			}
			env.polyPartial(pts, de, ac2, cw2 * 0.7, env.out * 0.9);
		} else if (env.out > 0 && de > 0 && doodle === "arrow") {
			env.polyPartial(
				[
					[qx - u * 2.4, qy + u * 0.4],
					[qx - u, qy - u * 0.3],
					[qx + u * 0.6, qy],
					[qx + u * 0.1, qy - u * 0.6],
					[qx + u * 0.6, qy],
					[qx, qy + u * 0.55],
				],
				de,
				ac2,
				cw2 * 0.7,
				env.out * 0.9,
			);
		}
		env.main(item);
	});
}

/** トラック — a delivery truck drives in with the lyric painted on its cargo box; wheels keep turning, the road slides by. */
function drawTruck(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const dir = Number.parseInt(env.pick(1, ["1", "1", "-1"]));
	const band = env.chance(2, 0.6);
	const c = env.pick(3, ["paper", "paper", "ink"]);
	const cw = W * (port ? 0.66 : 0.6);
	const chh = port ? W * 0.52 : H * 0.52;
	const cabW = W * (port ? 0.2 : 0.15);
	const cabH = chh * 0.66;
	const r = M * (port ? 0.062 : 0.075);
	const gap = W * 0.012;
	const total = cw + gap + cabW;
	const xl = (W - total) / 2;
	const yt = port ? H / 2 - (chh + r * 1.9) / 2 : H * 0.14;
	const yb = yt + chh;
	const gy = yb + r * 1.9;
	const box = env.pickPlate(c);
	const ink = env.onCol(box);
	const cab = env.pickPlate("accent");
	const dk = mixHex({ from: env.bg, progress: 0.55, to: env.fg });
	const ac = env.accOn(box);
	const road = mixHex({ from: env.bg, progress: 0.3, to: env.fg });
	const k = env.clamp(env.lt / 0.8);
	const e = outExpo(k);
	const g = new X2CShapes(env, env.clamp(env.lt / 0.1) * env.out);
	const g0 = new X2CShapes(env, env.inC(0.3) * env.out);
	const mx = (x: number, w = 0) => (dir > 0 ? x : W - x - w);
	const roll = (env.ltb * 3.2 + (1 - e) * 12) * dir;
	g0.l(0, gy, W, gy, road, env.lw * 2);
	for (let i = 0; i < 9; i++) {
		const dxp = (((i / 9 - env.ltb * 0.35 * dir - (1 - e) * 2 * dir) % 1) + 1) % 1;
		g0.r(dxp * W * 1.1 - W * 0.05, gy + r * 0.35, W * 0.045, env.lw * 3, road);
	}
	env.pose(
		W / 2,
		gy,
		{
			dx: -dir * (1 - e) * W * 1.05,
			dy: Math.sin(env.ltb * 11) * M * 0.0015,
			rot: -dir * (1 - k) * (1 - k) * 2.5 * Math.sin(k * 14),
		},
		() => {
			for (let i = 0; i < 3; i++) {
				if ((env.step + i) % 3) {
					g.r(mx(xl - W * (0.05 + 0.02 * i), W * 0.04), yt + chh * (0.25 + i * 0.25), W * 0.04, env.lw * 2.5, env.sub, 0.7);
				}
			}
			g.r(mx(xl + cw * 0.04, total - cw * 0.06), yb, total - cw * 0.06, r * 0.5, dk);
			g.rr(mx(xl, cw), yt, cw, chh, M * 0.012, box);
			if (band) g.r(mx(xl, cw), yb - chh * 0.1, cw, chh * 0.05, ac);
			const cx0 = xl + cw + gap;
			const cy0 = yb - cabH;
			g.rr(mx(cx0, cabW), cy0, cabW, cabH, M * 0.02, cab);
			g.rr(mx(cx0 + cabW * 0.36, cabW * 0.52), cy0 + cabH * 0.12, cabW * 0.52, cabH * 0.38, M * 0.01, env.bg);
			g.r(mx(cx0 + cabW * 0.9, cabW * 0.14), yb - cabH * 0.12, cabW * 0.14, cabH * 0.1, dk);
			g.c(mx(cx0 + cabW * 0.93), yb - cabH * 0.26, cabH * 0.045, env.onCol(cab));
			for (const wx of [xl + cw * 0.2, xl + cw * 0.38, cx0 + cabW * 0.5]) {
				const x = mx(wx);
				const y = gy - r;
				g.c(x, y, r, dk);
				g.c(x, y, r * 0.5, env.bg);
				g.c(x, y, r * 0.16, dk);
				for (let s = 0; s < 3; s++) {
					const a = roll + (s * TAU) / 3;
					g.l(x, y, x + Math.cos(a) * r * 0.48, y + Math.sin(a) * r * 0.48, dk, env.lw * 3);
				}
			}
			env.fitMain(txt, mx(xl + cw / 2), yt + chh * (band ? 0.44 : 0.5), cw * 0.86, chh * (band ? 0.66 : 0.76), ink, null, port ? 4 : 3, chh * 0.42);
		},
	);
}

/** ナンバー — a vehicle number plate swings down on one bolt and settles: EU band, US slogan or two-row style. */
function drawPlate(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, port, txt } = env;
	const style = env.pick(1, ["eu", "us", "two"]);
	const c = env.pick(2, ["paper", "paper", "accent", "ink"]);
	const side = Number.parseInt(env.pick(3, ["-1", "1"]));
	const [pw, ph] = boxIn(W, H, port ? 1.3 : 2.15, 0.88, 0.7);
	const x0 = (W - pw) / 2;
	const y0 = (H - ph) / 2;
	const r = ph * 0.07;
	const plate = env.pickPlate(c);
	const ink = env.onCol(plate);
	const ac = env.accOn(plate);
	const bolt = mixHex({ from: plate, progress: 0.45, to: ink });
	const k = env.clamp(env.lt / 0.75);
	const sw = k >= 1 ? 0 : Math.cos(k * 10) * (1 - k) * (1 - k) * 16 * side;
	const g = new X2CShapes(env, env.clamp(env.lt / 0.12) * env.out);
	const bxs = [x0 + pw * 0.14, x0 + pw * 0.86];
	const byb = y0 + ph * 0.1;
	const pv = side < 0 ? bxs[0] : bxs[1];
	env.pose(
		pv,
		byb,
		{ dy: -(1 - outExpo(env.clamp(env.lt / 0.3))) * H * 0.12, rot: sw },
		() => {
			g.rr(x0, y0, pw, ph, r, plate);
			g.rs(x0 + ph * 0.035, y0 + ph * 0.035, pw - ph * 0.07, ph - ph * 0.07, r * 0.7, ink, Math.max(env.lw * 2, ph * 0.012));
			const us = style === "us";
			const eu = style === "eu";
			if (!eu) {
				for (const bx of bxs) {
					g.c(bx, byb, ph * 0.028, bolt);
					g.l(bx - ph * 0.016, byb, bx + ph * 0.016, byb, plate, env.lw * 1.5);
				}
			}
			let bx0 = x0 + pw * 0.06;
			let bx1 = x0 + pw * 0.94;
			let by0 = y0 + ph * 0.1;
			let by1 = y0 + ph * 0.9;
			if (eu) {
				const bwd = pw * (port ? 0.13 : 0.09);
				const on = env.onCol(ac);
				g.rr(x0 + ph * 0.07, y0 + ph * 0.07, bwd, ph * 0.86, r * 0.5, ac);
				for (let i = 0; i < 10; i++) {
					const a = (i * TAU) / 10 + env.ltb * 0.3;
					g.c(x0 + ph * 0.07 + bwd / 2 + Math.cos(a) * bwd * 0.26, y0 + ph * 0.32 + Math.sin(a) * bwd * 0.26, bwd * 0.035, on);
				}
				g.t("JZ", x0 + ph * 0.07 + bwd / 2, y0 + ph * 0.74, {
					color: on,
					align: "center",
					size: bwd * 0.36,
					track: 0.05,
				});
				bx0 = x0 + ph * 0.07 + bwd + pw * 0.03;
			} else if (us) {
				g.t(shortOf(txt.toUpperCase(), port ? 10 : 18), W / 2, y0 + ph * 0.13, {
					color: ac,
					align: "center",
					size: ph * 0.07,
					track: 0.2,
				});
				g.t(`· LINE ${pad2(env.no)} ·`, W / 2, y0 + ph * 0.88, {
					color: ink,
					align: "center",
					size: ph * 0.055,
					track: 0.3,
					alpha: 0.8,
				});
				g.rr(x0 + pw * 0.9 - ph * 0.05, y0 + ph * 0.8, ph * 0.1, ph * 0.1, ph * 0.02, ac, env.inB(0.3, 0.5));
				by0 = y0 + ph * 0.2;
				by1 = y0 + ph * 0.8;
			} else {
				g.t(`${shortOf(txt, 4)}  ${300 + (env.hash(3) % 500)}`, W / 2, y0 + ph * 0.17, {
					color: ink,
					align: "center",
					size: ph * 0.1,
					track: 0.1,
				});
				g.t(pad2(env.no), x0 + pw * 0.1, y0 + ph * 0.6, {
					color: ink,
					align: "center",
					size: ph * 0.11,
					track: 0,
				});
				g.c(x0 + pw * 0.9, y0 + ph * 0.6, ph * 0.02, ink);
				bx0 = x0 + pw * 0.16;
				bx1 = x0 + pw * 0.86;
				by0 = y0 + ph * 0.28;
			}
			env.fitMain(
				txt,
				(bx0 + bx1) / 2,
				(by0 + by1) / 2,
				(bx1 - bx0) * 0.94,
				(by1 - by0) * 0.86,
				ink,
				{ lead: 1.12, track: 0.04 },
				port ? 3 : 2,
				ph * 0.6,
			);
		},
	);
}

/** プルダウン — a select box drops its menu open; the highlight slides down to the row that holds the lyric and a pointer clicks it. */
function drawDropdown(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const nr = env.int(1, 3, 4);
	const hi = Math.min(env.int(2, 0, 3), nr - 1);
	const check = env.chance(3, 0.5);
	const mw = W * (port ? 0.88 : 0.72);
	const x0 = (W - mw) / 2;
	const u = M * 0.082;
	const sbh = M * 0.095;
	const gap = M * 0.016;
	const hh = Math.min(H * (port ? 0.3 : 0.42), H * 0.84 - sbh - gap - (nr - 1) * u);
	const toth = sbh + gap + (nr - 1) * u + hh;
	const y0 = (H - toth) / 2;
	const win = env.paperOf();
	const ink = env.onCol(win);
	const faint = mixHex({ from: win, progress: 0.22, to: ink });
	const ac = env.accOn(win);
	const on = env.onCol(ac);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const e = env.inE(0.32, 0.04);
	const my = y0 + sbh + gap;
	const mh = toth - sbh - gap;
	g.rr(x0, y0, mw, sbh, M * 0.014, win);
	g.rs(x0, y0, mw, sbh, M * 0.014, ac, env.lw * 3);
	g.t(shortOf(txt, port ? 12 : 26), x0 + sbh * 0.4, y0 + sbh / 2, {
		color: ink,
		size: sbh * 0.34,
		track: 0.04,
		alpha: 0.75,
	});
	const cx = x0 + mw - sbh * 0.5;
	const cu = sbh * 0.13;
	const fl = e > 0.5 ? -1 : 1;
	g.pl(
		[
			[cx - cu, y0 + sbh / 2 - (cu * 0.5 * fl)],
			[cx, y0 + sbh / 2 + (cu * 0.5 * fl)],
			[cx + cu, y0 + sbh / 2 - (cu * 0.5 * fl)],
		],
		ink,
		env.lw * 3,
	);
	g.rr(x0 + M * 0.01, my + M * 0.012, mw, mh * e, M * 0.014, env.dim, 0.6);
	g.rr(x0, my, mw, mh * e, M * 0.014, win);
	const rowY = (i: number) => my + i * u + (i > hi ? hh - u : 0);
	const sl = outCubic(env.clamp((env.lt - 0.22) / 0.25));
	const hy = rowY(hi);
	const hhh = hh;
	for (let i = 0; i < nr; i++) {
		const ry = rowY(i);
		const rh = i === hi ? hh : u;
		if (ry + rh > my + mh * e + 1) break;
		if (i === hi) continue;
		g.r(x0 + mw * 0.08, ry + rh / 2 - u * 0.1, mw * (0.22 + 0.3 * env.unit(i, 4)), u * 0.2, faint, 1.6);
		if (i < nr - 1 && i + 1 !== hi) g.l(x0 + mw * 0.03, ry + rh, x0 + mw * 0.97, ry + rh, faint, env.lw);
	}
	if (hy + M * 0.03 < my + mh * e) {
		g.rr(x0 + M * 0.008, hy + M * 0.006, (mw - M * 0.016) * (0.3 + 0.7 * sl), Math.min(hhh, my + mh * e - hy) - M * 0.012, M * 0.01, ac, sl);
		if (check && sl >= 1) {
			const kx = x0 + mw * 0.045;
			const ky = hy + hhh / 2;
			const ku = M * 0.014;
			g.pl(
				[
					[kx - ku, ky],
					[kx - ku * 0.2, ky + ku * 0.8],
					[kx + ku * 1.1, ky - ku * 0.9],
				],
				on,
				env.lw * 3.5,
			);
		}
	}
	const pe = env.inE(0.6, 0.35);
	const pk = env.clamp((env.lt - 0.95) / 0.12);
	const click = pk > 0 && pk < 1 ? 0.85 : 1;
	const pu = M * 0.07 * click;
	const px = x0 + mw * 0.9 + (1 - pe) * W * 0.12;
	const py = rowY(hi) + hh * 0.7 + (1 - pe) * H * 0.2;
	const arrow = (s: number): Pt[] =>
		[
			[0, 0],
			[0, 1],
			[0.27, 0.77],
			[0.45, 1.17],
			[0.6, 1.1],
			[0.42, 0.71],
			[0.72, 0.71],
		].map(
			([a, b]) =>
				[
					px + a * pu * s - (s - 1) * pu * 0.12,
					py + b * pu * s - (s - 1) * pu * 0.2,
				] as Pt,
		);
	if (env.lt > 0.35) {
		g.p(arrow(1.28), win);
		g.p(arrow(1), ink);
	}
	env.fitMain(txt, W / 2 - mw * 0.02, rowY(hi) + hh / 2, mw * 0.74, hh * 0.76, mixHex({ from: ink, progress: sl, to: on }), null, port ? 4 : 3, hh * 0.5);
}

/** 範囲選択 — the lyric gets selected like text on a phone: the highlight sweeps line by line between two handles, a copy / share bar pops up. */
function drawSelect(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const ui = env.pick(1, ["mobile", "mobile", "desktop"]);
	const align = env.pick(2, ["center", "center", "left"]);
	const o = { lead: 1.34, track: 0.03 };
	const mob = ui === "mobile";
	const f = env.fitBox(txt, W * 0.8, H * (port ? 0.4 : 0.46), o, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.22);
	const lines = f.text.split("\n");
	const L = lines.length;
	const ws = lines.map((s) => textWidth(s, size, o.track));
	const mwid = Math.max(...ws);
	const cy = H * (mob ? 0.55 : 0.45);
	const pitch = size * o.lead;
	const left = align === "left";
	const xl = W / 2 - mwid / 2;
	const ac = env.accOn(env.bg);
	const g = new X2CShapes(env, env.out);
	const lx0 = (i: number) => (left ? xl : W / 2 - ws[i] / 2);
	const ly = (i: number) => cy + (i - (L - 1) / 2) * pitch;
	const pdx = size * 0.08;
	const sp = env.inC(0.3 + 0.18 * L, 0.2) * L;
	let ex = lx0(0) - pdx;
	let ey = ly(0);
	for (let i = 0; i < L; i++) {
		const k = env.clamp(sp - i);
		if (k <= 0) break;
		g.r(lx0(i) - pdx, ly(i) - pitch / 2, (ws[i] + pdx * 2) * k, pitch, ac, 0.36);
		ex = lx0(i) - pdx + (ws[i] + pdx * 2) * k;
		ey = ly(i);
	}
	env.main({
		text: f.text,
		size,
		x: left ? xl : W / 2,
		y: cy,
		align: left ? "left" : "center",
		lead: o.lead,
		track: o.track,
		color: env.fg,
	});
	const ha = env.clamp((env.lt - 0.15) / 0.1);
	const hr = size * 0.1;
	const hw = Math.max(env.lw * 2, size * 0.035);
	if (mob) {
		const sx = lx0(0) - pdx;
		const sy = ly(0);
		g.r(sx - hw / 2, sy - pitch / 2, hw, pitch + hr, ac, ha);
		g.c(sx, sy + pitch / 2 + hr * 1.5, hr, ac, ha);
		g.r(ex - hw / 2, ey - pitch / 2, hw, pitch + hr, ac, ha);
		g.c(ex, ey + pitch / 2 + hr * 1.5, hr, ac, ha);
		const bar = env.paperOf();
		const bin = env.onCol(bar);
		const be = env.inB(0.35, 0.5 + 0.12 * L, 1.5);
		const bw = Math.min(W * 0.8, M * 0.62);
		const bh = M * 0.08;
		const by = ly(0) - pitch / 2 - bh - M * 0.035;
		const gb = new X2CShapes(env, env.clamp((env.lt - 0.5 - 0.12 * L) / 0.1) * env.out);
		if (be > 0) {
			env.pose(W / 2, by + bh, { s: be }, () => {
				gb.rr(W / 2 - bw / 2, by, bw, bh, bh * 0.25, bar);
				gb.p(
					[
						[W / 2 - bh * 0.22, by + bh - 1],
						[W / 2 + bh * 0.22, by + bh - 1],
						[W / 2, by + bh * 1.26],
					],
					bar,
				);
				const labs = isLatinText(txt)
					? ["Copy", "Share", "Search"]
					: ["コピー", "共有", "検索"];
				labs.forEach((s, i) => {
					gb.t(s, W / 2 + (i - 1) * (bw / 3), by + bh / 2, {
						color: bin,
						align: "center",
						size: bh * 0.36,
						track: 0.04,
					});
					if (i) gb.l(W / 2 + (i - 1.5) * (bw / 3), by + bh * 0.25, W / 2 + (i - 1.5) * (bw / 3), by + bh * 0.75, bin, env.lw, 0.35);
				});
			});
		}
	} else {
		if (env.step % 4 < 3 || sp < L) {
			g.r(ex - hw / 2, ey - pitch * 0.46, hw, pitch * 0.92, env.fg, ha);
			g.r(ex - hw * 2, ey - pitch * 0.46, hw * 4, hw * 0.8, env.fg, ha);
			g.r(ex - hw * 2, ey + pitch * 0.46 - hw * 0.8, hw * 4, hw * 0.8, env.fg, ha);
		}
		const menu = env.paperOf();
		const min = env.onCol(menu);
		const me = env.inB(0.3, 0.55 + 0.12 * L, 1.4);
		const mw2 = M * 0.34;
		const rh = M * 0.058;
		const mh = rh * 3 + M * 0.016;
		const mx = Math.min(Math.max(ex + M * 0.02, W * 0.08), W * 0.94 - mw2);
		const my = Math.min(ly(L - 1) + pitch / 2 + M * 0.03, H * 0.95 - mh);
		const gm = new X2CShapes(env, env.clamp((env.lt - 0.55 - 0.12 * L) / 0.1) * env.out);
		if (me > 0) {
			env.pose(mx, my, { s: me }, () => {
				gm.r(mx + M * 0.008, my + M * 0.01, mw2, mh, env.dim, 0.7);
				gm.r(mx, my, mw2, mh, menu);
				gm.rs(mx, my, mw2, mh, 0, min, env.lw * 1.5);
				const hot = Math.min(2, Math.floor(Math.max(0, env.lt - 0.8 - 0.12 * L) / 0.35));
				const labs = isLatinText(txt)
					? ["Copy", "Cut", "Search…"]
					: ["コピー", "切り取り", "検索…"];
				const keys = ["Ctrl+C", "Ctrl+X", ""];
				labs.forEach((s, i) => {
					const ry = my + M * 0.008 + i * rh;
					if (i === hot) gm.r(mx + env.lw * 2, ry, mw2 - env.lw * 4, rh, env.accOn(menu));
					const col = i === hot ? env.onCol(env.accOn(menu)) : min;
					gm.t(s, mx + rh * 0.5, ry + rh / 2, { color: col, size: rh * 0.44, track: 0.04 });
					gm.t(keys[i], mx + mw2 - rh * 0.4, ry + rh / 2, { color: col, align: "right", size: rh * 0.34, alpha: 0.7 });
				});
			});
		}
	}
}

/** ラジオ — a transistor radio: the tuner needle slides along the dial and settles, knobs turn, the lyric shows in the window. */
function drawRadio(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, port, txt, ls } = env;
	const c = env.pick(1, ["paper", "accent", "ink"]);
	const f0 = env.range(2, 0.2, 0.85);
	const ant = Number.parseInt(env.pick(3, ["-1", "1"]));
	const flip = env.chance(4, 0.4);
	const bw = W * 0.88;
	const bh = H * (port ? 0.66 : 0.72);
	const x0 = (W - bw) / 2;
	const y0 = (H - bh) / 2 + H * 0.035;
	const m = Math.min(bw, bh);
	const body = env.pickPlate(c);
	const on = env.onCol(body);
	const dk = mixHex({ from: body, progress: 0.8, to: on });
	const mid = mixHex({ from: body, progress: 0.3, to: on });
	const ac = env.accOn(dk);
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const fl = flip && !port;
	const rx0 = port ? x0 + bw * 0.06 : fl ? x0 + bw * 0.04 : x0 + bw * 0.3;
	const rw = port ? bw * 0.88 : bw * 0.66;
	const ty = y0 + bh * (port ? 0.06 : 0.09);
	const thh = bh * (port ? 0.09 : 0.15);
	const wy = ty + thh + bh * 0.04;
	const wh = port ? bh * 0.42 : bh * 0.5;
	env.pose(W / 2, H / 2, { dy: (1 - e) * H * 0.06 }, () => {
		const ae = env.inE(0.6, 0.25);
		const axp = x0 + bw * (ant > 0 ? 0.88 : 0.12);
		g.l(axp, y0 + 2, axp + ant * bw * 0.06 * ae, y0 - H * 0.085 * ae, mid, env.lw * 3);
		g.c(axp + ant * bw * 0.06 * ae, y0 - H * 0.085 * ae, env.lw * 4, mid);
		g.rr(x0, y0, bw, bh, m * 0.06, body);
		g.rr(rx0, ty, rw, thh, thh * 0.12, dk);
		const don = env.onCol(dk);
		for (let i = 0; i <= 32; i++) {
			const x = rx0 + rw * (0.04 + (0.92 * i) / 32);
			const mj = i % 4 === 0;
			g.l(x, ty + thh * (mj ? 0.42 : 0.56), x, ty + thh * 0.8, don, env.lw * (mj ? 1.6 : 1), mj ? 0.9 : 0.5);
			if (mj && (!port || i % 8 === 0)) {
				g.t(String(76 + i), x, ty + thh * 0.24, {
					color: don,
					align: "center",
					size: Math.min(ls * 0.85, thh * 0.24),
					track: 0,
					alpha: 0.8,
				});
			}
		}
		const tk = env.clamp((env.lt - 0.15) / 0.9);
		const nf =
			env.lerpN(0.02, f0, outCubicSlide(tk)) +
			(tk < 1 ? Math.sin(tk * 30) * 0.03 * (1 - tk) : env.noise(env.ltb * 1.5, 11) * 0.004);
		const nx = rx0 + rw * (0.04 + 0.92 * env.clamp(nf));
		g.r(nx - env.lw * 1.5, ty + thh * 0.06, env.lw * 3, thh * 0.88, ac);
		g.rr(rx0, wy, rw, wh, m * 0.02, dk);
		g.r(rx0 + env.lw * 4, wy + env.lw * 4, rw - env.lw * 8, wh - env.lw * 8, env.bg, env.clamp((env.lt - 0.15) / 0.2));
		const scx = port ? x0 + bw * 0.27 : fl ? x0 + bw * 0.84 : x0 + bw * 0.16;
		const scy = port ? y0 + bh * 0.8 : y0 + bh * 0.5;
		const sr = port ? Math.min(bh * 0.14, bw * 0.2) : Math.min(bw * 0.113, bh * 0.36);
		const nd = 9;
		const dp = (sr * 2) / nd;
		for (let i = 0; i < nd; i++) {
			for (let j = 0; j < nd; j++) {
				const dx = (i - (nd - 1) / 2) * dp;
				const dy = (j - (nd - 1) / 2) * dp;
				const d = Math.hypot(dx, dy);
				if (d > sr) continue;
				if (env.lt < 0.15 + (d / sr) * 0.25) continue;
				g.c(scx + dx, scy + dy, dp * 0.26, dk);
			}
		}
		const ky = port ? y0 + bh * 0.8 : wy + wh + (y0 + bh - wy - wh) / 2;
		const kr = port ? bh * 0.055 : Math.min((y0 + bh - wy - wh) * 0.3, bh * 0.07);
		const knobs: [number, number, string][] = [
			[port ? x0 + bw * 0.62 : rx0 + rw * 0.72, nf * 5, "TUNE"],
			[port ? x0 + bw * 0.84 : rx0 + rw * 0.92, 0.8 + Math.sin(env.ltb * 0.7) * 0.2, "VOL"],
		];
		knobs.forEach(([kx, a, lab], i) => {
			g.c(kx, ky, kr * env.inB(0.3, 0.2 + i * 0.08), dk);
			g.l(kx, ky, kx + Math.cos(a) * kr * 0.85, ky + Math.sin(a) * kr * 0.85, don, env.lw * 2.5);
			g.t(lab, kx - kr * 1.4, ky, { color: on, align: "right", size: Math.min(ls * 0.85, kr * 0.5), alpha: 0.75 });
		});
		if (!port) {
			const sx = rx0 + rw * 0.02;
			const swd = rw * 0.16;
			g.rr(sx, ky - kr * 0.42, swd, kr * 0.84, kr * 0.42, mid);
			g.rr(sx + (options.frame.exitProgress > 0 ? 0 : swd * 0.5), ky - kr * 0.42, swd * 0.5, kr * 0.84, kr * 0.42, dk);
			g.t("AM  FM", sx + swd + kr * 0.4, ky, { color: on, size: Math.min(ls * 0.85, kr * 0.5), alpha: 0.75 });
		}
		env.fitMain(txt, rx0 + rw / 2, wy + wh / 2, rw * 0.88, wh * 0.76, env.fg, null, port ? 4 : 3, wh * 0.5);
	});
}

function outCubicSlide(value: number): number {
	return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

/** フロッピー — a 3.5-inch floppy disk slides in, its metal shutter snaps across, and the lyric is on the paper label. */
function drawFloppy(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, txt } = env;
	const c = env.pick(1, ["ink", "accent", "ink"]);
	const tilt = Number.parseFloat(env.pick(2, ["0", "-3", "3", "0"]));
	const from = Number.parseInt(env.pick(3, ["-1", "1"]));
	const ruled = env.chance(4, 0.6);
	const s = Math.min(W * 0.86, H * 0.84);
	const x0 = (W - s) / 2;
	const y0 = (H - s) / 2;
	const cc = s * 0.07;
	const body = env.pickPlate(c);
	const on = env.onCol(body);
	const dk = mixHex({ from: body, progress: 0.22, to: on });
	const metal = mixHex({ from: body, progress: 0.62, to: on });
	const lab = mixHex({ from: on, progress: 0.06, to: body });
	const ink = env.onCol(lab);
	const ac = env.accOn(lab);
	const faint = mixHex({ from: lab, progress: 0.2, to: ink });
	const e = env.inE(0.5);
	const g = new X2CShapes(env, env.clamp(env.lt / 0.12) * env.out);
	env.pose(W / 2, H / 2, { dx: from * (1 - e) * W * 0.7, rot: tilt + from * (1 - e) * 8 }, () => {
		g.p(
			[
				[x0, y0],
				[x0 + s - cc, y0],
				[x0 + s, y0 + cc],
				[x0 + s, y0 + s],
				[x0, y0 + s],
			],
			body,
		);
		const sh = outCubicSlide(env.clamp((env.lt - 0.4) / 0.3));
		const shx = x0 + s * (0.2 + 0.1 * sh);
		const shw = s * 0.5;
		const shh = s * 0.3;
		g.r(x0 + s * 0.18, y0, s * 0.64, shh * 1.02, dk);
		g.r(shx, y0, shw, shh, metal);
		g.r(shx + shw * 0.62, y0 + shh * 0.14, shw * 0.2, shh * 0.7, sh < 1 ? body : dk);
		g.r(x0 + s * 0.04, y0 + s * 0.9, s * 0.045, s * 0.055, dk);
		g.r(x0 + s * 0.915, y0 + s * 0.9, s * 0.045, s * 0.055, env.bg, 0.9);
		const lx = x0 + s * 0.1;
		const ly0 = y0 + s * 0.4;
		const lw2 = s * 0.8;
		const lh = s * 0.6;
		g.rr(lx, ly0, lw2, lh, s * 0.015, lab);
		g.r(lx, ly0, lw2, lh * 0.12, ac);
		g.t(`DISK ${pad2(env.no)}`, lx + lw2 * 0.04, ly0 + lh * 0.06, {
			color: env.onCol(ac),
			size: lh * 0.05,
			track: 0.2,
		});
		g.t("1.44MB", lx + lw2 * 0.96, ly0 + lh * 0.06, {
			color: env.onCol(ac),
			align: "right",
			size: lh * 0.05,
		});
		if (ruled) {
			for (let i = 1; i <= 4; i++) {
				g.l(lx + lw2 * 0.04, ly0 + lh * (0.12 + i * 0.2), lx + lw2 * (0.04 + 0.92 * env.inE(0.5, 0.2 + i * 0.05)), ly0 + lh * (0.12 + i * 0.2), faint, env.lw);
			}
		}
		env.fitMain(txt, W / 2, ly0 + lh * 0.55, lw2 * 0.88, lh * 0.72, ink, null, 3, lh * 0.42);
	});
}

/** 拡声器 — a megaphone in the corner shouts the lyric: sound arcs pulse out of it towards the big text. */
function drawMegaphone(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const sd = Number.parseInt(env.pick(1, ["-1", "1"]));
	const rot = Number.parseFloat(env.pick(2, ["0", "-3", "-5"]));
	const arcs = env.int(3, 3, 4);
	const marks = env.chance(4, 0.6);
	const u = M * 0.135;
	const mx = W / 2 - sd * W * (port ? 0.3 : 0.37);
	const my = H * (port ? 0.82 : 0.8);
	const ang = sd > 0 ? -32 : -148;
	const ca = Math.cos(degrees(ang));
	const sa = Math.sin(degrees(ang));
	const cone = env.paperOf();
	const ac = env.accOn(env.bg);
	const dk = mixHex({ from: env.bg, progress: 0.5, to: env.fg });
	const e = env.inB(0.4, 0, 1.6);
	const g = new X2CShapes(env, env.clamp(env.lt / 0.1) * env.out);
	const shake =
		Math.sin(env.ltb * 26) *
		2.2 *
		(env.step % 6 < 2 ? 1 : 0.2);
	if (e > 0) {
		env.pose(mx, my, { rot: (sd > 0 ? -32 : 32) + shake, s: e, sx: sd }, () => {
			g.r(mx - u * 0.32, my + u * 0.1, u * 0.2, u * 0.62, dk);
			g.rr(mx - u * 0.84, my - u * 0.27, u * 0.4, u * 0.54, u * 0.08, ac);
			g.p(
				[
					[mx - u * 0.5, my - u * 0.22],
					[mx + u * 0.72, my - u * 0.62],
					[mx + u * 0.72, my + u * 0.62],
					[mx - u * 0.5, my + u * 0.22],
				],
				cone,
			);
			g.rr(mx + u * 0.68, my - u * 0.72, u * 0.16, u * 1.44, u * 0.06, ac);
		});
	}
	const ox = mx + ca * u * 0.95;
	const oy = my + sa * u * 0.95;
	for (let i = 0; i < arcs; i++) {
		const k = (((env.ltb * 0.9 + i / arcs) % 1) + 1) % 1;
		g.arc(
			ox,
			oy,
			u * (0.5 + k * 1.9),
			ang - 30,
			ang + 30,
			ac,
			u * 0.09 * (1 - k * 0.5),
			Math.sin(k * Math.PI) * env.clamp((env.lt - 0.2) / 0.2),
		);
	}
	const tcx = W / 2 + sd * W * (port ? 0 : 0.045);
	const tcy = H * (port ? 0.4 : 0.37);
	const tw = W * (port ? 0.86 : 0.78);
	const thh = H * (port ? 0.46 : W < H * 1.5 ? 0.4 : 0.46);
	const o = { lead: 1.16, track: 0.02 };
	const f = env.fitBox(txt, tw, thh, o, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.34);
	if (marks) {
		const m = env.measure({ text: f.text, size, x: 0, y: 0, ...o });
		const qx = tcx + sd * (m.w / 2 + size * 0.12);
		const qy = tcy - m.h / 2 - size * 0.02;
		for (let i = 0; i < 3; i++) {
			const a = degrees(-90 + sd * (10 + i * 28));
			const ke = env.inE(0.3, 0.3 + i * 0.05);
			const r0 = size * 0.1;
			const r1 = size * (0.1 + 0.22 * ke);
			if (Math.abs(qx + Math.cos(a) * r1 - W / 2) < W * 0.48 && qy + Math.sin(a) * r1 > H * 0.03) {
				g.l(qx + Math.cos(a) * r0, qy + Math.sin(a) * r0, qx + Math.cos(a) * r1, qy + Math.sin(a) * r1, ac, Math.max(env.lw * 3, size * 0.035));
			}
		}
	}
	env.main({
		text: f.text,
		size,
		x: tcx,
		y: tcy,
		rot: rot * sd,
		lead: o.lead,
		track: o.track,
		color: env.fg,
	});
}

/** ガーランド — party bunting: every glyph on its own pennant, hung along sagging strings and swaying. */
function drawBunting(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const shape = env.pick(1, ["tri", "tri", "tail", "sq"]);
	const c0 = env.int(2, 0, 2);
	const mono = env.chance(3, 0.25);
	const n = env.glyphCountOf(txt);
	const maxPer = port ? 5 : 8;
	const rows = Math.max(1, Math.ceil(n / maxPer));
	let lines = env.toLines(txt, rows).map((s) => [...s.trim()]);
	if (lines.some((a) => a.length > maxPer + 1)) lines = chunkRows(txt, maxPer);
	const R2 = lines.length;
	const maxC = Math.max(...lines.map((a) => a.length));
	const rowH = (H * 0.84) / R2;
	const pitch = Math.min((W * 0.88) / (maxC + 0.4), (rowH * 0.8) / 1.55, M * 0.3);
	const fw = pitch * 0.88;
	const tri = shape === "tri";
	const fh = pitch * (tri ? 1.25 : 1.12);
	const sag = pitch * 0.3;
	const plates = [env.paperOf(), env.pickPlate("accent"), env.pickPlate("ink")];
	const strc = mixHex({ from: env.bg, progress: 0.55, to: env.fg });
	let gi = 0;
	lines.forEach((chs, r) => {
		const c = chs.length;
		const half = (c * pitch) / 2 + pitch * 0.45;
		const yT = H * 0.08 + r * rowH + (rowH - (sag + fh)) / 2;
		const ys = (x: number) => yT + sag * (1 - ((x - W / 2) / half) ** 2);
		const pts: Pt[] = [];
		for (let k = 0; k <= 24; k++) {
			const x = W / 2 - half + (2 * half * k) / 24;
			pts.push([x, ys(x)]);
		}
		if (env.out > 0) env.polyPartial(pts, env.inE(0.5, r * 0.08), strc, env.lw * 2.5, env.out);
		chs.forEach((ch, i) => {
			if (isSp(ch)) return;
			const x = W / 2 + (i - (c - 1) / 2) * pitch;
			const ya = ys(x);
			const d = 0.1 + r * 0.08 + i * 0.035;
			const fe = env.inB(0.4, d, 1.6);
			const plate = plates[mono ? c0 : (gi + c0) % 3];
			const ink = env.onCol(plate);
			const g = new X2CShapes(env, env.clamp((env.lt - d) / 0.08) * env.out);
			gi++;
			const slope = (Math.atan2(ys(x + 1) - ys(x - 1), 2) * 180) / Math.PI;
			env.pose(
				x,
				ya,
				{
					rot: slope * 0.6 + Math.sin(env.ltb * 1.7 + i * 0.8 + r) * 3.5,
					sy: Math.max(0.02, fe),
				},
				() => {
					if (tri) {
						g.p(
							[
								[x - fw / 2, ya],
								[x + fw / 2, ya],
								[x, ya + fh],
							],
							plate,
						);
					} else if (shape === "tail") {
						g.p(
							[
								[x - fw / 2, ya],
								[x + fw / 2, ya],
								[x + fw / 2, ya + fh],
								[x, ya + fh * 0.8],
								[x - fw / 2, ya + fh],
							],
							plate,
						);
					} else {
						g.r(x - fw / 2, ya, fw, fh * 0.92, plate);
					}
					env.main({
						text: ch,
						size: fw * (tri ? 0.5 : 0.66),
						x,
						y: ya + fh * (tri ? 0.31 : 0.42),
						color: ink,
					});
				},
			);
		});
	});
}

/** 引き出し — a filing cabinet: drawers slide shut one by one, each line of the lyric in a drawer's label holder. */
function drawDrawers(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt } = env;
	const c = env.pick(1, ["ink", "accent", "paper"]);
	const handle = env.pick(2, ["bar", "cup"]);
	const pull = env.int(3, 0, 2);
	const n = env.glyphCountOf(txt);
	const L = port
		? n <= 3
			? 1
			: n <= 8
				? 2
				: n <= 12
					? 3
					: 4
		: n <= 6
			? 1
			: n <= 11
				? 2
				: 3;
	const lines = env.toLines(txt, L);
	const k = lines.length;
	const T = Math.max(3, k);
	const first = Math.floor((T - k) / 2);
	const o = { track: 0.03 };
	const cw = W * (port ? 0.86 : 0.72);
	const ch = H * 0.86;
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const pd = M * 0.022;
	const dh = (ch - pd * (T + 1)) / T;
	const dwd = cw - pd * 2;
	const body = env.pickPlate(c);
	const on = env.onCol(body);
	const front = mixHex({ from: body, progress: 0.1, to: on });
	const metal = mixHex({ from: body, progress: 0.55, to: on });
	const lab = mixHex({ from: on, progress: 0.05, to: body });
	const ink = env.onCol(lab);
	const faint = mixHex({ from: lab, progress: 0.25, to: ink });
	const size = Math.min(...lines.map((s) => env.fitSizeOf(s, dwd * 0.78, dh * 0.5, o)), dh * 0.5);
	const g0 = new X2CShapes(env, env.inC(0.2) * env.out);
	g0.rr(x0, y0, cw, ch, M * 0.015, body);
	for (let i = 0; i < T; i++) {
		const li = i - first;
		const has = li >= 0 && li < k;
		const d = 0.08 + i * 0.09;
		const e = env.inE(0.45, d);
		const g = new X2CShapes(env, env.clamp((env.lt - d) / 0.1) * env.out);
		const dy0 = y0 + pd + i * (dh + pd);
		const cx = W / 2;
		const cy = dy0 + dh / 2;
		const pulled = has && li === pull % k;
		const sc2 = 1 + (1 - e) * 0.12 + (pulled ? 0.025 : 0);
		env.pose(cx, cy, { s: sc2 }, () => {
			if (pulled || e < 1) g.r(x0 + pd + M * 0.006, dy0 + M * 0.01, dwd, dh, env.dim, 0.7);
			g.r(x0 + pd, dy0, dwd, dh, front);
			g.rs(x0 + pd, dy0, dwd, dh, 0, on, env.lw, 0.35);
			const tw = has ? textWidth(lines[li], size, o.track) : dwd * 0.2;
			const hw = Math.max(tw + size * 1.1, dwd * 0.24);
			const hh = Math.max(size * 1.5, dh * 0.3);
			const hy = dy0 + dh * 0.42 - hh / 2;
			g.r(cx - hw / 2, hy, hw, hh, lab);
			g.rs(cx - hw / 2, hy, hw, hh, 0, metal, Math.max(env.lw * 2, dh * 0.02));
			const ky = dy0 + dh * 0.86;
			const kw = Math.min(dwd * 0.16, dh * 0.9);
			if (handle === "bar") {
				g.rr(cx - kw / 2, ky - dh * 0.03, kw, dh * 0.06, dh * 0.03, metal);
			} else {
				g.arc(cx, ky - dh * 0.05, kw * 0.3, 10, 170, metal, dh * 0.05);
			}
			if (!has) {
				g.r(cx - hw * 0.3, hy + hh / 2 - hh * 0.08, hw * 0.6, hh * 0.16, faint, 1.5);
				return;
			}
			env.main({
				text: lines[li],
				size,
				track: o.track,
				x: cx,
				y: hy + hh / 2,
				color: ink,
			});
		});
	}
}

/** アンケート — a poll card: the lyric is the question, the option bars fill and their percentages count up, the winner lights. */
function drawPoll(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const no = env.int(1, 2, 3);
	const card = env.chance(2, 0.65);
	const ps = [env.range(3, 0.2, 1), env.range(4, 0.2, 1), env.range(5, 0.2, 1)].slice(0, no);
	const votes = env.int(6, 120, 9800);
	const cw = W * 0.86;
	const ch = H * (port ? 0.76 : 0.84);
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const win = card ? env.paperOf() : env.bg;
	const ink = card ? env.onCol(win) : env.fg;
	const faint = mixHex({ from: win, progress: 0.14, to: ink });
	const ac = env.accOn(win);
	const mid = mixHex({ from: win, progress: 0.4, to: ink });
	const e = env.inE(0.45);
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const tot = ps.reduce((a, b) => a + b, 0);
	const win2 = ps.indexOf(Math.max(...ps));
	if (card) g.rr(x0, y0 + (1 - e) * M * 0.04, cw, ch, M * 0.035, win);
	const oy0 = y0 + ch * (port ? 0.48 : 0.5);
	const oh = (ch * (port ? 0.4 : 0.38)) / no;
	const bx = x0 + cw * 0.07;
	const bw = cw * 0.86;
	const bh = Math.min(oh * 0.7, M * 0.11);
	for (let i = 0; i < no; i++) {
		const by = oy0 + i * oh;
		const d = 0.3 + i * 0.1;
		const fe = outCubic(env.clamp((env.lt - d) / 0.7));
		const pct = ps[i] / tot;
		const isW = i === win2;
		const fc = isW ? ac : mid;
		const be = env.inE(0.4, 0.15 + i * 0.07);
		g.rr(bx, by, bw * be, bh, bh * 0.22, faint);
		g.rr(bx, by, Math.max(bh * 0.44, bw * pct * fe) * (be > 0 ? 1 : 0), bh, bh * 0.22, fc, env.clamp((env.lt - d) / 0.1));
		const on = (pct * fe * bw > bw * 0.3) ? env.onCol(fc) : ink;
		g.r(bx + bh * 0.4, by + bh / 2 - bh * 0.09, bw * (0.12 + 0.1 * env.unit(i, 3)) * be, bh * 0.18, on, 0.85);
		g.t(`${Math.round(pct * fe * 100)}%`, bx + bw - bh * 0.35, by + bh / 2, {
			color: ink,
			align: "right",
			size: bh * 0.36,
			track: 0.02,
			alpha: env.clamp((env.lt - d) / 0.15),
		});
		if (isW && fe >= 1 && pct > 0.34) {
			const kx = bx + bw * pct - bh * 0.5;
			const ku = bh * 0.15;
			const kc = env.onCol(fc);
			g.pl(
				[
					[kx - ku, by + bh / 2],
					[kx - ku * 0.2, by + bh / 2 + ku * 0.8],
					[kx + ku * 1.1, by + bh / 2 - ku * 0.9],
				],
				kc,
				env.lw * 3,
			);
		}
	}
	g.t(
		`${Math.round(votes * outCubic(env.clamp((env.lt - 0.3) / 0.9))).toLocaleString("en-US")} VOTES`,
		bx,
		y0 + ch * 0.94,
		{ color: ink, size: ls, alpha: 0.7 * env.inC(0.3, 0.3) },
	);
	g.t(`${1 + (env.hash(2) % 23)}H LEFT`, bx + bw, y0 + ch * 0.94, {
		color: ink,
		align: "right",
		size: ls,
		alpha: 0.7 * env.inC(0.3, 0.3),
	});
	g.t("Q.", bx, y0 + ch * 0.075, {
		color: ac,
		size: ls * 1.5,
		track: 0,
		alpha: env.inC(0.3, 0.2),
	});
	env.fitMain(txt, W / 2, y0 + ch * (port ? 0.27 : 0.28), bw, ch * (port ? 0.3 : 0.32), ink, null, port ? 4 : 2, ch * 0.2);
}

/** 店先テント — a shop front: the striped awning rolls out and the lyric is lettered on the window underneath. */
function drawAwning(options: TypographyLayoutOptions): void {
	const env = new X2CEnv(options);
	const { W, H, M, port, txt, ls } = env;
	const nsPlan = Number.parseInt(env.pick(1, ["7", "9", "11"]));
	const sign = env.pick(2, ["OPEN", "OPEN", "CLOSED"]);
	const glass = env.chance(3, 0.6);
	const c = env.int(4, 0, 1);
	const sw = W * (port ? 0.9 : 0.84);
	const x0 = (W - sw) / 2;
	const y0 = H * (port ? 0.12 : 0.08);
	const ah = H * (port ? 0.1 : 0.17);
	const ns = port ? Math.min(7, nsPlan) : nsPlan;
	const a = env.pickPlate("accent");
	const b = env.paperOf();
	const cols = c
		? [a, contrastOf(a, b) < 1.4 ? mixHex({ from: b, progress: 0.8, to: env.onCol(b) }) : b]
		: [contrastOf(a, b) < 1.4 ? mixHex({ from: b, progress: 0.8, to: env.onCol(b) }) : b, a];
	const wood = mixHex({ from: env.bg, progress: 0.5, to: env.fg });
	const g = new X2CShapes(env, env.inC(0.2) * env.out);
	const ae = env.inE(0.6, 0.05);
	const wx = x0 + sw * 0.04;
	const ww = sw * 0.92;
	const wy = y0 + ah * 0.55;
	const wb = H * (port ? 0.88 : 0.92);
	const wh = wb - wy;
	const fr = M * 0.012;
	const we = env.inE(0.5);
	g.rs(wx, wy, ww, wh * we, 0, wood, fr);
	g.r(wx - fr * 1.5, wy + wh * we, ww + fr * 3, fr * 1.6, wood);
	if (glass) {
		for (let i = 0; i < 2; i++) {
			const gx = wx + ww * (0.06 + i * 0.035);
			const gy = wy + ah * 0.75 + wh * 0.05;
			g.l(gx + wh * 0.1, gy, gx, gy + wh * 0.1, env.sub, env.lw * 2, 0.5 * env.inC(0.4, 0.4));
		}
	}
	const fy = wy + wh * 0.9;
	const la = env.inC(0.3, 0.45);
	g.l(wx + ww * 0.04, wy + wh * 0.82, wx + ww * (0.04 + 0.92 * env.inE(0.5, 0.3)), wy + wh * 0.82, env.sub, env.lw, 0.6);
	const tg = env.accOn(env.bg);
	const tw2 = Math.min(ww * 0.2, M * 0.2);
	const th2 = wh * 0.085;
	g.rr(wx + ww * 0.04, fy - th2 / 2, tw2, th2, th2 * 0.2, tg, la);
	g.t(sign, wx + ww * 0.04 + tw2 / 2, fy, {
		color: env.onCol(tg),
		align: "center",
		size: Math.min(th2 * 0.5, tw2 * 0.16),
		track: 0.2,
		alpha: la,
	});
	g.t(`${10 + (env.hash(2) % 3)}:00 - ${19 + (env.hash(3) % 4)}:00`, wx + ww * 0.96, fy, {
		color: env.sub,
		align: "right",
		size: ls,
		alpha: la,
	});
	const tw = sw * 0.9;
	const st = sw / ns;
	const hh = ah * ae;
	for (let i = 0; i < ns; i++) {
		const col = cols[i % 2];
		const xt0 = x0 + (sw - tw) / 2 + (tw / ns) * i;
		const xt1 = xt0 + tw / ns;
		const xb0 = x0 + st * i;
		const xb1 = xb0 + st;
		g.p(
			[
				[xt0, y0],
				[xt1 + 0.5, y0],
				[xb1 + 0.5, y0 + hh],
				[xb0, y0 + hh],
			],
			col,
		);
		g.c((xb0 + xb1) / 2, y0 + hh - 0.5, (st / 2) * Math.min(1, ae * 1.5), col);
	}
	g.r(x0 + (sw - tw) / 2 - fr, y0 - fr * 1.2, tw + fr * 2, fr * 1.4, wood);
	const ty0 = y0 + ah + st / 2 + wh * 0.02;
	const ty1 = wy + wh * 0.8;
	env.fitMain(txt, W / 2, (ty0 + ty1) / 2, ww * 0.86, (ty1 - ty0) * 0.86, env.fg, null, port ? 4 : 3, wh * 0.36);
}



