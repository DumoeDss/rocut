import { layoutGlyphs, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
	layoutASize,
	layoutAText,
	layoutAUnits,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const MEDIA_LAYOUTS = new Set([
	"circleWords",
	"columnsBig",
	"credits",
	"depthStack",
	"dotMatrix",
	"splitHalves",
	"zoomRepeat",
]);

export function drawLayoutsBMedia(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !MEDIA_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "circleWords":
			drawCircleWords(options);
			break;
		case "columnsBig":
			drawColumnsBig(options);
			break;
		case "credits":
			drawCredits(options);
			break;
		case "depthStack":
			drawDepthStack(options);
			break;
		case "dotMatrix":
			drawDotMatrix(options);
			break;
		case "splitHalves":
			drawSplitHalves(options);
			break;
		case "zoomRepeat":
			drawZoomRepeat(options);
			break;
	}
	return true;
}

function drawCredits(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = [
		"MOTION TEXT",
		...layoutAUnits({ count: 5, text: layoutAText(options) }),
		"ROCut / JIZURA",
		`FRAME ${String(Math.floor(frame.progress * 999)).padStart(3, "0")}`,
	];
	const size = Math.max(12, height * 0.055);
	const travel = (frame.progress * height * 1.25) % (units.length * size * 1.8);
	ctx.textAlign = "center";
	for (const [index, line] of units.entries()) {
		const y = height * 1.05 + index * size * 1.8 - travel;
		if (y < -size || y > height + size) continue;
		ctx.fillStyle =
			index === 0 || index === units.length - 1
				? frame.palette.accent
				: frame.palette.foreground;
		setFontSize(index === 0 ? size * 1.35 : size);
		drawText({
			text: line,
			x: width / 2,
			y,
			maxWidth: width * 0.72,
			size: index === 0 ? size * 1.35 : size,
		});
	}
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(width * 0.18, height * 0.12, width * 0.64, 2);
	ctx.fillRect(width * 0.18, height * 0.88, width * 0.64, 2);
}

function drawZoomRepeat(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const baseSize = layoutASize({
		height,
		maxHeightRatio: 0.13,
		maxWidthRatio: 0.58,
		text,
		width,
	});
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	for (let copy = 6; copy >= 0; copy -= 1) {
		const phase = (copy / 7 + frame.progress * 0.8) % 1;
		const scale = 0.42 + phase * 1.7;
		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.scale(scale, scale);
		ctx.globalAlpha = baseAlpha * (0.06 + (1 - phase) * 0.28);
		ctx.fillStyle =
			copy % 3 === 0 ? frame.palette.accent : frame.palette.secondary;
		setFontSize(baseSize);
		drawText({ text, x: 0, y: 0, maxWidth: width * 0.65, size: baseSize });
		ctx.restore();
	}
	ctx.globalAlpha = baseAlpha;
}

function drawSplitHalves(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.24,
		maxWidthRatio: 0.7,
		text,
		width,
	});
	const gap = (frame.progress - 0.5) * width * 0.18;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, width / 2, height);
	ctx.clip();
	drawText({
		text,
		x: width / 2 - gap,
		y: height / 2,
		maxWidth: width * 0.76,
		size,
	});
	ctx.restore();
	ctx.save();
	ctx.beginPath();
	ctx.rect(width / 2, 0, width / 2, height);
	ctx.clip();
	ctx.fillStyle = frame.palette.accent;
	drawText({
		text,
		x: width / 2 + gap,
		y: height / 2,
		maxWidth: width * 0.76,
		size,
	});
	ctx.restore();
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(width / 2 - 1, height * 0.18, 2, height * 0.64);
}

function drawColumnsBig(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 6);
	if (glyphs.length === 0) return;
	const columnWidth = (width * 0.9) / glyphs.length;
	const left = width * 0.05;
	for (const [index, glyph] of glyphs.entries()) {
		const x = left + (index + 0.5) * columnWidth;
		const y =
			height / 2 +
			Math.sin(frame.progress * Math.PI * 2 + index * 0.65) * height * 0.05;
		layoutADrawFrame({
			alpha: 0.35,
			color: frame.palette.secondary,
			ctx,
			height: height * 0.72,
			left: x - columnWidth / 2,
			thickness: 1,
			top: height * 0.14,
			width: columnWidth,
		});
		ctx.fillStyle =
			index % 3 === 0 ? frame.palette.accent : frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(Math.min(height * 0.5, columnWidth * 0.92));
		drawText({
			text: glyph,
			x,
			y,
			maxWidth: columnWidth * 0.88,
			size: Math.min(height * 0.5, columnWidth * 0.92),
		});
	}
}

function drawCircleWords(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 8, text: layoutAText(options) });
	const radius = Math.min(width, height) * 0.33;
	const size = Math.min(height * 0.07, width * 0.045);
	for (const [index, unit] of units.entries()) {
		const angle = (index / units.length) * Math.PI * 2 + frame.progress * 0.62;
		const x = width / 2 + Math.cos(angle) * radius;
		const y = height / 2 + Math.sin(angle) * radius;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle + Math.PI / 2);
		layoutADrawPlate({
			alpha: 0.82,
			color: index % 3 === 0 ? frame.palette.accent : frame.palette.foreground,
			ctx,
			height: size * 1.55,
			width: Math.max(size * 1.6, unit.length * size * 0.72),
			x: 0,
			y: 0,
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(size);
		drawText({
			text: unit,
			x: 0,
			y: 0,
			maxWidth: size * Math.max(1.4, unit.length),
			size,
		});
		ctx.restore();
	}
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "center";
	setFontSize(size * 0.7);
	drawText({
		text: "CIRCLE WORDS",
		x: width / 2,
		y: height / 2,
		maxWidth: radius,
		size: size * 0.7,
	});
}

function drawDotMatrix(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const columns = 38;
	const rows = 16;
	const dot = Math.min(width * 0.012, height * 0.024);
	const left = width / 2 - (columns * dot * 1.35) / 2;
	const top = height / 2 - (rows * dot * 1.35) / 2;
	const seed = frame.cut?.seed ?? 0;
	const sweep = Math.floor(frame.progress * columns);
	const baseAlpha = ctx.globalAlpha;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const on =
				layoutUnit(seed, row, column, 61) > 0.74 ||
				Math.abs(column - sweep) <= 1;
			if (!on) continue;
			ctx.globalAlpha =
				baseAlpha *
				(column === sweep
					? 0.95
					: 0.18 + layoutUnit(seed, row, column, 62) * 0.36);
			ctx.fillStyle =
				column === sweep ? frame.palette.accent : frame.palette.secondary;
			ctx.fillRect(
				left + column * dot * 1.35,
				top + row * dot * 1.35,
				dot,
				dot,
			);
		}
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	const size = layoutASize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.62,
		text,
		width,
	});
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.66, size });
}

function drawDepthStack(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.18,
		maxWidthRatio: 0.62,
		text,
		width,
	});
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	for (let layer = 9; layer >= 0; layer -= 1) {
		const offset = layer * size * 0.09;
		ctx.globalAlpha = baseAlpha * (0.08 + (9 - layer) * 0.08);
		ctx.fillStyle =
			layer === 0
				? frame.palette.foreground
				: layer % 3 === 0
					? frame.palette.accent
					: frame.palette.secondary;
		setFontSize(size);
		drawText({
			text,
			x: width / 2 + offset * (0.8 + frame.progress * 0.3),
			y: height / 2 - offset * 0.55,
			maxWidth: width * 0.68,
			size,
		});
	}
	ctx.globalAlpha = baseAlpha;
	layoutADrawLine({
		alpha: 0.45,
		color: frame.palette.accent,
		ctx,
		fromX: width * 0.18,
		fromY: height * 0.78,
		thickness: 2,
		toX: width * (0.44 + frame.progress * 0.38),
		toY: height * 0.78,
	});
}
