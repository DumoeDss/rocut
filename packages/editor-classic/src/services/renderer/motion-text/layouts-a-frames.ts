import { drawDiscBands, layoutGlyphs } from "./core-layout-utils";
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

const FRAME_LAYOUTS = new Set([
	"bubble",
	"dropCap",
	"frameBox",
	"justified",
	"splitScreen",
	"subtitleBar",
	"ticker",
]);

export function drawLayoutsAFrames(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !FRAME_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "bubble":
			drawBubble(options);
			break;
		case "dropCap":
			drawDropCap(options);
			break;
		case "frameBox":
			drawFrameBox(options);
			break;
		case "justified":
			drawJustified(options);
			break;
		case "splitScreen":
			drawSplitScreen(options);
			break;
		case "subtitleBar":
			drawSubtitleBar(options);
			break;
		case "ticker":
			drawTicker(options);
			break;
	}
	return true;
}

function drawDropCap(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options));
	if (glyphs.length === 0) return;
	const first = glyphs[0] ?? "A";
	const rest = glyphs.slice(1).join("");
	const capSize = height * 0.38;
	const x = width * 0.18;
	ctx.fillStyle = frame.palette.accent;
	ctx.textAlign = "center";
	setFontSize(capSize);
	drawText({
		text: first,
		x,
		y: height / 2,
		maxWidth: width * 0.25,
		size: capSize,
	});
	layoutADrawFrame({
		alpha: 0.35 + frame.progress * 0.5,
		color: frame.palette.secondary,
		ctx,
		height: capSize * 1.05,
		left: x - capSize * 0.38,
		thickness: Math.max(1, capSize * 0.012),
		top: height / 2 - capSize * 0.52,
		width: capSize * 0.76,
	});
	const lines = layoutAUnits({ count: 3, text: rest || first });
	const size = Math.min(height * 0.085, width * 0.06);
	ctx.textAlign = "left";
	for (const [index, line] of lines.entries()) {
		ctx.fillStyle =
			index === 0 ? frame.palette.foreground : frame.palette.secondary;
		setFontSize(size * (index === 0 ? 1 : 0.78));
		drawText({
			text: line,
			x: width * 0.34,
			y: height * (0.36 + index * 0.14),
			maxWidth: width * 0.52,
			size: size * (index === 0 ? 1 : 0.78),
		});
	}
}

function drawJustified(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 4, text: layoutAText(options) });
	const left = width * 0.1;
	const right = width * 0.9;
	const rowGap = height * 0.15;
	for (const [row, unit] of units.entries()) {
		const glyphs = layoutGlyphs(unit);
		const size = Math.min(height * (0.13 - row * 0.008), width * 0.1);
		const y = height / 2 + (row - (units.length - 1) / 2) * rowGap;
		ctx.textAlign = "center";
		ctx.fillStyle = row === 1 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		for (const [index, glyph] of glyphs.entries()) {
			const ratio = glyphs.length === 1 ? 0.5 : index / (glyphs.length - 1);
			drawText({
				text: glyph,
				x: left + (right - left) * ratio,
				y,
				maxWidth: size,
				size,
			});
		}
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(
			left,
			y + size * 0.62,
			(right - left) * (0.45 + frame.progress * 0.55),
			1.5,
		);
	}
}

function drawFrameBox(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.18,
		maxWidthRatio: 0.64,
		text,
		width,
	});
	const frameWidth = width * (0.45 + frame.progress * 0.28);
	const frameHeight = height * 0.48;
	layoutADrawFrame({
		color: frame.palette.foreground,
		ctx,
		height: frameHeight,
		left: width / 2 - frameWidth / 2,
		thickness: Math.max(2, size * 0.035),
		top: height / 2 - frameHeight / 2,
		width: frameWidth,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width / 2 - frameWidth / 2,
		height / 2 - frameHeight / 2,
		frameWidth * 0.18,
		size * 0.08,
	);
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: width / 2,
		y: height / 2,
		maxWidth: frameWidth * 0.82,
		size,
	});
	const label = Math.max(10, size * 0.18);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(label);
	drawText({
		text: "FRAME / MOTION / TEXT",
		x: width / 2,
		y: height / 2 + frameHeight * 0.34,
		maxWidth: frameWidth * 0.7,
		size: label,
	});
}

function drawBubble(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.16,
		maxWidthRatio: 0.58,
		text,
		width,
	});
	const textWidth = layoutATextWidth({ maxWidth: width * 0.58, size, text });
	const plateWidth = textWidth + size * 1.5;
	const plateHeight = size * 1.8;
	const right = Math.abs(frame.cut?.seed ?? 0) % 2 === 1;
	const x = width / 2 + (right ? 1 : -1) * width * 0.08;
	const y = height / 2;
	layoutADrawPlate({
		color: frame.palette.foreground,
		ctx,
		height: plateHeight,
		width: plateWidth,
		x,
		y,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.save();
	ctx.translate(
		x + (right ? plateWidth : -plateWidth) * 0.32,
		y + plateHeight * 0.47,
	);
	ctx.rotate((right ? -1 : 1) * 0.7);
	ctx.fillRect(-size * 0.2, -size * 0.2, size * 0.4, size * 0.8);
	ctx.restore();
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x, y, maxWidth: plateWidth * 0.82, size });
	for (let ring = 0; ring < 3; ring += 1) {
		drawDiscBands({
			alpha: 0.18 + ring * 0.08,
			color: ring === 2 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			radius: size * (0.12 + ring * 0.08) * (0.7 + frame.progress * 0.3),
			x: x + (right ? -1 : 1) * (plateWidth / 2 + size * (0.5 + ring * 0.55)),
			y: y - plateHeight * 0.45 - ring * size * 0.08,
		});
	}
}

function drawSubtitleBar(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.105,
		maxWidthRatio: 0.72,
		text,
		width,
	});
	const barHeight = size * 2.1;
	const y = height * 0.82;
	const reveal = 0.4 + frame.progress * 0.6;
	layoutADrawPlate({
		alpha: 0.94,
		color: frame.palette.background,
		ctx,
		height: barHeight,
		width: width * 0.86 * reveal,
		x: width / 2,
		y,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(width * 0.07, y - barHeight / 2, width * 0.012, barHeight);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: width / 2, y, maxWidth: width * 0.7, size });
	const label = Math.max(10, size * 0.22);
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "right";
	setFontSize(label);
	drawText({
		text: `${(frame.localTime / 120_000).toFixed(2)} / SUBTITLE`,
		x: width * 0.92,
		y: y - barHeight * 0.7,
		maxWidth: width * 0.34,
		size: label,
	});
}

function drawTicker(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options).toUpperCase();
	const size = Math.max(12, height * 0.075);
	const unit = `${text}  ◆  `;
	const unitWidth = Math.max(
		size * 4,
		layoutATextWidth({ maxWidth: width, size, text: unit }),
	);
	const repeated = unit.repeat(Math.ceil((width * 2.5) / unitWidth) + 3);
	const y = height * 0.72;
	layoutADrawPlate({
		color: frame.palette.foreground,
		ctx,
		height: size * 1.75,
		width: width,
		x: width / 2,
		y,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text: repeated,
		x: -unitWidth - ((frame.progress * unitWidth * 5) % unitWidth),
		y,
		maxWidth: width * 3,
		size,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(0, y - size * 1.08, width * frame.progress, size * 0.12);
}

function drawSplitScreen(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 2, text: layoutAText(options) });
	const split = width * (0.42 + frame.progress * 0.16);
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(0, height * 0.2, split, height * 0.6);
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(split, height * 0.2, width - split, height * 0.6);
	const size = Math.min(height * 0.16, width * 0.1);
	ctx.textAlign = "center";
	setFontSize(size);
	ctx.fillStyle = frame.palette.background;
	drawText({
		text: units[0] ?? "",
		x: split / 2,
		y: height / 2,
		maxWidth: split * 0.78,
		size,
	});
	ctx.fillStyle = frame.palette.background;
	drawText({
		text: units[1] ?? units[0] ?? "",
		x: split + (width - split) / 2,
		y: height / 2,
		maxWidth: (width - split) * 0.78,
		size: size * 0.82,
	});
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: split,
		fromY: height * 0.12,
		thickness: 3,
		toX: split,
		toY: height * 0.88,
	});
}
