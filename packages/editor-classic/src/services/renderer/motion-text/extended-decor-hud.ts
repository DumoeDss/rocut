import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorRing,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw } from "./core-decor-types";
import {
	drawDecorBox,
	drawDecorCross,
	drawDecorPolygon,
	extendedDecorRandom,
	extendedDecorState,
	fillDecorCentered,
} from "./extended-decor-utils";

const HUD_DECORS = new Set([
	"crosshair",
	"cropMarks",
	"dateStamp",
	"dimension",
	"indexNum",
	"progressRing",
	"qrBlock",
	"radar",
	"reticle",
	"rulerEdge",
	"timecodeBar",
]);

export function drawExtendedHudDecor(draw: CoreDecorDraw): boolean {
	if (!HUD_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "crosshair":
			drawCrosshair(draw);
			break;
		case "cropMarks":
			drawCropMarks(draw);
			break;
		case "dateStamp":
			drawDateStamp(draw);
			break;
		case "dimension":
			drawDimension(draw);
			break;
		case "indexNum":
			drawIndexNum(draw);
			break;
		case "progressRing":
			drawProgressRing(draw);
			break;
		case "qrBlock":
			drawQrBlock(draw);
			break;
		case "radar":
			drawRadar(draw);
			break;
		case "reticle":
			drawReticle(draw);
			break;
		case "rulerEdge":
			drawRulerEdge(draw);
			break;
		case "timecodeBar":
			drawTimecodeBar(draw);
			break;
	}
	return true;
}

function drawCrosshair(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	const gapX = bounds.width / 2 + 16 * unit;
	const gapY = bounds.height / 2 + 13 * unit;
	const color = draw.frame.palette.secondary;
	const pulse = 0.62 + 0.28 * Math.sin(phase * 3.4);
	for (const [x0, y0, x1, y1] of [
		[draw.width * 0.04, cy, cx - gapX, cy],
		[cx + gapX, cy, draw.width * 0.96, cy],
		[cx, draw.height * 0.05, cx, cy - gapY],
		[cx, cy + gapY, cx, draw.height * 0.95],
	] as const) {
		drawDecorSegment({
			alpha: alpha * pulse,
			color,
			draw,
			thickness: Math.max(1, unit * 1.2),
			x0,
			x1,
			y0,
			y1,
		});
	}
	for (let tick = -5; tick <= 5; tick += 1) {
		const x = cx + tick * 14 * unit;
		if (Math.abs(tick) < 2) continue;
		drawDecorSegment({
			alpha: alpha * 0.7,
			color: draw.frame.palette.foreground,
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x,
			y0: cy - (tick % 5 === 0 ? 7 : 4) * unit,
			y1: cy + (tick % 5 === 0 ? 7 : 4) * unit,
		});
	}
}

function drawCropMarks(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const pad = 22 * unit + Math.sin(phase * 2.1) * 3 * unit;
	const left = Math.max(12 * unit, bounds.x0 - pad);
	const top = Math.max(12 * unit, bounds.y0 - pad);
	const right = Math.min(draw.width - 12 * unit, bounds.x1 + pad);
	const bottom = Math.min(draw.height - 12 * unit, bounds.y1 + pad);
	const length = 24 * unit;
	for (const [x, y, sx, sy] of [
		[left, top, -1, -1],
		[right, top, 1, -1],
		[right, bottom, 1, 1],
		[left, bottom, -1, 1],
	] as const) {
		drawDecorSegment({
			alpha: alpha * 0.88,
			color: draw.frame.palette.foreground,
			draw,
			thickness: Math.max(1, unit),
			x0: x + sx * 7 * unit,
			x1: x + sx * length,
			y0: y,
			y1: y,
		});
		drawDecorSegment({
			alpha: alpha * 0.88,
			color: draw.frame.palette.foreground,
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x,
			y0: y + sy * 7 * unit,
			y1: y + sy * length,
		});
	}
	drawDecorCross({
		alpha: alpha * 0.72,
		color: draw.frame.palette.accent,
		draw,
		radius: 8 * unit,
		thickness: Math.max(1, unit),
		x: (left + right) / 2,
		y: top - 10 * unit,
	});
}

function drawReticle(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const radius = Math.min(52 * unit, Math.max(24 * unit, bounds.height * 0.42));
	const x =
		bounds.x1 + radius * 1.5 < draw.width
			? bounds.x1 + radius
			: bounds.x0 - radius;
	const y = Math.max(radius * 1.3, bounds.y0 - radius * 0.2);
	for (let arc = 0; arc < 4; arc += 1) {
		const start = phase * 0.9 + arc * (Math.PI / 2);
		drawDecorRing({
			alpha: alpha * (0.55 + arc * 0.08),
			color:
				arc % 2 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			end: start + Math.PI * 0.31,
			radius: radius * (0.62 + arc * 0.12),
			segments: 7,
			start,
			thickness: Math.max(1, unit * 1.5),
			x,
			y,
		});
	}
	drawDecorCross({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		radius: radius * 0.22,
		thickness: Math.max(1, unit),
		x,
		y,
	});
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		size: 10 * unit,
		text: `LOCK ${String(Math.floor(phase * 17) % 100).padStart(2, "0")}`,
		x: x - radius,
		y: y + radius * 1.35,
	});
}

function drawRadar(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const radius = Math.min(58 * unit, draw.height * 0.14);
	const x =
		bounds.x0 - radius * 1.35 > 0
			? bounds.x0 - radius
			: draw.width - radius * 1.3;
	const y = draw.height - radius * 1.35;
	for (let ring = 1; ring <= 3; ring += 1) {
		drawDecorRing({
			alpha: alpha * (0.24 + ring * 0.14),
			color: draw.frame.palette.secondary,
			draw,
			radius: (radius * ring) / 3,
			segments: 20,
			thickness: Math.max(1, unit),
			x,
			y,
		});
	}
	const angle = phase * 1.8;
	drawDecorSegment({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(1, unit * 1.6),
		x0: x,
		x1: x + Math.cos(angle) * radius,
		y0: y,
		y1: y + Math.sin(angle) * radius,
	});
	for (let dot = 0; dot < 4; dot += 1) {
		const a =
			extendedDecorRandom({ seed: coreSeed(draw), salt: dot + 20 }) *
			Math.PI *
			2;
		const r =
			radius *
			(0.24 +
				extendedDecorRandom({ seed: coreSeed(draw), salt: dot + 30 }) * 0.68);
		drawDecorDot({
			alpha: alpha * (0.45 + 0.45 * Math.sin(phase * 3 + dot)),
			color: draw.frame.palette.foreground,
			draw,
			radius: Math.max(1.5, unit * 2),
			x: x + Math.cos(a) * r,
			y: y + Math.sin(a) * r,
		});
	}
}

function drawProgressRing(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const radius = Math.min(46 * unit, draw.height * 0.12);
	const x =
		bounds.x1 + radius * 1.4 < draw.width ? bounds.x1 + radius : radius * 1.3;
	const y = radius * 1.4;
	const progress = (phase * 0.17) % 1;
	drawDecorRing({
		alpha: alpha * 0.28,
		color: draw.frame.palette.secondary,
		draw,
		radius,
		segments: 24,
		thickness: Math.max(1, unit * 2),
		x,
		y,
	});
	drawDecorRing({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		end: -Math.PI / 2 + progress * Math.PI * 2,
		radius,
		segments: Math.max(3, Math.ceil(progress * 24)),
		start: -Math.PI / 2,
		thickness: Math.max(2, unit * 3.2),
		x,
		y,
	});
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 12 * unit,
		text: `${String(Math.floor(progress * 100)).padStart(2, "0")}%`,
		x,
		y,
	});
}

function drawTimecodeBar(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const left = draw.width * 0.06;
	const top = draw.height * 0.08;
	const width = draw.width * 0.36;
	const height = Math.max(20 * unit, draw.height * 0.055);
	fillDecorRect({
		alpha: alpha * 0.82,
		color: draw.frame.palette.background,
		draw,
		height,
		width,
		x: left,
		y: top,
	});
	drawDecorBox({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		height,
		left,
		thickness: Math.max(1, unit),
		top,
		width,
	});
	const frames = Math.floor(phase * 30);
	const seconds = Math.floor(frames / 30);
	const text = `TC ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frames % 30).padStart(2, "0")}`;
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 11 * unit,
		text,
		x: left + 8 * unit,
		y: top + height / 2,
	});
	fillDecorRect({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		height,
		width: Math.max(3 * unit, ((phase * 43) % 1) * width * 0.12),
		x: left + width - Math.max(4 * unit, width * 0.14),
		y: top,
	});
}

function drawRulerEdge(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const vertical = Math.floor(phase * 0.45) % 2 === 0;
	const offset = (phase * 26 * unit) % (20 * unit);
	const length = vertical ? draw.height : draw.width;
	for (let position = -offset; position < length; position += 10 * unit) {
		const major = Math.round((position + offset) / (10 * unit)) % 5 === 0;
		if (vertical) {
			drawDecorSegment({
				alpha: alpha * (major ? 0.9 : 0.52),
				color: major ? draw.frame.palette.accent : draw.frame.palette.secondary,
				draw,
				thickness: Math.max(1, unit),
				x0: draw.width * 0.04,
				x1: draw.width * 0.04 + (major ? 16 : 8) * unit,
				y0: position,
				y1: position,
			});
		} else {
			drawDecorSegment({
				alpha: alpha * (major ? 0.9 : 0.52),
				color: major ? draw.frame.palette.accent : draw.frame.palette.secondary,
				draw,
				thickness: Math.max(1, unit),
				x0: position,
				x1: position,
				y0: draw.height * 0.94,
				y1: draw.height * 0.94 - (major ? 16 : 8) * unit,
			});
		}
	}
}

function drawDimension(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const y = Math.min(
		draw.height * 0.9,
		bounds.y1 + 28 * unit + Math.sin(phase * 2) * 4 * unit,
	);
	const left = Math.max(draw.width * 0.08, bounds.x0);
	const right = Math.min(draw.width * 0.92, bounds.x1);
	drawDecorSegment({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		thickness: Math.max(1, unit),
		x0: left,
		x1: right,
		y0: y,
		y1: y,
	});
	for (const [x, direction] of [
		[left, 1],
		[right, -1],
	] as const) {
		drawDecorPolygon({
			alpha,
			color: draw.frame.palette.accent,
			draw,
			points: [
				{ x, y },
				{ x: x + direction * 9 * unit, y: y - 5 * unit },
				{ x: x + direction * 9 * unit, y: y + 5 * unit },
			],
			thickness: Math.max(1, unit * 1.4),
		});
	}
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 9 * unit,
		text: `${Math.round(right - left)} PX`,
		x: (left + right) / 2,
		y: y - 10 * unit,
	});
}

function drawIndexNum(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const right = coreSeed(draw) % 2 === 0;
	const x = right ? draw.width * 0.92 : draw.width * 0.08;
	const y = draw.height * 0.16;
	const value = (Math.floor(phase * 2.2) + Math.abs(coreSeed(draw))) % 100;
	drawDecorLabel({
		align: "center",
		alpha: alpha * 0.18,
		color: draw.frame.palette.secondary,
		draw,
		size: 62 * unit,
		text: String(value).padStart(2, "0"),
		x,
		y,
	});
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.accent,
		draw,
		size: 10 * unit,
		text: `INDEX / ${String(value).padStart(2, "0")}`,
		x,
		y: y + 38 * unit,
	});
}

function drawDateStamp(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const width = 126 * unit;
	const height = 34 * unit;
	const x = draw.width - width - draw.width * 0.06;
	const y = draw.height - height - draw.height * 0.07;
	drawDecorBox({
		alpha: alpha * (0.68 + 0.22 * Math.sin(phase * 2.7)),
		color: draw.frame.palette.accent,
		draw,
		height,
		left: x,
		thickness: Math.max(1, unit * 1.7),
		top: y,
		width,
	});
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 11 * unit,
		text: `2026.09.${String(27 + (Math.floor(phase) % 3)).padStart(2, "0")}`,
		x: x + width / 2,
		y: y + height / 2,
	});
}

function drawQrBlock(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const cell = Math.max(2, 5 * unit);
	const side = cell * 9;
	const left = draw.width * 0.07;
	const top = draw.height - side - draw.height * 0.08;
	fillDecorRect({
		alpha: alpha * 0.82,
		color: draw.frame.palette.background,
		draw,
		height: side + cell * 2,
		width: side + cell * 2,
		x: left - cell,
		y: top - cell,
	});
	for (let row = 0; row < 9; row += 1) {
		for (let column = 0; column < 9; column += 1) {
			const finder =
				(row < 3 && column < 3) ||
				(row < 3 && column > 5) ||
				(row > 5 && column < 3);
			const active =
				finder ||
				extendedDecorRandom({ seed, salt: row * 19 + column + 500 }) > 0.52;
			if (!active) continue;
			fillDecorRect({
				alpha,
				color: finder
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
				draw,
				height: cell * 0.82,
				width: cell * 0.82,
				x: left + column * cell,
				y: top + row * cell,
			});
		}
	}
	const scanY = top + ((phase * 0.7) % 1) * side;
	fillDecorCentered({
		alpha: alpha * 0.55,
		color: draw.frame.palette.secondary,
		draw,
		height: Math.max(1, unit * 1.5),
		width: side,
		x: left + side / 2,
		y: scanY,
	});
}

function coreSeed(draw: CoreDecorDraw): number {
	return extendedDecorState(draw).seed;
}
