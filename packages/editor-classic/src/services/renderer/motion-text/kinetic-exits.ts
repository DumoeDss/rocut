import { unitRandom } from "./deterministic-random";
import {
	resolveKineticWordGeometry,
	type KineticWordGeometry,
	type KineticWordGlyph,
} from "./kinetic-word-geometry";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface KineticExitDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

interface GlyphTransform {
	readonly alpha?: number;
	readonly anchorX?: number;
	readonly anchorY?: number;
	readonly color?: string;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}

export function drawKineticExit(options: KineticExitDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "knWordKick":
			drawWordKick(options);
			return true;
		case "knPushOut":
			drawPushOut(options);
			return true;
		case "knDiveGlyph":
			drawDiveGlyph(options);
			return true;
		case "knLaunch":
			drawLaunch(options);
			return true;
		case "knWordBlink":
			drawWordBlink(options);
			return true;
		case "knCloseGap":
			drawCloseGap(options);
			return true;
		case "knJumpCutOut":
			drawJumpCutOut(options);
			return true;
		case "knStackAway":
			drawStackAway(options);
			return true;
		default:
			return false;
	}
}

function drawWordKick(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	const distance = Math.max(options.maxWidth * 0.9, options.size * 6);
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.exitProgress,
			spread: geometry.wordCount > 1 ? 0.4 : 0,
		});
		if (progress >= 1) continue;
		if (progress <= 0) {
			drawGlyph({ ...options, glyph, transform: {} });
			continue;
		}
		const direction = glyph.wordIndex % 2 === 0 ? -1 : 1;
		const eased = inCubic(progress);
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: 1 - inQuad(clamp01((progress - 0.45) / 0.55)),
				anchorX: glyph.wordCenter,
				rotation: degrees(direction * 70 * eased),
				translateX: direction * options.size * 0.6 * eased,
				translateY:
					direction * distance * eased -
					direction * options.size * 0.25 * bell(progress * 2),
			},
		});
	}
}

function drawPushOut(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	if (geometry.wordCount === 0) return;
	const starts = wordGlyphs(geometry).map(
		(glyphs) => glyphs[0]?.wordStart ?? 0,
	);
	const position = options.frame.exitProgress * geometry.wordCount;
	const current = Math.min(geometry.wordCount - 1, Math.floor(position));
	const next = Math.min(geometry.wordCount, current + 1);
	const from = starts[current] - starts[0];
	const to =
		next >= geometry.wordCount
			? geometry.width + options.size * 0.2
			: starts[next] - starts[0];
	const shift = lerp({
		start: from,
		end: to,
		progress: outBack({
			value: clamp01((position - current) / 0.8),
			overshoot: 1.6,
		}),
	});
	const fade =
		1 -
		smoothStep({
			start: 0.72,
			end: 1,
			value: options.frame.exitProgress,
		});
	for (const glyph of geometry.glyphs) {
		const over = starts[0] - (glyph.x - shift);
		const alpha = (1 - clamp01(over / (options.size * 0.45))) * fade;
		if (alpha <= 0.01) continue;
		drawGlyph({
			...options,
			glyph,
			transform: { alpha, translateX: -shift },
		});
	}
}

function drawDiveGlyph(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	if (geometry.glyphs.length === 0) return;
	const focus =
		geometry.glyphs.find((glyph) => /\p{Script=Han}/u.test(glyph.character)) ??
		geometry.glyphs[Math.floor(geometry.glyphs.length / 2)];
	if (!focus) return;
	const progress = options.frame.exitProgress;
	const onlyGlyph = geometry.glyphs.length === 1;
	const scale = Math.exp(progress ** 1.7 * Math.log(onlyGlyph ? 3 : 34));
	for (const glyph of geometry.glyphs) {
		const alpha = onlyGlyph
			? 1 - smoothStep({ start: 0.3, end: 1, value: progress })
			: glyph.glyphIndex === focus.glyphIndex
				? 1 - smoothStep({ start: 0.6, end: 1, value: progress })
				: 1 - smoothStep({ start: 0.25, end: 0.7, value: progress });
		if (alpha <= 0.01) continue;
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha,
				anchorX: focus.x,
				anchorY: focus.y,
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawLaunch(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	const count = geometry.glyphs.length;
	const direction = randomDirection({ options, salt: 71 });
	for (const glyph of geometry.glyphs) {
		const back =
			count > 1
				? direction > 0
					? (count - 1 - glyph.glyphIndex) / (count - 1)
					: glyph.glyphIndex / (count - 1)
				: 0;
		const progress = clamp01((options.frame.exitProgress - back * 0.35) / 0.65);
		if (progress >= 1) continue;
		const windUp = -0.06 * bell(clamp01(options.frame.exitProgress / 0.18));
		const travel = inCubic(progress) + windUp;
		const stretch = 1 + Math.min(1.2, 3 * progress ** 2 * 0.35);
		drawGlyph({
			...options,
			glyph,
			transform: {
				scaleX: stretch,
				scaleY: 1 / Math.sqrt(stretch),
				translateX: direction * options.maxWidth * 1.25 * travel,
			},
		});
	}
}

function drawWordBlink(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	const reverse = randomDirection({ options, salt: 73 }) > 0;
	const singleStart =
		unitRandom({
			seed: options.frame.cut?.seed ?? 0,
			salt: 74,
		}) * 0.6;
	for (const glyph of geometry.glyphs) {
		const order = reverse
			? geometry.wordCount - 1 - glyph.wordIndex
			: glyph.wordIndex;
		const start =
			geometry.wordCount > 1 ? order / geometry.wordCount : singleStart;
		const end =
			geometry.wordCount > 1
				? (order + 1) / geometry.wordCount
				: singleStart + 0.4;
		if (options.frame.exitProgress >= end) continue;
		if (options.frame.exitProgress < start) {
			drawGlyph({ ...options, glyph, transform: {} });
			continue;
		}
		const progress =
			(options.frame.exitProgress - start) / Math.max(0.001, end - start);
		const scale = 1 + 0.16 * bell(progress * 1.4);
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: progress > 0.7 ? 0.35 : 1,
				anchorX: glyph.wordCenter,
				color: progress > 0.25 ? options.frame.palette.accent : undefined,
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawCloseGap(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	const words = wordGlyphs(geometry);
	const order: number[] = [];
	for (
		let start = 0, end = words.length - 1;
		start <= end;
		start += 1, end -= 1
	) {
		order.push(start);
		if (end !== start) order.push(end);
	}
	const rank = new Map(order.map((wordIndex, index) => [wordIndex, index]));
	const collapse = words.map((_, wordIndex) =>
		inOutCubic(
			clamp01(
				options.frame.exitProgress * words.length - (rank.get(wordIndex) ?? 0),
			),
		),
	);
	const widths = words.map((glyphs) =>
		Math.max(0, (glyphs[0]?.wordEnd ?? 0) - (glyphs[0]?.wordStart ?? 0)),
	);
	const gaps = words.map((glyphs, index) =>
		index >= words.length - 1
			? 0
			: (words[index + 1][0]?.wordStart ?? 0) - (glyphs[0]?.wordEnd ?? 0),
	);
	const remainingWidth = words.reduce(
		(total, _, index) =>
			total +
			widths[index] * (1 - collapse[index]) +
			gaps[index] * (1 - Math.max(collapse[index], collapse[index + 1] ?? 0)),
		0,
	);
	let cursor = geometry.centerX - remainingWidth / 2;
	const targetCenters = words.map((_, index) => {
		const width = widths[index] * (1 - collapse[index]);
		const center = cursor + width / 2;
		cursor +=
			width +
			gaps[index] * (1 - Math.max(collapse[index], collapse[index + 1] ?? 0));
		return center;
	});
	for (const glyph of geometry.glyphs) {
		const amount = collapse[glyph.wordIndex];
		if (amount >= 0.999) continue;
		drawGlyph({
			...options,
			glyph,
			transform: {
				anchorX: glyph.wordCenter,
				scaleX: Math.max(0.01, 1 - amount),
				scaleY: Math.max(0.01, 1 - amount),
				translateX: targetCenters[glyph.wordIndex] - glyph.wordCenter,
			},
		});
	}
}

function drawJumpCutOut(options: KineticExitDraw): void {
	const stages = [
		[1.22, 0.05, -0.02, 0],
		[0.8, -0.07, 0.03, 0],
		[1.5, 0.02, 0, 3],
	] as const;
	const stage = Math.floor(clamp01(options.frame.exitProgress) * 4);
	const values = stages[stage];
	if (!values) return;
	const direction = randomDirection({ options, salt: 79 });
	const geometry = geometryOf(options);
	for (const glyph of geometry.glyphs) {
		drawGlyph({
			...options,
			glyph,
			transform: {
				anchorX: geometry.centerX,
				rotation: degrees(values[3] * direction),
				scaleX: values[0],
				scaleY: values[0],
				translateX: values[1] * direction * options.maxWidth,
				translateY: values[2] * options.size * 6,
			},
		});
	}
}

function drawStackAway(options: KineticExitDraw): void {
	const geometry = geometryOf(options);
	const towerEnd = 0.62;
	const fall = clamp01(
		(options.frame.exitProgress - towerEnd) / (1 - towerEnd),
	);
	if (fall >= 1) return;
	for (const glyph of geometry.glyphs) {
		const stack = inOutCubic(
			clamp01(
				(options.frame.exitProgress / towerEnd -
					(glyph.wordIndex / Math.max(1, geometry.wordCount)) * 0.7) /
					0.3,
			),
		);
		const targetY =
			options.y -
			(glyph.wordIndex - (geometry.wordCount - 1) / 2) * options.size * 1.05;
		const hop = -bell(stack) * options.size * 0.8;
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: 1 - smoothStep({ start: 0.8, end: 1, value: fall }),
				anchorX: glyph.wordCenter,
				rotation: degrees(fall * (glyph.wordIndex % 2 === 0 ? -8 : 8)),
				translateX: (geometry.centerX - glyph.wordCenter) * stack,
				translateY:
					(targetY - glyph.y) * stack + hop + inQuad(fall) * options.size * 8,
			},
		});
	}
}

function geometryOf(options: KineticExitDraw): KineticWordGeometry {
	return resolveKineticWordGeometry({
		align: options.ctx.textAlign,
		maxWidth: options.maxWidth,
		size: options.size,
		text: options.text,
		x: options.x,
		y: options.y,
	});
}

function wordGlyphs(
	geometry: KineticWordGeometry,
): readonly (readonly KineticWordGlyph[])[] {
	return Array.from({ length: geometry.wordCount }, (_, wordIndex) =>
		geometry.glyphs.filter((glyph) => glyph.wordIndex === wordIndex),
	);
}

function drawGlyph({
	ctx,
	drawGlyph: draw,
	glyph,
	size,
	transform,
}: KineticExitDraw & {
	readonly glyph: KineticWordGlyph;
	readonly transform: GlyphTransform;
}): void {
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	const anchorX = transform.anchorX ?? glyph.x;
	const anchorY = transform.anchorY ?? glyph.y;
	ctx.save();
	ctx.translate(
		anchorX + (transform.translateX ?? 0),
		anchorY + (transform.translateY ?? 0),
	);
	if (transform.rotation) ctx.rotate(transform.rotation);
	ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
	ctx.translate(glyph.x - anchorX, glyph.y - anchorY);
	ctx.globalAlpha = baseAlpha * (transform.alpha ?? 1);
	ctx.textAlign = "center";
	if (transform.color) ctx.fillStyle = transform.color;
	draw({ text: glyph.character, x: 0, y: 0, maxWidth: size * 0.76, size });
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

function randomDirection({
	options,
	salt,
}: {
	readonly options: KineticExitDraw;
	readonly salt: number;
}): -1 | 1 {
	return unitRandom({ seed: options.frame.cut?.seed ?? 0, salt }) >= 0.5
		? 1
		: -1;
}

function stagger({
	progress,
	index,
	count,
	spread,
}: {
	readonly progress: number;
	readonly index: number;
	readonly count: number;
	readonly spread: number;
}): number {
	const delay = count > 1 ? (index / (count - 1)) * spread : 0;
	return clamp01((progress - delay) / (1 - spread));
}

function smoothStep({
	start,
	end,
	value,
}: {
	readonly start: number;
	readonly end: number;
	readonly value: number;
}): number {
	const progress = clamp01((value - start) / Math.max(0.0001, end - start));
	return progress * progress * (3 - 2 * progress);
}

function outBack({
	value,
	overshoot,
}: {
	readonly value: number;
	readonly overshoot: number;
}): number {
	const shifted = clamp01(value) - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

function inCubic(value: number): number {
	return clamp01(value) ** 3;
}

function inQuad(value: number): number {
	return clamp01(value) ** 2;
}

function bell(value: number): number {
	return Math.sin(Math.PI * clamp01(value));
}

function degrees(value: number): number {
	return (value * Math.PI) / 180;
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

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
