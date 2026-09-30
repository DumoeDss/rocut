import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorPolyline,
	drawDecorRing,
	drawDecorSegment,
} from "./core-decor-geometry";
import type { CoreDecorDraw } from "./core-decor-types";
import {
	drawDecorDiamond,
	drawDecorPolygon,
	drawDecorStar,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorSigned,
	extendedDecorState,
} from "./extended-decor-utils";

const GRAPHIC_DECORS = new Set([
	"decoCorners",
	"halfCircles",
	"loopArrows",
	"memphis",
	"polkaPatch",
	"starburst",
	"stripeCircle",
	"tally",
	"zigzagRibbon",
]);

export function drawDecorBGraphic(draw: CoreDecorDraw): boolean {
	if (!GRAPHIC_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "memphis":
			drawMemphis(draw);
			break;
		case "zigzagRibbon":
			drawZigzagRibbon(draw);
			break;
		case "polkaPatch":
			drawPolkaPatch(draw);
			break;
		case "stripeCircle":
			drawStripeCircle(draw);
			break;
		case "decoCorners":
			drawDecoCorners(draw);
			break;
		case "halfCircles":
			drawHalfCircles(draw);
			break;
		case "loopArrows":
			drawLoopArrows(draw);
			break;
		case "starburst":
			drawStarburst(draw);
			break;
		case "tally":
			drawTally(draw);
			break;
	}
	return true;
}

function drawMemphis(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 18; index += 1) {
		const side = index % 2 === 0 ? -1 : 1;
		const x =
			(side < 0 ? bounds.x0 : bounds.x1) +
			side *
				(24 + extendedDecorRandom({ seed, salt: 5_000 + index }) * 90) *
				unit;
		const y =
			draw.height *
				(0.08 + extendedDecorRandom({ seed, salt: 5_100 + index }) * 0.84) +
			Math.sin(phase * 0.7 + index) * 5 * unit;
		const radius = (4 + (index % 5) * 2.2) * unit;
		if (index % 3 === 0) {
			drawDecorDiamond({
				alpha: alpha * (0.42 + (index % 4) * 0.13),
				color: extendedDecorColor({ draw, index }),
				draw,
				radius,
				thickness: Math.max(1, unit),
				x,
				y,
			});
		} else if (index % 3 === 1) {
			drawDecorRing({
				alpha: alpha * 0.62,
				color: extendedDecorColor({ draw, index }),
				draw,
				radius,
				segments: 12,
				thickness: Math.max(1, unit),
				x,
				y,
			});
		} else {
			drawDecorSegment({
				alpha: alpha * 0.72,
				color: extendedDecorColor({ draw, index }),
				draw,
				thickness: Math.max(1, unit * 1.4),
				x0: x - radius,
				x1: x + radius,
				y0: y - Math.sin(phase + index) * radius,
				y1: y + Math.sin(phase + index) * radius,
			});
		}
	}
}

function drawZigzagRibbon(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const horizontal = seed % 2 === 0;
	const points = Array.from({ length: 24 }, (_, index) => {
		const progress = index / 23;
		const zig = (index % 2 === 0 ? -1 : 1) * (12 + (index % 3) * 3) * unit;
		return horizontal
			? {
					x: draw.width * (0.05 + progress * 0.9),
					y: draw.height * 0.86 + zig + Math.sin(phase) * 4 * unit,
				}
			: {
					x: draw.width * 0.9 + zig + Math.sin(phase) * 4 * unit,
					y: draw.height * (0.05 + progress * 0.9),
				};
	});
	for (let band = 0; band < 3; band += 1) {
		drawDecorPolyline({
			alpha: alpha * (0.32 + band * 0.22),
			color: extendedDecorColor({ draw, index: band }),
			draw,
			points: points.map((point) => ({
				x: point.x + (horizontal ? 0 : band * 4 * unit),
				y: point.y + (horizontal ? band * 4 * unit : 0),
			})),
			thickness: Math.max(1, unit * (1.3 + band * 0.5)),
		});
	}
}

function drawPolkaPatch(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const cell = Math.max(15 * unit, draw.height * 0.032);
	const right = seed % 2 === 0;
	const left = right ? draw.width * 0.68 : draw.width * 0.05;
	const top = draw.height * 0.1;
	for (let row = 0; row < 9; row += 1) {
		for (let column = 0; column < 9; column += 1) {
			const pulse =
				0.68 + 0.28 * Math.sin(phase * 1.2 + row * 0.6 + column * 0.4);
			drawDecorDot({
				alpha: alpha * pulse * (0.2 + ((row + column) % 4) * 0.09),
				color:
					(row + column) % 5 === 0
						? draw.frame.palette.accent
						: draw.frame.palette.secondary,
				draw,
				radius: cell * (0.13 + ((row * 3 + column) % 4) * 0.04),
				x: left + column * cell,
				y: top + row * cell,
			});
		}
	}
}

function drawStripeCircle(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(62 * unit, draw.height * 0.13);
	const x = seed % 2 === 0 ? draw.width * 0.14 : draw.width * 0.86;
	const y = bounds.y0 > radius * 1.7 ? draw.height * 0.16 : draw.height * 0.8;
	for (let stripe = -7; stripe <= 7; stripe += 1) {
		const yy = stripe * (radius / 7) + Math.sin(phase * 0.7) * 3 * unit;
		const half = Math.sqrt(Math.max(0, radius * radius - yy * yy));
		draw.ctx.save();
		draw.ctx.translate(x, y);
		draw.ctx.rotate(phase * 0.08);
		drawDecorSegment({
			alpha: alpha * (0.28 + (Math.abs(stripe) % 4) * 0.12),
			color:
				stripe % 3 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit * 1.5),
			x0: -half,
			x1: half,
			y0: yy,
			y1: yy,
		});
		draw.ctx.restore();
	}
	drawDecorRing({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		radius,
		segments: 30,
		thickness: Math.max(1, unit * 1.8),
		x,
		y,
	});
	drawDecorRing({
		alpha: alpha * 0.55,
		color: draw.frame.palette.accent,
		draw,
		radius: radius * 1.06,
		segments: 30,
		thickness: Math.max(1, unit),
		x: x + Math.sin(phase * 0.6) * 5 * unit,
		y: y + Math.cos(phase * 0.6) * 4 * unit,
	});
}

function drawDecoCorners(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const margin = draw.width * 0.055;
	const length = Math.min(74 * unit, draw.width * 0.12);
	for (const [x, y, sx, sy] of [
		[margin, margin, 1, 1],
		[draw.width - margin, margin, -1, 1],
		[draw.width - margin, draw.height - margin, -1, -1],
		[margin, draw.height - margin, 1, -1],
	] as const) {
		const pulse = 0.92 + Math.sin(phase * 1.1 + x + y) * 0.08;
		drawDecorPolyline({
			alpha,
			color: draw.frame.palette.accent,
			draw,
			points: [
				{ x: x + sx * length * pulse, y },
				{ x: x + sx * length * 0.28, y },
				{ x, y: y + sy * length * 0.28 },
				{ x, y: y + sy * length * pulse },
			],
			thickness: Math.max(1, unit * 1.8),
		});
		drawDecorDiamond({
			alpha: alpha * 0.72,
			color: draw.frame.palette.secondary,
			draw,
			radius: 5 * unit,
			thickness: Math.max(1, unit),
			x: x + sx * length * 0.28,
			y: y + sy * length * 0.28,
		});
	}
}

function drawHalfCircles(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const x = right ? draw.width * 0.92 : draw.width * 0.08;
	const y = draw.height * 0.54;
	for (let layer = 0; layer < 7; layer += 1) {
		const radius = (18 + layer * 12) * unit;
		const direction = right ? Math.PI : 0;
		drawDecorRing({
			alpha: alpha * (0.22 + layer * 0.09),
			color: extendedDecorColor({ draw, index: layer }),
			draw,
			end: direction + Math.PI / 2 + Math.sin(phase * 0.4) * 0.04,
			radius,
			segments: 16,
			start: direction - Math.PI / 2 + Math.sin(phase * 0.4) * 0.04,
			thickness: Math.max(1, unit * (1 + layer * 0.18)),
			x,
			y,
		});
	}
}

function drawLoopArrows(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(54 * unit, draw.height * 0.11);
	const x =
		bounds.x1 + radius * 1.4 < draw.width
			? bounds.x1 + radius
			: draw.width * 0.12;
	const y = draw.height * 0.76;
	for (let loop = 0; loop < 3; loop += 1) {
		const start = phase * (0.32 + loop * 0.05) + loop * 2.1;
		const end = start + Math.PI * (1.1 + loop * 0.12);
		const loopRadius = radius * (0.58 + loop * 0.22);
		drawDecorRing({
			alpha: alpha * (0.42 + loop * 0.2),
			color: extendedDecorColor({ draw, index: loop }),
			draw,
			end,
			radius: loopRadius,
			segments: 20,
			start,
			thickness: Math.max(1, unit * 1.5),
			x,
			y,
		});
		const ax = x + Math.cos(end) * loopRadius;
		const ay = y + Math.sin(end) * loopRadius;
		drawDecorPolygon({
			alpha,
			color: extendedDecorColor({ draw, index: loop }),
			draw,
			points: [
				{ x: ax, y: ay },
				{
					x: ax + Math.cos(end + 2.45) * 9 * unit,
					y: ay + Math.sin(end + 2.45) * 9 * unit,
				},
				{
					x: ax + Math.cos(end - 2.45) * 9 * unit,
					y: ay + Math.sin(end - 2.45) * 9 * unit,
				},
			],
			thickness: Math.max(1, unit),
		});
	}
	drawDecorDot({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		radius: (3 + extendedDecorRandom({ seed, salt: 5_600 }) * 2) * unit,
		x,
		y,
	});
}

function drawStarburst(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(62 * unit, draw.height * 0.13);
	const x = seed % 2 === 0 ? draw.width * 0.14 : draw.width * 0.86;
	const y = bounds.y0 > radius * 1.6 ? draw.height * 0.15 : draw.height * 0.82;
	drawDecorStar({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		innerRadius: radius * (0.38 + 0.06 * Math.sin(phase * 1.4)),
		outerRadius: radius,
		rotation: phase * 0.24,
		thickness: Math.max(1, unit * 2),
		x,
		y,
	});
	for (let ray = 0; ray < 18; ray += 1) {
		const angle = (ray * Math.PI * 2) / 18 - phase * 0.1;
		drawDecorSegment({
			alpha: alpha * (0.2 + (ray % 5) * 0.12),
			color:
				ray % 4 === 0
					? draw.frame.palette.foreground
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: x + Math.cos(angle) * radius * 1.18,
			x1: x + Math.cos(angle) * radius * (1.36 + (ray % 3) * 0.1),
			y0: y + Math.sin(angle) * radius * 1.18,
			y1: y + Math.sin(angle) * radius * (1.36 + (ray % 3) * 0.1),
		});
	}
}

function drawTally(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const groups = 4;
	const left = seed % 2 === 0 ? draw.width * 0.08 : draw.width * 0.66;
	const top = draw.height * 0.12;
	const spacing = 18 * unit;
	const active = 4 + (Math.floor(phase * 1.4) % 17);
	let count = 0;
	for (let group = 0; group < groups; group += 1) {
		const x = left + group * spacing * 5.2;
		for (let mark = 0; mark < 4; mark += 1) {
			count += 1;
			if (count > active) continue;
			drawDecorSegment({
				alpha: alpha * (0.5 + mark * 0.12),
				color:
					group % 2 === 0
						? draw.frame.palette.foreground
						: draw.frame.palette.secondary,
				draw,
				thickness: Math.max(1, unit * 1.8),
				x0: x + mark * spacing,
				x1:
					x +
					mark * spacing +
					extendedDecorSigned({ seed, salt: 5_900 + count }) * unit,
				y0: top,
				y1: top + 42 * unit,
			});
		}
		if (active >= group * 5 + 5) {
			drawDecorSegment({
				alpha,
				color: draw.frame.palette.accent,
				draw,
				thickness: Math.max(1, unit * 2.1),
				x0: x - 4 * unit,
				x1: x + spacing * 3 + 4 * unit,
				y0: top + 38 * unit,
				y1: top + 4 * unit,
			});
		}
	}
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		size: 9 * unit,
		text: `COUNT / ${String(active).padStart(2, "0")}`,
		x: left,
		y: top + 58 * unit,
	});
}
