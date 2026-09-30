import {
	coreDecorTextBounds,
	drawDecorDot,
	drawDecorPolyline,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import {
	coreDecorPlan,
	decorInOut,
	randomSigned,
	randomUnit,
	sequenceSeconds,
} from "./core-decor-timing";
import type {
	CoreDecorBounds,
	CoreDecorDraw,
	CoreDecorPoint,
} from "./core-decor-types";

export function extendedDecorState(draw: CoreDecorDraw): {
	readonly alpha: number;
	readonly bounds: CoreDecorBounds;
	readonly phase: number;
	readonly seed: number;
	readonly unit: number;
} {
	return {
		alpha: decorInOut(draw.frame),
		bounds: coreDecorTextBounds(draw),
		phase: sequenceSeconds(draw.frame),
		seed: coreDecorPlan(draw).seed,
		unit: Math.max(0.5, Math.min(draw.width, draw.height) / 720),
	};
}

export function extendedDecorColor({
	draw,
	index,
}: {
	readonly draw: CoreDecorDraw;
	readonly index: number;
}): string {
	const palette = draw.frame.palette;
	return [palette.accent, palette.secondary, palette.foreground][
		((index % 3) + 3) % 3
	]!;
}

export function extendedDecorRandom({
	seed,
	salt,
}: {
	readonly seed: number;
	readonly salt: number;
}): number {
	return randomUnit({ seed, salt });
}

export function extendedDecorSigned({
	seed,
	salt,
}: {
	readonly seed: number;
	readonly salt: number;
}): number {
	return randomSigned({ seed, salt });
}

export function drawDecorBox({
	alpha,
	color,
	draw,
	height,
	left,
	thickness,
	top,
	width,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly height: number;
	readonly left: number;
	readonly thickness: number;
	readonly top: number;
	readonly width: number;
}): void {
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: left,
		x1: left + width,
		y0: top,
		y1: top,
	});
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: left + width,
		x1: left + width,
		y0: top,
		y1: top + height,
	});
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: left + width,
		x1: left,
		y0: top + height,
		y1: top + height,
	});
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: left,
		x1: left,
		y0: top + height,
		y1: top,
	});
}

export function drawDecorCross({
	alpha,
	color,
	draw,
	radius,
	thickness,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly radius: number;
	readonly thickness: number;
	readonly x: number;
	readonly y: number;
}): void {
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: x - radius,
		x1: x + radius,
		y0: y,
		y1: y,
	});
	drawDecorSegment({
		alpha,
		color,
		draw,
		thickness,
		x0: x,
		x1: x,
		y0: y - radius,
		y1: y + radius,
	});
}

export function drawDecorPolygon({
	alpha,
	color,
	draw,
	points,
	thickness,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly points: readonly CoreDecorPoint[];
	readonly thickness: number;
}): void {
	if (points.length < 3) return;
	drawDecorPolyline({
		alpha,
		color,
		draw,
		points: [...points, points[0]!],
		thickness,
	});
}

export function drawDecorStar({
	alpha,
	color,
	draw,
	innerRadius,
	outerRadius,
	rotation = -Math.PI / 2,
	thickness,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly innerRadius: number;
	readonly outerRadius: number;
	readonly rotation?: number;
	readonly thickness: number;
	readonly x: number;
	readonly y: number;
}): void {
	const points = Array.from({ length: 10 }, (_, index) => {
		const radius = index % 2 === 0 ? outerRadius : innerRadius;
		const angle = rotation + (index * Math.PI) / 5;
		return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
	});
	drawDecorPolygon({ alpha, color, draw, points, thickness });
}

export function drawDecorDiamond({
	alpha,
	color,
	draw,
	radius,
	thickness,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly radius: number;
	readonly thickness: number;
	readonly x: number;
	readonly y: number;
}): void {
	drawDecorPolygon({
		alpha,
		color,
		draw,
		points: [
			{ x, y: y - radius },
			{ x: x + radius, y },
			{ x, y: y + radius },
			{ x: x - radius, y },
		],
		thickness,
	});
}

export function drawDecorSoftDot({
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
	for (let layer = 3; layer >= 1; layer -= 1) {
		drawDecorDot({
			alpha: (alpha * (4 - layer)) / 6,
			color,
			draw,
			radius: (radius * layer) / 3,
			x,
			y,
		});
	}
}

export function fillDecorCentered({
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
	fillDecorRect({
		alpha,
		color,
		draw,
		height,
		width,
		x: x - width / 2,
		y: y - height / 2,
	});
}
