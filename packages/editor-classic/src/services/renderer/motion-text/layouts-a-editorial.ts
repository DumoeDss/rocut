import { layoutGlyphs } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
	layoutASize,
	layoutAText,
	layoutATextWidth,
	layoutAUnits,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const EDITORIAL_LAYOUTS = new Set([
	"arcTop",
	"corners",
	"gridCells",
	"lowerThird",
	"spiral",
	"staircase",
	"zigzag",
]);

export function drawLayoutsAEditorial(
	options: TypographyLayoutOptions,
): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !EDITORIAL_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "arcTop":
			drawArcTop(options);
			break;
		case "corners":
			drawCorners(options);
			break;
		case "gridCells":
			drawGridCells(options);
			break;
		case "lowerThird":
			drawLowerThird(options);
			break;
		case "spiral":
			drawSpiral(options);
			break;
		case "staircase":
			drawStaircase(options);
			break;
		case "zigzag":
			drawZigzag(options);
			break;
	}
	return true;
}

function drawLowerThird(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.13,
		maxWidthRatio: 0.72,
		text,
		width,
	});
	const right = Math.abs(frame.cut?.seed ?? 0) % 3 === 0;
	const x = right ? width * 0.92 : width * 0.08;
	const y = height * 0.76;
	const textWidth = layoutATextWidth({ maxWidth: width * 0.72, size, text });
	const reveal = 0.35 + frame.progress * 0.65;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		right ? width - (width * 0.08 + textWidth) * reveal : 0,
		y + size * 0.68,
		(width * 0.08 + textWidth) * reveal,
		Math.max(2, size * 0.05),
	);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = right ? "right" : "left";
	setFontSize(size);
	drawText({ text, x, y, maxWidth: width * 0.74, size });
	const labelSize = Math.max(10, size * 0.2);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(labelSize);
	drawText({
		text: `LINE ${String((Math.abs(frame.cut?.seed ?? 0) % 97) + 1).padStart(2, "0")}`,
		x,
		y: y - size * 0.78,
		maxWidth: width * 0.26,
		size: labelSize,
	});
}

function drawCorners(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 2, text: layoutAText(options) });
	const size = Math.min(height * 0.15, width * 0.36);
	const left = Math.abs(frame.cut?.seed ?? 0) % 2 === 0;
	const points = left
		? ([
				[width * 0.09, height * 0.2],
				[width * 0.91, height * 0.78],
			] as const)
		: ([
				[width * 0.91, height * 0.2],
				[width * 0.09, height * 0.78],
			] as const);
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	for (const [index, unit] of units.entries()) {
		ctx.textAlign = (index === 0) === left ? "left" : "right";
		drawText({
			text: unit,
			x: points[index]?.[0] ?? width / 2,
			y: points[index]?.[1] ?? height / 2,
			maxWidth: width * 0.42,
			size: size * (index === 0 ? 1 : 0.78),
		});
	}
	const bendX = width * (0.5 + (frame.progress - 0.5) * 0.12);
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: points[0][0],
		fromY: points[0][1] + size * 0.7,
		thickness: 2,
		toX: bendX,
		toY: height / 2,
	});
	layoutADrawLine({
		color: frame.palette.accent,
		ctx,
		fromX: bendX,
		fromY: height / 2,
		thickness: 3,
		toX: points[1][0],
		toY: points[1][1] - size * 0.7,
	});
}

function drawStaircase(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 5, text: layoutAText(options) });
	const direction = Math.abs(frame.cut?.seed ?? 0) % 2 === 0 ? 1 : -1;
	const baseSize = Math.min(height * 0.16, width * 0.13);
	ctx.textAlign = "left";
	for (const [index, unit] of units.entries()) {
		const size = baseSize * (1 - index * 0.09);
		const x = width * (0.14 + index * 0.13);
		const y = height / 2 + direction * (index - 2) * baseSize * 0.83;
		ctx.fillStyle =
			index === 0 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		drawText({ text: unit, x, y, maxWidth: width * 0.24, size });
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(
			x - baseSize * 0.08,
			y + direction * baseSize * 0.55,
			baseSize * (1.1 + index * 0.2) * (0.45 + frame.progress * 0.55),
			2,
		);
	}
}

function drawZigzag(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const size = Math.min(height * 0.18, (width * 0.78) / glyphs.length);
	const step = (width * 0.78) / glyphs.length;
	const phase = Math.abs(frame.cut?.seed ?? 0) % 2 === 0 ? 1 : -1;
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const x = width * 0.11 + step * (index + 0.5);
		const y = height / 2 + (index % 2 === 0 ? -1 : 1) * phase * height * 0.12;
		ctx.fillStyle =
			index % 3 === 0 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(((index % 2 === 0 ? -1 : 1) * phase * 7 * Math.PI) / 180);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
		if (index > 0) {
			const previousY =
				height / 2 + (index % 2 === 0 ? 1 : -1) * phase * height * 0.12;
			layoutADrawLine({
				alpha: 0.45 + frame.progress * 0.45,
				color: frame.palette.secondary,
				ctx,
				fromX: x - step,
				fromY: previousY + size * 0.7,
				thickness: 2,
				toX: x,
				toY: y + size * 0.7,
			});
		}
	}
}

function drawArcTop(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const radius = Math.min(width * 0.34, height * 0.42);
	const size = Math.min(height * 0.11, (Math.PI * radius) / glyphs.length);
	const span = Math.min(Math.PI * 0.9, glyphs.length * 0.24);
	const centerY = height * 0.62;
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const angle =
			-Math.PI / 2 - span / 2 + (span * (index + 0.5)) / glyphs.length;
		const x = width / 2 + Math.cos(angle) * radius;
		const y = centerY + Math.sin(angle) * radius;
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(size);
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle + Math.PI / 2);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
	}
	for (let tick = 0; tick <= 24; tick += 1) {
		const angle = -Math.PI / 2 - span / 2 + (span * tick) / 24;
		const inner = radius - size * (0.75 + (tick % 4 === 0 ? 0.14 : 0));
		layoutADrawLine({
			alpha: 0.3 + frame.progress * 0.5,
			color: tick % 4 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			fromX: width / 2 + Math.cos(angle) * inner,
			fromY: centerY + Math.sin(angle) * inner,
			thickness: 1.5,
			toX: width / 2 + Math.cos(angle) * (radius - size * 0.56),
			toY: centerY + Math.sin(angle) * (radius - size * 0.56),
		});
	}
}

function drawSpiral(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 18);
	if (glyphs.length === 0) return;
	const direction = Math.abs(frame.cut?.seed ?? 0) % 2 === 0 ? 1 : -1;
	const base = Math.min(width, height) * 0.04;
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const ratio = glyphs.length === 1 ? 0 : index / (glyphs.length - 1);
		const angle = direction * (ratio * Math.PI * 4 + frame.progress * 0.9);
		const radius = base + ratio * Math.min(width, height) * 0.34;
		const size = height * (0.045 + ratio * 0.045);
		const x = width / 2 + Math.cos(angle) * radius;
		const y = height / 2 + Math.sin(angle) * radius * 0.62;
		ctx.fillStyle =
			index % 5 === 0 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle + (direction * Math.PI) / 2);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
	}
}

function drawGridCells(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const columns = Math.ceil(Math.sqrt(glyphs.length * (width / height)));
	const rows = Math.ceil(glyphs.length / columns);
	const cell = Math.min((width * 0.76) / columns, (height * 0.7) / rows);
	const left = width / 2 - (columns * cell) / 2;
	const top = height / 2 - (rows * cell) / 2;
	const active = Math.floor(frame.progress * glyphs.length) % glyphs.length;
	for (let index = 0; index < glyphs.length; index += 1) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const x = left + column * cell;
		const y = top + row * cell;
		layoutADrawFrame({
			alpha: index === active ? 1 : 0.38,
			color: index === active ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: cell,
			left: x,
			thickness: Math.max(1, cell * 0.025),
			top: y,
			width: cell,
		});
		if (index === active) {
			layoutADrawPlate({
				alpha: 0.2,
				color: frame.palette.accent,
				ctx,
				height: cell * 0.88,
				width: cell * 0.88,
				x: x + cell / 2,
				y: y + cell / 2,
			});
		}
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(cell * 0.62);
		drawText({
			text: glyphs[index] ?? "",
			x: x + cell / 2,
			y: y + cell / 2,
			maxWidth: cell * 0.82,
			size: cell * 0.62,
		});
	}
}
