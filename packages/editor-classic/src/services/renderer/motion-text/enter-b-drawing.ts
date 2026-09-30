import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	exitHoldGlyphs,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	randomSigned,
	randomUnit,
	secondsOf,
	stagger,
	type ExitHoldDraw,
	type ExitHoldGlyph,
	type ExitHoldGlyphTransform,
} from "./exit-hold-geometry";

export type EnterBDraw = ExitHoldDraw;
export type EnterBGlyph = ExitHoldGlyph;
export type EnterBGlyphTransform = ExitHoldGlyphTransform;

export interface EnterBBounds {
	readonly bottom: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly height: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly width: number;
}

export function enterBGlyphs(options: EnterBDraw): EnterBGlyph[] {
	return exitHoldGlyphs(options);
}

// The optional padding is a geometry scalar used by compact preset recipes.
// eslint-disable-next-line opencut/prefer-object-params
export function enterBBounds(options: EnterBDraw, padding = 0): EnterBBounds {
	const glyphs = enterBGlyphs(options);
	const fallbackWidth = Math.min(
		options.maxWidth,
		Math.max(options.size * 0.62, options.text.length * options.size * 0.62),
	);
	const left =
		(glyphs[0]?.x ?? options.x - fallbackWidth / 2) -
		(glyphs[0]?.width ?? 0) / 2 -
		padding;
	const last = glyphs.at(-1);
	const right =
		(last?.x ?? options.x + fallbackWidth / 2) +
		(last?.width ?? 0) / 2 +
		padding;
	const height = options.size * 1.45 + padding * 2;
	const top = options.y - height * 0.52;
	return {
		bottom: top + height,
		centerX: (left + right) / 2,
		centerY: top + height / 2,
		height,
		left,
		right,
		top,
		width: right - left,
	};
}

export function drawEnterBGlyph({
	glyph,
	options,
	transform,
}: {
	readonly glyph: EnterBGlyph;
	readonly options: EnterBDraw;
	readonly transform?: EnterBGlyphTransform;
}): void {
	drawExitHoldGlyph({ glyph, options, transform });
}

export function drawEnterBGlyphs({
	options,
	resolve,
}: {
	readonly options: EnterBDraw;
	readonly resolve: (
		glyph: EnterBGlyph,
	) => EnterBGlyphTransform | null | undefined;
}): void {
	for (const glyph of enterBGlyphs(options)) {
		const transform = resolve(glyph);
		if (transform === null) continue;
		drawEnterBGlyph({ glyph, options, transform: transform ?? {} });
	}
}

export function drawEnterBWhole({
	alpha = 1,
	color,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
	skewX = 0,
	translateX = 0,
	translateY = 0,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly options: EnterBDraw;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly skewX?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}): void {
	if (alpha <= 0.003 || Math.abs(scaleX) < 0.004 || Math.abs(scaleY) < 0.004) {
		return;
	}
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(options.x + translateX, options.y + translateY);
	if (rotation) ctx.rotate(rotation);
	if (skewX) ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	ctx.scale(scaleX, scaleY);
	ctx.translate(-options.x, -options.y);
	ctx.globalAlpha = baseAlpha * alpha;
	if (color) ctx.fillStyle = color;
	options.drawGlyph(options);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function drawEnterBClipped({
	alpha = 1,
	color,
	height,
	left,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
	top,
	translateX = 0,
	translateY = 0,
	width,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly height: number;
	readonly left: number;
	readonly options: EnterBDraw;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly top: number;
	readonly translateX?: number;
	readonly translateY?: number;
	readonly width: number;
}): void {
	if (width <= 0.05 || height <= 0.05 || alpha <= 0.003) return;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(left, top, width, height);
	options.ctx.clip();
	drawEnterBWhole({
		alpha,
		color,
		options,
		rotation,
		scaleX,
		scaleY,
		translateX,
		translateY,
	});
	options.ctx.restore();
}

export function drawEnterBLine({
	alpha = 1,
	color,
	from,
	options,
	to,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly from: readonly [number, number];
	readonly options: EnterBDraw;
	readonly to: readonly [number, number];
	readonly width: number;
}): void {
	if (alpha <= 0.003 || width <= 0.05) return;
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const length = Math.hypot(dx, dy);
	if (length <= 0.05) return;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.save();
	options.ctx.translate(from[0], from[1]);
	options.ctx.rotate(Math.atan2(dy, dx));
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = color;
	options.ctx.fillRect(0, -width / 2, length, width);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

export function drawEnterBRing({
	alpha = 1,
	color,
	options,
	radius,
	segments = 20,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly options: EnterBDraw;
	readonly radius: number;
	readonly segments?: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (radius <= 0.1) return;
	for (let index = 0; index < segments; index += 1) {
		const fromAngle = (index / segments) * Math.PI * 2;
		const toAngle = ((index + 1) / segments) * Math.PI * 2;
		drawEnterBLine({
			alpha,
			color,
			from: [
				x + Math.cos(fromAngle) * radius,
				y + Math.sin(fromAngle) * radius,
			],
			options,
			to: [x + Math.cos(toAngle) * radius, y + Math.sin(toAngle) * radius],
			width,
		});
	}
}

export function drawEnterBDot({
	alpha = 1,
	color,
	options,
	radius,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly options: EnterBDraw;
	readonly radius: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (radius <= 0.05 || alpha <= 0.003) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	if (ctx.arc && ctx.fill) {
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function clipEnterBPolygon({
	draw,
	options,
	points,
}: {
	readonly draw: () => void;
	readonly options: EnterBDraw;
	readonly points: readonly (readonly [number, number])[];
}): void {
	if (points.length < 3) return;
	options.ctx.save();
	options.ctx.beginPath();
	if (options.ctx.moveTo && options.ctx.lineTo) {
		options.ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) options.ctx.lineTo(point[0], point[1]);
		options.ctx.closePath?.();
	} else {
		const xs = points.map(([x]) => x);
		const ys = points.map(([, y]) => y);
		const left = Math.min(...xs);
		const top = Math.min(...ys);
		options.ctx.rect(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
	}
	options.ctx.clip();
	draw();
	options.ctx.restore();
}

export function enterBSeed(options: EnterBDraw): number {
	return options.frame.cut?.seed ?? 0;
}

// Seeded drawing helpers mirror the source pack's compact call shape.
// eslint-disable-next-line opencut/prefer-object-params
export function enterBDirection(options: EnterBDraw, salt: number): -1 | 1 {
	return randomUnit(enterBSeed(options), salt) < 0.5 ? -1 : 1;
}

// eslint-disable-next-line opencut/prefer-object-params
export function enterBRandom(
	options: EnterBDraw,
	index: number,
	salt: number,
): number {
	return randomUnit(enterBSeed(options), index, salt);
}

// eslint-disable-next-line opencut/prefer-object-params
export function enterBRandomSigned(
	options: EnterBDraw,
	index: number,
	salt: number,
): number {
	return randomSigned(enterBSeed(options), index, salt);
}

export function enterBSeconds(options: EnterBDraw): number {
	return secondsOf(options.frame);
}

export function enterBPhase({
	order,
	options,
	spread,
}: {
	readonly order: number;
	readonly options: EnterBDraw;
	readonly spread: number;
}): number {
	return stagger({
		order,
		progress: options.frame.enterProgress,
		spread,
	});
}

export function enterBSpring({
	frequency,
	progress,
	strength,
}: {
	readonly frequency: number;
	readonly progress: number;
	readonly strength: number;
}): number {
	const value = clamp01(progress);
	return (
		Math.exp(-strength * value) *
		Math.cos(frequency * Math.PI * value) *
		(1 - value ** 3)
	);
}

// Overshoot is a scalar easing coefficient, not an independent options domain.
// eslint-disable-next-line opencut/prefer-object-params
export function enterBOutBack(progress: number, overshoot = 1.70158): number {
	const value = clamp01(progress) - 1;
	return 1 + (overshoot + 1) * value ** 3 + overshoot * value ** 2;
}

export function enterBOutQuart(progress: number): number {
	return 1 - (1 - clamp01(progress)) ** 4;
}

export function enterBOutQuint(progress: number): number {
	return 1 - (1 - clamp01(progress)) ** 5;
}

export {
	clamp01,
	degrees,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	randomSigned,
	randomUnit,
	stagger,
};
