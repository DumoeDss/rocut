import {
	coreDecorTextBounds,
	drawDecorDot,
	drawDecorLabel,
	drawDecorRing,
	drawDecorSegment,
} from "./core-decor-geometry";
import {
	coreDecorPlan,
	decorInOut,
	delayedEntrance,
	lerp,
	localSeconds,
	randomUnit,
	TICKS_PER_SECOND,
} from "./core-decor-timing";
import type { CoreDecorDraw } from "./core-decor-types";

export function drawCoreFrontFrameDecor(options: CoreDecorDraw): boolean {
	switch (options.decor) {
		case "brackets":
			drawBrackets(options);
			return true;
		case "rings":
			drawRings(options);
			return true;
		case "dots":
			drawDots(options);
			return true;
		case "arrows":
			drawArrows(options);
			return true;
		default:
			return false;
	}
}

function drawBrackets(draw: CoreDecorDraw): void {
	const bounds = coreDecorTextBounds(draw);
	const plan = coreDecorPlan(draw);
	const entrance = delayedEntrance({
		frame: draw.frame,
		delay: 0,
		duration: 0.35,
	});
	if (entrance <= 0.001) return;
	const padding = 18 + bounds.height * 0.12;
	const x0 = bounds.x0 - padding;
	const x1 = bounds.x1 + padding;
	const y0 = bounds.y0 - padding;
	const y1 = bounds.y1 + padding;
	const centerX = (x0 + x1) / 2;
	const centerY = (y0 + y1) / 2;
	const left = lerp({ first: centerX, second: x0, amount: entrance });
	const right = lerp({ first: centerX, second: x1, amount: entrance });
	const top = lerp({ first: centerY, second: y0, amount: entrance });
	const bottom = lerp({ first: centerY, second: y1, amount: entrance });
	const length = Math.min(x1 - x0, y1 - y0) * 0.16 + 8;
	const color = plan.accent
		? draw.frame.palette.accent
		: draw.frame.palette.foreground;
	for (const [first, second] of [
		[
			[left, top + length, left, top],
			[left, top, left + length, top],
		],
		[
			[right - length, top, right, top],
			[right, top, right, top + length],
		],
		[
			[left, bottom - length, left, bottom],
			[left, bottom, left + length, bottom],
		],
		[
			[right - length, bottom, right, bottom],
			[right, bottom, right, bottom - length],
		],
	] as const) {
		for (const [sx, sy, ex, ey] of [first, second]) {
			drawDecorSegment({
				alpha: 1,
				color,
				draw,
				thickness: 2.2,
				x0: sx,
				x1: ex,
				y0: sy,
				y1: ey,
			});
		}
	}
}

function drawRings(draw: CoreDecorDraw): void {
	const bounds = coreDecorTextBounds(draw);
	const plan = coreDecorPlan(draw);
	const entrance = delayedEntrance({
		frame: draw.frame,
		delay: 0,
		duration: 0.5,
	});
	if (entrance <= 0.001) return;
	const centerX = (bounds.x0 + bounds.x1) / 2;
	const centerY = (bounds.y0 + bounds.y1) / 2;
	const baseRadius =
		Math.max(bounds.width, bounds.height) * 0.55 + draw.height * 0.05;
	for (let index = 0; index < Math.max(2, plan.count); index += 1) {
		const radius =
			baseRadius *
			(1 +
				index * 0.28 +
				randomUnit({ seed: plan.seed, salt: index * 5 + 1 }) * 0.1);
		const start =
			randomUnit({ seed: plan.seed, salt: index * 5 + 2 }) * Math.PI * 2 +
			localSeconds(draw.frame) * (index % 2 === 0 ? 0.18 : -0.24);
		const arc =
			Math.PI *
			2 *
			entrance *
			(0.55 + 0.45 * randomUnit({ seed: plan.seed, salt: index * 5 + 3 }));
		drawDecorRing({
			alpha: 0.7,
			color: draw.frame.palette.foreground,
			draw,
			end: start + arc,
			radius,
			segments: 24,
			start,
			thickness: 1.2,
			x: centerX,
			y: centerY,
		});
		const markerAngle = start + (40 * Math.PI) / 180;
		const markerX = centerX + Math.cos(markerAngle) * radius;
		const markerY = centerY + Math.sin(markerAngle) * radius;
		drawDecorDot({
			alpha: entrance,
			color: draw.frame.palette.accent,
			draw,
			radius: 3.5,
			x: markerX,
			y: markerY,
		});
		drawDecorLabel({
			alpha: entrance,
			color: draw.frame.palette.secondary,
			draw,
			size: Math.min(18, Math.max(10, draw.height * 0.015)),
			text: `X${Math.round(markerX)} Y${Math.round(markerY)}`,
			x: markerX + 10,
			y: markerY - 12,
		});
	}
}

function drawDots(draw: CoreDecorDraw): void {
	const bounds = coreDecorTextBounds(draw);
	const entrance = decorInOut(draw.frame);
	if (entrance <= 0.001) return;
	const centerX = (bounds.x0 + bounds.x1) / 2;
	const centerY = (bounds.y0 + bounds.y1) / 2;
	const radius =
		Math.max(bounds.width, bounds.height) * 0.62 + draw.height * 0.04;
	const count = Math.floor(36 * entrance);
	for (let index = 0; index < count; index += 1) {
		const angle =
			(index / 36) * Math.PI * 2 +
			localSeconds(draw.frame) * ((20 * Math.PI) / 180);
		drawDecorDot({
			alpha: 0.85,
			color:
				index % 6 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius: index % 6 === 0 ? 3.5 : 2,
			x: centerX + Math.cos(angle) * radius,
			y: centerY + Math.sin(angle) * radius,
		});
	}
}

function drawArrows(draw: CoreDecorDraw): void {
	const bounds = coreDecorTextBounds(draw);
	const plan = coreDecorPlan(draw);
	const entrance = delayedEntrance({
		frame: draw.frame,
		delay: 0,
		duration: 0.4,
	});
	if (entrance <= 0.001) return;
	const centerY = (bounds.y0 + bounds.y1) / 2;
	const size = Math.min(40, Math.max(14, draw.height * 0.03));
	const gap = size * 0.9;
	const step = Math.floor(draw.frame.sequenceTime / (TICKS_PER_SECOND / 12));
	for (const side of [-1, 1] as const) {
		const edge = side < 0 ? bounds.x0 - size * 1.2 : bounds.x1 + size * 1.2;
		for (let index = 0; index < 3; index += 1) {
			const opacity = (step + index) % 3 === 0 ? 0.3 : 1;
			const x = edge + side * (index * gap + (1 - entrance) * draw.width * 0.2);
			const direction = -side;
			const color =
				index === 0 ? draw.frame.palette.accent : draw.frame.palette.foreground;
			for (const [x0, y0, x1, y1] of [
				[
					x - direction * size * 0.35,
					centerY - size * 0.5,
					x + direction * size * 0.35,
					centerY,
				],
				[
					x + direction * size * 0.35,
					centerY,
					x - direction * size * 0.35,
					centerY + size * 0.5,
				],
			] as const) {
				drawDecorSegment({
					alpha: opacity,
					color,
					draw,
					thickness: Math.max(2, size * 0.14),
					x0,
					x1,
					y0,
					y1,
				});
			}
		}
	}
	if (plan.big) {
		drawLargeArrow({
			draw,
			entrance,
			right: plan.right,
			low: plan.low,
		});
	}
}

function drawLargeArrow({
	draw,
	entrance,
	right,
	low,
}: {
	readonly draw: CoreDecorDraw;
	readonly entrance: number;
	readonly right: boolean;
	readonly low: boolean;
}): void {
	const x = right ? draw.width * 0.9 : draw.width * 0.1;
	const y = draw.height * (low ? 0.82 : 0.2);
	const length = draw.height * 0.1 * entrance;
	const dx = right ? -1 : 1;
	const dy = low ? -1 : 1;
	const color = draw.frame.palette.foreground;
	const thickness = Math.max(3, draw.height * 0.008);
	drawDecorSegment({
		alpha: 1,
		color,
		draw,
		thickness,
		x0: x,
		x1: x + dx * length,
		y0: y,
		y1: y + dy * length,
	});
	for (const [x0, y0, x1, y1] of [
		[x + dx * length * 0.45, y + dy * length, x + dx * length, y + dy * length],
		[x + dx * length, y + dy * length, x + dx * length, y + dy * length * 0.55],
	] as const) {
		drawDecorSegment({
			alpha: 1,
			color,
			draw,
			thickness,
			x0,
			x1,
			y0,
			y1,
		});
	}
}
