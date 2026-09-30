import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorPolyline,
	drawDecorRing,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw, CoreDecorPoint } from "./core-decor-types";
import {
	drawDecorBox,
	drawDecorCross,
	drawDecorPolygon,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorSigned,
	extendedDecorState,
} from "./extended-decor-utils";

const GEOMETRY_DECORS = new Set([
	"beatRing",
	"checkerStrip",
	"concentricSquares",
	"constellation",
	"glitchRects",
	"guides",
	"halftonePatch",
	"lineBurst",
	"orbitDots",
	"plusGrid",
	"spiralLine",
	"triangleSpin",
	"waveLine",
]);

export function drawExtendedGeometryDecor(draw: CoreDecorDraw): boolean {
	if (!GEOMETRY_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "beatRing":
			drawBeatRing(draw);
			break;
		case "checkerStrip":
			drawCheckerStrip(draw);
			break;
		case "concentricSquares":
			drawConcentricSquares(draw);
			break;
		case "constellation":
			drawConstellation(draw);
			break;
		case "glitchRects":
			drawGlitchRects(draw);
			break;
		case "guides":
			drawGuides(draw);
			break;
		case "halftonePatch":
			drawHalftonePatch(draw);
			break;
		case "lineBurst":
			drawLineBurst(draw);
			break;
		case "orbitDots":
			drawOrbitDots(draw);
			break;
		case "plusGrid":
			drawPlusGrid(draw);
			break;
		case "spiralLine":
			drawSpiralLine(draw);
			break;
		case "triangleSpin":
			drawTriangleSpin(draw);
			break;
		case "waveLine":
			drawWaveLine(draw);
			break;
	}
	return true;
}

function drawGlitchRects(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 18; index += 1) {
		const width =
			8 * unit + extendedDecorRandom({ seed, salt: index + 100 }) * 58 * unit;
		const height =
			2 * unit + extendedDecorRandom({ seed, salt: index + 200 }) * 10 * unit;
		const side = index % 2 === 0 ? -1 : 1;
		const anchor = side < 0 ? bounds.x0 : bounds.x1;
		const jitter = Math.sin(phase * (3 + (index % 4)) + index) * 18 * unit;
		const x = anchor + side * (12 * unit + width * 0.2) + jitter - width / 2;
		const y =
			bounds.y0 -
			24 * unit +
			extendedDecorRandom({ seed, salt: index + 300 }) *
				(bounds.height + 48 * unit);
		fillDecorRect({
			alpha: alpha * (0.28 + (index % 5) * 0.12),
			color: extendedDecorColor({ draw, index }),
			draw,
			height,
			width,
			x,
			y,
		});
	}
}

function drawConcentricSquares(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	for (let layer = 0; layer < 7; layer += 1) {
		const width = bounds.width + (layer + 1) * 28 * unit;
		const height = bounds.height + (layer + 1) * 20 * unit;
		draw.ctx.save();
		draw.ctx.translate(cx, cy);
		draw.ctx.rotate(Math.sin(phase * 0.7 + layer * 0.4) * 0.025 * (layer + 1));
		drawDecorBox({
			alpha: alpha * (0.18 + layer * 0.07),
			color:
				layer % 2 === 0
					? draw.frame.palette.secondary
					: draw.frame.palette.accent,
			draw,
			height,
			left: -width / 2,
			thickness: Math.max(1, unit * (1 + layer * 0.12)),
			top: -height / 2,
			width,
		});
		draw.ctx.restore();
	}
}

function drawTriangleSpin(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const radius = Math.min(draw.width, draw.height) * 0.16;
	const cx =
		bounds.x1 + radius * 1.25 < draw.width
			? bounds.x1 + radius
			: draw.width * 0.18;
	const cy = draw.height * 0.24;
	for (let layer = 0; layer < 4; layer += 1) {
		const rotation = phase * (0.32 + layer * 0.08) + layer * 0.7;
		const r = radius * (1 - layer * 0.17);
		const points = Array.from({ length: 3 }, (_, index) => {
			const angle = rotation - Math.PI / 2 + (index * Math.PI * 2) / 3;
			return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
		});
		drawDecorPolygon({
			alpha: alpha * (0.36 + layer * 0.14),
			color: extendedDecorColor({ draw, index: layer }),
			draw,
			points,
			thickness: Math.max(1, unit * (1.2 + layer * 0.35)),
		});
	}
}

function drawLineBurst(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	const inner = Math.max(bounds.width, bounds.height) * 0.58;
	const outer = Math.hypot(draw.width, draw.height) * 0.52;
	for (let ray = 0; ray < 30; ray += 1) {
		const angle =
			(ray / 30) * Math.PI * 2 +
			phase * 0.08 +
			extendedDecorSigned({ seed, salt: ray + 420 }) * 0.035;
		const length =
			outer * (0.55 + extendedDecorRandom({ seed, salt: ray + 450 }) * 0.45);
		drawDecorSegment({
			alpha: alpha * (0.18 + (ray % 5) * 0.1),
			color:
				ray % 7 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit * (0.75 + (ray % 3) * 0.4)),
			x0: cx + Math.cos(angle) * inner,
			x1: cx + Math.cos(angle) * length,
			y0: cy + Math.sin(angle) * inner,
			y1: cy + Math.sin(angle) * length,
		});
	}
}

function drawPlusGrid(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const spacing = Math.max(28 * unit, Math.min(draw.width, draw.height) * 0.1);
	const offsetX = (phase * 8 * unit) % spacing;
	const offsetY = (phase * 5 * unit) % spacing;
	for (let y = -spacing + offsetY; y < draw.height + spacing; y += spacing) {
		for (let x = -spacing + offsetX; x < draw.width + spacing; x += spacing) {
			const index = Math.round(x / spacing) + Math.round(y / spacing);
			drawDecorCross({
				alpha: alpha * (index % 5 === 0 ? 0.52 : 0.2),
				color:
					index % 7 === 0
						? draw.frame.palette.accent
						: draw.frame.palette.secondary,
				draw,
				radius: (index % 4 === 0 ? 6 : 3.5) * unit,
				thickness: Math.max(1, unit),
				x,
				y,
			});
		}
	}
}

function drawGuides(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const inset = 18 * unit + Math.sin(phase * 1.3) * 4 * unit;
	const left = Math.max(draw.width * 0.05, bounds.x0 - inset);
	const right = Math.min(draw.width * 0.95, bounds.x1 + inset);
	const top = Math.max(draw.height * 0.05, bounds.y0 - inset);
	const bottom = Math.min(draw.height * 0.95, bounds.y1 + inset);
	for (const x of [left, (left + right) / 2, right]) {
		drawDecorSegment({
			alpha: alpha * 0.33,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x,
			y0: draw.height * 0.03,
			y1: draw.height * 0.97,
		});
	}
	for (const y of [top, (top + bottom) / 2, bottom]) {
		drawDecorSegment({
			alpha: alpha * 0.33,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: draw.width * 0.03,
			x1: draw.width * 0.97,
			y0: y,
			y1: y,
		});
	}
	drawDecorLabel({
		alpha: alpha * 0.7,
		color: draw.frame.palette.accent,
		draw,
		size: 9 * unit,
		text: `GUIDE ${String(Math.floor(phase * 10) % 100).padStart(2, "0")}`,
		x: left + 5 * unit,
		y: top - 8 * unit,
	});
}

function drawWaveLine(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const y = Math.min(draw.height * 0.9, bounds.y1 + 28 * unit);
	const points = Array.from({ length: 49 }, (_, index) => {
		const progress = index / 48;
		return {
			x: draw.width * (0.04 + progress * 0.92),
			y:
				y +
				Math.sin(progress * Math.PI * 8 + phase * 2.2) * 7 * unit +
				Math.sin(progress * Math.PI * 3 - phase) * 3 * unit,
		};
	});
	drawDecorPolyline({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		points,
		thickness: Math.max(1.5, unit * 2.1),
	});
}

function drawSpiralLine(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const maxRadius = Math.min(draw.width, draw.height) * 0.2;
	const cx =
		bounds.x0 - maxRadius * 1.2 > 0
			? bounds.x0 - maxRadius * 0.62
			: draw.width * 0.82;
	const cy = draw.height * 0.26;
	const points = Array.from({ length: 72 }, (_, index) => {
		const progress = index / 71;
		const angle = progress * Math.PI * 5 + phase * 0.8;
		const radius = maxRadius * progress;
		return {
			x: cx + Math.cos(angle) * radius,
			y: cy + Math.sin(angle) * radius,
		};
	});
	drawDecorPolyline({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		points,
		thickness: Math.max(1, unit * 1.8),
	});
	drawDecorDot({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		radius: Math.max(2, unit * 3),
		x: cx,
		y: cy,
	});
}

function drawHalftonePatch(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const columns = 13;
	const rows = 9;
	const cell = Math.max(
		5 * unit,
		Math.min(draw.width * 0.022, draw.height * 0.038),
	);
	const right = seed % 2 === 0;
	const left = right
		? draw.width - columns * cell - draw.width * 0.04
		: draw.width * 0.04;
	const top = draw.height * 0.08;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const distance = Math.hypot(column - columns / 2, row - rows / 2);
			const wave = 0.5 + 0.5 * Math.sin(phase * 1.4 + column * 0.5 - row * 0.4);
			const radius = Math.max(
				0.8,
				cell * (0.08 + wave * Math.max(0, 1 - distance / 8) * 0.38),
			);
			drawDecorDot({
				alpha: alpha * 0.52,
				color: draw.frame.palette.secondary,
				draw,
				radius,
				x: left + (column + 0.5) * cell,
				y: top + (row + 0.5) * cell,
			});
		}
	}
}

function drawCheckerStrip(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const cell = Math.max(9 * unit, draw.width * 0.018);
	const y = Math.min(draw.height - cell * 1.2, bounds.y1 + 24 * unit);
	const offset = (phase * 22 * unit) % (cell * 2);
	for (
		let column = -2;
		column < Math.ceil(draw.width / cell) + 2;
		column += 1
	) {
		for (let row = 0; row < 2; row += 1) {
			if ((column + row) % 2 !== 0) continue;
			fillDecorRect({
				alpha: alpha * 0.78,
				color:
					row === 0 ? draw.frame.palette.foreground : draw.frame.palette.accent,
				draw,
				height: cell,
				width: cell,
				x: column * cell + offset,
				y: y + row * cell,
			});
		}
	}
}

function drawBeatRing(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	const beat = phase * 2 - Math.floor(phase * 2);
	const baseRadius = Math.max(bounds.width, bounds.height) * 0.54;
	for (let echo = 0; echo < 4; echo += 1) {
		const progress = (beat + echo * 0.2) % 1;
		drawDecorRing({
			alpha: alpha * (1 - progress) * 0.34,
			color:
				echo % 2 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			radius: baseRadius + progress * 64 * unit,
			segments: 28,
			thickness: Math.max(1, unit * 1.5),
			x: cx,
			y: cy,
		});
	}
}

function drawOrbitDots(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	const radiusX = bounds.width * 0.62 + 28 * unit;
	const radiusY = bounds.height * 0.8 + 20 * unit;
	for (let dot = 0; dot < 16; dot += 1) {
		const angle = phase * 0.8 + (dot / 16) * Math.PI * 2;
		drawDecorDot({
			alpha: alpha * (0.3 + 0.65 * ((Math.cos(angle) + 1) / 2)),
			color:
				dot % 5 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			radius: Math.max(1.5, unit * (2 + (dot % 3))),
			x: cx + Math.cos(angle) * radiusX,
			y: cy + Math.sin(angle) * radiusY,
		});
	}
}

function drawConstellation(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const points: CoreDecorPoint[] = Array.from({ length: 14 }, (_, index) => ({
		x:
			draw.width *
			(0.07 + extendedDecorRandom({ seed, salt: index + 700 }) * 0.86),
		y:
			draw.height *
				(0.08 + extendedDecorRandom({ seed, salt: index + 750 }) * 0.84) +
			Math.sin(phase * 0.45 + index) * 3 * unit,
	}));
	for (let index = 1; index < points.length; index += 1) {
		if (index % 4 === 0) continue;
		drawDecorSegment({
			alpha: alpha * 0.3,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: points[index - 1]!.x,
			x1: points[index]!.x,
			y0: points[index - 1]!.y,
			y1: points[index]!.y,
		});
	}
	for (const [index, point] of points.entries()) {
		drawDecorDot({
			alpha: alpha * (0.55 + 0.4 * Math.sin(phase * 1.8 + index)),
			color:
				index % 4 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius: Math.max(1.4, unit * (index % 4 === 0 ? 3 : 1.8)),
			x: point.x,
			y: point.y,
		});
	}
}
