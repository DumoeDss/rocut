import {
	drawDecorLabel,
	drawDecorPolyline,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw, CoreDecorPoint } from "./core-decor-types";
import {
	drawDecorBox,
	drawDecorPolygon,
	drawDecorStar,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorSigned,
	extendedDecorState,
} from "./extended-decor-utils";

const ORNAMENT_DECORS = new Set([
	"bracketsJP",
	"brushStroke",
	"crossOut",
	"heartsStars",
	"highlightMark",
	"romajiLine",
	"scribbleCircle",
	"scribbleUnder",
	"seal",
	"tapePieces",
	"verticalStrip",
	"watermarkKanji",
]);

export function drawExtendedOrnamentDecor(draw: CoreDecorDraw): boolean {
	if (!ORNAMENT_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "bracketsJP":
			drawBracketsJp(draw);
			break;
		case "brushStroke":
			drawBrushStroke(draw);
			break;
		case "crossOut":
			drawCrossOut(draw);
			break;
		case "heartsStars":
			drawHeartsStars(draw);
			break;
		case "highlightMark":
			drawHighlightMark(draw);
			break;
		case "romajiLine":
			drawRomajiLine(draw);
			break;
		case "scribbleCircle":
			drawScribbleCircle(draw);
			break;
		case "scribbleUnder":
			drawScribbleUnder(draw);
			break;
		case "seal":
			drawSeal(draw);
			break;
		case "tapePieces":
			drawTapePieces(draw);
			break;
		case "verticalStrip":
			drawVerticalStrip(draw);
			break;
		case "watermarkKanji":
			drawWatermarkKanji(draw);
			break;
	}
	return true;
}

function drawBrushStroke(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	const width = Math.min(draw.width * 0.9, bounds.width + 120 * unit);
	for (let stroke = 0; stroke < 7; stroke += 1) {
		const height = (4 + stroke * 2.4) * unit;
		const taper = 1 - stroke * 0.055;
		draw.ctx.save();
		draw.ctx.translate(cx, cy + (stroke - 3) * 5 * unit);
		draw.ctx.rotate(-0.055 + Math.sin(phase * 0.55 + stroke) * 0.018);
		fillDecorRect({
			alpha: alpha * (0.09 + (7 - stroke) * 0.025),
			color:
				stroke % 3 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			height,
			width:
				width *
				taper *
				(0.9 + extendedDecorRandom({ seed, salt: stroke + 2_600 }) * 0.1),
			x:
				(-width * taper) / 2 +
				extendedDecorSigned({ seed, salt: stroke + 2_620 }) * 8 * unit,
			y: -height / 2,
		});
		draw.ctx.restore();
	}
}

function drawTapePieces(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const corners = [
		[bounds.x0, bounds.y0],
		[bounds.x1, bounds.y0],
		[bounds.x1, bounds.y1],
		[bounds.x0, bounds.y1],
	] as const;
	for (const [index, [x, y]] of corners.entries()) {
		const width =
			(38 + extendedDecorRandom({ seed, salt: index + 2_700 }) * 28) * unit;
		const height = (10 + (index % 3) * 3) * unit;
		draw.ctx.save();
		draw.ctx.translate(x, y);
		draw.ctx.rotate(
			extendedDecorSigned({ seed, salt: index + 2_720 }) * 0.32 +
				Math.sin(phase + index) * 0.025,
		);
		fillDecorRect({
			alpha: alpha * 0.52,
			color: extendedDecorColor({ draw, index }),
			draw,
			height,
			width,
			x: -width / 2,
			y: -height / 2,
		});
		draw.ctx.restore();
	}
}

function drawScribbleCircle(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	for (let loop = 0; loop < 3; loop += 1) {
		const points = Array.from({ length: 44 }, (_, index) => {
			const angle = (index / 43) * Math.PI * 2;
			const wobble =
				1 +
				extendedDecorSigned({ seed, salt: loop * 100 + index + 2_800 }) *
					0.035 +
				Math.sin(phase * 0.8 + index * 0.7) * 0.01;
			return {
				x:
					cx +
					Math.cos(angle) *
						(bounds.width * 0.58 + 18 * unit + loop * 3 * unit) *
						wobble,
				y:
					cy +
					Math.sin(angle) *
						(bounds.height * 0.76 + 16 * unit + loop * 2 * unit) *
						wobble,
			};
		});
		drawDecorPolyline({
			alpha: alpha * (0.34 + loop * 0.17),
			color:
				loop === 2 ? draw.frame.palette.accent : draw.frame.palette.foreground,
			draw,
			points,
			thickness: Math.max(1, unit * (1.1 + loop * 0.35)),
		});
	}
}

function drawScribbleUnder(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	for (let line = 0; line < 3; line += 1) {
		const y = bounds.y1 + (12 + line * 5) * unit;
		const points = Array.from({ length: 24 }, (_, index) => {
			const progress = index / 23;
			return {
				x: bounds.x0 - 8 * unit + progress * (bounds.width + 16 * unit),
				y:
					y +
					extendedDecorSigned({ seed, salt: line * 50 + index + 3_000 }) *
						2.3 *
						unit +
					Math.sin(phase * 1.1 + index * 0.8) * unit,
			};
		});
		drawDecorPolyline({
			alpha: alpha * (0.42 + line * 0.19),
			color:
				line === 2 ? draw.frame.palette.accent : draw.frame.palette.secondary,
			draw,
			points,
			thickness: Math.max(1, unit * (1.2 + line * 0.4)),
		});
	}
}

function drawCrossOut(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const pad = 9 * unit;
	for (let stroke = 0; stroke < 5; stroke += 1) {
		const reverse = stroke % 2 === 1;
		const yOffset =
			extendedDecorSigned({ seed, salt: stroke + 3_100 }) * 7 * unit;
		drawDecorSegment({
			alpha: alpha * (0.35 + stroke * 0.1),
			color:
				stroke === 4
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			thickness: Math.max(1, unit * (1.2 + (stroke % 3) * 0.5)),
			x0: reverse ? bounds.x1 + pad : bounds.x0 - pad,
			x1: reverse ? bounds.x0 - pad : bounds.x1 + pad,
			y0: bounds.y0 + bounds.height * (0.18 + stroke * 0.16) + yOffset,
			y1:
				bounds.y1 -
				bounds.height * (0.18 + stroke * 0.12) -
				yOffset +
				Math.sin(phase * 1.4 + stroke) * 3 * unit,
		});
	}
	const glyph = Math.floor(phase * 2) % 2 === 0 ? "×" : "REVISE";
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		size: 10 * unit,
		text: glyph,
		x: bounds.x1 + 14 * unit,
		y: bounds.y0 - 10 * unit,
	});
}

function drawHighlightMark(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const bands = 3;
	for (let band = 0; band < bands; band += 1) {
		const y = bounds.y0 + ((band + 0.5) / bands) * bounds.height;
		const height = Math.max(5 * unit, (bounds.height / bands) * 0.54);
		const reveal = 0.66 + 0.34 * Math.sin(phase * 0.7 + band * 1.1);
		draw.ctx.save();
		draw.ctx.translate(bounds.x0 - 10 * unit, y);
		draw.ctx.rotate(extendedDecorSigned({ seed, salt: band + 3_200 }) * 0.035);
		fillDecorRect({
			alpha: alpha * (0.12 + band * 0.045),
			color:
				band === 1 ? draw.frame.palette.accent : draw.frame.palette.secondary,
			draw,
			height,
			width: (bounds.width + 20 * unit) * reveal,
			x: 0,
			y: -height / 2,
		});
		draw.ctx.restore();
	}
}

function drawHeartsStars(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 12; index += 1) {
		const side = index % 2 === 0 ? -1 : 1;
		const x =
			(side < 0 ? bounds.x0 : bounds.x1) +
			side *
				(18 + extendedDecorRandom({ seed, salt: index + 3_300 }) * 50) *
				unit;
		const y =
			bounds.y0 -
			16 * unit +
			extendedDecorRandom({ seed, salt: index + 3_340 }) *
				(bounds.height + 32 * unit) +
			Math.sin(phase * 0.9 + index) * 4 * unit;
		const radius = (4 + (index % 4) * 2.2) * unit;
		if (index % 3 === 0) {
			drawDecorPolygon({
				alpha: alpha * (0.45 + (index % 5) * 0.1),
				color: draw.frame.palette.accent,
				draw,
				points: heartPoints({ radius, x, y }),
				thickness: Math.max(1, unit * 1.2),
			});
		} else {
			drawDecorStar({
				alpha: alpha * (0.38 + (index % 5) * 0.11),
				color: extendedDecorColor({ draw, index }),
				draw,
				innerRadius: radius * 0.42,
				outerRadius: radius,
				rotation: phase * 0.28 + index,
				thickness: Math.max(1, unit),
				x,
				y,
			});
		}
	}
}

function drawWatermarkKanji(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const glyphs = Array.from(draw.frame.cut?.text ?? "").filter((glyph) =>
		glyph.trim(),
	);
	const glyph = glyphs[Math.abs(seed) % Math.max(1, glyphs.length)] ?? "字";
	draw.ctx.save();
	draw.ctx.translate(draw.width * 0.72, draw.height * 0.48);
	draw.ctx.rotate(-0.12 + Math.sin(phase * 0.25) * 0.025);
	drawDecorLabel({
		align: "center",
		alpha: alpha * 0.09,
		color: draw.frame.palette.foreground,
		draw,
		size: Math.min(draw.width, draw.height) * 0.72,
		text: glyph,
		x: 0,
		y: 0,
	});
	draw.ctx.restore();
	drawDecorLabel({
		alpha: alpha * 0.72,
		color: draw.frame.palette.secondary,
		draw,
		size: 9 * unit,
		text: `WATERMARK / ${String(Math.floor(phase * 10) % 100).padStart(2, "0")}`,
		x: draw.width * 0.06,
		y: draw.height * 0.9,
	});
}

function drawVerticalStrip(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const width = Math.max(28 * unit, draw.width * 0.055);
	const x = right
		? draw.width - width - draw.width * 0.045
		: draw.width * 0.045;
	fillDecorRect({
		alpha: alpha * 0.72,
		color: draw.frame.palette.accent,
		draw,
		height: draw.height * 0.76,
		width,
		x,
		y: draw.height * 0.12,
	});
	const glyphs = Array.from(draw.frame.cut?.text ?? "SIGNAL")
		.filter((glyph) => glyph.trim())
		.slice(0, 10);
	for (const [index, glyph] of glyphs.entries()) {
		drawDecorLabel({
			align: "center",
			alpha: alpha * (0.72 + 0.2 * Math.sin(phase + index)),
			color: draw.frame.palette.background,
			draw,
			size: Math.min(16 * unit, width * 0.48),
			text: glyph,
			x: x + width / 2,
			y: draw.height * 0.19 + index * Math.min(24 * unit, draw.height * 0.055),
		});
	}
}

function drawRomajiLine(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const text = (draw.frame.cut?.text ?? "MOTION TEXT")
		.normalize("NFKD")
		.replace(/[^\p{Letter}\p{Number}]+/gu, " ")
		.trim()
		.toUpperCase();
	const y = Math.min(draw.height * 0.92, bounds.y1 + 24 * unit);
	drawDecorSegment({
		alpha: alpha * 0.7,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(1, unit * 1.4),
		x0: bounds.x0,
		x1: bounds.x0 + bounds.width * (0.62 + 0.18 * Math.sin(phase * 0.6)),
		y0: y,
		y1: y,
	});
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		size: 9 * unit,
		text: `ROMAJI / ${text || "SIGNAL"}`,
		x: bounds.x0,
		y: y + 12 * unit,
	});
}

function drawBracketsJp(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const offset = 20 * unit + Math.sin(phase * 1.1) * 4 * unit;
	const size = Math.max(34 * unit, bounds.height * 0.72);
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.accent,
		draw,
		size,
		text: "【",
		x: bounds.x0 - offset,
		y: (bounds.y0 + bounds.y1) / 2,
	});
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.accent,
		draw,
		size,
		text: "】",
		x: bounds.x1 + offset,
		y: (bounds.y0 + bounds.y1) / 2,
	});
	drawDecorSegment({
		alpha: alpha * 0.5,
		color: draw.frame.palette.secondary,
		draw,
		thickness: Math.max(1, unit),
		x0: bounds.x0 - offset,
		x1: bounds.x1 + offset,
		y0: bounds.y1 + 14 * unit,
		y1: bounds.y1 + 14 * unit,
	});
}

function drawSeal(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const side = Math.max(34 * unit, Math.min(draw.width, draw.height) * 0.075);
	const x = seed % 2 === 0 ? draw.width * 0.86 : draw.width * 0.08;
	const y = draw.height * 0.76;
	draw.ctx.save();
	draw.ctx.translate(x, y);
	draw.ctx.rotate(
		extendedDecorSigned({ seed, salt: 3_600 }) * 0.12 +
			Math.sin(phase * 0.45) * 0.015,
	);
	drawDecorBox({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		height: side,
		left: 0,
		thickness: Math.max(2, unit * 2.2),
		top: 0,
		width: side,
	});
	const glyph =
		Array.from(draw.frame.cut?.text ?? "印").find((value) => value.trim()) ??
		"印";
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.accent,
		draw,
		size: side * 0.48,
		text: glyph,
		x: side / 2,
		y: side / 2,
	});
	draw.ctx.restore();
}

function heartPoints({
	radius,
	x,
	y,
}: {
	readonly radius: number;
	readonly x: number;
	readonly y: number;
}): readonly CoreDecorPoint[] {
	return Array.from({ length: 24 }, (_, index) => {
		const angle = (index / 24) * Math.PI * 2;
		const sx = 16 * Math.sin(angle) ** 3;
		const sy =
			13 * Math.cos(angle) -
			5 * Math.cos(angle * 2) -
			2 * Math.cos(angle * 3) -
			Math.cos(angle * 4);
		return { x: x + (sx / 17) * radius, y: y - (sy / 17) * radius };
	});
}
