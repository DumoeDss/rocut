import type {
	CoreDecorBounds,
	CoreDecorDraw,
	CoreDecorPoint,
} from "./core-decor-types";

export function coreDecorTextBounds({
	frame,
	height,
	width,
}: CoreDecorDraw): CoreDecorBounds {
	const characters = Array.from(frame.cut?.text ?? "");
	const size = Math.min(
		height * 0.22,
		width / Math.max(4, characters.length * 0.72),
	);
	const vertical = frame.cut?.preset.layout === "vcols";
	const textWidth = vertical
		? size * 1.2
		: Math.min(width * 0.86, Math.max(size, characters.length * size * 0.62));
	const textHeight = vertical
		? Math.min(height * 0.8, Math.max(size, characters.length * size * 1.05))
		: size * 1.25;
	return {
		height: textHeight,
		width: textWidth,
		x0: width / 2 - textWidth / 2,
		x1: width / 2 + textWidth / 2,
		y0: height / 2 - textHeight / 2,
		y1: height / 2 + textHeight / 2,
	};
}

export function fillDecorRect({
	alpha,
	color,
	draw,
	height,
	width,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly height: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (alpha <= 0.001 || width <= 0 || height <= 0) return;
	const baseAlpha = draw.ctx.globalAlpha;
	const baseFill = draw.ctx.fillStyle;
	draw.ctx.globalAlpha = baseAlpha * alpha;
	draw.ctx.fillStyle = color;
	draw.ctx.fillRect(x, y, width, height);
	draw.ctx.fillStyle = baseFill;
	draw.ctx.globalAlpha = baseAlpha;
}

export function drawDecorSegment({
	alpha,
	color,
	draw,
	thickness,
	x0,
	x1,
	y0,
	y1,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly thickness: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}): void {
	const length = Math.hypot(x1 - x0, y1 - y0);
	if (length <= 0.001 || alpha <= 0.001) return;
	draw.ctx.save();
	draw.ctx.translate(x0, y0);
	draw.ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
	fillDecorRect({
		alpha,
		color,
		draw,
		height: Math.max(0.75, thickness),
		width: length,
		x: 0,
		y: -Math.max(0.75, thickness) / 2,
	});
	draw.ctx.restore();
}

export function drawDecorPolyline({
	alpha,
	color,
	draw,
	points,
	progress = 1,
	thickness,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly points: readonly CoreDecorPoint[];
	readonly progress?: number;
	readonly thickness: number;
}): void {
	if (points.length < 2 || progress <= 0) return;
	const target = Math.min(points.length - 1, (points.length - 1) * progress);
	const wholeSegments = Math.floor(target);
	for (let index = 0; index < wholeSegments; index += 1) {
		drawSegmentBetween({
			alpha,
			color,
			draw,
			end: points[index + 1]!,
			start: points[index]!,
			thickness,
		});
	}
	if (wholeSegments >= points.length - 1) return;
	const remainder = target - wholeSegments;
	if (remainder <= 0) return;
	const start = points[wholeSegments]!;
	const end = points[wholeSegments + 1]!;
	drawSegmentBetween({
		start,
		end: {
			x: start.x + (end.x - start.x) * remainder,
			y: start.y + (end.y - start.y) * remainder,
		},
		alpha,
		color,
		draw,
		thickness,
	});
}

export function drawDecorRing({
	alpha,
	color,
	draw,
	end = Math.PI * 2,
	radius,
	segments = 28,
	start = 0,
	thickness,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly end?: number;
	readonly radius: number;
	readonly segments?: number;
	readonly start?: number;
	readonly thickness: number;
	readonly x: number;
	readonly y: number;
}): void {
	const points = Array.from({ length: segments + 1 }, (_, index) => {
		const angle = start + ((end - start) * index) / segments;
		return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
	});
	drawDecorPolyline({ alpha, color, draw, points, thickness });
}

export function drawDecorDot({
	alpha,
	color,
	draw,
	radius,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly radius: number;
	readonly x: number;
	readonly y: number;
}): void {
	fillDecorRect({
		alpha,
		color,
		draw,
		height: radius * 2,
		width: radius * 2,
		x: x - radius,
		y: y - radius,
	});
}

export function drawDecorLabel({
	align = "left",
	alpha,
	color,
	draw,
	size,
	text,
	x,
	y,
}: {
	readonly align?: CanvasTextAlign;
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): void {
	if (alpha <= 0.001) return;
	const baseAlpha = draw.ctx.globalAlpha;
	const baseFill = draw.ctx.fillStyle;
	draw.ctx.globalAlpha = baseAlpha * alpha;
	draw.ctx.fillStyle = color;
	draw.ctx.textAlign = align;
	draw.ctx.textBaseline = "middle";
	draw.ctx.font = `${draw.frame.font.style} ${draw.frame.font.weight} ${Math.max(8, size)}px ${quoteFamily(draw.frame.font.family)}`;
	draw.ctx.fillText(text, x, y);
	draw.ctx.fillStyle = baseFill;
	draw.ctx.globalAlpha = baseAlpha;
}

function drawSegmentBetween({
	start,
	end,
	alpha,
	color,
	draw,
	thickness,
}: {
	readonly start: CoreDecorPoint;
	readonly end: CoreDecorPoint;
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly thickness: number;
}): void {
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: start.x,
		x1: end.x,
		y0: start.y,
		y1: end.y,
	});
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
