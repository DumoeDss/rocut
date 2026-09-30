import { clamp01, degrees, type ExitHoldDraw } from "./exit-hold-geometry";

export interface ExitBRect {
	readonly bottom: number;
	readonly height: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}

// The optional padding keeps high-volume drawing call sites compact.
// eslint-disable-next-line opencut/prefer-object-params
export function exitBRect(options: ExitHoldDraw, padding = 0): ExitBRect {
	const width = options.maxWidth + padding * 2;
	const height = options.size * 1.55 + padding * 2;
	const left = options.x - width / 2;
	const top = options.y - height * 0.64;
	return {
		bottom: top + height,
		height,
		left,
		right: left + width,
		top,
		width,
		x: options.x,
		y: options.y,
	};
}

export function drawExitBWhole({
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
	readonly options: ExitHoldDraw;
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
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.save();
	options.ctx.translate(options.x + translateX, options.y + translateY);
	if (rotation) options.ctx.rotate(rotation);
	if (skewX) options.ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	options.ctx.scale(scaleX, scaleY);
	options.ctx.translate(-options.x, -options.y);
	options.ctx.globalAlpha = baseAlpha * alpha;
	if (color) options.ctx.fillStyle = color;
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

export function drawExitBLine({
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
	readonly options: ExitHoldDraw;
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

export function drawExitBRing({
	alpha = 1,
	color,
	options,
	radius,
	segments = 16,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly options: ExitHoldDraw;
	readonly radius: number;
	readonly segments?: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (radius <= 0.1) return;
	for (let index = 0; index < segments; index += 1) {
		const start = (index / segments) * Math.PI * 2;
		const end = ((index + 1) / segments) * Math.PI * 2;
		drawExitBLine({
			alpha,
			color,
			from: [x + Math.cos(start) * radius, y + Math.sin(start) * radius],
			options,
			to: [x + Math.cos(end) * radius, y + Math.sin(end) * radius],
			width,
		});
	}
}

export function drawExitBClipped({
	alpha = 1,
	color,
	height,
	left,
	options,
	top,
	translateX = 0,
	translateY = 0,
	width,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly height: number;
	readonly left: number;
	readonly options: ExitHoldDraw;
	readonly top: number;
	readonly translateX?: number;
	readonly translateY?: number;
	readonly width: number;
}): void {
	if (width <= 0.05 || height <= 0.05 || alpha <= 0.003) return;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(left, top, width, height);
	options.ctx.clip();
	options.ctx.translate(translateX, translateY);
	options.ctx.globalAlpha = baseAlpha * alpha;
	if (color) options.ctx.fillStyle = color;
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

export function exitBPhase({
	order,
	progress,
	spread,
}: {
	readonly order: number;
	readonly progress: number;
	readonly spread: number;
}): number {
	return clamp01((progress - order * spread) / Math.max(0.001, 1 - spread));
}

// A seed/salt pair mirrors the source pack's compact direction helper.
// eslint-disable-next-line opencut/prefer-object-params
export function exitBSeedDirection(seed: number, salt: number): -1 | 1 {
	return ((seed >>> Math.abs(salt % 15)) & 1) === 0 ? -1 : 1;
}

export function exitBBounce(progress: number): number {
	const step = clamp01(progress) * 3.5;
	const section = Math.min(3, Math.floor(step));
	const phase = step - section;
	return Math.sin(Math.PI * phase) * 0.62 ** section;
}

export function exitBClockPoint({
	angle,
	height,
	width,
	x,
	y,
}: {
	readonly angle: number;
	readonly height: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): readonly [number, number] {
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	const distance = Math.min(
		Math.abs(cosine) > 0.0001 ? width / Math.abs(cosine) : Number.MAX_VALUE,
		Math.abs(sine) > 0.0001 ? height / Math.abs(sine) : Number.MAX_VALUE,
	);
	return [x + cosine * distance, y + sine * distance];
}

export { degrees };
