import { layoutGlyphs, layoutSigned } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawDisc,
	layoutCDrawRing,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
	layoutCUnits,
} from "./layouts-c-utils";
import {
	layoutDColor,
	layoutDDrawCard,
	layoutDDrawText,
} from "./layouts-d-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const SPATIAL_LAYOUTS = new Set([
	"accordion",
	"blocks",
	"cube",
	"cylinder",
	"flag",
	"flipCards",
	"pendulum",
	"pile",
	"ribbon",
]);

export function drawLayoutsDSpatial(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !SPATIAL_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "accordion":
			drawAccordion(options);
			break;
		case "blocks":
			drawBlocks(options);
			break;
		case "cube":
			drawCube(options);
			break;
		case "cylinder":
			drawCylinder(options);
			break;
		case "flag":
			drawFlag(options);
			break;
		case "flipCards":
			drawFlipCards(options);
			break;
		case "pendulum":
			drawPendulum(options);
			break;
		case "pile":
			drawPile(options);
			break;
		case "ribbon":
			drawRibbon(options);
			break;
	}
	return true;
}

function drawCube(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const side = Math.min(width, height) * 0.38;
	const depth = side * (0.18 + 0.05 * Math.sin(phase));
	const rotation = -0.06 + Math.sin(phase * 0.7) * 0.045;
	ctx.save();
	ctx.translate(width / 2, height / 2 + side * 0.06);
	ctx.rotate(rotation);
	layoutADrawPlate({
		alpha: 0.28,
		color: frame.palette.foreground,
		ctx,
		height: side,
		width: depth,
		x: side / 2 + depth / 2,
		y: depth * 0.42,
	});
	layoutADrawPlate({
		color: frame.palette.secondary,
		ctx,
		height: depth,
		width: side,
		x: depth * 0.42,
		y: -side / 2 - depth / 2,
	});
	layoutADrawPlate({
		color: frame.palette.accent,
		ctx,
		height: side,
		width: side,
		x: 0,
		y: 0,
	});
	layoutADrawFrame({
		alpha: 0.7,
		color: frame.palette.foreground,
		ctx,
		height: side,
		left: -side / 2,
		thickness: Math.max(2, side * 0.018),
		top: -side / 2,
		width: side,
	});
	const size = layoutCSize({
		height: side,
		maxHeightRatio: 0.34,
		maxWidthRatio: 0.72,
		text,
		width: side,
	});
	layoutDDrawText({
		color: frame.palette.background,
		maxWidth: side * 0.78,
		options,
		size,
		text,
		x: 0,
		y: 0,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: side * 0.45,
		options,
		size: Math.max(9, size * 0.24),
		text: `FACE ${String(Math.floor(frame.progress * 4) + 1).padStart(2, "0")}`,
		x: 0,
		y: side * 0.37,
	});
	ctx.restore();
}

function drawCylinder(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const units = layoutCUnits({ count: 10, text: layoutCText(options) });
	const phase = layoutCPhase(options);
	const radius = Math.min(width * 0.38, height * 0.34);
	const centerX = width / 2;
	const centerY = height / 2;
	const bandHeight = Math.min(height * 0.42, radius * 1.18);
	layoutADrawPlate({
		alpha: 0.3,
		color: frame.palette.secondary,
		ctx,
		height: bandHeight,
		width: radius * 2,
		x: centerX,
		y: centerY,
	});
	for (let ring = -1; ring <= 1; ring += 1) {
		layoutCDrawRing({
			alpha: 0.45,
			color: ring === 0 ? frame.palette.accent : frame.palette.secondary,
			innerColor: frame.palette.background,
			options,
			radius: radius * (0.96 - Math.abs(ring) * 0.07),
			thickness: Math.max(2, radius * 0.025),
			x: centerX,
			y: centerY + ring * bandHeight * 0.48,
		});
	}
	const size = Math.max(13, Math.min(radius * 0.2, bandHeight * 0.24));
	for (let index = 0; index < 11; index += 1) {
		const theta = phase * 0.45 + (index / 11) * Math.PI * 2;
		const depth = Math.cos(theta);
		if (depth < -0.24) continue;
		const x = centerX + Math.sin(theta) * radius * 0.84;
		ctx.save();
		ctx.translate(x, centerY);
		ctx.scale(Math.max(0.18, Math.abs(depth)), 1);
		layoutDDrawText({
			alpha: 0.35 + Math.max(0, depth) * 0.65,
			color: depth > 0.25 ? frame.palette.foreground : frame.palette.secondary,
			maxWidth: radius * 0.55,
			options,
			size,
			text: units[index % units.length] ?? textFallback(options),
			x: 0,
			y: 0,
		});
		ctx.restore();
	}
}

function drawFlipCards(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const perRow = Math.min(portrait ? 5 : 8, glyphs.length);
	const rows = Math.ceil(glyphs.length / perRow);
	const cardWidth = Math.min(
		(width * 0.82) / perRow,
		(height * 0.68) / rows / 1.3,
	);
	const cardHeight = cardWidth * 1.3;
	const phase = layoutCPhase(options);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const x = width / 2 + (column - (count - 1) / 2) * cardWidth * 1.12;
		const y = height / 2 + (row - (rows - 1) / 2) * cardHeight * 1.08;
		const flip = Math.cos(phase * 1.2 - index * 0.38);
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(Math.max(0.12, Math.abs(flip)), 1);
		layoutDDrawCard({
			color: flip >= 0 ? frame.palette.background : frame.palette.secondary,
			height: cardHeight,
			options,
			text: flip >= 0 ? glyph : "◆",
			textColor:
				flip >= 0 ? frame.palette.foreground : frame.palette.background,
			textSize: cardWidth * 0.56,
			width: cardWidth,
			x: 0,
			y: 0,
		});
		ctx.restore();
	}
}

function drawAccordion(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const phase = layoutCPhase(options);
	const panelHeight = Math.min(height * 0.54, width * 0.28);
	const panelWidth = Math.min(
		(width * 0.84) / glyphs.length,
		panelHeight * 0.62,
	);
	const totalWidth = panelWidth * glyphs.length;
	for (const [index, glyph] of glyphs.entries()) {
		const fold = 0.34 + 0.66 * Math.abs(Math.cos(phase * 0.5 + index * 0.9));
		const x = width / 2 - totalWidth / 2 + (index + 0.5) * panelWidth;
		const y = height / 2 + Math.sin(phase + index * 0.8) * panelHeight * 0.035;
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(fold, 1);
		layoutADrawPlate({
			color: index % 2 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: panelHeight,
			width: panelWidth * 1.08,
			x: 0,
			y: 0,
		});
		layoutDDrawText({
			color:
				index % 2 === 0 ? frame.palette.background : frame.palette.foreground,
			maxWidth: panelWidth * 0.9,
			options,
			size: Math.min(panelHeight * 0.34, panelWidth * 0.8),
			text: glyph,
			x: 0,
			y: 0,
		});
		ctx.restore();
	}
	layoutADrawLine({
		alpha: 0.7,
		color: frame.palette.foreground,
		ctx,
		fromX: width / 2 - totalWidth / 2,
		fromY: height / 2 + panelHeight * 0.55,
		thickness: Math.max(2, panelHeight * 0.012),
		toX: width / 2 + totalWidth / 2,
		toY: height / 2 + panelHeight * 0.55,
	});
}

function drawFlag(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const units = layoutCUnits({ count: 8, text: layoutCText(options) });
	const phase = layoutCPhase(options);
	const poleX = width * 0.12;
	const top = height * 0.15;
	const bottom = height * 0.86;
	layoutADrawLine({
		color: frame.palette.foreground,
		ctx,
		fromX: poleX,
		fromY: top,
		thickness: Math.max(3, width * 0.007),
		toX: poleX,
		toY: bottom,
	});
	const flagWidth = width * 0.72;
	const flagHeight = Math.min(height * 0.5, width * 0.34);
	const segmentWidth = flagWidth / Math.max(1, units.length);
	const centerY = height * 0.42;
	for (const [index, unit] of units.entries()) {
		const x = poleX + (index + 0.5) * segmentWidth;
		const wave = Math.sin(phase + index * 0.85) * flagHeight * 0.1;
		const nextWave = Math.sin(phase + (index + 1) * 0.85) * flagHeight * 0.1;
		const rotation = Math.atan2(nextWave - wave, segmentWidth);
		ctx.save();
		ctx.translate(x, centerY + wave);
		ctx.rotate(rotation);
		layoutADrawPlate({
			color: index % 2 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: flagHeight,
			width: segmentWidth + 1,
			x: 0,
			y: 0,
		});
		layoutDDrawText({
			color:
				index % 2 === 0 ? frame.palette.background : frame.palette.foreground,
			maxWidth: segmentWidth * 0.82,
			options,
			size: Math.min(segmentWidth * 0.68, flagHeight * 0.22),
			text: unit,
			x: 0,
			y: 0,
		});
		ctx.restore();
	}
	layoutCDrawDisc({
		color: frame.palette.accent,
		options,
		radius: Math.max(4, width * 0.014),
		x: poleX,
		y: top,
	});
}

function drawRibbon(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const units = layoutCUnits({ count: 10, text: layoutCText(options) });
	const phase = layoutCPhase(options);
	const left = width * 0.08;
	const span = width * 0.84;
	const segment = span / units.length;
	const bandHeight = Math.min(height * 0.15, segment * 0.8);
	for (const [index, unit] of units.entries()) {
		const x = left + (index + 0.5) * segment;
		const angle = phase * 0.75 + (index / units.length) * Math.PI * 2;
		const y = height / 2 + Math.sin(angle) * height * 0.13;
		const slope = Math.cos(angle) * 0.22;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(slope);
		layoutADrawPlate({
			color: slope > 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: bandHeight,
			width: segment * 1.08,
			x: 0,
			y: 0,
		});
		layoutDDrawText({
			color: frame.palette.background,
			maxWidth: segment * 0.86,
			options,
			size: Math.min(bandHeight * 0.52, segment * 0.45),
			text: unit,
			x: 0,
			y: 0,
		});
		ctx.restore();
	}
	const tail = Math.sin(phase) * height * 0.04;
	for (const side of [-1, 1]) {
		const x = side < 0 ? left - segment * 0.32 : left + span + segment * 0.32;
		layoutADrawLine({
			alpha: 0.7,
			color: frame.palette.foreground,
			ctx,
			fromX: x,
			fromY: height / 2 + tail,
			thickness: Math.max(2, bandHeight * 0.08),
			toX: x + side * segment * 0.45,
			toY: height / 2 + tail + bandHeight * 0.9,
		});
	}
}

function drawPendulum(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 10);
	if (glyphs.length === 0) return;
	const phase = layoutCPhase(options);
	const top = height * 0.13;
	const span = width * 0.74;
	const radius = Math.min(
		span / Math.max(3, glyphs.length * 2.2),
		height * 0.075,
	);
	const length = Math.min(height * 0.5, radius * 5.2);
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: width / 2 - span / 2,
		fromY: top,
		thickness: Math.max(2, radius * 0.12),
		toX: width / 2 + span / 2,
		toY: top,
	});
	for (const [index, glyph] of glyphs.entries()) {
		const anchorX =
			width / 2 +
			(index - (glyphs.length - 1) / 2) *
				(span / Math.max(1, glyphs.length - 1));
		const angle = Math.sin(phase * 1.1 + index * 0.5) * (0.18 + index * 0.004);
		const bobX = anchorX + Math.sin(angle) * length;
		const bobY = top + Math.cos(angle) * length;
		layoutADrawLine({
			alpha: 0.8,
			color: frame.palette.secondary,
			ctx,
			fromX: anchorX,
			fromY: top,
			thickness: Math.max(1, radius * 0.05),
			toX: bobX,
			toY: bobY,
		});
		layoutCDrawDisc({
			color: layoutDColor({ index, options }),
			options,
			radius,
			x: bobX,
			y: bobY,
		});
		layoutDDrawText({
			color: frame.palette.background,
			maxWidth: radius * 1.5,
			options,
			size: radius * 0.9,
			text: glyph,
			x: bobX,
			y: bobY,
		});
	}
}

function drawPile(options: TypographyLayoutOptions): void {
	const { frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	const cell = Math.min(width * 0.12, height * 0.15);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(Math.sqrt(index));
		const rowStart = row * row;
		const count = row * 2 + 1;
		const column = index - rowStart;
		const x = width / 2 + (column - (count - 1) / 2) * cell * 0.76;
		const y = height * 0.76 - row * cell * 0.7;
		const rotation =
			layoutSigned(seed, index, 811) * 0.34 + Math.sin(phase + index) * 0.045;
		layoutDDrawCard({
			color: index % 4 === 0 ? frame.palette.accent : frame.palette.background,
			frameAlpha: 0.3,
			height: cell * 0.82,
			options,
			rotation,
			text: glyph,
			textColor:
				index % 4 === 0 ? frame.palette.background : frame.palette.foreground,
			textSize: cell * 0.5,
			width: cell * 0.76,
			x,
			y,
		});
	}
	layoutADrawLine({
		alpha: 0.65,
		color: frame.palette.secondary,
		ctx: options.ctx,
		fromX: width * 0.12,
		fromY: height * 0.82,
		thickness: Math.max(2, height * 0.006),
		toX: width * (0.88 + 0.02 * Math.sin(phase)),
		toY: height * 0.82,
	});
}

function drawBlocks(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const perRow = Math.min(portrait ? 4 : 7, glyphs.length);
	const rows = Math.ceil(glyphs.length / perRow);
	const cell = Math.min((width * 0.78) / perRow, (height * 0.62) / rows);
	const depth = cell * 0.14;
	const phase = layoutCPhase(options);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const bounce = Math.abs(Math.sin(phase * 1.15 + index * 0.72));
		const x = width / 2 + (column - (count - 1) / 2) * cell * 1.05;
		const y =
			height / 2 + (row - (rows - 1) / 2) * cell * 1.08 - bounce * cell * 0.08;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(layoutSigned(layoutCSeed(options), index, 821) * 0.035);
		layoutADrawPlate({
			alpha: 0.7,
			color: frame.palette.secondary,
			ctx,
			height: cell * 0.78,
			width: depth,
			x: cell * 0.44,
			y: depth * 0.4,
		});
		layoutADrawPlate({
			alpha: 0.85,
			color: frame.palette.foreground,
			ctx,
			height: depth,
			width: cell * 0.82,
			x: depth * 0.3,
			y: -cell * 0.39,
		});
		layoutDDrawCard({
			color: layoutDColor({ index, options }),
			height: cell * 0.78,
			options,
			text: glyph,
			textColor:
				index % 3 === 2 ? frame.palette.background : frame.palette.foreground,
			textSize: cell * 0.48,
			width: cell * 0.82,
			x: 0,
			y: 0,
		});
		ctx.restore();
	}
}

function textFallback(options: TypographyLayoutOptions): string {
	return layoutGlyphs(layoutCText(options))[0] ?? "A";
}
