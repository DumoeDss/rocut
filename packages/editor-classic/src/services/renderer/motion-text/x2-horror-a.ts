import {
	drawHorrorSegment,
	localSeconds,
} from "./horror-frame-utils";
import {
	clamp01,
	degrees,
	inCubic,
	inOutCubic,
	inOutSine,
	lerp,
	mixHex,
	outCubic,
	smoothNoise,
} from "./exit-hold-geometry";
import {
	drawKineticLayoutText,
	fitKineticText,
	horrorGlyphs,
	horrorLines,
} from "./horror-layout-utils";
import { approximateTextWidth } from "./kinetic-words";
import type { TypographyLayoutOptions } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";
import { x2Hash, x2Signed, x2Unit } from "./x2-drawing";

/*
 * JIZURA 追加分2 (v0.12) x2horrorA pack — uneasy layouts, things at the edge
 * of attention (decor) and dark, slow backgrounds.
 *
 * Semantic simplifications match the A/B family ports (see x2-drawing.ts):
 * single-line horizontal items; canvas gradients/ellipses/quadratics are
 * approximated with flat stepped fills, scaled arcs and sampled polylines
 * (the typed canvas context exposes neither); planner `plan(rng, …)` params
 * are derived deterministically from the cut seed; `env.fx.motion` stays at
 * its 0.7 default.
 */

const TAU = Math.PI * 2;

/** JIZURA `clamp(v, lo, hi)`. */
// eslint-disable-next-line opencut/prefer-object-params
function clamp(value: number, low = 0, high = 1): number {
	return Math.min(high, Math.max(low, value));
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function inExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 2 ** (-10 * (1 - progress));
}

/** JIZURA `pad2`. */
function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

// eslint-disable-next-line opencut/prefer-object-params
function wrap(value: number, modulus: number): number {
	return ((value % modulus) + modulus) % modulus;
}

function hasLatin(text: string): boolean {
	return /[A-Za-z]/u.test(text);
}

/** JIZURA `flat` — collapse latin spacing, strip it entirely otherwise. */
function flat(text: string): string {
	const raw = String(text ?? "");
	return hasLatin(raw)
		? raw.trim().replace(/\s+/gu, " ")
		: raw.replace(/\s+/gu, "");
}

/* ------------------------------------------------------------------ palette */

function lum(color: string): number {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(color);
	if (!match?.[1]) return 0.5;
	const digits =
		match[1].length === 3
			? Array.from(match[1], (part) => part.repeat(2)).join("")
			: match[1];
	const red = Number.parseInt(digits.slice(0, 2), 16) / 255;
	const green = Number.parseInt(digits.slice(2, 4), 16) / 255;
	const blue = Number.parseInt(digits.slice(4, 6), 16) / 255;
	return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function isDark(color: string): boolean {
	return lum(color) < 0.45;
}

function mixC({
	from,
	to,
	progress,
}: {
	readonly from: string;
	readonly to: string;
	readonly progress: number;
}): string {
	return mixHex({ from, to, progress });
}

function lightOf(frame: MotionTextRenderFrame): string {
	const { foreground, background } = frame.palette;
	return lum(foreground) > lum(background) ? foreground : background;
}

function darkOf(frame: MotionTextRenderFrame): string {
	const { foreground, background } = frame.palette;
	return lum(foreground) > lum(background) ? background : foreground;
}

function nightC(frame: MotionTextRenderFrame): string {
	return mixC({
		from: frame.palette.background,
		to: "#000000",
		progress: isDark(frame.palette.background) ? 0.72 : 0.9,
	});
}

/** A faint line / silhouette colour over the scheme background. */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the pack's `dimC(sc, k)`.
function dimC(frame: MotionTextRenderFrame, k: number): string {
	return isDark(frame.palette.background)
		? mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: k })
		: mixC({ from: frame.palette.background, to: "#000000", progress: k * 1.1 });
}

/** The colour of light falling on the scheme background. */
function glowC(frame: MotionTextRenderFrame): string {
	return isDark(frame.palette.background)
		? lightOf(frame)
		: mixC({ from: frame.palette.background, to: "#FFFFFF", progress: 0.85 });
}

/** The most readable palette colour on `fill` (JIZURA `onCol`). */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the pack's `onCol(sc, fill)`.
function onCol(
	frame: MotionTextRenderFrame,
	fill: string,
): string {
	let best: string | null = null;
	let bestContrast = 0;
	for (const color of [
		frame.palette.background,
		frame.palette.foreground,
		frame.palette.secondary,
	]) {
		if (!color || color === fill) continue;
		const ratio =
			(Math.max(lum(color), lum(fill)) + 0.05) /
			(Math.min(lum(color), lum(fill)) + 0.05);
		if (ratio > bestContrast) {
			bestContrast = ratio;
			best = color;
		}
	}
	return bestContrast >= 3
		? (best ?? fill)
		: lum(fill) > 0.5
			? "#111111"
			: "#FFFFFF";
}

/** JIZURA `fitContrast` — the colour, or the readable fallback. */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the pack's `J.fitContrast(color, bg, k)`.
function fitContrast(
	frame: MotionTextRenderFrame,
	color: string,
): string {
	const background = frame.palette.background;
	const ratio =
		(Math.max(lum(color), lum(background)) + 0.05) /
		(Math.min(lum(color), lum(background)) + 0.05);
	return ratio >= 3 ? color : onCol(frame, color);
}

/* ------------------------------------------------------------------ scene */

interface X2HorrorScene {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

/** Local cut seconds — JIZURA `env.lt` / `env.ltb`. */
function ltOf(scene: X2HorrorScene): number {
	return localSeconds(scene.frame);
}

/** Global timeline seconds — JIZURA `env.t`. */
function tOf(scene: X2HorrorScene): number {
	return scene.frame.sequenceTime / 120_000;
}

function stepOf(scene: X2HorrorScene): number {
	return Math.floor(ltOf(scene) * 24);
}

/** JIZURA `tin` — eased clamp of local seconds past a delay. */
function tin({
	delay = 0,
	ease = outCubic,
	length,
	seconds,
}: {
	readonly delay?: number;
	readonly ease?: (value: number) => number;
	readonly length: number;
	readonly seconds: number;
}): number {
	return ease(clamp((seconds - delay) / Math.max(0.01, length)));
}

/** JIZURA `tout`. */
function tout(scene: X2HorrorScene): number {
	return 1 - inCubic(scene.frame.exitProgress);
}

/** JIZURA `lamp` — failing-light level on a ≤24 Hz clock. */
// eslint-disable-next-line opencut/prefer-object-params
function lamp(time: number, seed: number, rate = 1): number {
	const step = Math.floor(time * 24);
	const run = step >> 2;
	if (x2Unit(seed, run, 7) < 0.1 * rate) {
		return x2Unit(seed, step, 8) < 0.5 ? 0.15 : 0.55;
	}
	return 0.88 + 0.12 * x2Unit(seed, step, 9);
}

function rect({
	alpha = 1,
	color,
	height,
	scene,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly scene: X2HorrorScene;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (width <= 0 || height <= 0 || alpha <= 0.002) return;
	const { ctx } = scene;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

function seg({
	alpha,
	color,
	scene,
	thickness,
	x0,
	x1,
	y0,
	y1,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly scene: X2HorrorScene;
	readonly thickness: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}): void {
	drawHorrorSegment({
		alpha,
		color,
		ctx: scene.ctx,
		thickness,
		x0,
		x1,
		y0,
		y1,
	});
}

function buildPolyPath({
	ctx,
	points,
}: {
	readonly ctx: MotionTextCanvasContext;
	readonly points: readonly (readonly [number, number])[];
}): boolean {
	if (!ctx.moveTo || !ctx.lineTo || points.length < 2) return false;
	ctx.moveTo(points[0]![0], points[0]![1]);
	for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
	return true;
}

function polyFill({
	alpha,
	color,
	points,
	scene,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly points: readonly (readonly [number, number])[];
	readonly scene: X2HorrorScene;
}): void {
	if (alpha <= 0.002 || points.length < 3) return;
	const { ctx } = scene;
	if (!ctx.fill) return;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.beginPath();
	if (!buildPolyPath({ ctx, points })) {
		ctx.restore();
		return;
	}
	ctx.closePath?.();
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();
	ctx.fillStyle = baseFill;
	ctx.globalAlpha = baseAlpha;
}

function polyStroke({
	alpha,
	color,
	points,
	scene,
	thickness,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly points: readonly (readonly [number, number])[];
	readonly scene: X2HorrorScene;
	readonly thickness: number;
}): void {
	if (alpha <= 0.002 || points.length < 2 || thickness <= 0.05) return;
	const { ctx } = scene;
	if (!ctx.stroke || !ctx.moveTo || !ctx.lineTo) return;
	const baseAlpha = ctx.globalAlpha;
	const baseStroke = ctx.strokeStyle;
	ctx.save();
	ctx.beginPath();
	if (!buildPolyPath({ ctx, points })) {
		ctx.restore();
		return;
	}
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.strokeStyle = color;
	ctx.lineWidth = thickness;
	ctx.stroke();
	ctx.restore();
	ctx.strokeStyle = baseStroke;
	ctx.globalAlpha = baseAlpha;
}

/** Polyline drawn up to a fraction of its total length — JIZURA `polyPartial`. */
function polyPartial({
	alpha,
	color,
	points,
	progress,
	scene,
	thickness,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly points: readonly (readonly [number, number])[];
	readonly progress: number;
	readonly scene: X2HorrorScene;
	readonly thickness: number;
}): void {
	const eased = clamp01(progress);
	if (eased <= 0.002 || points.length < 2) return;
	let total = 0;
	for (let index = 1; index < points.length; index += 1) {
		total += Math.hypot(
			points[index]![0] - points[index - 1]![0],
			points[index]![1] - points[index - 1]![1],
		);
	}
	if (total <= 0.01) return;
	let budget = total * eased;
	for (let index = 1; index < points.length && budget > 0; index += 1) {
		const from = points[index - 1]!;
		const to = points[index]!;
		const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
		if (length <= 0.01) continue;
		const take = Math.min(1, budget / length);
		budget -= length;
		seg({
			alpha,
			color,
			scene,
			thickness,
			x0: from[0],
			x1: from[0] + (to[0] - from[0]) * take,
			y0: from[1],
			y1: from[1] + (to[1] - from[1]) * take,
		});
	}
}

function circle({
	alpha,
	color,
	radius,
	scene,
	stroke,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color?: string;
	readonly radius: number;
	readonly scene: X2HorrorScene;
	readonly stroke?: string;
	readonly x: number;
	readonly y: number;
}): void {
	if (radius <= 0.05 || alpha <= 0.002) return;
	const { ctx } = scene;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.beginPath();
	if (!ctx.arc) {
		ctx.restore();
		return;
	}
	ctx.arc(x, y, radius, 0, TAU);
	if (color) {
		ctx.fillStyle = color;
		ctx.fill?.();
	}
	if (stroke) {
		ctx.strokeStyle = stroke;
		ctx.stroke?.();
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

/** Filled ellipse via a scaled arc (the context has no `ellipse`). */
function ellipseFill({
	alpha,
	color,
	radiusX,
	radiusY,
	rotation,
	scene,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly radiusX: number;
	readonly radiusY: number;
	readonly rotation: number;
	readonly scene: X2HorrorScene;
	readonly x: number;
	readonly y: number;
}): void {
	if (radiusX <= 0.05 || radiusY <= 0.05 || alpha <= 0.002) return;
	const { ctx } = scene;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.fillStyle = color;
	if (ctx.arc && ctx.fill) {
		ctx.translate(x, y);
		ctx.rotate(rotation);
		ctx.scale(1, radiusY / radiusX);
		ctx.beginPath();
		ctx.arc(0, 0, radiusX, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(x - radiusX, y - radiusY, radiusX * 2, radiusY * 2);
	}
	ctx.restore();
	ctx.fillStyle = baseFill;
	ctx.globalAlpha = baseAlpha;
}

function arcPolyline({
	alpha,
	centerX,
	centerY,
	color,
	fromDegrees,
	radius,
	scene,
	thickness,
	toDegrees,
}: {
	readonly alpha: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly color: string;
	readonly fromDegrees: number;
	readonly radius: number;
	readonly scene: X2HorrorScene;
	readonly thickness: number;
	readonly toDegrees: number;
}): void {
	const segments = 40;
	const points: Array<readonly [number, number]> = [];
	for (let index = 0; index <= segments; index += 1) {
		const angle = degrees(
			fromDegrees + ((toDegrees - fromDegrees) * index) / segments,
		);
		points.push([
			centerX + Math.cos(angle) * radius,
			centerY + Math.sin(angle) * radius,
		]);
	}
	polyPartial({ alpha, color, points, progress: 1, scene, thickness });
}

/** Stepped disc stack standing in for a radial glow gradient. */
function glowDisc({
	alpha,
	color,
	radius,
	scene,
	steps = 3,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly radius: number;
	readonly scene: X2HorrorScene;
	readonly steps?: number;
	readonly x: number;
	readonly y: number;
}): void {
	for (let index = steps; index >= 1; index -= 1) {
		circle({
			alpha: alpha / steps,
			color,
			radius: (radius * index) / steps,
			scene,
			x,
			y,
		});
	}
}

/** Corner vignette — a stepped radial approximation of JIZURA `vign`. */
function vignette({
	alpha,
	innerFraction,
	scene,
}: {
	readonly alpha: number;
	readonly innerFraction: number;
	readonly scene: X2HorrorScene;
}): void {
	if (alpha <= 0.004) return;
	const { ctx, width, height } = scene;
	if (!ctx.arc || !ctx.fill) return;
	const dark = nightC(scene.frame);
	const radius = Math.hypot(width, height) * 0.62;
	const steps = 4;
	const baseAlpha = ctx.globalAlpha;
	for (let index = steps; index >= 1; index -= 1) {
		const r =
			radius *
			lerp({
				start: Math.max(0.05, innerFraction),
				end: 1,
				progress: index / steps,
			});
		ctx.save();
		ctx.beginPath();
		ctx.rect(-width, -height, width * 3, height * 3);
		ctx.arc(width / 2, height / 2, r, 0, TAU);
		ctx.globalAlpha = baseAlpha * (alpha / steps);
		ctx.fillStyle = dark;
		ctx.fill("evenodd");
		ctx.restore();
	}
	ctx.globalAlpha = baseAlpha;
}

/* ------------------------------------------------------------------ text */

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Raw frame-font fill that bypasses the drawText dispatch (ghost copies, labels). */
function rawText({
	align = "center",
	alpha = 1,
	color,
	maxWidth,
	mono = false,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
	size,
	text,
	x,
	y,
}: {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color?: string;
	readonly maxWidth?: number;
	readonly mono?: boolean;
	readonly options: TypographyLayoutOptions;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx } = options;
	const { font } = options.frame;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	const baseFont = ctx.font;
	ctx.save();
	ctx.font = mono
		? `normal 400 ${Math.max(10, size)}px monospace`
		: `${font.style} ${font.weight} ${Math.max(10, size)}px ${quoteFamily(font.family)}`;
	ctx.textAlign = align;
	ctx.textBaseline = "middle";
	ctx.translate(x, y);
	if (rotation) ctx.rotate(rotation);
	if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	if (color) ctx.fillStyle = color;
	ctx.fillText(
		text,
		0,
		0,
		maxWidth ?? Math.max(1, size * 0.78 * Math.max(1, text.length)),
	);
	ctx.restore();
	ctx.font = baseFont;
	ctx.fillStyle = baseFill;
	ctx.globalAlpha = baseAlpha;
}

interface X2HorrorSlot {
	readonly character: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Glyph centres of a text line on the house advance model — JIZURA `slots`. */
function glyphSlots({
	size,
	text,
	track = 0,
	x,
	y,
}: {
	readonly size: number;
	readonly text: string;
	readonly track?: number;
	readonly x: number;
	readonly y: number;
}): X2HorrorSlot[] {
	const characters = Array.from(text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? size * 0.34 : size * 0.62 * (1 + track),
	);
	const natural = advances.reduce((sum, advance) => sum + advance, 0);
	const startX = x - natural / 2;
	let cursor = startX;
	const slots: X2HorrorSlot[] = [];
	for (const [index, character] of characters.entries()) {
		const advance = advances[index]!;
		const center = cursor + advance / 2;
		cursor += advance;
		if (/\s/u.test(character)) continue;
		slots.push({
			character,
			height: size,
			width: advance,
			x: center,
			y,
		});
	}
	return slots;
}

/** Fit a whole multi-line block into a box — JIZURA `fitSize` for blocks. */
function fitBlock({
	height,
	lead,
	lines,
	track = 0,
	width,
}: {
	readonly height: number;
	readonly lead: number;
	readonly lines: readonly string[];
	readonly track?: number;
	readonly width: number;
}): number {
	const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
	return fitKineticText({
		height: height / Math.max(1, lines.length * lead),
		maxSize: height,
		text: longest,
		width: width / (1 + track),
	});
}

function measureBlock({
	lead,
	lines,
	size,
	track = 0,
}: {
	readonly lead: number;
	readonly lines: readonly string[];
	readonly size: number;
	readonly track?: number;
}): { readonly height: number; readonly width: number } {
	const width = Math.max(
		...lines.map((line) =>
			approximateTextWidth({ text: line, size }),
		),
	) * (1 + track);
	return { height: lines.length * size * lead, width };
}

/* ------------------------------------------------------------------ bounds */

interface X2HorrorBB {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
	readonly cx: number;
	readonly cy: number;
}

function textBoundsOf(scene: X2HorrorScene): X2HorrorBB {
	const characters = Array.from(scene.frame.cut?.text ?? "");
	const size = Math.min(
		scene.height * 0.22,
		scene.width / Math.max(4, characters.length * 0.72),
	);
	const width = Math.min(
		scene.width * 0.86,
		Math.max(size, characters.length * size * 0.62),
	);
	const height = size * 1.25;
	return {
		cx: scene.width / 2,
		cy: scene.height / 2,
		x0: scene.width / 2 - width / 2,
		x1: scene.width / 2 + width / 2,
		y0: scene.height / 2 - height / 2,
		y1: scene.height / 2 + height / 2,
	};
}

// eslint-disable-next-line opencut/prefer-object-params
function distToBB(bb: X2HorrorBB, x: number, y: number): number {
	return Math.hypot(
		Math.max(bb.x0 - x, 0, x - bb.x1),
		Math.max(bb.y0 - y, 0, y - bb.y1),
	);
}

function overlapsBB({
	bb,
	pad = 0,
	x0,
	x1,
	y0,
	y1,
}: {
	readonly bb: X2HorrorBB;
	readonly pad?: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}): boolean {
	return !(
		x1 < bb.x0 - pad ||
		x0 > bb.x1 + pad ||
		y1 < bb.y0 - pad ||
		y0 > bb.y1 + pad
	);
}

/** A spot inside the frame as far from the lyric as a few tries allow. */
function farSpot({
	bb,
	height,
	marginX,
	marginY,
	salt,
	seed,
	width,
}: {
	readonly bb: X2HorrorBB;
	readonly height: number;
	readonly marginX: number;
	readonly marginY: number;
	readonly salt: number;
	readonly seed: number;
	readonly width: number;
}): { readonly d: number; readonly x: number; readonly y: number } {
	let bestX = width * marginX;
	let bestY = height * marginY;
	let bestDistance = -1;
	for (let index = 0; index < 9; index += 1) {
		const x =
			width * (marginX + (1 - 2 * marginX) * x2Unit(seed, salt, index, 1));
		const y =
			height * (marginY + (1 - 2 * marginY) * x2Unit(seed, salt, index, 2));
		const distance = distToBB(bb, x, y);
		if (distance > bestDistance) {
			bestDistance = distance;
			bestX = x;
			bestY = y;
		}
	}
	return { d: bestDistance, x: bestX, y: bestY };
}

/* ================================================================== LAYOUTS */

export function drawX2HorrorLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "hzKeyhole":
			drawKeyhole(options);
			return true;
		case "hzEmptyRoom":
			drawEmptyRoom(options);
			return true;
		case "hzWrongCopy":
			drawWrongCopy(options);
			return true;
		case "hzHangSign":
			drawHangSign(options);
			return true;
		case "hzElevator":
			drawElevator(options);
			return true;
		case "hzReflection":
			drawReflection(options);
			return true;
		case "hzFogWindow":
			drawFogWindow(options);
			return true;
		case "hzVoicemail":
			drawVoicemail(options);
			return true;
		case "hzStreetLamp":
			drawStreetLamp(options);
			return true;
		case "hzTornNote":
			drawTornNote(options);
			return true;
		case "hzUnderDoor":
			drawUnderDoor(options);
			return true;
		case "hzSlats":
			drawSlats(options);
			return true;
		case "hzStoppedClock":
			drawStoppedClock(options);
			return true;
		case "hzCloser":
			drawCloser(options);
			return true;
		case "hzStairs":
			drawStairs(options);
			return true;
		default:
			return false;
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the pack's `linesOf(env, raw, perL, perP)`.
function linesOf(
	options: TypographyLayoutOptions,
	perLandscape: number,
	perPortrait: number,
): readonly string[] {
	return horrorLines({
		maximum: options.height > options.width * 1.08 ? perPortrait : perLandscape,
		text: flat(options.frame.cut?.text ?? ""),
	});
}

function seedOfScene(scene: X2HorrorScene): number {
	return scene.frame.cut?.seed ?? 0;
}

function mainBlock({
	alpha = 1,
	color,
	lead = 1.18,
	lines,
	options,
	rotation = 0,
	size,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly lead?: number;
	readonly lines: readonly string[];
	readonly options: TypographyLayoutOptions;
	readonly rotation?: number;
	readonly size: number;
	readonly x: number;
	readonly y: number;
}): void {
	const gap = size * lead;
	const firstY = y - ((lines.length - 1) * gap) / 2;
	for (const [index, line] of lines.entries()) {
		drawKineticLayoutText({
			options,
			text: {
				alpha,
				color,
				rotation,
				size,
				text: line,
				x,
				y: firstY + index * gap,
			},
		});
	}
}

/** 鍵穴 — the line sits in the round head of a keyhole cut out of the dark. */
function drawKeyhole(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const ltb = lt;
	const show = lerp({ start: 0.36, end: 0.6, progress: x2Unit(seed, 1) });
	const direction = x2Unit(seed, 2) < 0.5 ? -1 : 1;
	const drift = lerp({ start: 0.5, end: 1, progress: x2Unit(seed, 3) });
	const passes = x2Unit(seed, 4) < 0.85;
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const radius = Math.min(W * 0.42, H * 0.32);
	const cx = W / 2;
	const cy = H / 2 - radius * 0.4;
	const raw = flat(frame.cut?.text ?? "");
	const count = horrorGlyphs(raw).length;
	const lines = horrorLines({
		maximum: hasLatin(raw) ? 8 : count <= 3 ? 3 : count <= 8 ? 4 : count <= 12 ? 5 : 6,
		text: raw,
	});
	const size = Math.min(
		fitBlock({ height: radius * 1.12, lead: 1.15, lines, width: radius * 1.36 }),
		radius * 0.85,
	);
	mainBlock({ lead: 1.15, lines, options, size, x: cx, y: cy });
	const dark = nightC(frame);
	const open =
		tin({ length: 0.55, seconds: lt }) * (1 - inExpo(frame.exitProgress));
	const ox = smoothNoise({ seed: seed + 1, salt: 0, value: ltb * 0.45 }) * radius * 0.07 * drift;
	const oy = smoothNoise({ seed: seed + 2, salt: 0, value: ltb * 0.4 }) * radius * 0.05 * drift;
	// something passes on the other side
	if (passes) {
		const phase = (lt - duration * show) / 0.9;
		if (phase > 0 && phase < 1) {
			const x = cx + direction * lerp({ start: -radius * 1.7, end: radius * 1.7, progress: phase });
			rect({
				alpha: 0.4,
				color: dark,
				height: radius * 3.4,
				scene,
				width: radius * 1.1,
				x: x - radius * 0.55,
				y: cy - radius * 1.2,
			});
			rect({
				alpha: 0.5,
				color: dark,
				height: radius * 3.4,
				scene,
				width: radius * 0.72,
				x: x - radius * 0.36,
				y: cy - radius * 1.2,
			});
		}
	}
	const hx = cx + ox;
	const hy = cy + oy;
	const hole = (q: number): Array<readonly [number, number]> => {
		const points: Array<readonly [number, number]> = [];
		const startAngle = 66;
		const sweep = 312;
		const steps = 26;
		for (let index = 0; index <= steps; index += 1) {
			const angle = degrees(startAngle - (sweep * index) / steps);
			points.push([
				hx + Math.cos(angle) * radius * q,
				hy + Math.sin(angle) * radius * q,
			]);
		}
		points.push([hx - radius * 0.62 * q, hy + radius * 1.86 * q]);
		points.push([hx + radius * 0.62 * q, hy + radius * 1.86 * q]);
		return points;
	};
	const { ctx } = scene;
	const unit = Math.min(W, H);
	if (ctx.fill && ctx.moveTo && ctx.lineTo) {
		const baseAlpha = ctx.globalAlpha;
		ctx.save();
		ctx.beginPath();
		ctx.rect(-W, -H, W * 3, H * 3);
		if (buildPolyPath({ ctx, points: hole(open) })) {
			ctx.closePath?.();
			ctx.globalAlpha = baseAlpha * 0.965;
			ctx.fillStyle = dark;
			ctx.fill("evenodd");
		}
		ctx.restore();
		ctx.globalAlpha = baseAlpha;
	}
	if (open > 0.02) {
		const rim = mixC({ from: dark, to: lightOf(frame), progress: 0.42 });
		polyStroke({
			alpha: 0.8 * open,
			color: rim,
			points: hole(open),
			scene,
			thickness: Math.max(1.5, unit * 0.004),
		});
		polyStroke({
			alpha: 0.3 * open,
			color: rim,
			points: hole(open * 1.07),
			scene,
			thickness: Math.max(1, unit * 0.002),
		});
	}
}

/** 広すぎる部屋 — a small line pressed against one wall; the rest is an empty room with a far door. */
function drawEmptyRoom(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const side = x2Unit(seed, 1) < 0.5 ? -1 : 1;
	const vy = x2Signed(seed, 2);
	const door = x2Unit(seed, 3) < 0.85;
	const openAt = lerp({ start: 0.3, end: 0.6, progress: x2Unit(seed, 4) });
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const bx = W * (0.5 - side * (port ? 0.14 : 0.17));
	const by = H * 0.47;
	const bw = W * (port ? 0.13 : 0.12);
	const bh = H * (port ? 0.075 : 0.14);
	const edge = side > 0 ? W * 0.94 : W * 0.06;
	const tw = W * (W > H * 1.3 ? 0.32 : 0.42);
	// the clear band on the side wall at the inner end of the text
	const xin = edge - side * tw;
	const wallX = bx + side * bw;
	const cornerX = side > 0 ? W : 0;
	const f = clamp((cornerX - xin) / (cornerX - wallX));
	const yTop = (by - bh) * f;
	const yBot = H - (H - (by + bh)) * f;
	const lines = linesOf(options, 6, 4);
	const size = Math.min(
		fitBlock({
			height: Math.min(H * 0.24, (yBot - yTop) * 0.8),
			lead: 1.2,
			lines,
			width: tw,
		}),
		H * 0.15,
	);
	const measure = measureBlock({ lead: 1.2, lines, size, track: 0.05 });
	const slack = Math.max(0, ((yBot - yTop) * 0.9 - measure.height) / 2);
	const ty = (yTop + yBot) / 2 + vy * slack * 0.6;
	const color = dimC(frame, 0.24);
	const thickness = Math.max(1.2, Math.min(W, H) * 0.0022);
	const ease = tin({ ease: inOutCubic, length: 1, seconds: lt });
	const out = tout(scene);
	const back: Array<readonly [number, number]> = [
		[bx - bw, by - bh],
		[bx + bw, by - bh],
		[bx + bw, by + bh],
		[bx - bw, by + bh],
		[bx - bw, by - bh],
	];
	polyPartial({
		alpha: out,
		color,
		points: back,
		progress: ease,
		scene,
		thickness,
	});
	const corners: Array<readonly [number, number]> = [
		[0, 0],
		[W, 0],
		[W, H],
		[0, H],
	];
	for (let index = 0; index < 4; index += 1) {
		polyPartial({
			alpha: out * 0.85,
			color,
			points: [back[index]!, corners[index]!],
			progress: clamp(ease * 1.3 - 0.3),
			scene,
			thickness,
		});
	}
	if (door) {
		// a door in the far wall; it opens a little while nobody watches
		const dw = bw * 0.36;
		const dh = bh * 1.3;
		const dx = bx - side * bw * 0.4 - dw / 2;
		const dy = by + bh - dh;
		const opening =
			0.1 +
			0.5 *
				inOutSine(
					clamp((lt - duration * openAt) / 1.6),
				);
		const level = lamp(tOf(scene), seed, 0.8) * ease * out;
		polyPartial({
			alpha: ease * out,
			color,
			points: [
				[dx, by + bh],
				[dx, dy],
				[dx + dw, dy],
				[dx + dw, by + bh],
			],
			progress: 1,
			scene,
			thickness,
		});
		const light = glowC(frame);
		const sx0 = side > 0 ? dx : dx + dw * (1 - opening);
		rect({
			alpha: 0.8 * level,
			color: light,
			height: dh - thickness,
			scene,
			width: dw * opening,
			x: sx0,
			y: dy + thickness,
		});
		polyFill({
			alpha: 0.07 * level,
			color: light,
			points: [
				[sx0, by + bh],
				[sx0 + dw * opening, by + bh],
				[
					sx0 + dw * opening + side * bw * 0.5 + dw * opening,
					by + bh + (H - by - bh) * 0.3,
				],
				[sx0 + side * bw * 0.5 - dw * opening, by + bh + (H - by - bh) * 0.3],
			],
			scene,
		});
	}
	mainBlock({
		color: frame.palette.foreground,
		lead: 1.2,
		lines,
		options,
		size,
		x: edge - side * measure.width / 2,
		y: ty,
	});
}

/** 一行だけ違う — the same line again and again, and one copy is wrong. */
function drawWrongCopy(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const step = stepOf(scene);
	const port = H > W * 1.08;
	const raw = flat(frame.cut?.text ?? "");
	const count = horrorGlyphs(raw).length;
	const unitLines = horrorLines({ maximum: port ? 6 : 14, text: raw });
	const lineCount = unitLines.length;
	const copies = Math.max(
		2,
		Math.min(
			3 + (x2Hash(seed, 1) % 3) + (port && lineCount === 1 ? 1 : 0),
			lineCount === 1 ? 6 : lineCount === 2 ? 3 : 2,
		),
	);
	const roll = x2Unit(seed, 2);
	const wrongRow = 1 + Math.min(copies - 2, Math.floor(roll * (copies - 1)));
	let kind = ["mirror", "reverse", "drop", "flip"][x2Hash(seed, 3) % 4]!;
	if (count < 2 && (kind === "reverse" || kind === "drop")) kind = "mirror";
	const accentRow = x2Unit(seed, 5) < 0.55;
	const glyphRoll = x2Unit(seed, 6);
	const size = Math.min(
		fitBlock({
			height: (H * 0.84 * 0.8) / copies,
			lead: 1.1,
			lines: unitLines,
			width: W * 0.84,
		}),
		H * 0.24,
	);
	const measure = measureBlock({ lead: 1.1, lines: unitLines, size, track: 0.05 });
	const rowHeight = Math.min((H * 0.84) / copies, measure.height + size * 0.42);
	const y0 = H / 2 - (rowHeight * (copies - 1)) / 2;
	// now and then the wrong copy looks right for a frame
	const looksRight = x2Unit(seed, step >> 1, 5) < 0.06;
	for (let row = 0; row < copies; row += 1) {
		let x = W / 2;
		let alpha = 1;
		let scaleX = 1;
		let rotation = 0;
		let color = frame.palette.foreground;
		let lines = unitLines;
		const isWrong = row === wrongRow;
		if (isWrong) {
			if (accentRow) color = fitContrast(frame, frame.palette.accent);
			if (!looksRight) {
				if (kind === "mirror") scaleX = -1;
				else if (kind === "flip") rotation = degrees(180);
				else if (kind === "reverse") {
					lines = unitLines.map((line) =>
						Array.from(line).reverse().join(""),
					);
				} else {
					const characters = Array.from(unitLines.join(""));
					const indices: number[] = [];
					characters.forEach((character, index) => {
						if (character !== "\n" && character !== " ") indices.push(index);
					});
					if (indices.length > 0) {
						const at = indices[
							Math.min(indices.length - 1, Math.floor(glyphRoll * indices.length))
						]!;
						characters[at] = hasLatin(characters[at]!) ? "_" : "　";
						lines = characters.join("").split("\n");
					}
				}
			}
			if (x2Unit(seed, step >> 2, 8) < 0.22) {
				x += x2Signed(seed, step >> 2, 7) * size * 0.05;
			}
			alpha = 1;
		}
		const gap = size * 1.1;
		const firstY = y0 + row * rowHeight - ((lines.length - 1) * gap) / 2;
		for (const [index, line] of lines.entries()) {
			drawKineticLayoutText({
				options,
				text: {
					alpha,
					color,
					rotation,
					scaleX,
					size,
					text: line,
					x,
					y: firstY + index * gap,
				},
			});
		}
	}
}

/** 傾いた吊り看板 — a hanging sign with one snapped wire, crooked and creaking. */
function drawHangSign(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const ltb = lt;
	const side = x2Unit(seed, 2) < 0.5 ? -1 : 1;
	const snap = x2Hash(seed, 1) % 3 !== 0;
	const amp = lerp({ start: 0.7, end: 1.2, progress: x2Unit(seed, 3) });
	const tiltBase = lerp({ start: 5, end: 8.5, progress: x2Unit(seed, 4) });
	const phase = lerp({ start: 0, end: 6, progress: x2Unit(seed, 5) });
	const lines = linesOf(options, 9, 5);
	let size = Math.min(
		fitBlock({ height: H * 0.3, lead: 1.15, lines, width: W * 0.6 }),
		H * 0.2,
	);
	let measure = measureBlock({ lead: 1.15, lines, size, track: 0.06 });
	if (measure.width + size * 1.3 > W * 0.74) {
		size *= (W * 0.74) / (measure.width + size * 1.3);
		measure = measureBlock({ lead: 1.15, lines, size, track: 0.06 });
	}
	const pw = measure.width + size * 1.3;
	const ph = measure.height + size * 0.9;
	const plate = frame.palette.foreground;
	const textColor = onCol(frame, plate);
	const drop =
		-(H * 0.95) * (1 - outCubic(clamp(lt / 0.55))) +
		H * 1.15 * inCubic(frame.exitProgress);
	const damping = 0.45 + 0.55 * Math.exp(-Math.max(0, ltb) * 0.5);
	const swing =
		amp *
		(snap ? 2.4 : 3.2) *
		damping *
		Math.sin(ltb * 1.5 + phase) *
		degrees(1);
	const anchorX = side * pw * 0.32;
	const anchorY = -ph / 2;
	const cordLength = H * 0.55 - ph / 2 + 12;
	const a1: readonly [number, number] = [W / 2 + anchorX, -12];
	const a2: readonly [number, number] = [W / 2 - anchorX, -12];
	let theta: number;
	let cx: number;
	let cy: number;
	if (snap) {
		theta =
			degrees(-side * tiltBase + (swing / degrees(1)) * 1.6 + Math.sin(ltb * 2.3 + phase) * 0.7 * damping) +
			side * 0.5 * inCubic(frame.exitProgress);
		const qx = a1[0] + Math.sin(swing) * cordLength;
		const qy = a1[1] + Math.cos(swing) * cordLength;
		cx = qx - (Math.cos(theta) * anchorX - Math.sin(theta) * anchorY);
		cy = qy - (Math.sin(theta) * anchorX + Math.cos(theta) * anchorY);
	} else {
		theta = 0;
		cx = W / 2 + Math.sin(swing) * cordLength;
		cy = H * 0.55 + (Math.cos(swing) - 1) * cordLength;
	}
	cy += drop;
	// eslint-disable-next-line opencut/prefer-object-params -- The pack's `wp(lx, ly)` local frame closure.
	const wp = (lx: number, ly: number): readonly [number, number] => [
		cx + Math.cos(theta) * lx - Math.sin(theta) * ly,
		cy + Math.sin(theta) * lx + Math.cos(theta) * ly,
	];
	const out = tout(scene);
	const wireColor = dimC(frame, 0.5);
	const thickness = Math.max(1.2, Math.min(W, H) * 0.0028);
	const q1 = wp(anchorX, anchorY);
	const q2 = wp(-anchorX, anchorY);
	seg({ alpha: out, color: wireColor, scene, thickness, x0: a1[0], x1: q1[0], y0: a1[1], y1: q1[1] });
	if (snap) {
		// the snapped wire: a stub swinging from the ceiling, the end lying against the plate
		const stubSwing = Math.sin(ltb * 2.6 + 1) * degrees(9);
		const stubLength = Math.min(H * 0.13, cordLength * 0.3);
		seg({
			alpha: out * clamp(lt / 0.3),
			color: wireColor,
			scene,
			thickness,
			x0: a2[0],
			x1: a2[0] + Math.sin(stubSwing) * stubLength,
			y0: a2[1],
			y1: a2[1] + Math.cos(stubSwing) * stubLength,
		});
		seg({
			alpha: out,
			color: wireColor,
			scene,
			thickness,
			x0: q2[0],
			x1: q2[0] - side * size * 0.12,
			y0: q2[1],
			y1: q2[1] + size * 0.5,
		});
	} else {
		seg({ alpha: out, color: wireColor, scene, thickness, x0: a2[0], x1: q2[0], y0: a2[1], y1: q2[1] });
	}
	const { ctx } = scene;
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(theta);
	ctx.globalAlpha *= out;
	ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
	ctx.fillRect(-pw / 2 + size * 0.06, -ph / 2 + size * 0.08, pw, ph);
	ctx.fillStyle = plate;
	ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
	if (ctx.stroke && ctx.moveTo && ctx.lineTo) {
		ctx.strokeStyle = mixC({ from: textColor, to: plate, progress: 0.55 });
		ctx.lineWidth = Math.max(1.5, size * 0.025);
		ctx.beginPath();
		ctx.rect(
			-pw / 2 + size * 0.14,
			-ph / 2 + size * 0.14,
			pw - size * 0.28,
			ph - size * 0.28,
		);
		ctx.stroke();
	}
	ctx.globalAlpha *= 0.7;
	ctx.fillStyle = textColor;
	if (ctx.arc && ctx.fill) {
		for (const sign of [1, -1]) {
			ctx.beginPath();
			ctx.arc(sign * anchorX, anchorY + size * 0.07, size * 0.035, 0, TAU);
			ctx.fill();
		}
	}
	ctx.restore();
	mainBlock({
		color: textColor,
		lead: 1.15,
		lines,
		options,
		rotation: theta,
		size,
		x: cx,
		y: cy,
	});
}

/** 存在しない階 — the light travels along the floors and stops where there is no floor. */
function drawElevator(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const unit = Math.min(W, H);
	const version = ["gap", "beyond", "below"][x2Hash(seed, 1) % 3]!;
	const floors = 5 + (x2Hash(seed, 2) % 3);
	const stopAt = lerp({ start: 0.4, end: 0.55, progress: x2Unit(seed, 3) });
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const labels: string[] = [];
	let from = 0;
	let to = 0;
	if (version === "gap") {
		const gapIndex = floors - 2;
		for (let index = 1; index <= floors; index += 1) {
			if (labels.length === gapIndex) labels.push("");
			labels.push(String(index));
		}
		from = 0;
		to = gapIndex;
	} else if (version === "beyond") {
		for (let index = 1; index <= floors; index += 1) labels.push(String(index));
		labels.push("");
		from = Math.max(0, floors - 4);
		to = floors;
	} else {
		labels.push("", "B1");
		for (let index = 1; index < floors; index += 1) labels.push(String(index));
		from = Math.min(labels.length - 1, 4);
		to = 0;
	}
	const total = labels.length;
	const stopTime = Math.max(0.5, duration * stopAt);
	const arrived = lt >= stopTime;
	const current = Math.round(
		lerp({
			start: from,
			end: to,
			progress: inOutSine(clamp(lt / stopTime)),
		}),
	);
	const pitch = Math.min((W * 0.84) / total, unit * 0.115);
	const r = pitch * 0.34;
	const ry = H * (port ? 0.2 : 0.17);
	const x0 = W / 2 - (pitch * (total - 1)) / 2;
	const lines = linesOf(options, 10, 5);
	const size = Math.min(
		fitBlock({ height: H * 0.4, lead: 1.18, lines, width: W * 0.76 }),
		H * 0.22,
	);
	const measure = measureBlock({ lead: 1.18, lines, size, track: 0.05 });
	const textY = H * 0.58;
	const out = tout(scene);
	const color = dimC(frame, 0.38);
	const thickness = Math.max(1.2, unit * 0.0024);
	const light = lightOf(frame);
	const accent = fitContrast(frame, frame.palette.accent);
	// the doors: one seam that parts once the car has stopped
	const gapWidth =
		(measure.width + size * 1.1) *
		inOutCubic(clamp((lt - stopTime - 0.15) / 0.8)) *
		out;
	const ease0 = tin({ length: 0.5, seconds: lt });
	const yA = ry + pitch * 0.9;
	const yB = H * 0.95;
	const tY0 = textY - measure.height / 2 - size * 0.25;
	const tY1 = textY + measure.height / 2 + size * 0.25;
	const yE = yA + (yB - yA) * ease0;
	for (const sign of [-1, 1]) {
		const x = W / 2 + (sign * gapWidth) / 2;
		if (gapWidth > measure.width + size * 0.4) {
			seg({ alpha: 0.8 * out, color, scene, thickness, x0: x, x1: x, y0: yA, y1: yE });
		} else {
			seg({
				alpha: 0.8 * out,
				color,
				scene,
				thickness,
				x0: x,
				x1: x,
				y0: yA,
				y1: Math.min(yE, tY0),
			});
			if (yE > tY1) {
				seg({ alpha: 0.8 * out, color, scene, thickness, x0: x, x1: x, y0: tY1, y1: yE });
			}
		}
	}
	seg({
		alpha: ease0 * out,
		color,
		scene,
		thickness,
		x0: x0 - pitch * 0.7,
		x1: x0 + pitch * (total - 0.3),
		y0: ry + pitch * 0.62,
		y1: ry + pitch * 0.62,
	});
	for (let index = 0; index < total; index += 1) {
		const appear = tin({ delay: index * 0.04, length: 0.3, seconds: lt }) * out;
		const x = x0 + index * pitch;
		const lit = index === current;
		if (appear <= 0) continue;
		if (labels[index]) {
			circle({
				alpha: appear,
				color: lit ? light : undefined,
				radius: r * (0.6 + 0.4 * appear),
				scene,
				stroke: color,
				x,
				y: ry,
			});
			rawText({
				alpha: appear,
				color: lit ? darkOf(frame) : color,
				maxWidth: r * 2,
				mono: true,
				options,
				size: r * (labels[index]!.length > 1 ? 0.8 : 1),
				text: labels[index]!,
				x,
				y: ry,
			});
		} else if (lit) {
			// the slot that is not on the panel
			const flicker = arrived
				? x2Unit(seed, stepOf(scene), 3) < 0.14
					? 0.3
					: 1
				: 1;
			circle({ alpha: appear * flicker, color: accent, radius: r, scene, x, y: ry });
			circle({
				alpha:
					appear *
					flicker *
					0.35 *
					(0.5 + 0.5 * Math.sin(ltOf(scene) * 5)),
				radius: r * 1.5,
				scene,
				stroke: accent,
				x,
				y: ry,
			});
		}
	}
	// direction arrow: blinks while travelling, dead once stopped
	const up = to > from;
	const ax = x0 + pitch * (total - 0.05);
	const ar = r * 0.7;
	const blink = arrived ? 0.25 : stepOf(scene) % 8 < 5 ? 1 : 0.2;
	polyFill({
		alpha: ease0 * out * blink,
		color: arrived ? color : light,
		points: up
			? [
					[ax, ry - ar],
					[ax + ar, ry + ar * 0.7],
					[ax - ar, ry + ar * 0.7],
				]
			: [
					[ax, ry + ar],
					[ax + ar, ry - ar * 0.7],
					[ax - ar, ry - ar * 0.7],
				],
		scene,
	});
	mainBlock({
		color: frame.palette.foreground,
		lines,
		options,
		size,
		x: W / 2,
		y: textY,
	});
}

/** 遅れる水鏡 — the line over dark water; its reflection arrives late, ripples, and once moves by itself. */
function drawReflection(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const ltb = lt;
	const lag = lerp({ start: 0.4, end: 0.8, progress: x2Unit(seed, 1) });
	const ripple = lerp({ start: 0.7, end: 1.3, progress: x2Unit(seed, 2) });
	const odd = x2Unit(seed, 3) < 0.7;
	const oddAt = lerp({ start: 0.45, end: 0.7, progress: x2Unit(seed, 4) });
	const direction = x2Unit(seed, 5) < 0.5 ? -1 : 1;
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const lines = linesOf(options, 10, 5);
	const size = Math.min(
		fitBlock({ height: H * 0.3, lead: 1.12, lines, width: W * 0.82 }),
		H * 0.2,
	);
	const measure = measureBlock({ lead: 1.12, lines, size, track: 0.06 });
	const y0 = H * 0.52;
	const out = tout(scene);
	const ease = tin({ length: 0.6, seconds: lt });
	const dark = nightC(frame);
	// the water (gradient → two stepped bands)
	const bandHeight = (H - y0) / 2;
	rect({ alpha: 0.24 * ease * out, color: dark, height: bandHeight, scene, width: W, x: 0, y: y0 });
	rect({ alpha: 0.55 * ease * out, color: dark, height: bandHeight, scene, width: W, x: 0, y: y0 + bandHeight });
	const color = dimC(frame, 0.35);
	const thickness = Math.max(1, Math.min(W, H) * 0.002);
	seg({
		alpha: 0.7 * out,
		color,
		scene,
		thickness,
		x0: W / 2 - (W * 0.5 * ease),
		x1: W / 2 + (W * 0.5 * ease),
		y0,
		y1: y0,
	});
	for (let index = 0; index < 5; index += 1) {
		const yy = y0 + (H - y0) * (0.2 + 0.16 * index);
		const ww =
			W *
			lerp({ start: 0.05, end: 0.16, progress: x2Unit(seed, index, 1) });
		const xx = wrap(
			W * x2Unit(seed, index, 2) + ltb * W * 0.012 * (index % 2 ? 1 : -1),
			W,
		);
		seg({
			alpha: 0.35 * ease * out,
			color,
			scene,
			thickness,
			x0: xx - ww / 2,
			x1: xx + ww / 2,
			y0: yy,
			y1: yy,
		});
	}
	const textY = y0 - measure.height / 2 - size * 0.1;
	mainBlock({
		color: frame.palette.foreground,
		lead: 1.12,
		lines,
		options,
		size,
		x: W / 2,
		y: textY,
	});
	// the reflection: nine clipped slices of a mirrored, lagging copy
	const mirror = 0.82;
	const reflectedHeight = measure.height * mirror;
	const slices = 9;
	const top = y0 + size * 0.08;
	const glyphTotal = Math.max(1, horrorGlyphs(lines.join("")).length);
	const reflectionAlpha = 0.42 * out * (1 - clamp(frame.exitProgress * 2.2));
	const t0 = duration * 0.25 + lag;
	let driftAll = 0;
	if (odd) {
		const phase = (lt - duration * oddAt) / 0.9;
		if (phase > 0 && phase < 1) {
			driftAll =
				direction *
				size *
				0.42 *
				Math.sin(Math.PI * phase) *
				(x2Unit(seed, stepOf(scene) >> 1, 9) < 0.8 ? 1 : 0.6);
		}
	}
	const reflectionColor = mixC({
		from: frame.palette.foreground,
		to: frame.palette.background,
		progress: 0.15,
	});
	const slots = glyphSlots({
		size,
		text: lines[0] ?? "",
		track: 0.06,
		x: W / 2,
		y: top + reflectedHeight / 2,
	});
	for (let index = 0; index < slices; index += 1) {
		const sliceY = top + (reflectedHeight * index) / slices;
		const dx =
			Math.sin(ltb * 1.7 * ripple + index * 0.85) *
			size *
			0.05 *
			(0.35 + index / slices);
		const sliceAlpha = reflectionAlpha * (1 - (0.7 * index) / slices);
		const { ctx } = scene;
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, sliceY, W, reflectedHeight / slices + 0.6);
		ctx.clip();
		for (const [slotIndex, slot] of slots.entries()) {
			const appear = clamp(
				(lt - t0 - (slotIndex / Math.max(1, glyphTotal - 1)) * lag * 1.6) / 0.55,
			);
			if (appear <= 0) continue;
			rawText({
				alpha: sliceAlpha,
				color: reflectionColor,
				maxWidth: size * 0.78,
				options,
				scaleY: -mirror,
				size,
				text: slot.character,
				x: slot.x + dx + driftAll,
				y: top + reflectedHeight / 2,
			});
		}
		ctx.restore();
	}
}

/** 曇り窓の指文字 — the line wiped into the condensation with a finger; water runs from the strokes. */
function drawFogWindow(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const unit = Math.min(W, H);
	const bar = lerp({ start: 0.22, end: 0.3, progress: x2Unit(seed, 1) });
	const drip = lerp({ start: 0.45, end: 0.9, progress: x2Unit(seed, 2) });
	const tilt = x2Signed(seed, 3) * 2.5;
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const margin = unit * 0.07;
	const fx0 = margin;
	const fx1 = W - margin;
	const fy0 = margin;
	const fy1 = H - margin;
	const barY = fy0 + (fy1 - fy0) * bar;
	const barHeight = unit * 0.022;
	const dark = darkOf(frame);
	const fogColor = mixC({ from: dark, to: lightOf(frame), progress: 0.46 });
	const inkColor = mixC({ from: dark, to: "#000000", progress: 0.6 });
	const wallColor = mixC({ from: dark, to: "#000000", progress: 0.4 });
	const inA = tin({ length: 0.3, seconds: lt });
	rect({ alpha: inA, color: wallColor, height: H, scene, width: W, x: 0, y: 0 });
	rect({ alpha: inA, color: fogColor, height: fy1 - fy0, scene, width: fx1 - fx0, x: fx0, y: fy0 });
	// the fog is thinner towards the frame (edge gradients → flat inner bands)
	rect({
		alpha: 0.16 * inA,
		color: inkColor,
		height: unit * 0.16,
		scene,
		width: fx1 - fx0,
		x: fx0,
		y: fy0,
	});
	rect({
		alpha: 0.16 * inA,
		color: inkColor,
		height: unit * 0.16,
		scene,
		width: fx1 - fx0,
		x: fx0,
		y: fy1 - unit * 0.16,
	});
	rect({
		alpha: 0.12 * inA,
		color: inkColor,
		height: fy1 - fy0,
		scene,
		width: unit * 0.16,
		x: fx0,
		y: fy0,
	});
	rect({
		alpha: 0.12 * inA,
		color: inkColor,
		height: fy1 - fy0,
		scene,
		width: unit * 0.16,
		x: fx1 - unit * 0.16,
		y: fy0,
	});
	rect({
		alpha: inA,
		color: wallColor,
		height: barHeight,
		scene,
		width: fx1 - fx0,
		x: fx0,
		y: barY - barHeight / 2,
	});
	polyStroke({
		alpha: inA,
		color: mixC({ from: wallColor, to: lightOf(frame), progress: 0.18 }),
		points: [
			[fx0, fy0],
			[fx1, fy0],
			[fx1, fy1],
			[fx0, fy1],
			[fx0, fy0],
		],
		scene,
		thickness: Math.max(2, unit * 0.006),
	});
	const lines = linesOf(options, 9, 5);
	const areaHeight = fy1 - barY - barHeight;
	const size = Math.min(
		fitBlock({
			height: areaHeight * 0.56,
			lead: 1.2,
			lines,
			width: (fx1 - fx0) * 0.8,
		}),
		H * 0.2,
	);
	const textY = barY + barHeight / 2 + areaHeight * 0.44;
	mainBlock({
		color: inkColor,
		lead: 1.2,
		lines,
		options,
		rotation: degrees(tilt),
		size,
		x: W / 2,
		y: textY,
	});
	if (lt > duration * 0.35) {
		// water runs down from the strokes
		const limit = fy1 - unit * 0.02;
		const thickness = Math.max(1.5, size * 0.035);
		const slots = glyphSlots({
			size,
			text: lines[0] ?? "",
			track: 0.05,
			x: W / 2,
			y: textY,
		});
		for (const [index, slot] of slots.slice(0, 24).entries()) {
			if (x2Unit(seed, index, 11) > drip) continue;
			const x = slot.x + x2Signed(seed, index, 12) * slot.width * 0.22;
			const yBase = slot.y + slot.height * 0.2;
			const run = outCubic(
				clamp(
					(lt - duration * 0.35 - x2Unit(seed, index, 13) * 1.4) /
						(2.2 + x2Unit(seed, index, 14) * 3),
				),
			);
			const length = Math.min(
				size * lerp({ start: 0.5, end: 1.7, progress: x2Unit(seed, index, 15) }) * run,
				limit - yBase,
			);
			if (length < 2) continue;
			const wobble = x2Signed(seed, index, 16) * thickness;
			seg({
				alpha: 0.85 * tout(scene),
				color: inkColor,
				scene,
				thickness: thickness * lerp({ start: 0.6, end: 1, progress: x2Unit(seed, index, 17) }),
				x0: x,
				x1: x + wobble,
				y0: yBase,
				y1: yBase + length,
			});
			circle({
				alpha: 0.85 * tout(scene),
				color: inkColor,
				radius: thickness * 0.75,
				scene,
				x: x + wobble,
				y: yBase + length,
			});
		}
	}
}

/** 非通知の留守電 — a voicemail from a number that does not exist. */
function drawVoicemail(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const unit = Math.min(W, H);
	const hours = 2 + (x2Hash(seed, 1) % 3);
	const minutes = x2Hash(seed, 2) % 60;
	const deadAt = lerp({ start: 0.3, end: 0.55, progress: x2Unit(seed, 3) });
	const deadWidth = lerp({ start: 0.12, end: 0.22, progress: x2Unit(seed, 4) });
	const glitchAt = lerp({ start: 0.45, end: 0.75, progress: x2Unit(seed, 5) });
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const cardWidth = port ? W * 0.86 : Math.min(W * 0.72, H * 1.3);
	const cardHeight = port ? Math.min(H * 0.62, cardWidth * 1.2) : H * 0.74;
	const fs = clamp(unit * 0.032, 12, 40);
	const ease = tin({ ease: outExpo, length: 0.45, seconds: lt });
	const out = tout(scene);
	const appear = ease * out;
	const x0 = (W - cardWidth) / 2;
	const y0 = (H - cardHeight) / 2 + (1 - ease) * unit * 0.05;
	const x1 = x0 + cardWidth;
	const plate = mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.08 });
	const lineColor = mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.32 });
	const main = frame.palette.foreground;
	const pad = fs * 1.5;
	const waveY = y0 + fs * 6.4;
	const listY0 = waveY + fs * 3.2;
	const listY1 = y0 + cardHeight - fs * 1.1;
	const thickness = Math.max(1.2, unit * 0.002);
	rect({ alpha: appear, color: plate, height: cardHeight, scene, width: cardWidth, x: x0, y: y0 });
	polyStroke({
		alpha: appear,
		color: lineColor,
		points: [
			[x0, y0],
			[x1, y0],
			[x1, y0 + cardHeight],
			[x0, y0 + cardHeight],
			[x0, y0],
		],
		scene,
		thickness,
	});
	// caller: nobody
	const avatarX = x0 + pad + fs * 1.25;
	const avatarY = y0 + fs * 2.5;
	circle({ alpha: appear, radius: fs * 1.25, scene, stroke: lineColor, x: avatarX, y: avatarY });
	rawText({
		alpha: appear,
		color: lineColor,
		maxWidth: fs * 1.4,
		mono: true,
		options,
		size: fs * 1.3,
		text: "?",
		x: avatarX,
		y: avatarY,
	});
	rawText({
		align: "left",
		alpha: appear,
		color: main,
		maxWidth: cardWidth * 0.5,
		mono: true,
		options,
		size: fs * 1.2,
		text: "UNKNOWN",
		x: avatarX + fs * 2.1,
		y: y0 + fs * 1.9,
	});
	// the number never settles on anything but zeros, and loses them for a moment
	const glitchTime = lt - duration * glitchAt;
	const glitching = glitchTime > 0 && glitchTime < 0.35;
	let number = "";
	for (let index = 0; index < 11; index += 1) {
		if (index === 3 || index === 7) number += "-";
		const live =
			lt < 0.25 + index * 0.07 ||
			(glitching && x2Unit(seed, index, stepOf(scene), 2) < 0.6);
		number += live
			? String(x2Hash(seed, index, stepOf(scene)) % 10)
			: "0";
	}
	rawText({
		align: "left",
		alpha: appear,
		color: glitching ? fitContrast(frame, frame.palette.accent) : lineColor,
		maxWidth: cardWidth * 0.5,
		mono: true,
		options,
		size: fs * 0.92,
		text: number,
		x: avatarX + fs * 2.1,
		y: y0 + fs * 3.35,
	});
	rawText({
		align: "right",
		alpha: appear,
		color: lineColor,
		mono: true,
		options,
		size: fs * 0.92,
		text: `${pad2(hours)}:${pad2(minutes)}`,
		x: x1 - pad,
		y: y0 + fs * 1.9,
	});
	seg({
		alpha: appear * 0.7,
		color: lineColor,
		scene,
		thickness,
		x0: x0 + pad,
		x1: x0 + pad + (cardWidth - pad * 2) * ease,
		y0: y0 + fs * 4.7,
		y1: y0 + fs * 4.7,
	});
	// waveform with a stretch of nothing in it
	const bars = port ? 34 : 48;
	const waveX0 = x0 + pad;
	const waveWidth = cardWidth - pad * 2;
	const played = clamp(lt / Math.max(0.2, duration));
	const barWidth = waveWidth / bars;
	for (let index = 0; index < bars; index += 1) {
		const fraction = (index + 0.5) / bars;
		const dead = fraction > deadAt && fraction < deadAt + deadWidth;
		let height =
			fs *
			1.25 *
			(dead
				? 0.05
				: 0.14 +
					0.86 *
						Math.abs(
							smoothNoise({ seed: seed + 3, salt: 0, value: index * 0.7 }),
						) *
						(0.6 + 0.4 * x2Unit(seed, index, 4)));
		if (fraction < played && fraction > played - 0.04 && !dead) {
			height *= 1 + 0.25 * x2Signed(seed, index, stepOf(scene), 5);
		}
		height *= tin({ delay: 0.1 + fraction * 0.3, length: 0.25, seconds: lt });
		rect({
			alpha: appear * (fraction <= played ? 0.9 : 0.7),
			color: fraction <= played ? main : lineColor,
			height: height * 2,
			scene,
			width: barWidth * 0.56,
			x: waveX0 + index * barWidth + barWidth * 0.22,
			y: waveY - height,
		});
	}
	rect({
		alpha: appear,
		color: fitContrast(frame, frame.palette.accent),
		height: fs * 3,
		scene,
		width: thickness * 2,
		x: waveX0 + waveWidth * played - thickness,
		y: waveY - fs * 1.5,
	});
	rawText({
		align: "left",
		alpha: appear,
		color: lineColor,
		mono: true,
		options,
		size: fs * 0.8,
		text: `0:${pad2(Math.floor(Math.max(0, lt)) % 60)}`,
		x: waveX0,
		y: waveY + fs * 2.1,
	});
	rawText({
		align: "right",
		alpha: appear,
		color: lineColor,
		mono: true,
		options,
		size: fs * 0.8,
		text: "--:--",
		x: x1 - pad,
		y: waveY + fs * 2.1,
	});
	const lines = linesOf(options, 9, 5);
	const size = Math.min(
		fitBlock({
			height: (listY1 - listY0) * 0.88,
			lead: 1.2,
			lines,
			width: cardWidth * 0.84,
		}),
		H * 0.18,
	);
	mainBlock({
		color: main,
		lead: 1.2,
		lines,
		options,
		size,
		x: W / 2,
		y: (listY0 + listY1) / 2,
	});
}

/** 街灯の下 — the line stands in the cone of the only light; everything else is night, and the lamp is failing. */
function drawStreetLamp(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const ltb = lt;
	const port = H > W * 1.08;
	const unit = Math.min(W, H);
	const side = x2Unit(seed, 1) < 0.5 ? -1 : 1;
	const rate = lerp({ start: 0.4, end: 0.9, progress: x2Unit(seed, 2) });
	const moths = 3 + (x2Hash(seed, 3) % 4);
	const coneWidth = Math.min(W * 0.46, unit * 0.64);
	const hx = W * (0.5 + (port ? 0 : side * 0.05));
	const hy = H * 0.12;
	const gy = H * 0.88;
	const coneHeight = gy - hy;
	const apex = unit * 0.022;
	const lines = linesOf(options, 7, 5);
	// the block sits at the foot of the cone: the lower it ends up, the wider it may be
	let size = Math.min(
		fitBlock({ height: coneHeight * 0.42, lead: 1.16, lines, width: coneWidth * 0.92 }),
		H * 0.17,
	);
	let measure = measureBlock({ lead: 1.16, lines, size, track: 0.05 });
	for (let index = 0; index < 2; index += 1) {
		const f = clamp(1 - 0.07 - measure.height / coneHeight, 0.5, 0.9);
		size = Math.min(
			fitBlock({
				height: coneHeight * 0.42,
				lead: 1.16,
				lines,
				width: Math.min(coneWidth * 2 * f * 0.9, W * 0.84),
			}),
			H * 0.17,
		);
		measure = measureBlock({ lead: 1.16, lines, size, track: 0.05 });
	}
	// lamp level: stutters on, fails now and then, dies on the way out
	let level =
		lt < 0.4
			? (x2Unit(seed, stepOf(scene), 3) < 0.45 ? 0.12 : 1) * clamp(lt / 0.1)
			: lamp(lt + (seed % 97), seed, rate);
	if (frame.exitProgress > 0) {
		level *=
			(x2Unit(seed, stepOf(scene), 4) < 0.4 ? 0.3 : 1) *
			(1 - inCubic(frame.exitProgress));
	}
	const light = glowC(frame);
	const dark = nightC(frame);
	const conePoints: Array<readonly [number, number]> = [
		[hx - apex, hy],
		[hx + apex, hy],
		[hx + coneWidth, gy],
		[hx - coneWidth, gy],
	];
	// the cone (gradient → two stepped triangles)
	polyFill({
		alpha: 0.22 * level,
		color: light,
		points: [
			conePoints[0]!,
			conePoints[1]!,
			[hx + coneWidth * 0.55, (hy + gy) / 2],
			[hx - coneWidth * 0.55, (hy + gy) / 2],
		],
		scene,
	});
	polyFill({
		alpha: 0.09 * level,
		color: light,
		points: [
			[hx - coneWidth * 0.55, (hy + gy) / 2],
			[hx + coneWidth * 0.55, (hy + gy) / 2],
			conePoints[2]!,
			conePoints[3]!,
		],
		scene,
	});
	ellipseFill({
		alpha: 0.16 * level,
		color: light,
		radiusX: coneWidth,
		radiusY: coneWidth * 0.12,
		rotation: 0,
		scene,
		x: hx,
		y: gy,
	});
	mainBlock({
		color: frame.palette.foreground,
		lead: 1.16,
		lines,
		options,
		size,
		x: hx,
		y: gy - coneHeight * 0.07 - measure.height / 2,
	});
	const { ctx } = scene;
	if (ctx.fill && ctx.moveTo && ctx.lineTo) {
		const baseAlpha = ctx.globalAlpha;
		ctx.save();
		ctx.beginPath();
		ctx.rect(-W, -H, W * 3, H * 3);
		if (buildPolyPath({ ctx, points: conePoints })) {
			ctx.closePath?.();
			ctx.globalAlpha = baseAlpha * 0.93;
			ctx.fillStyle = dark;
			ctx.fill("evenodd");
			ctx.globalAlpha = baseAlpha * clamp01((1 - level) * 0.85);
			ctx.fill();
		}
		ctx.restore();
		ctx.globalAlpha = baseAlpha;
	}
	// the lamp itself: a pole at the edge of the light, an arm, a small head
	const poleColor = mixC({ from: dark, to: lightOf(frame), progress: 0.3 });
	const thickness = Math.max(2, unit * 0.006);
	const poleX = hx - side * coneWidth * 0.94;
	const ease = tin({ length: 0.3, seconds: lt });
	polyPartial({
		alpha: ease,
		color: poleColor,
		points: [
			[poleX, gy],
			[poleX, hy - unit * 0.02],
			[hx - side * apex, hy - unit * 0.02],
		],
		progress: 1,
		scene,
		thickness,
	});
	polyFill({
		alpha: ease,
		color: poleColor,
		points: [
			[hx - apex * 1.8, hy],
			[hx + apex * 1.8, hy],
			[hx + apex, hy - unit * 0.03],
			[hx - apex, hy - unit * 0.03],
		],
		scene,
	});
	rect({
		alpha: clamp(level) * 0.9,
		color: light,
		height: Math.max(2, unit * 0.005),
		scene,
		width: apex * 2.6,
		x: hx - apex * 1.3,
		y: hy,
	});
	seg({
		alpha: 0.5 * ease,
		color: poleColor,
		scene,
		thickness: Math.max(1, unit * 0.002),
		x0: 0,
		x1: W,
		y0: gy,
		y1: gy,
	});
	for (let index = 0; index < moths; index += 1) {
		const phase0 = x2Unit(seed, index, 21) * TAU;
		const radius = unit * lerp({ start: 0.02, end: 0.06, progress: x2Unit(seed, index, 22) });
		const speed =
			lerp({ start: 3, end: 6, progress: x2Unit(seed, index, 23) }) *
			(index % 2 ? 1 : -1);
		const mx =
			hx +
			Math.cos(ltb * speed + phase0) * radius * 1.3 +
			smoothNoise({ seed: seed + index, salt: 0, value: ltb * 2 }) * radius;
		const my =
			hy +
			unit * 0.05 +
			Math.sin(ltb * speed * 1.3 + phase0) * radius;
		circle({
			alpha: 0.7 * clamp(level) * ease,
			color: light,
			radius: Math.max(1.2, unit * 0.003),
			scene,
			x: mx,
			y: my,
		});
	}
}

/** 破れた書き置き — a note torn in two: the pieces tear apart and lie crooked, the line split between them. */
function drawTornNote(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const raw = flat(frame.cut?.text ?? "");
	const count = horrorGlyphs(raw).length;
	const whole = horrorLines({ maximum: port ? 5 : 8, text: raw });
	let textA = raw;
	let textB = "";
	if (whole.length >= 2) {
		const half = Math.ceil(whole.length / 2);
		textA = whole.slice(0, half).join("");
		textB = whole.slice(half).join("");
	} else if (hasLatin(raw) && raw.includes(" ")) {
		const words = raw.split(" ");
		const half = Math.ceil(words.length / 2);
		textA = words.slice(0, half).join(" ");
		textB = words.slice(half).join(" ");
	} else if (!hasLatin(raw) && count >= 4) {
		const characters = Array.from(raw);
		let half = Math.ceil(characters.length / 2);
		const boundary = /[、。,.!?:;…ーぁぃぅぇぉっゃゅょァィゥェォッャュョ]/u;
		while (half < characters.length - 1 && boundary.test(characters[half]!)) {
			half += 1;
		}
		textA = characters.slice(0, half).join("");
		textB = characters.slice(half).join("");
	}
	const linesA = [textA];
	const linesB = textB ? [textB] : [];
	const rotA = lerp({ start: -4.5, end: -1.5, progress: x2Unit(seed, 1) });
	const rotB = lerp({ start: 2, end: 5.5, progress: x2Unit(seed, 2) });
	const dxSeed = lerp({ start: 0.02, end: 0.045, progress: x2Unit(seed, 3) });
	const side = x2Unit(seed, 4) < 0.5 ? -1 : 1;
	const ruled = x2Unit(seed, 5) < 0.6;
	const maxWidth = W * 0.56;
	const maxHeightA = H * (textB ? 0.21 : 0.34);
	const size = Math.min(
		fitBlock({ height: maxHeightA, lead: 1.2, lines: linesA, width: maxWidth }),
		textB
			? fitBlock({ height: H * 0.21, lead: 1.2, lines: linesB, width: maxWidth })
			: 1e9,
		H * 0.19,
	);
	const measureA = measureBlock({ lead: 1.2, lines: linesA, size, track: 0.04 });
	const measureB = textB
		? measureBlock({ lead: 1.2, lines: linesB, size, track: 0.04 })
		: { height: 0, width: 0 };
	const paperWidth = Math.max(measureA.width, measureB.width) + size * 1.3;
	const heightA = measureA.height + size * 0.95;
	const heightB = textB ? measureB.height + size * 0.95 : size * 1.1;
	const yA0 = H / 2 - (heightA + heightB) / 2 + heightA / 2;
	const yB0 = yA0 + heightA / 2 + heightB / 2;
	const tear = inOutCubic(clamp((lt - 0.12) / 0.6));
	const positionA = {
		x: W / 2 - side * W * dxSeed * tear,
		y: yA0 - H * 0.02 * tear,
	};
	const positionB = {
		x: W / 2 + side * W * dxSeed * tear,
		y: yB0 + H * 0.03 * tear,
	};
	const rotationA = degrees(rotA * tear);
	const rotationB = degrees(rotB * tear);
	const paperColor = mixC({ from: lightOf(frame), to: darkOf(frame), progress: 0.1 });
	const inkColor = mixC({ from: darkOf(frame), to: "#000000", progress: 0.25 });
	const appear = tin({ length: 0.2, seconds: lt }) * tout(scene);
	const jagCount = 18;
	const jag = (index: number): number =>
		x2Signed(seed, index, 31) * size * 0.13 +
		(index % 2 ? 1 : -1) * size * 0.03;
	const piece = ({
		centerX,
		centerY,
		height,
		jagOnTop,
		rotation,
	}: {
		readonly centerX: number;
		readonly centerY: number;
		readonly height: number;
		readonly jagOnTop: boolean;
		readonly rotation: number;
	}): void => {
		const points: Array<readonly [number, number]> = [];
		// eslint-disable-next-line opencut/prefer-object-params -- The pack's local point-rotation closure.
		const local = (x: number, y: number): readonly [number, number] => [
			centerX + Math.cos(rotation) * x - Math.sin(rotation) * y,
			centerY + Math.sin(rotation) * x + Math.cos(rotation) * y,
		];
		if (jagOnTop) {
			for (let index = 0; index <= jagCount; index += 1) {
				points.push(
					local(
						-paperWidth / 2 + (paperWidth * index) / jagCount,
						-height / 2 + jag(index),
					),
				);
			}
			points.push(local(paperWidth / 2, height / 2));
			points.push(local(-paperWidth / 2, height / 2));
		} else {
			points.push(local(-paperWidth / 2, -height / 2));
			points.push(local(paperWidth / 2, -height / 2));
			for (let index = jagCount; index >= 0; index -= 1) {
				points.push(
					local(
						-paperWidth / 2 + (paperWidth * index) / jagCount,
						height / 2 + jag(index),
					),
				);
			}
		}
		polyFill({
			alpha: appear * 0.28,
			color: "#000000",
			points: points.map(([x, y]) => [x + size * 0.05, y + size * 0.07] as const),
			scene,
		});
		polyFill({ alpha: appear, color: paperColor, points, scene });
		if (ruled) {
			const step = size * 0.6;
			for (
				let y = -height / 2 + step * 0.7;
				y < height / 2 + size * 0.2;
				y += step
			) {
				seg({
					alpha: appear * 0.14,
					color: inkColor,
					scene,
					thickness: Math.max(1, size * 0.012),
					x0: centerX - Math.cos(rotation) * paperWidth / 2 - Math.sin(rotation) * y,
					x1: centerX + Math.cos(rotation) * paperWidth / 2 - Math.sin(rotation) * y,
					y0: centerY - Math.sin(rotation) * paperWidth / 2 + Math.cos(rotation) * y,
					y1: centerY + Math.sin(rotation) * paperWidth / 2 + Math.cos(rotation) * y,
				});
			}
		}
	};
	piece({
		centerX: positionA.x,
		centerY: positionA.y,
		height: heightA,
		jagOnTop: false,
		rotation: rotationA,
	});
	if (textB) {
		piece({
			centerX: positionB.x,
			centerY: positionB.y,
			height: heightB,
			jagOnTop: true,
			rotation: rotationB,
		});
	}
	mainBlock({
		color: inkColor,
		lead: 1.2,
		lines: linesA,
		options,
		rotation: rotationA,
		size,
		x: positionA.x,
		y: positionA.y,
	});
	if (textB) {
		const nudge = size * 0.06; // nudge down past the torn edge
		mainBlock({
			color: inkColor,
			lead: 1.2,
			lines: linesB,
			options,
			rotation: rotationB,
			size,
			x: positionB.x - Math.sin(rotationB) * nudge,
			y: positionB.y + Math.cos(rotationB) * nudge,
		});
	}
}

/** 扉の下の影 — the strip of light under a door, and two shadows that walk into it and stop. */
function drawUnderDoor(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const ltb = lt;
	const unit = Math.min(W, H);
	const from = x2Unit(seed, 1) < 0.5 ? -1 : 1;
	const at = lerp({ start: 0.28, end: 0.42, progress: x2Unit(seed, 2) });
	const knob = x2Unit(seed, 3) < 0.5 ? -1 : 1;
	const feetOffset = x2Signed(seed, 4) * 0.18;
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const lines = linesOf(options, 9, 5);
	const size = Math.min(
		fitBlock({ height: H * 0.4, lead: 1.18, lines, width: W * 0.72 }),
		H * 0.2,
	);
	const measure = measureBlock({ lead: 1.18, lines, size, track: 0.05 });
	const doorWidth = clamp(
		measure.width + size * 1.7,
		Math.min(W * 0.5, H * 0.46),
		W * 0.88,
	);
	const top = H * 0.07;
	const gy = H * 0.855;
	const gh = unit * 0.02;
	const x0 = W / 2 - doorWidth / 2;
	const x1 = W / 2 + doorWidth / 2;
	const out = tout(scene);
	const ease = tin({ ease: inOutCubic, length: 0.8, seconds: lt });
	const color = dimC(frame, 0.26);
	const thickness = Math.max(1.2, unit * 0.0024);
	const light = glowC(frame);
	polyPartial({
		alpha: out,
		color,
		points: [
			[x0, gy],
			[x0, top],
			[x1, top],
			[x1, gy],
		],
		progress: ease,
		scene,
		thickness,
	});
	seg({ alpha: 0.6 * ease * out, color, scene, thickness, x0: 0, x1: x0, y0: gy + gh, y1: gy + gh });
	seg({ alpha: 0.6 * ease * out, color, scene, thickness, x0: x1, x1: W, y0: gy + gh, y1: gy + gh });
	// feet: they come along the gap in a few steps and stop under the words
	const footWidth = clamp(doorWidth * 0.075, unit * 0.045, unit * 0.085);
	const targetX = W / 2 + feetOffset * doorWidth;
	const startX = from > 0 ? x1 + footWidth * 2 : x0 - footWidth * 2;
	const walk = (input: number): number => {
		const value = clamp(input) * 4;
		const index = Math.floor(value);
		return Math.min(1, (index + inOutCubic(value - index)) / 4);
	};
	const t0 = duration * at * 0.5;
	const travel = Math.max(0.8, duration * at);
	const feet = [
		lerp({
			start: startX,
			end: targetX - from * footWidth * 0.75,
			progress: walk((lt - t0) / travel),
		}),
		lerp({
			start: startX,
			end: targetX + from * footWidth * 0.75,
			progress: walk((lt - t0 - travel * 0.11) / travel),
		}),
	];
	const arrived = lt > t0 + travel * 1.15;
	const level =
		(lt < 0.3
			? x2Unit(seed, stepOf(scene), 2) < 0.4
				? 0.2
				: 1
			: 0.9 + 0.1 * x2Unit(seed, stepOf(scene), 3)) *
		clamp(lt / 0.12) *
		(1 - clamp(frame.exitProgress * 3));
	// light spilling under the door onto the floor (gradient → flat trapezoid)
	polyFill({
		alpha: 0.12 * level,
		color: light,
		points: [
			[x0, gy + gh],
			[x1, gy + gh],
			[x1 + doorWidth * 0.12, H],
			[x0 - doorWidth * 0.12, H],
		],
		scene,
	});
	rect({ alpha: 0.9 * level, color: light, height: gh, scene, width: doorWidth, x: x0, y: gy });
	for (const foot of feet) {
		const a0 = Math.max(x0, foot - footWidth / 2);
		const a1 = Math.min(x1, foot + footWidth / 2);
		if (a1 - a0 < 1) continue;
		rect({ alpha: 1, color: frame.palette.background, height: gh + 2, scene, width: a1 - a0, x: a0, y: gy - 1 });
		polyFill({
			alpha: 0.8 * clamp(level),
			color: frame.palette.background,
			points: [
				[a0, gy + gh],
				[a1, gy + gh],
				[a1 + footWidth * 0.5, H],
				[a0 - footWidth * 0.5, H],
			],
			scene,
		});
	}
	// the handle moves once they have stopped
	const knobX = knob > 0 ? x1 - size * 0.42 : x0 + size * 0.42;
	const knobY = H * 0.5;
	const knobR = Math.max(4, unit * 0.013);
	const rattle =
		arrived && x2Unit(seed, Math.floor(lt * 1.3), 6) < 0.55
			? Math.sin(ltb * 22) * 24
			: 0;
	const knobAngle = degrees((10 + rattle) * knob);
	circle({ alpha: ease * out, radius: knobR, scene, stroke: color, x: knobX, y: knobY });
	seg({
		alpha: ease * out,
		color,
		scene,
		thickness: thickness * 1.6,
		x0: knobX,
		x1: knobX - knob * Math.cos(knobAngle) * knobR * 3.2,
		y0: knobY,
		y1: knobY + Math.sin(knobAngle) * knobR * 3.2,
	});
	mainBlock({
		color: frame.palette.foreground,
		lines,
		options,
		size,
		x: W / 2,
		y: (top + gy) / 2 - H * 0.02,
	});
}

/** 鎧戸の隙間 — horizontal slats open just enough to read the line, and someone walks past outside. */
function drawSlats(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const unit = Math.min(W, H);
	const duty = lerp({ start: 0.26, end: 0.33, progress: x2Unit(seed, 1) });
	const at = lerp({ start: 0.35, end: 0.6, progress: x2Unit(seed, 2) });
	const direction = x2Unit(seed, 3) < 0.5 ? -1 : 1;
	const passes = x2Unit(seed, 4) < 0.85;
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const lines = linesOf(options, 8, 4);
	const size = Math.min(
		fitBlock({ height: H * 0.5, lead: 1.12, lines, width: W * 0.84 }),
		H * 0.3,
	);
	mainBlock({
		color: frame.palette.foreground,
		lead: 1.12,
		lines,
		options,
		size,
		x: W / 2,
		y: H / 2,
	});
	const dark = nightC(frame);
	const slat = mixC({
		from: frame.palette.background,
		to: "#000000",
		progress: isDark(frame.palette.background) ? 0.55 : 0.84,
	});
	const edge = mixC({ from: slat, to: lightOf(frame), progress: 0.22 });
	const pitch = clamp(size * 0.2, unit * 0.028, unit * 0.06);
	const open =
		tin({ delay: 0.03, ease: inOutCubic, length: 0.5, seconds: lt }) *
		(1 - inCubic(frame.exitProgress));
	if (passes) {
		const phase = (lt - duration * at) / 1.3;
		if (phase > 0 && phase < 1) {
			const px = lerp({
				start: -unit * 0.2,
				end: W + unit * 0.2,
				progress: direction > 0 ? phase : 1 - phase,
			});
			rect({ alpha: 0.3, color: dark, height: H, scene, width: unit * 0.26, x: px - unit * 0.13, y: 0 });
			rect({ alpha: 0.45, color: dark, height: H, scene, width: unit * 0.16, x: px - unit * 0.08, y: 0 });
		}
	}
	const lineHeight = Math.max(1, unit * 0.0016);
	let y = -pitch * 0.4;
	for (let index = 0; y < H && index < 80; index += 1) {
		// a hand on the slats now and then: one of them closes a little
		const twitch =
			x2Unit(seed, index, stepOf(scene) >> 3, 4) < 0.04 ? 0.25 : 0;
		const d = clamp(
			lerp({
				start: 1,
				end: duty + x2Signed(seed, index, 3) * 0.035 + twitch,
				progress: open,
			}),
		);
		rect({ alpha: 1, color: slat, height: pitch * d + 0.5, scene, width: W, x: 0, y });
		if (d < 0.98) {
			rect({ alpha: 0.8, color: edge, height: lineHeight, scene, width: W, x: 0, y: y + pitch * d - lineHeight });
		}
		y += pitch;
	}
}

/** 止まった時計 — the second hand keeps trying the same second; the line stands beside the dial. */
function drawStoppedClock(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const unit = Math.min(W, H);
	const hours = 1 + (x2Hash(seed, 1) % 11);
	const minutes = 3 + (x2Hash(seed, 2) % 55);
	const seconds = 5 + (x2Hash(seed, 3) % 46);
	const stick = lerp({ start: 0.25, end: 0.45, progress: x2Unit(seed, 4) });
	const flip = x2Unit(seed, 5) < 0.5;
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const radius = port ? W * 0.3 : Math.min(H * 0.33, W * 0.2);
	const cx = port ? W / 2 : flip ? W * 0.94 - radius : W * 0.06 + radius;
	const cy = port ? H * 0.28 : H * 0.48;
	const textWidth = W * 0.83 - radius * 2;
	const textCenterX = flip ? W * 0.06 + textWidth / 2 : W * 0.94 - textWidth / 2;
	const out = tout(scene);
	const ease = tin({ ease: inOutCubic, length: 0.9, seconds: lt });
	const color = dimC(frame, 0.34);
	const thickness = Math.max(1.2, unit * 0.0026);
	arcPolyline({
		alpha: out,
		centerX: cx,
		centerY: cy,
		color,
		fromDegrees: -90,
		radius,
		scene,
		thickness: thickness * 1.5,
		toDegrees: -90 + 360 * ease,
	});
	for (let index = 0; index < 60 * ease; index += 1) {
		const angle = degrees((index / 60) * 360 - 90);
		const big = index % 5 === 0;
		const r0 = radius * (big ? 0.88 : 0.94);
		seg({
			alpha: out * (big ? 1 : 0.7),
			color,
			scene,
			thickness: big ? thickness * 1.6 : thickness,
			x0: cx + Math.cos(angle) * r0,
			x1: cx + Math.cos(angle) * radius * 0.975,
			y0: cy + Math.sin(angle) * r0,
			y1: cy + Math.sin(angle) * radius * 0.975,
		});
	}
	// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the pack's `hand(deg, len, w, c2, a, back)` closure.
	const hand = (
		angleDeg: number,
		length: number,
		width: number,
		handColor: string,
		alpha: number,
		back = 0,
	): void => {
		const angle = degrees(angleDeg - 90);
		seg({
			alpha,
			color: handColor,
			scene,
			thickness: width,
			x0: cx - Math.cos(angle) * back,
			x1: cx + Math.cos(angle) * length,
			y0: cy - Math.sin(angle) * back,
			y1: cy + Math.sin(angle) * length,
		});
	};
	const handColor = dimC(frame, 0.55);
	const handEase = tin({ delay: 0.25, length: 0.5, seconds: lt }) * out;
	hand(((hours % 12) + minutes / 60) * 30, radius * 0.5 * handEase, thickness * 3, handColor, out);
	hand(minutes * 6, radius * 0.76 * handEase, thickness * 2, handColor, out);
	// the second hand runs, then sticks: it tries the next second and falls back
	const stickTime = Math.max(0.6, duration * stick);
	let second = seconds + Math.floor(Math.min(lt, stickTime));
	let tremor = 0;
	if (lt >= stickTime) {
		const fraction = (lt - stickTime) % 1;
		if (fraction < 0.13) second += 1;
		tremor = x2Signed(seed, stepOf(scene), 5) * 0.7;
	}
	hand(
		second * 6 + tremor,
		radius * 0.84 * handEase,
		thickness * 1.2,
		fitContrast(frame, frame.palette.accent),
		out,
		radius * 0.14 * handEase,
	);
	circle({ alpha: out * ease, color: handColor, radius: thickness * 3, scene, x: cx, y: cy });
	const fs = clamp(unit * 0.026, 11, 32);
	rawText({
		alpha: ease * out,
		color,
		maxWidth: radius * 2,
		mono: true,
		options,
		size: fs,
		text: `${pad2(hours)}:${pad2(minutes)}:${pad2(second % 60)}`,
		x: cx,
		y: cy + radius + fs * 1.7,
	});
	const lines = horrorLines({ maximum: 5, text: flat(frame.cut?.text ?? "") });
	const size = port
		? Math.min(
				fitBlock({ height: H * 0.32, lead: 1.18, lines, width: W * 0.84 }),
				H * 0.13,
			)
		: Math.min(
				fitBlock({ height: H * 0.62, lead: 1.18, lines, width: textWidth }),
				H * 0.22,
			);
	mainBlock({
		color: frame.palette.foreground,
		lines,
		options,
		size,
		x: port ? W / 2 : textCenterX,
		y: port ? H * 0.72 : H / 2,
	});
}

/** 近づく人影 — a far figure on an empty floor; each time the light drops out it is standing nearer. */
function drawCloser(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const unit = Math.min(W, H);
	const side = x2Unit(seed, 1) < 0.5 ? -1 : 1;
	const stages = 3 + (x2Hash(seed, 2) % 2);
	const vx = W * lerp({ start: 0.42, end: 0.58, progress: x2Unit(seed, 3) });
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const lines = linesOf(options, 10, 5);
	const size = Math.min(
		fitBlock({
			height: H * (port ? 0.26 : 0.29),
			lead: 1.16,
			lines,
			width: W * 0.82,
		}),
		H * 0.19,
	);
	const measure = measureBlock({ lead: 1.16, lines, size, track: 0.05 });
	const ty = Math.max(port ? H * 0.24 : H * 0.26, H * 0.07 + measure.height / 2);
	const hy = H * (port ? 0.56 : 0.6);
	const stageAt = (stage: number): number =>
		duration * (0.18 + (0.6 * stage) / stages);
	let stage = 0;
	let dark = false;
	for (let index = 1; index <= stages; index += 1) {
		const since = lt - stageAt(index);
		if (since >= 0) stage = index;
		if (since > -0.045 && since < 0.1) dark = true;
	}
	const out = tout(scene);
	const ease = tin({ length: 0.7, seconds: lt });
	const light = glowC(frame);
	const color = dimC(frame, 0.22);
	const thickness = Math.max(1.2, unit * 0.0022);
	ellipseFill({
		alpha: 0.12 * ease * out,
		color: light,
		radiusX: unit * 0.6,
		radiusY: unit * 0.6 * 0.45,
		rotation: 0,
		scene,
		x: vx,
		y: hy,
	});
	seg({
		alpha: out,
		color,
		scene,
		thickness,
		x0: W / 2 - (W * 0.5 * ease),
		x1: W / 2 + (W * 0.5 * ease),
		y0: hy,
		y1: hy,
	});
	for (const bx of [-0.25, 0.2, 0.8, 1.25]) {
		polyPartial({
			alpha: out * 0.7,
			color,
			points: [
				[vx, hy],
				[W * bx, H],
			],
			progress: ease,
			scene,
			thickness,
		});
	}
	// the figure: a head and a long body, nothing else
	const near = (stage / stages) ** 1.6;
	const figureHeight = lerp({
		start: H * 0.05,
		end: H * (port ? 0.3 : 0.38),
		progress: near,
	});
	const baseY = lerp({ start: hy + figureHeight * 0.03, end: H * 1.03, progress: near });
	const x = lerp({ start: vx, end: W * (0.5 + side * 0.28), progress: near });
	const r = figureHeight * 0.1;
	const figureColor = mixC({
		from: frame.palette.background,
		to: "#000000",
		progress: isDark(frame.palette.background) ? 0.75 : 0.82,
	});
	const rim = dimC(frame, 0.3);
	const top = baseY - figureHeight;
	const appear = clamp((lt - 0.25) / 0.5) * out;
	if (appear > 0) {
		// the long body (quadratic shoulders sampled to a polyline)
		const shoulder = (sign: number): Array<readonly [number, number]> => {
			const p0: readonly [number, number] = [x + sign * figureHeight * 0.065, top + r * 2.1];
			const control: readonly [number, number] = [x + sign * figureHeight * 0.16, top + r * 2.5];
			const p1: readonly [number, number] = [x + sign * figureHeight * 0.15, top + r * 4.4];
			const points: Array<readonly [number, number]> = [];
			for (let index = 0; index <= 6; index += 1) {
				const t = index / 6;
				const inv = 1 - t;
				points.push([
					inv * inv * p0[0] + 2 * inv * t * control[0] + t * t * p1[0],
					inv * inv * p0[1] + 2 * inv * t * control[1] + t * t * p1[1],
				]);
			}
			return points;
		};
		const body: Array<readonly [number, number]> = [
			...shoulder(-1),
			[x - figureHeight * 0.115, baseY],
			[x + figureHeight * 0.115, baseY],
			...shoulder(1).reverse(),
		];
		polyFill({ alpha: appear, color: figureColor, points: body, scene });
		polyStroke({ alpha: appear, color: rim, points: body, scene, thickness });
		circle({ alpha: appear, color: figureColor, radius: r, scene, stroke: rim, x, y: top + r * 1.05 });
	}
	mainBlock({
		color: frame.palette.foreground,
		lead: 1.16,
		lines,
		options,
		size,
		x: W / 2,
		y: ty,
	});
	if (dark) {
		rect({ alpha: 0.86, color: nightC(frame), height: H, scene, width: W, x: 0, y: 0 });
	}
}

/** 下りていく階段 — each line on a lower, smaller step; below them the steps go dark, and something is climbing. */
function drawStairs(options: TypographyLayoutOptions): void {
	const scene = options;
	const { width: W, height: H, frame } = scene;
	const seed = seedOfScene(scene);
	const lt = ltOf(scene);
	const port = H > W * 1.08;
	const unit = Math.min(W, H);
	const steps = 8;
	const q = lerp({ start: 0.82, end: 0.87, progress: x2Unit(seed, 1) });
	const climb = x2Unit(seed, 2) < 0.85;
	const at = lerp({ start: 0.25, end: 0.4, progress: x2Unit(seed, 3) });
	const drift = W * (x2Signed(seed, 4) * 0.04);
	const duration = (frame.cut?.duration ?? 3 * 120_000) / 120_000;
	const lines = horrorLines({
		maximum: port ? 5 : 8,
		text: flat(frame.cut?.text ?? ""),
	}).slice(0, 5);
	const lineCount = lines.length;
	const h0 = (H * 0.86 * (1 - q)) / (1 - q ** steps);
	const ys: number[] = [H * 0.07];
	for (let index = 0; index < steps; index += 1) {
		ys.push(ys[index]! + h0 * q ** index);
	}
	const halfWidth = (index: number): number => W * 0.45 * q ** index;
	const centerXAt = (index: number): number => W / 2 + drift * index;
	let base = 1e9;
	for (let index = 0; index < lineCount; index += 1) {
		base = Math.min(
			base,
			fitBlock({
				height: (ys[index + 1]! - ys[index]!) * 0.68,
				lead: 1.05,
				lines: [lines[index]!],
				width: halfWidth(index + 1) * 2 * 0.88,
			}) / q ** index,
		);
	}
	base = Math.min(base, H * 0.2);
	const out = tout(scene);
	const color = dimC(frame, 0.36);
	const thickness = Math.max(1.2, unit * 0.0024);
	const light = glowC(frame);
	// something comes up the steps, one at a time, and stops just below the words
	if (climb) {
		const t0 = duration * at;
		const dt = Math.max(
			0.22,
			Math.min(0.5, (duration * 0.45) / Math.max(1, steps - lineCount)),
		);
		const position = steps - 1 - Math.floor((lt - t0) / dt);
		if (lt >= t0) {
			for (let index = lineCount; index < steps; index += 1) {
				const current = Math.max(lineCount, position);
				const alpha =
					index === current
						? 0.2 * (0.75 + 0.25 * x2Unit(seed, stepOf(scene), 6))
						: index > current
							? 0.05
							: 0;
				if (alpha > 0) {
					polyFill({
						alpha: alpha * out,
						color: light,
						points: [
							[centerXAt(index) - halfWidth(index), ys[index]!],
							[centerXAt(index) + halfWidth(index), ys[index]!],
							[centerXAt(index + 1) + halfWidth(index + 1), ys[index + 1]!],
							[centerXAt(index + 1) - halfWidth(index + 1), ys[index + 1]!],
						],
						scene,
					});
				}
			}
		}
	}
	for (let index = 0; index <= steps; index += 1) {
		const appear = tin({ delay: index * 0.07, length: 0.4, seconds: lt });
		const alpha = out * (1 - (0.62 * index) / steps);
		if (appear <= 0) continue;
		seg({
			alpha,
			color,
			scene,
			thickness,
			x0: centerXAt(index) - halfWidth(index) * appear,
			x1: centerXAt(index) + halfWidth(index) * appear,
			y0: ys[index]!,
			y1: ys[index]!,
		});
		if (index < steps) {
			for (const sign of [-1, 1]) {
				polyPartial({
					alpha: alpha * 0.8,
					color,
					points: [
						[centerXAt(index) + sign * halfWidth(index), ys[index]!],
						[centerXAt(index + 1) + sign * halfWidth(index + 1), ys[index + 1]!],
					],
					progress: tin({ delay: index * 0.07 + 0.2, length: 0.3, seconds: lt }),
					scene,
					thickness,
				});
			}
		}
	}
	// below the last step the dark comes up (gradient → two stepped bands)
	const yd = ys[Math.min(steps, lineCount)]!;
	const fade = tin({ length: 0.6, seconds: lt }) * out;
	const dark = nightC(frame);
	rect({ alpha: 0.3 * fade, color: dark, height: (H - yd) / 2, scene, width: W, x: 0, y: yd });
	rect({ alpha: 0.62 * fade, color: dark, height: (H - yd) / 2, scene, width: W, x: 0, y: yd + (H - yd) / 2 });
	for (let index = 0; index < lineCount; index += 1) {
		mainBlock({
			color: frame.palette.foreground,
			lead: 1.1,
			lines: [lines[index]!],
			options,
			size: base * q ** index,
			x: centerXAt(index) + drift * 0.5,
			y: (ys[index]! + ys[index + 1]!) / 2,
		});
	}
}

/* ================================================================== DECOR */

interface X2HorrorDecorDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly layer: "back" | "front";
	readonly width: number;
}

const X2_HORROR_BACK_DECORS = new Set(["hzFootprints"]);

export function drawX2HorrorDecor(options: X2HorrorDecorDraw): void {
	for (const decor of options.frame.cut?.preset.decor ?? []) {
		if (X2_HORROR_BACK_DECORS.has(decor) ? options.layer !== "back" : options.layer !== "front") {
			continue;
		}
		switch (decor) {
			case "hzPairEyes":
				drawPairEyes(options);
				break;
			case "hzPeeker":
				drawPeeker(options);
				break;
			case "hzFootprints":
				drawFootprints(options);
				break;
			case "hzStrayGlyph":
				drawStrayGlyph(options);
				break;
			case "hzFingers":
				drawFingers(options);
				break;
			case "hzHandprints":
				drawHandprints(options);
				break;
			case "hzBareBulb":
				drawBareBulb(options);
				break;
			case "hzDoorAjar":
				drawDoorAjar(options);
				break;
			case "hzCobweb":
				drawCobweb(options);
				break;
			case "hzFilmDirt":
				drawFilmDirt(options);
				break;
		}
	}
}

function decorScene(options: X2HorrorDecorDraw): X2HorrorScene {
	return options;
}

function decorLayoutOptions(
	options: X2HorrorDecorDraw,
): TypographyLayoutOptions {
	return {
		ctx: options.ctx,
		drawText: () => {},
		frame: options.frame,
		height: options.height,
		setFontSize: () => {},
		width: options.width,
	};
}

/** 闇の中の目 — pairs of small lights far from the words; they open late, blink, and are shut again. */
function drawPairEyes(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(scene.width, scene.height);
	const bb = textBoundsOf(scene);
	const pairs = 1 + (x2Hash(seed, 51) % 3);
	const ltb = ltOf(scene);
	for (let index = 0; index < pairs && index < 4; index += 1) {
		const spot = farSpot({
			bb,
			height: scene.height,
			marginX: 0.07,
			marginY: 0.09,
			salt: index,
			seed,
			width: scene.width,
		});
		if (spot.d < unit * 0.1) continue;
		const t0 = 0.45 + index * 0.6 + x2Unit(seed, index, 3) * 0.5;
		let open =
			outCubic(clamp((ltOf(scene) - t0) / 0.18)) *
			(1 - clamp(frame.exitProgress * (1.6 + index * 0.5)));
		for (let blink = 0; blink < 4; blink += 1) {
			const at = t0 + 0.7 + blink * 1.25 + x2Unit(seed, index, blink, 4) * 0.9;
			const distance = Math.abs(ltb - at);
			if (distance < 0.07) open *= distance / 0.07;
		}
		if (open <= 0.02) continue;
		const r = unit * 0.0085 * (1 - index * 0.12);
		const gap = r * 4.4;
		const tilt = x2Signed(seed, index, 5) * 0.2;
		// the gaze shifts in small jumps
		const gazeX = x2Signed(seed, index, Math.floor(ltb * 0.7), 6) * r * 0.8;
		const gazeY = x2Signed(seed, index, Math.floor(ltb * 0.7), 7) * r * 0.4;
		for (const sign of [-1, 1]) {
			ellipseFill({
				alpha: 0.9,
				color: frame.palette.foreground,
				radiusX: r,
				radiusY: Math.max(0.4, r * 0.82 * open),
				rotation: tilt,
				scene,
				x: spot.x + gazeX + (sign * gap) / 2,
				y: spot.y + gazeY,
			});
		}
	}
}

/** 覗き込む影 — a head-shaped shadow leaning in from the side edge; it pulls back the moment anything changes. */
function drawPeeker(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const bb = textBoundsOf(scene);
	const fromRight = x2Unit(seed, 1) < 0.5;
	const direction = fromRight ? -1 : 1;
	const r = unit * 0.065;
	const edgeX = fromRight ? W : 0;
	let y = H * (x2Unit(seed, 2) < 0.5 ? 0.3 : 0.68) + x2Signed(seed, 1) * H * 0.06;
	const near = fromRight ? bb.x1 > W - r * 2.4 : bb.x0 < r * 2.4;
	if (near && y > bb.y0 - r * 1.6 && y < bb.y1 + r * 1.6) {
		y =
			(bb.y0 + bb.y1) / 2 > H / 2
				? Math.max(r * 1.2, bb.y0 - r * 2)
				: Math.min(H - r * 1.2, bb.y1 + r * 2);
	}
	// lean in slowly, flinch back once, vanish fast
	const lt = ltOf(scene);
	let lean = inOutSine(clamp((lt - 0.3) / 1.4));
	const flinch = lt - (2.2 + x2Unit(seed, 2) * 1.5);
	if (flinch > 0 && flinch < 0.9) {
		lean *=
			0.25 + 0.75 * inOutSine(clamp(Math.abs(flinch - 0.3) / 0.6));
	}
	lean *= 1 - outCubic(clamp(frame.exitProgress * 3));
	if (lean <= 0.01) return;
	const cx = edgeX + direction * (-r * 1.1 + lean * r * 1.75);
	const cy = y + Math.sin(ltOf(scene) * 0.8) * r * 0.05;
	const color = isDark(frame.palette.background)
		? mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.13 })
		: mixC({ from: frame.palette.background, to: "#000000", progress: 0.72 });
	ellipseFill({
		alpha: 0.95,
		color,
		radiusX: r * 1.7,
		radiusY: r * 1.5,
		rotation: 0,
		scene,
		x: cx - direction * r * 1.5,
		y: cy + r * 2.3,
	});
	ellipseFill({
		alpha: 0.95,
		color,
		radiusX: r * 0.82,
		radiusY: r,
		rotation: direction * 0.12,
		scene,
		x: cx,
		y: cy,
	});
	const blink =
		Math.abs(ltOf(scene) - 1.9 - x2Unit(seed, 3)) < 0.07 ? 0.15 : 1;
	circle({
		alpha: 0.9 * clamp(lean * 1.4 - 0.4),
		color: isDark(frame.palette.background)
			? frame.palette.foreground
			: frame.palette.background,
		radius: r * 0.075 * blink,
		scene,
		x: cx + direction * r * 0.38,
		y: cy - r * 0.12,
	});
}

/** 近づく足跡 — wet footprints that come towards the words one step at a time and stop short. */
function drawFootprints(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const bb = textBoundsOf(scene);
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0) return;
	const below = H - bb.y1 > bb.y0;
	const fromRight = x2Unit(seed, 1) < 0.5;
	const sx = W * (fromRight ? 0.95 : 0.05);
	const sy = below ? H * 0.95 : H * 0.05;
	const tx = clamp(
		bb.cx + x2Signed(seed, 1) * unit * 0.1,
		W * 0.2,
		W * 0.8,
	);
	const ty = below
		? Math.min(H * 0.93, bb.y1 + unit * 0.1)
		: Math.max(H * 0.07, bb.y0 - unit * 0.1);
	const distance = Math.hypot(tx - sx, ty - sy);
	const angle = Math.atan2(ty - sy, tx - sx);
	const stride = unit * 0.1;
	const steps = Math.min(14, Math.max(3, Math.floor(distance / stride)));
	const color = dimC(frame, 0.34);
	const foot = unit * 0.042;
	const lt = ltOf(scene);
	for (let index = 0; index < steps; index += 1) {
		const t0 = 0.2 + index * 0.24;
		const appear = clamp((lt - t0) / 0.1);
		if (appear <= 0) break;
		const age = lt - t0;
		const fraction = (index + 0.5) / steps;
		const side = index % 2 ? 1 : -1;
		const px =
			lerp({ start: sx, end: tx, progress: fraction }) -
			Math.sin(angle) * side * foot * 0.55;
		const py =
			lerp({ start: sy, end: ty, progress: fraction }) +
			Math.cos(angle) * side * foot * 0.55;
		const alpha = appear * out * (0.32 + 0.5 * Math.exp(-age * 0.5));
		const printRotation = angle + side * 0.12 + x2Signed(seed, index, 2) * 0.1;
		const local = (offset: number): readonly [number, number] => [
			px + Math.cos(printRotation) * offset,
			py + Math.sin(printRotation) * offset,
		];
		const sole = local(foot * 0.2);
		ellipseFill({
			alpha,
			color,
			radiusX: foot * 0.5,
			radiusY: foot * 0.26,
			rotation: printRotation,
			scene,
			x: sole[0],
			y: sole[1],
		});
		const heel = local(-foot * 0.48);
		ellipseFill({
			alpha,
			color,
			radiusX: foot * 0.2,
			radiusY: foot * 0.18,
			rotation: printRotation,
			scene,
			x: heel[0],
			y: heel[1],
		});
	}
}

/** はぐれた一字 — a glyph of the line turns up somewhere it should not be: mirrored, faint, twitching. */
function drawStrayGlyph(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(scene.width, scene.height);
	const bb = textBoundsOf(scene);
	const glyphs = Array.from(frame.cut?.text ?? "").filter(
		(character) => !/\s/u.test(character),
	);
	if (glyphs.length === 0) return;
	const copies = Math.min(2, 1);
	const lt = ltOf(scene);
	const step = stepOf(scene);
	for (let index = 0; index < copies; index += 1) {
		const spot = farSpot({
			bb,
			height: scene.height,
			marginX: 0.1,
			marginY: 0.13,
			salt: index + 5,
			seed,
			width: scene.width,
		});
		const size = unit * 0.11 * (1 - index * 0.2);
		if (spot.d < size * 0.9) continue;
		const t0 = 0.5 + index * 0.7;
		let alpha = clamp((lt - t0) / 0.08) * (1 - clamp(frame.exitProgress * 2.5));
		if (lt - t0 < 0.5 && x2Unit(seed, index, step, 1) < 0.45) alpha *= 0.2; // flickers into place
		if (x2Unit(seed, index, step >> 1, 2) < 0.07) alpha *= 0.3;
		if (alpha <= 0.01) continue;
		const twitch = x2Unit(seed, index, step >> 2, 3) < 0.18;
		const glyph = glyphs[x2Hash(seed, index, 4) % glyphs.length]!;
		rawText({
			alpha: 0.5 * alpha,
			color: frame.palette.secondary,
			maxWidth: size,
			options: decorLayoutOptions(options),
			rotation: degrees(x2Signed(seed, index, 6) * 14 + (index ? 180 : 0)),
			scaleX: -1,
			size,
			text: glyph,
			x: spot.x + (twitch ? x2Signed(seed, index, step, 5) * size * 0.08 : 0),
			y: spot.y,
		});
	}
}

/** 忍び寄る指 — long shadow fingers that creep out of a corner towards the words and stop just short. */
function drawFingers(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const bb = textBoundsOf(scene);
	const fromRight = x2Unit(seed, 1) < 0.5;
	const low = x2Unit(seed, 2) < 0.5;
	const originX = fromRight ? W : 0;
	const originY = low ? H : 0;
	const base = Math.atan2(bb.cy - originY, bb.cx - originX);
	const color = isDark(frame.palette.background)
		? mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.15 })
		: mixC({ from: frame.palette.background, to: "#000000", progress: 0.7 });
	const fingers = 4;
	const reach = Math.max(unit * 0.12, distToBB(bb, originX, originY) - unit * 0.05);
	const lt = ltOf(scene);
	const ltb = lt;
	for (let index = 0; index < fingers; index += 1) {
		const grow =
			outCubic(clamp((lt - 0.1 - index * 0.12) / (1.5 + x2Unit(seed, index, 1) * 1.5))) *
			(1 - inCubic(clamp(frame.exitProgress * 1.4)));
		if (grow <= 0.01) continue;
		const angle0 =
			base +
			(index - (fingers - 1) / 2) * 0.2 +
			x2Signed(seed, index, 2) * 0.05;
		const length =
			Math.min(reach, unit * lerp({ start: 0.3, end: 0.6, progress: x2Unit(seed, index, 3) })) *
			lerp({ start: 0.72, end: 1, progress: x2Unit(seed, index, 4) }) *
			grow;
		const width0 = unit * lerp({ start: 0.026, end: 0.04, progress: x2Unit(seed, index, 5) });
		const segments = 12;
		const left: Array<readonly [number, number]> = [];
		const right: Array<readonly [number, number]> = [];
		let x = originX;
		let y = originY;
		let angle = angle0;
		for (let segIndex = 0; segIndex <= segments; segIndex += 1) {
			const fraction = segIndex / segments;
			const width =
				width0 *
				(1 - fraction * 0.8) *
				(segIndex === segments ? 0.25 : 1) *
				(1 + 0.18 * Math.sin(fraction * 9.4)); // knuckles
			left.push([x - Math.sin(angle) * width, y + Math.cos(angle) * width]);
			right.push([x + Math.sin(angle) * width, y - Math.cos(angle) * width]);
			angle =
				angle0 +
				smoothNoise({ seed: seed + index * 7, salt: 0, value: fraction * 2.2 + ltb * 0.12 }) *
					0.5 *
					fraction;
			x += (Math.cos(angle) * length) / segments;
			y += (Math.sin(angle) * length) / segments;
			if (
				overlapsBB({
					bb,
					pad: unit * 0.03,
					x0: x,
					x1: x,
					y0: y,
					y1: y,
				})
			) {
				left.push([x, y]);
				break;
			}
		}
		polyFill({
			alpha: 0.92,
			color,
			points: [...left, ...right.reverse()],
			scene,
		});
	}
}

/** 窓の手形 — handprints on the glass: pale smears pressed against the frame, slowly running. */
function drawHandprints(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(scene.width, scene.height);
	const bb = textBoundsOf(scene);
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0) return;
	const color = isDark(frame.palette.background)
		? mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.42 })
		: mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.3 });
	const prints = 2 + (x2Hash(seed, 61) % 3);
	const lt = ltOf(scene);
	for (let index = 0; index < prints && index < 5; index += 1) {
		const spot = farSpot({
			bb,
			height: scene.height,
			marginX: 0.09,
			marginY: 0.12,
			salt: index + 11,
			seed,
			width: scene.width,
		});
		const radius =
			unit *
			0.055 *
			lerp({ start: 0.85, end: 1.15, progress: x2Unit(seed, index, 1) });
		if (spot.d < radius * 2.6) continue;
		const t0 = 0.25 + index * 0.5 + x2Unit(seed, index, 2) * 0.3;
		const press = clamp((lt - t0) / 0.12);
		if (press <= 0) continue;
		const age = lt - t0;
		const alpha = out * press * (0.2 + 0.2 * Math.exp(-age * 0.6));
		const run = outCubic(clamp(age / 4));
		const rotation = x2Signed(seed, index, 3) * 0.6;
		const flip = x2Unit(seed, index, 4) < 0.5 ? -1 : 1;
		// eslint-disable-next-line opencut/prefer-object-params -- The pack's local point-rotation closure.
	const rotate = (x: number, y: number): { readonly x: number; readonly y: number } => ({
		x: spot.x + (Math.cos(rotation) * x - Math.sin(rotation) * y) * flip,
		y: spot.y + Math.sin(rotation) * x + Math.cos(rotation) * y,
	});
		ellipseFill({
			alpha,
			color,
			radiusX: radius * 0.62,
			radiusY: radius * 0.7,
			rotation: rotation * flip,
			scene,
			x: spot.x,
			y: spot.y + radius * 0.25,
		});
		const fingerLengths = [0.95, 1.12, 1.05, 0.82] as const;
		for (let finger = 0; finger < 4; finger += 1) {
			const fingerAngle = -0.42 + finger * 0.28;
			const length = radius * fingerLengths[finger]!;
			const tip = rotate(0, -radius * 0.55 - length * 0.5);
			ellipseFill({
				alpha,
				color,
				radiusX: radius * 0.14,
				radiusY: length * 0.5,
				rotation: rotation * flip + fingerAngle,
				scene,
				x: tip.x,
				y: tip.y,
			});
		}
		const thumb = rotate(0, -radius * 0.8);
		ellipseFill({
			alpha,
			color,
			radiusX: radius * 0.15,
			radiusY: radius * 0.42,
			rotation: rotation * flip - 1.15,
			scene,
			x: thumb.x,
			y: thumb.y,
		});
		// the smear runs down from the fingertips
		for (let finger = 0; finger < 3; finger += 1) {
			const x =
				spot.x +
				(finger - 1) * radius * 0.42 +
				x2Signed(seed, index, finger, 5) * radius * 0.1;
			const drip = radius * lerp({ start: 0.8, end: 2.2, progress: x2Unit(seed, index, finger, 6) }) * run;
			if (
				drip > 2 &&
				!overlapsBB({
					bb,
					pad: unit * 0.02,
					x0: x,
					x1: x,
					y0: spot.y + radius * 0.9,
					y1: spot.y + radius * 0.9 + drip,
				})
			) {
				seg({
					alpha: alpha * 0.8,
					color,
					scene,
					thickness: Math.max(1.2, radius * 0.07),
					x0: x,
					x1: x,
					y0: spot.y + radius * 0.9,
					y1: spot.y + radius * 0.9 + drip,
				});
			}
		}
	}
}

/** 揺れる裸電球 — a bare bulb on a cord at the top of the frame: it swings, stutters and goes out. */
function drawBareBulb(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, scene.height);
	const bb = textBoundsOf(scene);
	const fromRight = x2Unit(seed, 1) < 0.5;
	let x = W * (fromRight ? 0.84 : 0.16) + x2Signed(seed, 1) * W * 0.04;
	let cord = unit * 0.14;
	if (
		bb.y0 < cord + unit * 0.12 &&
		x > bb.x0 - unit * 0.1 &&
		x < bb.x1 + unit * 0.1
	) {
		const moved = fromRight ? bb.x1 + unit * 0.12 : bb.x0 - unit * 0.12;
		if (moved > unit * 0.06 && moved < W - unit * 0.06) x = moved;
		else cord = Math.max(unit * 0.02, bb.y0 - unit * 0.11);
	}
	const lt = ltOf(scene);
	const length =
		cord *
		outCubic(clamp(lt / 0.5)) *
		(1 - inCubic(clamp(frame.exitProgress * 1.2 - 0.2)));
	if (length <= 1) return;
	const angle =
		Math.sin(lt * 1.9 + x2Unit(seed, 2) * 6) *
		(5 + 8 * Math.exp(-Math.max(0, lt) * 0.35)) *
		degrees(1) *
		0.82; // fx.motion 0.7 default: 0.4 + 0.6 × 0.7
	const bx = x + Math.sin(angle) * length;
	const by = Math.cos(angle) * length;
	const r = unit * 0.018;
	let level =
		lt < 0.75
			? lt > 0.3 && x2Unit(seed, stepOf(scene), 3) < 0.55
				? 1
				: 0.08
			: lamp(tOf(scene), seed, 1.3);
	if (frame.exitProgress > 0) {
		level *=
			(x2Unit(seed, stepOf(scene), 4) < 0.5 ? 0.15 : 1) *
			(1 - clamp(frame.exitProgress * 2));
	}
	const color = dimC(frame, 0.5);
	const light = glowC(frame);
	seg({ alpha: 1, color, scene, thickness: Math.max(1.2, unit * 0.0022), x0: x, x1: bx, y0: -2, y1: by });
	seg({
		alpha: 1,
		color,
		scene,
		thickness: r * 0.8,
		x0: bx - Math.sin(angle) * r * 1.5,
		x1: bx,
		y0: by - Math.cos(angle) * r * 1.5,
		y1: by,
	});
	const cx = bx + Math.sin(angle) * r * 0.9;
	const cy = by + Math.cos(angle) * r * 0.9;
	if (level > 0.02) {
		glowDisc({ alpha: 0.3 * level, color: light, radius: unit * 0.12, scene, x: cx, y: cy });
	}
	circle({
		alpha: 1,
		color: level > 0.02 ? light : color,
		radius: r,
		scene,
		stroke: color,
		x: cx,
		y: cy,
	});
	if (level < 0.9) {
		circle({
			alpha: clamp(1 - level) * 0.85,
			color: frame.palette.background,
			radius: r * 0.93,
			scene,
			x: cx,
			y: cy,
		});
	}
}

/** 開きかけの扉 — a small door at the edge of the frame that opens by itself, and is shut when the cut leaves. */
function drawDoorAjar(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const bb = textBoundsOf(scene);
	let doorWidth = unit * 0.095;
	let doorHeight = doorWidth * 2.15;
	let fromRight = x2Unit(seed, 1) < 0.5;
	const xOf = (right: boolean): number =>
		right ? W - unit * 0.06 - doorWidth : unit * 0.06;
	const gy = H - unit * 0.05;
	const hits = (right: boolean): boolean =>
		overlapsBB({
			bb,
			pad: unit * 0.03,
			x0: xOf(right),
			x1: xOf(right) + doorWidth,
			y0: gy - doorHeight,
			y1: gy,
		});
	if (hits(fromRight)) {
		fromRight = !fromRight;
		if (hits(fromRight)) {
			const k = clamp((gy - bb.y1 - unit * 0.04) / doorHeight, 0, 1);
			if (k < 0.35) return;
			doorWidth *= k;
			doorHeight *= k;
		}
	}
	const x = xOf(fromRight);
	const y = gy - doorHeight;
	const out = 1 - inCubic(frame.exitProgress);
	const ease = outCubic(clamp(ltOf(scene) / 0.5));
	const color = dimC(frame, 0.4);
	const thickness = Math.max(1.2, unit * 0.0024);
	const light = glowC(frame);
	polyPartial({
		alpha: out,
		color,
		points: [
			[x, gy],
			[x, y],
			[x + doorWidth, y],
			[x + doorWidth, gy],
		],
		progress: ease,
		scene,
		thickness,
	});
	seg({ alpha: 0.6 * ease * out, color, scene, thickness, x0: x - doorWidth * 0.5, x1: x + doorWidth * 1.5, y0: gy, y1: gy });
	// it opens while nobody looks, in two goes, and slams on the way out
	const lt = ltOf(scene);
	const opening =
		(0.07 * outCubic(clamp((lt - 0.5) / 0.5)) +
			0.24 * inOutSine(clamp((lt - 1.5 - x2Unit(seed, 1)) / 1.8))) *
		(1 - outExpo(clamp(frame.exitProgress * 2.5)));
	if (opening <= 0.003) return;
	const hinge = fromRight ? x + doorWidth : x;
	const direction = fromRight ? -1 : 1;
	const level = 0.85 + 0.15 * x2Unit(seed, stepOf(scene), 2);
	const slit = doorWidth * opening;
	rect({
		alpha: 0.85 * level,
		color: light,
		height: doorHeight - thickness,
		scene,
		width: slit,
		x: fromRight ? hinge - slit : hinge,
		y: y + thickness,
	});
	polyFill({
		alpha: 0.14 * level,
		color: light,
		points: [
			[hinge, gy],
			[hinge + direction * slit, gy],
			[hinge + direction * (slit * 2.4 + doorWidth * 0.5), gy + unit * 0.045],
			[hinge + direction * doorWidth * 0.2, gy + unit * 0.045],
		],
		scene,
	});
	circle({
		alpha: out,
		radius: Math.max(1.5, doorWidth * 0.035),
		scene,
		stroke: color,
		x: hinge + direction * (slit + doorWidth * 0.1),
		y: y + doorHeight * 0.55,
	});
}

/** 隅の蜘蛛の巣 — a cobweb spun into a top corner, thread by thread, with one line let down from it. */
function drawCobweb(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const bb = textBoundsOf(scene);
	const out = 1 - inCubic(frame.exitProgress);
	if (out <= 0) return;
	const fromRight = x2Unit(seed, 1) < 0.5;
	const low = bb.y0 < unit * 0.2 && bb.y1 < H - unit * 0.2;
	const originX = fromRight ? W : 0;
	const originY = low ? H : 0;
	const dx = fromRight ? -1 : 1;
	const dy = low ? -1 : 1;
	const radius = Math.min(
		unit * 0.27,
		Math.max(unit * 0.1, distToBB(bb, originX, originY) - unit * 0.03),
	);
	const color = dimC(frame, 0.42);
	const thickness = Math.max(1, unit * 0.0016);
	const spokes = 6;
	const ltb = ltOf(scene);
	const sway = Math.sin(ltb * 0.9) * 0.012;
	const lt = ltOf(scene);
	const ends: Array<readonly [number, number, number]> = [];
	for (let index = 0; index < spokes; index += 1) {
		const angle =
			(index / (spokes - 1)) * (Math.PI / 2) +
			(index > 0 && index < spokes - 1 ? x2Signed(seed, index, 1) * 0.07 : 0) +
			sway * (index - 2.5);
		const length =
			radius *
			(index === 0 || index === spokes - 1
				? 1.12
				: lerp({ start: 0.8, end: 1.05, progress: x2Unit(seed, index, 2) }));
		ends.push([Math.cos(angle) * dx, Math.sin(angle) * dy, length]);
		polyPartial({
			alpha: out,
			color,
			points: [
				[originX, originY],
				[originX + ends[index]![0]! * length, originY + ends[index]![1]! * length],
			],
			progress: outCubic(clamp((lt - index * 0.05) / 0.45)),
			scene,
			thickness,
		});
	}
	const rings = 5;
	for (let ring = 0; ring < rings; ring += 1) {
		const fraction = 0.24 + 0.17 * ring;
		const points: Array<readonly [number, number]> = [];
		for (let index = 0; index < spokes; index += 1) {
			const spoke = ends[index]!;
			const r1 = Math.min(
				spoke[2],
				radius * fraction * (1 + x2Signed(seed, ring, index, 3) * 0.05),
			);
			points.push([originX + spoke[0]! * r1, originY + spoke[1]! * r1]);
			if (index < spokes - 1) {
				const next = ends[index + 1]!;
				const r2 = Math.min(next[2], radius * fraction);
				const mx = (spoke[0]! * r1 + next[0]! * r2) / 2;
				const my = (spoke[1]! * r1 + next[1]! * r2) / 2;
				// the thread sags towards the corner
				points.push([originX + mx * 0.9, originY + my * 0.9]);
			}
		}
		polyPartial({
			alpha: out * 0.85,
			color,
			points,
			progress: clamp((lt - 0.4 - ring * 0.22) / 0.5),
			scene,
			thickness,
		});
	}
	// one thread let down, with something small at the end of it
	if (!low) {
		const spoke = ends[2]!;
		const hx = originX + spoke[0]! * spoke[2]! * 0.7;
		const hy = originY + spoke[1]! * spoke[2]! * 0.7;
		const down =
			unit *
			0.16 *
			inOutSine(clamp((lt - 1.4) / 2.6)) *
			out;
		if (
			down > 2 &&
			!overlapsBB({ bb, pad: unit * 0.03, x0: hx, x1: hx, y0: hy, y1: hy + down })
		) {
			const wobble = Math.sin(ltb * 1.4) * unit * 0.004;
			seg({ alpha: out, color, scene, thickness, x0: hx, x1: hx + wobble, y0: hy, y1: hy + down });
			circle({ alpha: out, color, radius: unit * 0.005, scene, x: hx + wobble, y: hy + down });
		}
	}
}

/** 古いフィルムの傷 — hairline scratches that stay for a few frames, and dirt that jumps around the edges. */
function drawFilmDirt(options: X2HorrorDecorDraw): void {
	const scene = decorScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const bb = textBoundsOf(scene);
	const step = stepOf(scene);
	const level =
		outCubic(clamp(ltOf(scene) / 0.3)) * (1 - inCubic(frame.exitProgress));
	if (level <= 0) return;
	const color = frame.palette.foreground;
	const thickness = Math.max(1, unit * 0.0014);
	const pad = unit * 0.02;
	const scratches = 2 + (x2Hash(seed, 71) % 3);
	for (let index = 0; index < scratches; index += 1) {
		const run = (step + index * 5) >> 3;
		if (x2Unit(seed, index, run, 1) < 0.35) continue;
		const x =
			W * x2Unit(seed, index, run, 2) + x2Signed(seed, index, step, 3) * unit * 0.003;
		const alpha = 0.3 * level * (0.5 + 0.5 * x2Unit(seed, index, step, 4));
		const y0 = H * x2Unit(seed, index, run, 5) * 0.3;
		const y1 = H * (0.7 + 0.3 * x2Unit(seed, index, run, 6));
		if (x > bb.x0 - pad && x < bb.x1 + pad) {
			// never across the words
			if (bb.y0 - pad > y0) {
				seg({ alpha, color, scene, thickness, x0: x, x1: x, y0, y1: bb.y0 - pad });
			}
			if (y1 > bb.y1 + pad) {
				seg({ alpha, color, scene, thickness, x0: x, x1: x, y0: bb.y1 + pad, y1 });
			}
		} else {
			seg({ alpha, color, scene, thickness, x0: x, x1: x, y0, y1 });
		}
	}
	const specks = 6 + (x2Hash(seed, 72) % 3) * 3;
	const halfStep = step >> 1;
	for (let index = 0; index < specks; index += 1) {
		const x = W * x2Unit(seed, index, halfStep, 7);
		const y = H * x2Unit(seed, index, halfStep, 8);
		if (overlapsBB({ bb, pad: unit * 0.035, x0: x, x1: x, y0: y, y1: y })) continue;
		const r = unit * lerp({ start: 0.0015, end: 0.006, progress: x2Unit(seed, index, halfStep, 9) });
		const alpha = 0.55 * level;
		if (index % 3 === 0) {
			const angle = x2Unit(seed, index, halfStep, 10) * TAU;
			const length = r * 5;
			seg({
				alpha,
				color,
				scene,
				thickness,
				x0: x,
				x1: x + Math.cos(angle) * length,
				y0: y,
				y1: y + Math.sin(angle) * length,
			});
			seg({
				alpha,
				color,
				scene,
				thickness,
				x0: x + Math.cos(angle) * length,
				x1: x + Math.cos(angle + 0.7) * length * 1.6,
				y0: y + Math.sin(angle) * length,
				y1: y + Math.sin(angle + 0.7) * length * 1.6,
			});
		} else {
			circle({ alpha, color, radius: r, scene, x, y });
		}
	}
}

/* ================================================================== BACKGROUND */

interface X2HorrorBackgroundDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawX2HorrorBackground(
	options: X2HorrorBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "hzFogBanks":
			drawFogBanks(options);
			return true;
		case "hzSwingLight":
			drawSwingLight(options);
			return true;
		case "hzFarWindows":
			drawFarWindows(options);
			return true;
		case "hzHeadlights":
			drawHeadlights(options);
			return true;
		case "hzHallLights":
			drawHallLights(options);
			return true;
		case "hzWires":
			drawWires(options);
			return true;
		default:
			return false;
	}
}

function bgScene(options: X2HorrorBackgroundDraw): X2HorrorScene {
	return options;
}

/** Time since this background started — approximated by the local cut time. */
function bgSeconds(scene: X2HorrorScene): number {
	return ltOf(scene);
}

/** 流れる霧 — banks of fog sliding past each other at different heights and speeds. */
function drawFogBanks(options: X2HorrorBackgroundDraw): void {
	const scene = bgScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const t = tOf(scene);
	const fade = outCubic(clamp(bgSeconds(scene)));
	const fog = mixC({
		from: frame.palette.background,
		to: frame.palette.foreground,
		progress: isDark(frame.palette.background) ? 0.65 : 0.6,
	});
	const base = 0.12 * fade * (isDark(frame.palette.background) ? 1 : 1.5);
	const banks = 5;
	for (let index = 0; index < banks; index += 1) {
		for (let other = 0; other < 2; other += 1) {
			const rx =
				W * lerp({ start: 0.4, end: 0.75, progress: x2Unit(seed, index, other, 2) });
			const ry = unit * lerp({ start: 0.06, end: 0.15, progress: x2Unit(seed, index, 3) });
			const y =
				H * (0.1 + 0.85 * x2Unit(seed, index, 1)) +
				Math.sin(t * 0.13 + index * 2) * unit * 0.02;
			const speed =
				lerp({ start: 0.01, end: 0.028, progress: x2Unit(seed, index, 4) }) *
				(index % 2 ? -1 : 1);
			const span = W + rx * 2;
			const x =
				wrap(W * x2Unit(seed, index, other, 5) * 2 + t * speed * W + (other * span) / 2, span) -
				rx;
			const breathe = 0.75 + 0.25 * Math.sin(t * 0.21 + index + other);
			ellipseFill({
				alpha: base * breathe * 0.6,
				color: fog,
				radiusX: rx,
				radiusY: ry,
				rotation: 0,
				scene,
				x,
				y,
			});
			ellipseFill({
				alpha: base * breathe * 0.4,
				color: fog,
				radiusX: rx * 0.6,
				radiusY: ry * 0.6,
				rotation: 0,
				scene,
				x,
				y,
			});
		}
	}
	rect({ alpha: base * 0.5, color: fog, height: H * 0.2, scene, width: W, x: 0, y: H * 0.8 });
	rect({ alpha: base * 0.4, color: fog, height: H * 0.2, scene, width: W, x: 0, y: H * 0.6 });
	vignette({ alpha: 0.4 * fade, innerFraction: 0.3, scene });
}

/** 揺れる灯り — one hanging light swinging slowly: its cone sweeps the room and the dark follows it. */
function drawSwingLight(options: X2HorrorBackgroundDraw): void {
	const scene = bgScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const t = tOf(scene);
	const fade = outCubic(clamp(bgSeconds(scene) / 0.8));
	const amplitude = lerp({ start: 11, end: 18, progress: x2Unit(seed, 2) });
	const omega = lerp({ start: 0.55, end: 0.85, progress: x2Unit(seed, 3) });
	const halfAngle = lerp({ start: 13, end: 18, progress: x2Unit(seed, 4) });
	const theta =
		degrees(amplitude) * Math.sin(t * omega + x2Unit(seed, 1) * 6);
	const px = W * lerp({ start: 0.38, end: 0.62, progress: x2Unit(seed, 5) });
	const py = -unit * 0.04;
	const length = Math.hypot(W, H) * 1.1;
	const halfWidth = Math.tan(degrees(halfAngle)) * length;
	const level = lamp(t, seed, 0.5) * fade;
	const light = glowC(frame);
	const dark = isDark(frame.palette.background)
		? nightC(frame)
		: mixC({ from: frame.palette.background, to: "#000000", progress: 0.55 });
	const cone: Array<readonly [number, number]> = [
		[-unit * 0.02, 0],
		[unit * 0.02, 0],
		[halfWidth, length],
		[-halfWidth, length],
	];
	const { ctx } = scene;
	ctx.save();
	ctx.translate(px, py);
	ctx.rotate(-theta);
	if (ctx.fill && ctx.moveTo && ctx.lineTo) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(-length * 2, -length, length * 4, length * 3);
		if (buildPolyPath({ ctx, points: cone })) {
			ctx.closePath?.();
			ctx.globalAlpha *= (isDark(frame.palette.background) ? 0.5 : 0.2) * fade;
			ctx.fillStyle = dark;
			ctx.fill("evenodd");
		}
		ctx.restore();
	}
	// the cone (gradient → two stepped triangles)
	polyFill({
		alpha: 0.12 * level,
		color: light,
		points: [cone[0]!, cone[1]!, [halfWidth * 0.5, length * 0.5], [-halfWidth * 0.5, length * 0.5]],
		scene,
	});
	polyFill({
		alpha: 0.05 * level,
		color: light,
		points: [
			[-halfWidth * 0.5, length * 0.5],
			[halfWidth * 0.5, length * 0.5],
			cone[2]!,
			cone[3]!,
		],
		scene,
	});
	// cord and shade
	polyFill({
		alpha: fade,
		color: dimC(frame, 0.4),
		points: [
			[-unit * 0.012, unit * 0.075],
			[unit * 0.012, unit * 0.075],
			[unit * 0.04, unit * 0.105],
			[-unit * 0.04, unit * 0.105],
		],
		scene,
	});
	rect({ alpha: fade, color: dimC(frame, 0.4), height: unit * 0.075, scene, width: unit * 0.003, x: -unit * 0.0015, y: 0 });
	ctx.restore();
	const floorX = px + Math.tan(theta) * (H * 0.94 - py);
	ellipseFill({
		alpha: 0.12 * level,
		color: light,
		radiusX: unit * 0.5,
		radiusY: unit * 0.5 * 0.14,
		rotation: 0,
		scene,
		x: floorX,
		y: H * 0.94,
	});
}

/** 消える窓明かり — a row of houses far away: their windows go dark one after another until one is left, then that too. */
function drawFarWindows(options: X2HorrorBackgroundDraw): void {
	const scene = bgScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const t = bgSeconds(scene);
	const fade = outCubic(clamp(t / 0.8));
	const period = lerp({ start: 20, end: 28, progress: x2Unit(seed, 1) });
	const cycle = wrap(t, period);
	const houses = 6 + (x2Hash(seed, 2) % 4);
	const keep = x2Hash(seed, 3) % houses;
	const houseColor = isDark(frame.palette.background)
		? mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.075 })
		: mixC({ from: frame.palette.background, to: "#000000", progress: 0.16 });
	const windowColor = isDark(frame.palette.background)
		? mixC({ from: frame.palette.foreground, to: frame.palette.accent, progress: 0.2 })
		: mixC({ from: frame.palette.background, to: "#FFFFFF", progress: 0.7 });
	rect({ alpha: 0.25 * fade, color: houseColor, height: H * 0.2, scene, width: W, x: 0, y: H * 0.8 });
	rect({ alpha: 0.25 * fade, color: houseColor, height: H * 0.25, scene, width: W, x: 0, y: H * 0.55 });
	for (let index = 0; index < houses; index += 1) {
		const houseWidth = (W / houses) * lerp({ start: 0.72, end: 1.02, progress: x2Unit(seed, index, 1) });
		const x = W * (index / houses) + x2Signed(seed, index, 2) * W * 0.012;
		const houseHeight = unit * lerp({ start: 0.11, end: 0.27, progress: x2Unit(seed, index, 3) });
		const y = H - houseHeight * fade;
		rect({ alpha: 1, color: houseColor, height: houseHeight + 2, scene, width: houseWidth, x, y });
		if (x2Unit(seed, index, 4) < 0.6) {
			polyFill({
				alpha: 1,
				color: houseColor,
				points: [
					[x - houseWidth * 0.04, y + 1],
					[x + houseWidth / 2, y - houseHeight * lerp({ start: 0.18, end: 0.34, progress: x2Unit(seed, index, 5) })],
					[x + houseWidth * 1.04, y + 1],
				],
				scene,
			});
		}
		const windows = 1 + (x2Hash(seed, index, 6) % 3);
		const windowWidth = Math.min(houseWidth * 0.14, unit * 0.022);
		const windowHeight = windowWidth * 1.3;
		for (let other = 0; other < windows; other += 1) {
			const last = index === keep && other === 0;
			const off = last
				? period * 0.9
				: period * (0.1 + 0.68 * x2Unit(seed, index, other, 7));
			let lit = clamp((cycle - x2Unit(seed, index, other, 8) * 0.8) / 0.4);
			if (cycle > off) lit = 0;
			else if (cycle > off - 0.4 && x2Unit(seed, index, other, stepOf(scene), 9) < 0.5) {
				lit *= 0.25;
			}
			if (last && cycle > period * 0.74 && x2Unit(seed, stepOf(scene) >> 1, 10) < 0.3) {
				lit *= 0.3; // the last one hesitates
			}
			if (lit <= 0.01) continue;
			const wx =
				x +
				houseWidth *
					(0.18 + 0.64 * (windows === 1 ? 0.5 : other / (windows - 1))) -
				windowWidth / 2;
			const wy = y + houseHeight * lerp({ start: 0.22, end: 0.55, progress: x2Unit(seed, index, other, 11) });
			rect({
				alpha: 0.62 * lit * fade,
				color: windowColor,
				height: windowHeight,
				scene,
				width: windowWidth,
				x: wx,
				y: wy,
			});
		}
	}
	vignette({ alpha: 0.3 * fade, innerFraction: 0.36, scene });
}

/** 通り過ぎる光 — car lights from the street: a window-shaped patch of light slides across the wall and is gone. */
function drawHeadlights(options: X2HorrorBackgroundDraw): void {
	const scene = bgScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const t = bgSeconds(scene);
	const fade = outCubic(clamp(t / 0.6));
	const period = lerp({ start: 6.5, end: 9.5, progress: x2Unit(seed, 1) });
	const direction = x2Unit(seed, 2) < 0.5 ? -1 : 1;
	const columns = 2 + (x2Hash(seed, 3) % 2);
	const light = glowC(frame);
	const yc = H * lerp({ start: 0.34, end: 0.5, progress: x2Unit(seed, 4) });
	if (!isDark(frame.palette.background)) {
		rect({
			alpha: 0.2 * fade,
			color: mixC({ from: frame.palette.background, to: "#000000", progress: 0.5 }),
			height: H,
			scene,
			width: W,
			x: 0,
			y: 0,
		});
	}
	for (let pass = 0; pass < 2; pass += 1) {
		const phase = (wrap(t + 0.3, period) - pass * 0.42) / 3.3;
		if (phase <= 0 || phase >= 1) continue;
		const swept = direction > 0 ? phase : 1 - phase;
		const xc = lerp({ start: -unit * 0.55, end: W + unit * 0.55, progress: swept });
		const skew = lerp({ start: -0.85, end: 0.85, progress: swept });
		const patchWidth =
			unit * 0.46 * (0.8 + 0.45 * Math.sin(Math.PI * phase));
		const patchHeight = unit * 0.4;
		const gap = unit * 0.014;
		const alpha = Math.min(
			0.5,
			Math.sin(Math.PI * phase) ** 0.7 *
				0.12 *
				(pass ? 0.45 : 1) *
				fade *
				(isDark(frame.palette.background) ? 1 : 2.3),
		);
		for (let column = 0; column < columns; column += 1) {
			for (let row = 0; row < 2; row += 1) {
				const lx0 = -patchWidth / 2 + (patchWidth / columns) * column + gap / 2;
				const lx1 = -patchWidth / 2 + (patchWidth / columns) * (column + 1) - gap / 2;
				const ly0 = -patchHeight / 2 + (patchHeight / 2) * row + gap / 2;
				const ly1 = -patchHeight / 2 + (patchHeight / 2) * (row + 1) - gap / 2;
				polyFill({
					alpha,
					color: light,
					points: [
						[xc + lx0 + skew * ly0, yc + ly0],
						[xc + lx1 + skew * ly0, yc + ly0],
						[xc + lx1 + skew * ly1, yc + ly1],
						[xc + lx0 + skew * ly1, yc + ly1],
					],
					scene,
				});
			}
		}
	}
	vignette({ alpha: 0.42 * fade, innerFraction: 0.3, scene });
}

/** 消えていく照明 — a corridor of ceiling lights: they die one by one from the far end towards you. */
function drawHallLights(options: X2HorrorBackgroundDraw): void {
	const scene = bgScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const t = bgSeconds(scene);
	const fade = outCubic(clamp(t / 0.7));
	const period = lerp({ start: 12, end: 16, progress: x2Unit(seed, 1) });
	const cycle = wrap(t, period);
	const count = 7 + (x2Hash(seed, 2) % 3);
	const vx = W * lerp({ start: 0.42, end: 0.58, progress: x2Unit(seed, 3) });
	const vy = H * 0.47;
	const light = glowC(frame);
	const color = dimC(frame, 0.2);
	const depthAt = (index: number): number => 1 / (1 + index * 0.62);
	const far = depthAt(count);
	if (!isDark(frame.palette.background)) {
		rect({
			alpha: 0.2 * fade,
			color: mixC({ from: frame.palette.background, to: "#000000", progress: 0.5 }),
			height: H,
			scene,
			width: W,
			x: 0,
			y: 0,
		});
	}
	for (const [cornerX, cornerY] of [
		[0, 0],
		[W, 0],
		[W, H],
		[0, H],
	] as const) {
		seg({
			alpha: 0.8 * fade,
			color,
			scene,
			thickness: Math.max(1.2, unit * 0.0024),
			x0: cornerX,
			x1: vx + (cornerX - vx) * far,
			y0: cornerY,
			y1: vy + (cornerY - vy) * far,
		});
	}
	polyStroke({
		alpha: 0.8 * fade,
		color,
		points: [
			[vx - vx * far, vy - vy * far],
			[vx + (W - vx) * far, vy - vy * far],
			[vx + (W - vx) * far, vy + (H - vy) * far],
			[vx - vx * far, vy + (H - vy) * far],
			[vx - vx * far, vy - vy * far],
		],
		scene,
		thickness: Math.max(1.2, unit * 0.0024),
	});
	const stepTime = (period * 0.55) / count;
	for (let index = count - 1; index >= 0; index -= 1) {
		const depth = depthAt(index);
		const y = vy - (vy - H * 0.035) * depth;
		const floorY = vy + (H * 0.985 - vy) * depth;
		const halfWidth = W * 0.15 * depth;
		const halfHeight = Math.max(1.5, unit * 0.014 * depth);
		const off = period * 0.14 + (count - 1 - index) * stepTime;
		let on = 1;
		if (cycle > period * 0.9) {
			on = x2Unit(seed, index, stepOf(scene), 1) <
				0.25 + (0.75 * (cycle - period * 0.9)) / (period * 0.1)
				? 1
				: 0.1;
		} else if (cycle > off) {
			on = 0;
		} else if (cycle > off - 0.45) {
			on = x2Unit(seed, index, stepOf(scene), 2) < 0.5 ? 1 : 0.15;
		}
		polyStroke({
			alpha: fade,
			color,
			points: [
				[vx - halfWidth, y - halfHeight],
				[vx + halfWidth, y - halfHeight],
				[vx + halfWidth, y + halfHeight],
				[vx - halfWidth, y + halfHeight],
				[vx - halfWidth, y - halfHeight],
			],
			scene,
			thickness: Math.max(1, unit * 0.002 * Math.sqrt(depth)),
		});
		if (on <= 0.01) continue;
		const za = depth ** 0.35 * on * fade * (isDark(frame.palette.background) ? 1 : 1.7);
		rect({
			alpha: 0.5 * za,
			color: light,
			height: halfHeight * 2,
			scene,
			width: halfWidth * 2,
			x: vx - halfWidth,
			y: y - halfHeight,
		});
		ellipseFill({
			alpha: 0.16 * za,
			color: light,
			radiusX: halfWidth * 1.9,
			radiusY: halfWidth * 1.9 * 0.5,
			rotation: 0,
			scene,
			x: vx,
			y: y + halfHeight,
		});
		ellipseFill({
			alpha: 0.09 * za,
			color: light,
			radiusX: halfWidth * 1.9,
			radiusY: halfWidth * 1.9 * 0.22,
			rotation: 0,
			scene,
			x: vx,
			y: floorY,
		});
	}
	vignette({ alpha: 0.5 * fade, innerFraction: 0.25, scene });
}

/** たるんだ電線 — power lines at dusk: sagging wires between two poles, and the small dark shapes sitting on them leave. */
function drawWires(options: X2HorrorBackgroundDraw): void {
	const scene = bgScene(options);
	const { width: W, height: H, frame } = scene;
	const seed = frame.cut?.seed ?? 0;
	const unit = Math.min(W, H);
	const t = tOf(scene);
	const cycleTime = bgSeconds(scene);
	const fade = outCubic(clamp(cycleTime / 0.8));
	const period = lerp({ start: 20, end: 28, progress: x2Unit(seed, 1) });
	const cycle = wrap(cycleTime, period);
	const color = isDark(frame.palette.background)
		? mixC({ from: frame.palette.background, to: frame.palette.foreground, progress: 0.2 })
		: mixC({ from: frame.palette.background, to: "#000000", progress: 0.3 });
	const thickness = Math.max(1.2, unit * 0.0022);
	// dusk gradient → a flat band low on the frame
	rect({
		alpha: 0.05 * fade,
		color: frame.palette.accent,
		height: H * 0.25,
		scene,
		width: W,
		x: 0,
		y: H * 0.75,
	});
	const xa = W * lerp({ start: 0.1, end: 0.2, progress: x2Unit(seed, 2) });
	const xb = W * lerp({ start: 0.74, end: 0.86, progress: x2Unit(seed, 3) });
	const ya = H * lerp({ start: 0.16, end: 0.26, progress: x2Unit(seed, 4) });
	const yb = ya + H * 0.05;
	const wires = 3 + (x2Hash(seed, 5) % 2);
	const gap = unit * 0.034;
	for (const [x, y, k] of [
		[xa, ya, 1],
		[xb, yb, 0.82],
	] as const) {
		seg({ alpha: fade, color, scene, thickness: unit * 0.009 * k, x0: x, x1: x, y0: H + 4, y1: y - unit * 0.04 * k });
		seg({
			alpha: fade,
			color,
			scene,
			thickness: unit * 0.005 * k,
			x0: x - unit * 0.07 * k,
			x1: x + unit * 0.07 * k,
			y0: y,
			y1: y,
		});
		seg({
			alpha: fade,
			color,
			scene,
			thickness: unit * 0.005 * k,
			x0: x - unit * 0.05 * k,
			x1: x + unit * 0.05 * k,
			y0: y + gap * 1.6 * k,
			y1: y + gap * 1.6 * k,
		});
	}
	const wireCurves: Array<
		readonly [
			readonly [number, number],
			readonly [number, number],
			readonly [number, number],
		]
	> = [];
	for (let index = 0; index < wires; index += 1) {
		const ox = (index - (wires - 1) / 2) * gap * 1.3;
		const oy = (index % 2) * gap * 1.6;
		const sag =
			unit *
			(0.07 + 0.025 * index) *
			(1 + 0.07 * Math.sin(t * 0.5 + index * 1.7));
		const sway = Math.sin(t * 0.37 + index) * unit * 0.006;
		const p0: readonly [number, number] = [xa + ox, ya + oy];
		const p1: readonly [number, number] = [xb + ox * 0.82, yb + oy * 0.82];
		const control: readonly [number, number] = [
			(p0[0] + p1[0]) / 2 + sway,
			(p0[1] + p1[1]) / 2 + sag * 2,
		];
		wireCurves.push([p0, control, p1]);
		const points: Array<readonly [number, number]> = [
			[-W * 0.25, p0[1] - H * 0.02],
		];
		for (let step = 0; step <= 10; step += 1) {
			const fraction = step / 10;
			const inv = 1 - fraction;
			points.push([
				inv * inv * (-W * 0.25) +
					2 * inv * fraction * ((p0[0] - W * 0.25) / 2) +
					fraction * fraction * p0[0],
				inv * inv * (p0[1] - H * 0.02) +
					2 * inv * fraction * (p0[1] + sag * 1.2 - H * 0.01) +
					fraction * fraction * p0[1],
			]);
		}
		for (let step = 0; step <= 12; step += 1) {
			const fraction = step / 12;
			const inv = 1 - fraction;
			points.push([
				inv * inv * p0[0] + 2 * inv * fraction * control[0] + fraction * fraction * p1[0],
				inv * inv * p0[1] + 2 * inv * fraction * control[1] + fraction * fraction * p1[1],
			]);
		}
		for (let step = 0; step <= 10; step += 1) {
			const fraction = step / 10;
			const inv = 1 - fraction;
			points.push([
				inv * inv * p1[0] +
					2 * inv * fraction * ((p1[0] + W * 1.3) / 2) +
					fraction * fraction * W * 1.3,
				inv * inv * p1[1] +
					2 * inv * fraction * (p1[1] + sag * 1.4) +
					fraction * fraction * (p1[1] + H * 0.03),
			]);
		}
		polyPartial({ alpha: fade, color, points, progress: 1, scene, thickness });
	}
	// the shapes on the wire: fewer every time you look
	const birds = 5 + (x2Hash(seed, 6) % 4);
	for (let bird = 0; bird < birds; bird += 1) {
		const last = bird === 0;
		const off = last
			? period * 0.92
			: period * (0.12 + 0.66 * x2Unit(seed, bird, 1));
		const appear =
			clamp((cycle - x2Unit(seed, bird, 2) * 0.6) / 0.3) * (cycle > off ? 0 : 1);
		if (appear <= 0) continue;
		const wire = wireCurves[x2Hash(seed, bird, 3) % Math.min(2, wireCurves.length)]!;
		const fraction = last
			? 0.5 + x2Signed(seed, 9) * 0.1
			: 0.12 + 0.76 * x2Unit(seed, bird, 4);
		const inv = 1 - fraction;
		const x =
			inv * inv * wire[0][0] + 2 * inv * fraction * wire[1][0] + fraction * fraction * wire[2][0];
		const y =
			inv * inv * wire[0][1] + 2 * inv * fraction * wire[1][1] + fraction * fraction * wire[2][1];
		const r = unit * 0.009;
		ellipseFill({
			alpha: appear * fade,
			color,
			radiusX: r * 0.75,
			radiusY: r * 1.15,
			rotation: 0,
			scene,
			x,
			y: y - r * 1.05,
		});
		circle({
			alpha: appear * fade,
			color,
			radius: r * 0.5,
			scene,
			x: x + (bird % 2 ? 1 : -1) * r * 0.3,
			y: y - r * 2.3,
		});
	}
	vignette({ alpha: 0.3 * fade, innerFraction: 0.38, scene });
}
