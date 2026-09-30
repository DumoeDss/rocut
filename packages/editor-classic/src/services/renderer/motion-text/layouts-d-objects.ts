import { layoutGlyphs, layoutSigned, layoutUnit } from "./core-layout-utils";
import { layoutADrawLine } from "./layouts-a-utils";
import {
	layoutCDrawDisc,
	layoutCDrawRing,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
} from "./layouts-c-utils";
import {
	layoutDColor,
	layoutDDrawCard,
	layoutDDrawPanel,
	layoutDDrawSquareDot,
	layoutDDrawText,
} from "./layouts-d-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const OBJECT_LAYOUTS = new Set([
	"balloons",
	"billboard",
	"bulbs",
	"crowdBubbles",
	"ledScroll",
	"magnets",
	"tiles",
]);

export function drawLayoutsDObjects(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !OBJECT_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "balloons":
			drawBalloons(options);
			break;
		case "billboard":
			drawBillboard(options);
			break;
		case "bulbs":
			drawBulbs(options);
			break;
		case "crowdBubbles":
			drawCrowdBubbles(options);
			break;
		case "ledScroll":
			drawLedScroll(options);
			break;
		case "magnets":
			drawMagnets(options);
			break;
		case "tiles":
			drawTiles(options);
			break;
	}
	return true;
}

function drawBalloons(options: TypographyLayoutOptions): void {
	const { frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 12);
	if (glyphs.length === 0) return;
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	const portrait = height > width;
	const perRow = Math.min(portrait ? 4 : 7, glyphs.length);
	const radius = Math.min(width * 0.08, height * 0.105);
	const knotX = width / 2;
	const knotY = height * 0.9;
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const bob = Math.sin(phase * 0.8 + index * 1.7) * radius * 0.12;
		const x =
			width / 2 +
			(column - (count - 1) / 2) * radius * 2.08 +
			layoutSigned(seed, index, 831) * radius * 0.18;
		const y =
			height * 0.42 +
			(row - (Math.ceil(glyphs.length / perRow) - 1) / 2) * radius * 2.05 +
			bob;
		layoutADrawLine({
			alpha: 0.65,
			color: frame.palette.secondary,
			ctx: options.ctx,
			fromX: x,
			fromY: y + radius * 0.92,
			thickness: Math.max(1, radius * 0.035),
			toX: knotX + layoutSigned(seed, index, 832) * radius * 0.25,
			toY: knotY,
		});
		layoutCDrawDisc({
			color: layoutDColor({ index, options }),
			options,
			radius,
			scaleX: 0.82 + 0.06 * Math.sin(phase + index),
			x,
			y,
		});
		layoutDDrawText({
			color:
				index % 3 === 2 ? frame.palette.background : frame.palette.foreground,
			maxWidth: radius * 1.25,
			options,
			size: radius * 0.78,
			text: glyph,
			x,
			y,
		});
	}
	layoutDDrawSquareDot({
		color: frame.palette.accent,
		options,
		size: Math.max(5, radius * 0.18),
		x: knotX,
		y: knotY,
	});
}

function drawMagnets(options: TypographyLayoutOptions): void {
	const { frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const left = width * 0.07;
	const top = height * 0.08;
	const boardWidth = width * 0.86;
	const boardHeight = height * 0.84;
	layoutDDrawPanel({
		color: frame.palette.background,
		height: boardHeight,
		left,
		options,
		top,
		width: boardWidth,
	});
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	const portrait = height > width;
	const perRow = Math.min(portrait ? 5 : 8, glyphs.length);
	const cell = Math.min((boardWidth * 0.76) / perRow, boardHeight * 0.18);
	const rows = Math.ceil(glyphs.length / perRow);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const x = width / 2 + (column - (count - 1) / 2) * cell * 1.02;
		const y = height / 2 + (row - (rows - 1) / 2) * cell * 1.08;
		layoutDDrawCard({
			color: layoutDColor({ index, options }),
			frameAlpha: 0.18,
			height: cell * (0.7 + layoutUnit(seed, index, 842) * 0.18),
			options,
			rotation:
				layoutSigned(seed, index, 841) * 0.18 + Math.sin(phase + index) * 0.025,
			text: glyph,
			textColor:
				index % 3 === 2 ? frame.palette.background : frame.palette.foreground,
			textSize: cell * 0.48,
			width: cell * (0.68 + layoutUnit(seed, index, 843) * 0.18),
			x,
			y,
		});
	}
	for (let index = 0; index < 8; index += 1) {
		const edge = index % 2 === 0;
		const x = edge
			? left + boardWidth * (0.08 + layoutUnit(seed, index, 844) * 0.84)
			: left + boardWidth * (index % 4 === 1 ? 0.08 : 0.92);
		const y = edge
			? top + boardHeight * (index < 4 ? 0.11 : 0.89)
			: top + boardHeight * (0.16 + layoutUnit(seed, index, 845) * 0.68);
		layoutDDrawSquareDot({
			alpha: 0.6,
			color: index % 2 ? frame.palette.accent : frame.palette.secondary,
			options,
			size: cell * (0.16 + 0.04 * Math.sin(phase + index)),
			x,
			y,
		});
	}
}

function drawTiles(options: TypographyLayoutOptions): void {
	const { frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const perRow = Math.min(portrait ? 5 : 9, glyphs.length);
	const rows = Math.ceil(glyphs.length / perRow);
	const tile = Math.min((width * 0.82) / perRow, (height * 0.62) / rows / 1.35);
	const phase = layoutCPhase(options);
	for (let row = 0; row < rows; row += 1) {
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const rackY =
			height / 2 + (row - (rows - 1) / 2) * tile * 1.55 + tile * 0.52;
		layoutADrawLine({
			alpha: 0.85,
			color: frame.palette.secondary,
			ctx: options.ctx,
			fromX: width / 2 - count * tile * 0.56,
			fromY: rackY,
			thickness: Math.max(3, tile * 0.12),
			toX: width / 2 + count * tile * 0.56,
			toY: rackY,
		});
	}
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const x = width / 2 + (column - (count - 1) / 2) * tile * 1.08;
		const y =
			height / 2 +
			(row - (rows - 1) / 2) * tile * 1.55 -
			Math.abs(Math.sin(phase * 1.2 + index * 0.4)) * tile * 0.08;
		layoutDDrawCard({
			color: frame.palette.background,
			height: tile,
			options,
			rotation: Math.sin(phase + index) * 0.018,
			text: glyph,
			textColor: frame.palette.foreground,
			textSize: tile * 0.58,
			width: tile,
			x,
			y,
		});
		layoutDDrawText({
			align: "right",
			color: frame.palette.accent,
			maxWidth: tile * 0.24,
			options,
			size: Math.max(7, tile * 0.13),
			text: String((glyph.codePointAt(0) ?? 0) % 10),
			x: x + tile * 0.35,
			y: y + tile * 0.34,
		});
	}
}

function drawBulbs(options: TypographyLayoutOptions): void {
	const { frame, height, width } = options;
	const text = layoutCText(options);
	const panelWidth = Math.min(width * 0.78, height * 1.45);
	const panelHeight = Math.min(height * 0.48, panelWidth * 0.45);
	const left = width / 2 - panelWidth / 2;
	const top = height / 2 - panelHeight / 2;
	layoutDDrawPanel({
		color: frame.palette.foreground,
		height: panelHeight,
		left,
		options,
		top,
		width: panelWidth,
	});
	const phase = layoutCPhase(options);
	const bulbs = 32;
	for (let index = 0; index < bulbs; index += 1) {
		const perimeter = index / bulbs;
		let x: number;
		let y: number;
		if (perimeter < 0.25) {
			x = left + panelWidth * perimeter * 4;
			y = top;
		} else if (perimeter < 0.5) {
			x = left + panelWidth;
			y = top + panelHeight * (perimeter - 0.25) * 4;
		} else if (perimeter < 0.75) {
			x = left + panelWidth * (1 - (perimeter - 0.5) * 4);
			y = top + panelHeight;
		} else {
			x = left;
			y = top + panelHeight * (1 - (perimeter - 0.75) * 4);
		}
		const lit = 0.35 + 0.65 * Math.max(0, Math.sin(phase * 2 + index * 0.7));
		layoutDDrawSquareDot({
			alpha: lit,
			color: index % 4 === 0 ? frame.palette.accent : frame.palette.background,
			options,
			size: Math.max(4, Math.min(panelWidth, panelHeight) * 0.045),
			x,
			y,
		});
	}
	const size = layoutCSize({
		height: panelHeight,
		maxHeightRatio: 0.28,
		maxWidthRatio: 0.72,
		text,
		width: panelWidth,
	});
	layoutDDrawText({
		color: frame.palette.background,
		maxWidth: panelWidth * 0.76,
		options,
		size,
		text,
		x: width / 2,
		y: height / 2,
	});
}

function drawLedScroll(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const panelWidth = width * 0.9;
	const panelHeight = Math.min(height * 0.36, width * 0.3);
	const left = width / 2 - panelWidth / 2;
	const top = height / 2 - panelHeight / 2;
	layoutDDrawPanel({
		color: frame.palette.foreground,
		height: panelHeight,
		left,
		options,
		top,
		width: panelWidth,
	});
	const phase = layoutCPhase(options);
	const dot = Math.max(3, Math.min(width, height) * 0.006);
	for (let row = 0; row < 6; row += 1) {
		for (let column = 0; column < 38; column += 1) {
			if ((row + column) % 3 !== 0) continue;
			layoutDDrawSquareDot({
				alpha: 0.16 + 0.08 * Math.sin(phase + row + column),
				color: frame.palette.background,
				options,
				size: dot,
				x: left + ((column + 0.5) / 38) * panelWidth,
				y: top + ((row + 0.5) / 6) * panelHeight,
			});
		}
	}
	const size = layoutCSize({
		height: panelHeight,
		maxHeightRatio: 0.32,
		maxWidthRatio: 0.75,
		text,
		width: panelWidth,
	});
	const travel = Math.max(panelWidth * 0.12, size * text.length * 0.18);
	const offset = Math.sin(phase * 0.55) * travel;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left + panelWidth * 0.04, top, panelWidth * 0.92, panelHeight);
	ctx.clip();
	layoutDDrawText({
		color: frame.palette.accent,
		maxWidth: panelWidth * 0.82,
		options,
		size,
		text,
		x: width / 2 + offset,
		y: height / 2,
	});
	ctx.restore();
	layoutDDrawText({
		align: "left",
		color: frame.palette.secondary,
		maxWidth: panelWidth * 0.6,
		options,
		size: Math.max(9, panelHeight * 0.08),
		text: `PLATFORM ${String(Math.floor(frame.progress * 99)).padStart(2, "0")}`,
		x: left + panelWidth * 0.05,
		y: top + panelHeight * 0.82,
	});
}

function drawBillboard(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const boardWidth = width * (height > width ? 0.84 : 0.72);
	const boardHeight = Math.min(height * 0.4, boardWidth * 0.46);
	const left = width / 2 - boardWidth / 2;
	const top = height * 0.14;
	const ground = height * 0.92;
	for (const ratio of [0.22, 0.78]) {
		layoutADrawLine({
			color: frame.palette.secondary,
			ctx,
			fromX: left + boardWidth * ratio,
			fromY: top + boardHeight,
			thickness: Math.max(4, boardWidth * 0.018),
			toX: left + boardWidth * ratio,
			toY: ground,
		});
	}
	layoutADrawLine({
		alpha: 0.5,
		color: frame.palette.secondary,
		ctx,
		fromX: left + boardWidth * 0.22,
		fromY: top + boardHeight * 1.08,
		thickness: Math.max(2, boardWidth * 0.008),
		toX: left + boardWidth * 0.78,
		toY: ground,
	});
	layoutADrawLine({
		alpha: 0.5,
		color: frame.palette.secondary,
		ctx,
		fromX: left + boardWidth * 0.78,
		fromY: top + boardHeight * 1.08,
		thickness: Math.max(2, boardWidth * 0.008),
		toX: left + boardWidth * 0.22,
		toY: ground,
	});
	layoutDDrawPanel({
		color: frame.palette.background,
		height: boardHeight,
		left,
		options,
		top,
		width: boardWidth,
	});
	const phase = layoutCPhase(options);
	for (let lamp = 0; lamp < 4; lamp += 1) {
		const x = left + ((lamp + 0.5) / 4) * boardWidth;
		const beam = boardHeight * (0.3 + 0.22 * Math.sin(phase + lamp));
		layoutADrawLine({
			alpha: 0.22 + 0.18 * Math.sin(phase * 1.4 + lamp),
			color: frame.palette.accent,
			ctx,
			fromX: x,
			fromY: top + boardHeight,
			thickness: Math.max(8, boardWidth * 0.05),
			toX: x + Math.sin(phase + lamp) * boardWidth * 0.1,
			toY: top + boardHeight - beam,
		});
		layoutCDrawDisc({
			color: frame.palette.secondary,
			options,
			radius: Math.max(4, boardWidth * 0.018),
			x,
			y: top + boardHeight * 1.04,
		});
	}
	const text = layoutCText(options);
	const size = layoutCSize({
		height: boardHeight,
		maxHeightRatio: 0.28,
		maxWidthRatio: 0.76,
		text,
		width: boardWidth,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: boardWidth * 0.8,
		options,
		size,
		text,
		x: width / 2,
		y: top + boardHeight * 0.48,
	});
	layoutDDrawText({
		color: frame.palette.accent,
		maxWidth: boardWidth * 0.5,
		options,
		size: Math.max(9, size * 0.24),
		text: "LIVE / TONIGHT / 20:26",
		x: width / 2,
		y: top + boardHeight * 0.78,
	});
}

function drawCrowdBubbles(options: TypographyLayoutOptions): void {
	const { frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	const bigWidth = width * (height > width ? 0.62 : 0.48);
	const bigHeight = Math.min(height * 0.3, bigWidth * 0.5);
	const bigX = width / 2;
	const bigY = height / 2;
	layoutCDrawDisc({
		color: frame.palette.accent,
		options,
		radius: bigHeight * 0.62,
		scaleX: (bigWidth / Math.max(1, bigHeight)) * 0.82,
		x: bigX,
		y: bigY,
	});
	const size = layoutCSize({
		height: bigHeight,
		maxHeightRatio: 0.32,
		maxWidthRatio: 0.78,
		text,
		width: bigWidth,
	});
	layoutDDrawText({
		color: frame.palette.background,
		maxWidth: bigWidth * 0.78,
		options,
		size,
		text,
		x: bigX,
		y: bigY,
	});
	const reactions = ["!", "?", "…", "♪", "♡", "!?", "OK"];
	for (let index = 0; index < 14; index += 1) {
		const angle = (index / 14) * Math.PI * 2 + phase * 0.05;
		const distance =
			Math.min(width, height) * (0.32 + layoutUnit(seed, index, 861) * 0.12);
		const radius =
			Math.min(width, height) * (0.035 + layoutUnit(seed, index, 862) * 0.025);
		const x = bigX + Math.cos(angle) * distance;
		const y = bigY + Math.sin(angle) * distance * 0.7;
		const pulse = 0.72 + 0.28 * Math.sin(phase * 1.7 + index);
		layoutCDrawRing({
			alpha: pulse,
			color: layoutDColor({ index, options }),
			innerColor: frame.palette.background,
			options,
			radius,
			thickness: Math.max(2, radius * 0.16),
			x,
			y,
		});
		layoutDDrawText({
			alpha: pulse,
			color: frame.palette.foreground,
			maxWidth: radius * 1.25,
			options,
			size: radius * 0.62,
			text: reactions[index % reactions.length]!,
			x,
			y,
		});
	}
}
