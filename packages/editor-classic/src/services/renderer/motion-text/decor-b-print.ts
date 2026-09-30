import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorPolyline,
	drawDecorRing,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw } from "./core-decor-types";
import {
	drawDecorCross,
	extendedDecorColor,
	extendedDecorSigned,
	extendedDecorState,
} from "./extended-decor-utils";

const PRINT_DECORS = new Set([
	"indexTabs",
	"paperClip",
	"punchHoles",
	"registration",
	"ruledLines",
	"staple",
	"swatches",
]);

export function drawDecorBPrint(draw: CoreDecorDraw): boolean {
	if (!PRINT_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "swatches":
			drawSwatches(draw);
			break;
		case "ruledLines":
			drawRuledLines(draw);
			break;
		case "registration":
			drawRegistration(draw);
			break;
		case "punchHoles":
			drawPunchHoles(draw);
			break;
		case "staple":
			drawStaple(draw);
			break;
		case "paperClip":
			drawPaperClip(draw);
			break;
		case "indexTabs":
			drawIndexTabs(draw);
			break;
	}
	return true;
}

function drawSwatches(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const cell = Math.max(18 * unit, draw.width * 0.026);
	const left = draw.width * 0.06;
	const top = draw.height * 0.78;
	for (let index = 0; index < 8; index += 1) {
		const pulse = 0.72 + 0.22 * Math.sin(phase * 1.1 + index * 0.7);
		fillDecorRect({
			alpha: alpha * pulse,
			color: extendedDecorColor({ draw, index }),
			draw,
			height: cell,
			width: cell,
			x: left + index * cell * 1.12,
			y: top,
		});
		fillDecorRect({
			alpha: alpha * pulse * 0.42,
			color: extendedDecorColor({ draw, index: index + 1 }),
			draw,
			height: cell * 0.42,
			width: cell,
			x: left + index * cell * 1.12,
			y: top + cell * 1.12,
		});
		drawDecorLabel({
			align: "center",
			alpha,
			color: draw.frame.palette.foreground,
			draw,
			size: 8 * unit,
			text: String(index + 1).padStart(2, "0"),
			x: left + index * cell * 1.12 + cell / 2,
			y: top - 8 * unit,
		});
	}
	const markX = left + cell * 9.35;
	const markY = top + cell * 0.52;
	drawDecorCross({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		radius: cell * 0.52,
		thickness: Math.max(1, unit),
		x: markX,
		y: markY,
	});
	drawDecorRing({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		radius: cell * 0.42,
		segments: 16,
		thickness: Math.max(1, unit),
		x: markX,
		y: markY,
	});
}

function drawRuledLines(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const spacing = Math.max(18 * unit, draw.height * 0.042);
	const offset = (phase * 5 * unit) % spacing;
	const marginX = draw.width * 0.12 + Math.sin(phase * 0.22) * 5 * unit;
	for (let y = -spacing + offset; y < draw.height + spacing; y += spacing) {
		drawDecorSegment({
			alpha: alpha * 0.12,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(0.75, unit),
			x0: draw.width * 0.05,
			x1: draw.width * 0.95,
			y0: y,
			y1: y,
		});
	}
	drawDecorSegment({
		alpha: alpha * 0.22,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(1, unit * 1.2),
		x0: marginX,
		x1: marginX,
		y0: draw.height * 0.04,
		y1: draw.height * 0.96,
	});
}

function drawRegistration(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(38 * unit, draw.height * 0.08);
	const x = seed % 2 === 0 ? draw.width * 0.1 : draw.width * 0.9;
	const y = draw.height * 0.16;
	const settle = 0.5 + 0.5 * Math.sin(phase * 1.35);
	for (let plate = 0; plate < 3; plate += 1) {
		const angle = (plate * Math.PI * 2) / 3 + phase * 0.2;
		const offset = (1 - settle) * 8 * unit;
		const px = x + Math.cos(angle) * offset;
		const py = y + Math.sin(angle) * offset;
		drawDecorRing({
			alpha: alpha * 0.72,
			color: extendedDecorColor({ draw, index: plate }),
			draw,
			radius: radius * (1 - plate * 0.17),
			segments: 22,
			thickness: Math.max(1, unit * 1.5),
			x: px,
			y: py,
		});
		drawDecorCross({
			alpha: alpha * 0.64,
			color: extendedDecorColor({ draw, index: plate }),
			draw,
			radius: radius * 1.15,
			thickness: Math.max(1, unit),
			x: px,
			y: py,
		});
	}
}

function drawPunchHoles(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const x = right ? draw.width * 0.955 : draw.width * 0.045;
	const count = 7;
	for (let index = 0; index < count; index += 1) {
		const y =
			draw.height * (0.1 + (index / (count - 1)) * 0.8) +
			Math.sin(phase * 0.7 + index) * 2 * unit;
		const radius = (7 + (index % 3) * 2) * unit;
		drawDecorDot({
			alpha: alpha * 0.22,
			color: draw.frame.palette.background,
			draw,
			radius,
			x,
			y,
		});
		drawDecorRing({
			alpha: alpha * (0.5 + index * 0.06),
			color:
				index % 2 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius,
			segments: 16,
			thickness: Math.max(1, unit),
			x,
			y,
		});
	}
}

function drawStaple(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 3; index += 1) {
		const x = draw.width * (0.15 + index * 0.34);
		const y = index % 2 === 0 ? draw.height * 0.1 : draw.height * 0.89;
		const width = (34 + index * 5) * unit;
		const height = 8 * unit;
		draw.ctx.save();
		draw.ctx.translate(x, y);
		draw.ctx.rotate(
			extendedDecorSigned({ seed, salt: 2_400 + index }) * 0.18 +
				Math.sin(phase + index) * 0.025,
		);
		drawDecorPolyline({
			alpha,
			color:
				index === 1 ? draw.frame.palette.accent : draw.frame.palette.foreground,
			draw,
			points: [
				{ x: -width / 2, y: height / 2 },
				{ x: -width / 2, y: -height / 2 },
				{ x: width / 2, y: -height / 2 },
				{ x: width / 2, y: height / 2 },
			],
			thickness: Math.max(1, unit * 2.1),
		});
		draw.ctx.restore();
	}
}

function drawPaperClip(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const x = seed % 2 === 0 ? draw.width * 0.12 : draw.width * 0.88;
	const y = draw.height * 0.74;
	const width = 34 * unit;
	const height = 74 * unit;
	draw.ctx.save();
	draw.ctx.translate(x, y);
	draw.ctx.rotate(-0.42 + Math.sin(phase * 0.5) * 0.04);
	const outer = [
		{ x: 0, y: height * 0.5 },
		{ x: -width * 0.5, y: height * 0.34 },
		{ x: -width * 0.5, y: -height * 0.35 },
		{ x: 0, y: -height * 0.5 },
		{ x: width * 0.5, y: -height * 0.34 },
		{ x: width * 0.5, y: height * 0.22 },
		{ x: 0, y: height * 0.36 },
		{ x: -width * 0.25, y: height * 0.2 },
		{ x: -width * 0.25, y: -height * 0.22 },
		{ x: 0, y: -height * 0.31 },
		{ x: width * 0.22, y: -height * 0.18 },
	];
	drawDecorPolyline({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		points: outer,
		progress: 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(phase * 0.8)),
		thickness: Math.max(1, unit * 2),
	});
	draw.ctx.restore();
}

function drawIndexTabs(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const width = Math.max(54 * unit, draw.width * 0.075);
	const height = Math.max(22 * unit, draw.height * 0.045);
	for (let index = 0; index < 6; index += 1) {
		const y =
			draw.height * (0.17 + index * 0.115) +
			Math.sin(phase * 0.55 + index) * 3 * unit;
		const x = right
			? draw.width - width - draw.width * 0.025
			: draw.width * 0.025;
		fillDecorRect({
			alpha: alpha * (0.24 + index * 0.1),
			color: extendedDecorColor({ draw, index }),
			draw,
			height,
			width: width * (0.78 + (index % 3) * 0.11),
			x,
			y,
		});
		drawDecorLabel({
			align: right ? "right" : "left",
			alpha,
			color: draw.frame.palette.foreground,
			draw,
			size: 8 * unit,
			text: `TAB ${String(index + 1).padStart(2, "0")}`,
			x: right ? x + width - 5 * unit : x + 5 * unit,
			y: y + height / 2,
		});
	}
	const markerY = draw.height * (0.17 + ((phase * 0.35) % 6) * 0.115);
	drawDecorSegment({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(2, unit * 2.2),
		x0: right ? draw.width - 8 * unit : 8 * unit,
		x1: right ? draw.width - width : width,
		y0: markerY,
		y1: markerY,
	});
}
