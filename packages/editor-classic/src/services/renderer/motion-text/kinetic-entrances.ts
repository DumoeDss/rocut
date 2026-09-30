import { unitRandom } from "./deterministic-random";
import {
	resolveKineticWordGeometry,
	type KineticWordGlyph,
} from "./kinetic-word-geometry";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface KineticEntranceDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawGlyph: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
}

interface GlyphTransform {
	readonly alpha?: number;
	readonly anchorX?: number;
	readonly anchorY?: number;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}

export function drawKineticEntrance(options: KineticEntranceDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "knWordSlam":
			drawWordSlam(options);
			return true;
		case "knTypeToSlam":
			drawTypeToSlam(options);
			return true;
		case "knReplaceIn":
			drawReplaceIn(options);
			return true;
		case "knHingeDrop":
			drawHingeDrop(options);
			return true;
		case "knLoopIn":
			drawLoopIn(options);
			return true;
		case "knPushIn":
			drawPushIn(options);
			return true;
		case "knInertia":
			drawInertia(options);
			return true;
		case "knWordSpin":
			drawWordSpin(options);
			return true;
		case "knDiveIn":
			drawDiveIn(options);
			return true;
		case "knStretchOut":
			drawStretchOut(options);
			return true;
		default:
			return false;
	}
}

function drawWordSlam(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const spread = geometry.wordCount > 1 ? 0.62 : 0;
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.enterProgress,
			spread,
		});
		if (progress <= 0) continue;
		const eased = outExpo(clamp01(progress * 1.35));
		const scale = 1 + 2.1 * (1 - eased);
		let knock = 0;
		for (let next = geometry.wordCount - 1; next > glyph.wordIndex; next -= 1) {
			const nextProgress = stagger({
				index: next,
				count: geometry.wordCount,
				progress: options.frame.enterProgress,
				spread,
			});
			if (nextProgress >= 0.74) {
				knock = options.size * 0.09 * kick((nextProgress - 0.74) * 0.4);
				break;
			}
		}
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: clamp01(progress * 7),
				anchorX: glyph.wordCenter,
				rotation:
					((1 - eased) * (glyph.wordIndex % 2 === 0 ? -7 : 7) * Math.PI) / 180,
				scaleX: scale,
				scaleY: scale,
				translateY: knock,
			},
		});
	}
}

function drawTypeToSlam(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const spread = geometry.wordCount > 1 ? 0.55 : 0;
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.enterProgress,
			spread,
		});
		if (progress <= 0) continue;
		const wordLength = geometry.glyphs.filter(
			(candidate) => candidate.wordIndex === glyph.wordIndex,
		).length;
		if (
			progress < 0.55 &&
			glyph.indexInWord >=
				Math.max(1, Math.ceil((progress / 0.55) * wordLength))
		) {
			continue;
		}
		const eased =
			progress < 0.55
				? 0
				: outBack({
						overshoot: 2.2,
						value: (progress - 0.55) / 0.45,
					});
		const scale = lerp({ start: 0.42, end: 1, progress: eased });
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: progress < 0.55 ? 0.85 : 1,
				anchorX: glyph.wordStart,
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawReplaceIn(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const progress = options.frame.enterProgress;
	const replaceEnd = geometry.wordCount > 1 ? 0.7 : 0.2;
	const fly = outExpo(clamp01((progress - replaceEnd) / (1 - replaceEnd)));
	for (const glyph of geometry.glyphs) {
		const start = (glyph.wordIndex / geometry.wordCount) * replaceEnd;
		const end = ((glyph.wordIndex + 1) / geometry.wordCount) * replaceEnd;
		let scale: number;
		let anchorX: number;
		let alpha = 1;
		if (progress < replaceEnd) {
			if (progress < start || progress >= end) continue;
			const local = (progress - start) / Math.max(0.001, end - start);
			const wordWidth = Math.max(1, glyph.wordEnd - glyph.wordStart);
			scale =
				Math.min(2.4, Math.max(1, (geometry.width / wordWidth) * 0.8)) *
				(1 + 0.35 * Math.exp(-local * 9));
			anchorX = geometry.centerX;
			alpha = clamp01(local * 8);
		} else {
			const last = glyph.wordIndex === geometry.wordCount - 1;
			const wordWidth = Math.max(1, glyph.wordEnd - glyph.wordStart);
			const large = Math.min(
				2.4,
				Math.max(1, (geometry.width / wordWidth) * 0.8),
			);
			scale = lerp({ start: last ? large : 0.3, end: 1, progress: fly });
			anchorX = lerp({
				start: geometry.centerX,
				end: glyph.wordCenter,
				progress: fly,
			});
			alpha = last ? 1 : clamp01(fly * 3);
		}
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha,
				anchorX,
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawHingeDrop(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const direction =
		unitRandom({ seed: options.frame.cut?.seed ?? 0, salt: 901 }) >= 0.5
			? 1
			: -1;
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.enterProgress,
			spread: geometry.wordCount > 1 ? 0.5 : 0,
		});
		if (progress <= 0) continue;
		const rotation =
			(-88 * direction * (1 - bounce(clamp01(progress))) * Math.PI) / 180;
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: clamp01(progress * 6),
				anchorX: direction > 0 ? glyph.wordStart : glyph.wordEnd,
				anchorY: options.y + options.size * 0.58,
				rotation,
			},
		});
	}
}

function drawLoopIn(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const count = geometry.glyphs.length;
	const direction =
		unitRandom({ seed: options.frame.cut?.seed ?? 0, salt: 911 }) >= 0.5
			? 1
			: -1;
	const distance = options.maxWidth * 0.55;
	const radius = (distance / (Math.PI * 2)) * 1.5;
	for (const glyph of geometry.glyphs) {
		const order =
			direction > 0 ? glyph.glyphIndex : count - 1 - glyph.glyphIndex;
		const progress = stagger({
			index: order,
			count,
			progress: options.frame.enterProgress,
			spread: 0.5,
		});
		if (progress <= 0) continue;
		const remaining = 1 - outCubic(progress);
		const phase = Math.PI * 2 * remaining;
		const deltaX =
			(remaining * distance - radius * Math.sin(phase)) * direction;
		const deltaY = -radius * (1 - Math.cos(phase));
		const tangentX = distance - Math.PI * 2 * radius * Math.cos(phase);
		const tangentY = -Math.PI * 2 * radius * Math.sin(phase);
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: clamp01(progress * 6),
				rotation:
					Math.atan2(tangentY, tangentX * direction) *
					Math.min(1, remaining * 4),
				translateX: deltaX,
				translateY: deltaY,
			},
		});
	}
}

function drawPushIn(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const position = options.frame.enterProgress * geometry.wordCount;
	const current = Math.min(geometry.wordCount - 1, Math.floor(position));
	const eased = outBack({
		overshoot: 1.5,
		value: clamp01((position - current) / 0.75),
	});
	const currentGlyphs = geometry.glyphs.filter(
		(glyph) => glyph.wordIndex === current,
	);
	const currentEnd = currentGlyphs[0]?.wordEnd ?? geometry.centerX;
	const previousEnd =
		geometry.glyphs.find((glyph) => glyph.wordIndex === current - 1)?.wordEnd ??
		currentEnd - options.size * 0.6;
	const finalEnd = geometry.centerX + geometry.width / 2;
	const shift =
		finalEnd - lerp({ start: previousEnd, end: currentEnd, progress: eased });
	for (const glyph of geometry.glyphs) {
		if (glyph.wordIndex > current) continue;
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: glyph.wordIndex === current ? clamp01(eased * 3) : 1,
				translateX: shift,
			},
		});
	}
}

function drawInertia(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	const count = geometry.glyphs.length;
	const direction =
		unitRandom({ seed: options.frame.cut?.seed ?? 0, salt: 921 }) >= 0.5
			? 1
			: -1;
	for (const glyph of geometry.glyphs) {
		const back =
			count > 1
				? direction > 0
					? (count - 1 - glyph.glyphIndex) / (count - 1)
					: glyph.glyphIndex / (count - 1)
				: 0;
		const progress = clamp01((options.frame.enterProgress - back * 0.3) / 0.7);
		const eased = outBack({ overshoot: 2.1, value: progress });
		const next = outBack({
			overshoot: 2.1,
			value: Math.min(1, progress + 0.02),
		});
		const velocity = (next - eased) / 0.02;
		const stretch = 1 + Math.min(0.5, Math.abs(velocity) * 0.08);
		const squeeze =
			progress > 0.55 ? 1 - 0.18 * back * bell((progress - 0.55) / 0.45) : 1;
		drawGlyph({
			...options,
			glyph,
			transform: {
				scaleX: stretch * squeeze,
				scaleY: 1 / stretch,
				translateX: -direction * options.maxWidth * 0.6 * (1 - eased),
			},
		});
	}
}

function drawWordSpin(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.enterProgress,
			spread: geometry.wordCount > 1 ? 0.5 : 0,
		});
		if (progress <= 0) continue;
		const scale = lerp({
			start: 0.15,
			end: 1,
			progress: outBack({ overshoot: 1.6, value: progress }),
		});
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: clamp01(progress * 5),
				anchorX: glyph.wordCenter,
				rotation:
					((1 - outCubic(progress)) *
						200 *
						(glyph.wordIndex % 2 === 0 ? 1 : -1) *
						Math.PI) /
					180,
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawDiveIn(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.enterProgress,
			spread: geometry.wordCount > 1 ? 0.55 : 0,
		});
		if (progress <= 0) continue;
		const eased = outCubic(progress);
		const scale = lerp({ start: 5.5, end: 1, progress: eased });
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha:
					clamp01(progress * 2.2) *
					lerp({ start: 0.35, end: 1, progress: eased }),
				anchorX: lerp({
					start: geometry.centerX,
					end: glyph.wordCenter,
					progress: eased,
				}),
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawStretchOut(options: KineticEntranceDraw): void {
	const geometry = geometryOf(options);
	for (const glyph of geometry.glyphs) {
		const progress = stagger({
			index: glyph.wordIndex,
			count: geometry.wordCount,
			progress: options.frame.enterProgress,
			spread: geometry.wordCount > 1 ? 0.55 : 0,
		});
		if (progress <= 0) continue;
		const stretch = Math.max(0.02, outElastic(progress));
		drawGlyph({
			...options,
			glyph,
			transform: {
				alpha: clamp01(progress * 8),
				anchorX: glyph.wordStart,
				scaleX: stretch,
				scaleY: 1,
			},
		});
	}
}

function geometryOf(options: KineticEntranceDraw) {
	return resolveKineticWordGeometry({
		align: options.ctx.textAlign,
		maxWidth: options.maxWidth,
		size: options.size,
		text: options.text,
		x: options.x,
		y: options.y,
	});
}

function drawGlyph({
	ctx,
	drawGlyph: draw,
	glyph,
	size,
	transform,
}: KineticEntranceDraw & {
	readonly glyph: KineticWordGlyph;
	readonly transform: GlyphTransform;
}): void {
	const baseAlpha = ctx.globalAlpha;
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
	draw({
		text: glyph.character,
		x: 0,
		y: 0,
		maxWidth: size * 0.76,
		size,
	});
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
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

function kick(seconds: number): number {
	return seconds <= 0 ? 0 : Math.exp(-11 * seconds) * Math.sin(30 * seconds);
}

function bell(value: number): number {
	return Math.sin(Math.PI * clamp01(value));
}

function bounce(value: number): number {
	let progress = clamp01(value);
	const first = 7.5625;
	const denominator = 2.75;
	if (progress < 1 / denominator) return first * progress * progress;
	if (progress < 2 / denominator) {
		progress -= 1.5 / denominator;
		return first * progress * progress + 0.75;
	}
	if (progress < 2.5 / denominator) {
		progress -= 2.25 / denominator;
		return first * progress * progress + 0.9375;
	}
	progress -= 2.625 / denominator;
	return first * progress * progress + 0.984375;
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

function outElastic(value: number): number {
	const progress = clamp01(value);
	if (progress === 0 || progress === 1) return progress;
	return (
		2 ** (-10 * progress) *
			Math.sin((progress * 10 - 0.75) * ((2 * Math.PI) / 3)) +
		1
	);
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
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
