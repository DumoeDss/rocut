import { drawDiscBands, layoutUnit } from "./core-layout-utils";
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

const UI_LAYOUTS = new Set([
	"chat",
	"filmstrip",
	"notification",
	"quote",
	"ruler",
	"searchBar",
	"ticket",
]);

export function drawLayoutsAUi(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !UI_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "chat":
			drawChat(options);
			break;
		case "filmstrip":
			drawFilmstrip(options);
			break;
		case "notification":
			drawNotification(options);
			break;
		case "quote":
			drawQuote(options);
			break;
		case "ruler":
			drawRuler(options);
			break;
		case "searchBar":
			drawSearchBar(options);
			break;
		case "ticket":
			drawTicket(options);
			break;
	}
	return true;
}

function drawFilmstrip(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const top = height * 0.2;
	const stripHeight = height * 0.6;
	layoutADrawFrame({
		color: frame.palette.foreground,
		ctx,
		height: stripHeight,
		left: width * 0.04,
		thickness: Math.max(3, height * 0.012),
		top,
		width: width * 0.92,
	});
	const holeWidth = width * 0.035;
	for (let index = 0; index < 18; index += 1) {
		const x = width * 0.055 + index * width * 0.051;
		ctx.fillStyle =
			index % 5 === Math.floor(frame.progress * 5)
				? frame.palette.accent
				: frame.palette.secondary;
		ctx.fillRect(x, top + height * 0.025, holeWidth, height * 0.035);
		ctx.fillRect(
			x,
			top + stripHeight - height * 0.06,
			holeWidth,
			height * 0.035,
		);
	}
	const units = layoutAUnits({ count: 3, text: layoutAText(options) });
	const frameWidth = width * 0.265;
	for (let index = 0; index < 3; index += 1) {
		const x = width * 0.085 + index * width * 0.29;
		layoutADrawFrame({
			alpha: index === 1 ? 1 : 0.45,
			color: index === 1 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: stripHeight * 0.56,
			left: x,
			thickness: 2,
			top: top + stripHeight * 0.22,
			width: frameWidth,
		});
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		const size = Math.min(height * 0.1, frameWidth * 0.14);
		setFontSize(size);
		drawText({
			text: units[index] ?? units[0] ?? "",
			x: x + frameWidth / 2,
			y: height / 2,
			maxWidth: frameWidth * 0.8,
			size,
		});
	}
}

function drawQuote(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.14,
		maxWidthRatio: 0.58,
		text,
		width,
	});
	const quoteSize = height * 0.52;
	const baseAlpha = ctx.globalAlpha;
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "center";
	ctx.globalAlpha = baseAlpha * (0.16 + frame.progress * 0.2);
	setFontSize(quoteSize);
	drawText({
		text: "“",
		x: width * 0.16,
		y: height * 0.4,
		maxWidth: width * 0.2,
		size: quoteSize,
	});
	drawText({
		text: "”",
		x: width * 0.84,
		y: height * 0.65,
		maxWidth: width * 0.2,
		size: quoteSize,
	});
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.62, size });
	const label = Math.max(11, size * 0.2);
	ctx.fillStyle = frame.palette.accent;
	setFontSize(label);
	drawText({
		text: "— MOTION TEXT / QUOTE",
		x: width / 2,
		y: height / 2 + size * 1.15,
		maxWidth: width * 0.5,
		size: label,
	});
}

function drawRuler(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.62,
		text,
		width,
	});
	const textWidth = layoutATextWidth({ maxWidth: width * 0.62, size, text });
	const left = width / 2 - textWidth / 2;
	const right = width / 2 + textWidth / 2;
	const y = height / 2;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: width / 2, y, maxWidth: width * 0.66, size });
	const rulerY = y + size * 0.9;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(left, rulerY, textWidth * (0.35 + frame.progress * 0.65), 2);
	for (let tick = 0; tick <= 20; tick += 1) {
		const x = left + (textWidth * tick) / 20;
		const tickHeight = tick % 5 === 0 ? size * 0.2 : size * 0.1;
		ctx.fillRect(x, rulerY, 1, tickHeight);
		if (tick % 5 === 0) {
			ctx.fillStyle = frame.palette.accent;
			ctx.textAlign = "center";
			setFontSize(Math.max(9, size * 0.12));
			drawText({
				text: String(tick),
				x,
				y: rulerY + tickHeight + size * 0.16,
				maxWidth: size,
				size: Math.max(9, size * 0.12),
			});
			ctx.fillStyle = frame.palette.secondary;
		}
	}
	layoutADrawLine({
		color: frame.palette.accent,
		ctx,
		fromX: left,
		fromY: y - size * 0.72,
		thickness: 2,
		toX: right,
		toY: y - size * 0.72,
	});
}

function drawSearchBar(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.105,
		maxWidthRatio: 0.54,
		text,
		width,
	});
	const barWidth = width * (0.38 + frame.progress * 0.34);
	const barHeight = size * 2.1;
	const y = height * 0.36;
	layoutADrawFrame({
		color: frame.palette.foreground,
		ctx,
		height: barHeight,
		left: width / 2 - barWidth / 2,
		thickness: Math.max(2, size * 0.04),
		top: y - barHeight / 2,
		width: barWidth,
	});
	drawDiscBands({
		color: frame.palette.accent,
		ctx,
		radius: size * 0.32,
		x: width / 2 - barWidth / 2 + size * 0.72,
		y,
	});
	layoutADrawLine({
		color: frame.palette.foreground,
		ctx,
		fromX: width / 2 - barWidth / 2 + size * 0.92,
		fromY: y + size * 0.22,
		thickness: Math.max(2, size * 0.06),
		toX: width / 2 - barWidth / 2 + size * 1.18,
		toY: y + size * 0.5,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: width / 2 - barWidth / 2 + size * 1.45,
		y,
		maxWidth: barWidth - size * 2,
		size,
	});
	const rows = ["lyrics", "meaning", "official video"];
	for (const [index, suffix] of rows.entries()) {
		const rowY = y + barHeight * (0.95 + index * 0.72);
		ctx.fillStyle =
			index === Math.floor(frame.progress * 3)
				? frame.palette.accent
				: frame.palette.secondary;
		ctx.textAlign = "left";
		setFontSize(size * 0.48);
		drawText({
			text: `${text} ${suffix}`,
			x: width / 2 - barWidth / 2 + size * 0.4,
			y: rowY,
			maxWidth: barWidth * 0.9,
			size: size * 0.48,
		});
	}
}

function drawChat(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 3, text: layoutAText(options) });
	const seed = frame.cut?.seed ?? 0;
	const size = Math.min(height * 0.09, width * 0.055);
	for (let index = 0; index < 3; index += 1) {
		const right = (index + Math.abs(seed)) % 2 === 0;
		const text = units[index] ?? units[0] ?? "…";
		const bubbleWidth = Math.min(
			width * 0.52,
			layoutATextWidth({ maxWidth: width * 0.45, size, text }) + size * 1.5,
		);
		const x = right ? width * 0.68 : width * 0.32;
		const y =
			height *
			(0.31 + index * 0.22 + Math.sin(frame.progress * 4 + index) * 0.008);
		const color = right ? frame.palette.accent : frame.palette.foreground;
		layoutADrawPlate({
			color,
			ctx,
			height: size * 1.75,
			width: bubbleWidth,
			x,
			y,
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(size);
		drawText({ text, x, y, maxWidth: bubbleWidth * 0.82, size });
		ctx.fillStyle = color;
		ctx.save();
		ctx.translate(x + (right ? 1 : -1) * bubbleWidth * 0.42, y + size * 0.76);
		ctx.rotate((right ? -1 : 1) * 0.6);
		ctx.fillRect(-size * 0.12, -size * 0.12, size * 0.24, size * 0.55);
		ctx.restore();
	}
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "right";
	setFontSize(Math.max(9, size * 0.34));
	drawText({
		text: `READ ${(frame.localTime / 120_000).toFixed(1)}s`,
		x: width * 0.92,
		y: height * 0.92,
		maxWidth: width * 0.22,
		size: Math.max(9, size * 0.34),
	});
}

function drawNotification(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const cardWidth = width * 0.62;
	const cardHeight = height * 0.46;
	const x = width / 2;
	const y =
		height / 2 + Math.sin(frame.progress * Math.PI * 2) * height * 0.018;
	layoutADrawPlate({
		alpha: 0.94,
		color: frame.palette.foreground,
		ctx,
		height: cardHeight,
		width: cardWidth,
		x,
		y,
	});
	layoutADrawPlate({
		color: frame.palette.accent,
		ctx,
		height: height * 0.09,
		width: height * 0.09,
		x: x - cardWidth * 0.39,
		y: y - cardHeight * 0.31,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "left";
	setFontSize(height * 0.035);
	drawText({
		text: "LYRICS  •  NOW",
		x: x - cardWidth * 0.29,
		y: y - cardHeight * 0.31,
		maxWidth: cardWidth * 0.5,
		size: height * 0.035,
	});
	const size = layoutASize({
		height,
		maxHeightRatio: 0.11,
		maxWidthRatio: 0.46,
		text,
		width,
	});
	setFontSize(size);
	drawText({
		text,
		x: x - cardWidth * 0.4,
		y: y + cardHeight * 0.12,
		maxWidth: cardWidth * 0.8,
		size,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "right";
	setFontSize(Math.max(10, size * 0.22));
	drawText({
		text: `${(frame.localTime / 120_000).toFixed(2)}s`,
		x: x + cardWidth * 0.42,
		y: y - cardHeight * 0.31,
		maxWidth: cardWidth * 0.2,
		size: Math.max(10, size * 0.22),
	});
}

function drawTicket(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const ticketWidth = width * 0.74;
	const ticketHeight = height * 0.45;
	const x = width / 2;
	const y = height / 2;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(
		((frame.cut?.seed ?? 0) % 9) * 0.009 + (frame.progress - 0.5) * 0.025,
	);
	layoutADrawPlate({
		color: frame.palette.foreground,
		ctx,
		height: ticketHeight,
		width: ticketWidth,
		x: 0,
		y: 0,
	});
	const stubX = ticketWidth * 0.28;
	for (let mark = -7; mark <= 7; mark += 1) {
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(
			stubX - 1,
			mark * ticketHeight * 0.055,
			2,
			ticketHeight * 0.025,
		);
	}
	const size = layoutASize({
		height: ticketHeight,
		maxHeightRatio: 0.32,
		maxWidthRatio: 0.68,
		text,
		width: ticketWidth,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: -ticketWidth * 0.42,
		y: 0,
		maxWidth: ticketWidth * 0.62,
		size,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(Math.max(9, size * 0.18));
	drawText({
		text: "ADMIT ONE",
		x: ticketWidth * 0.36,
		y: 0,
		maxWidth: ticketWidth * 0.16,
		size: Math.max(9, size * 0.18),
	});
	const seed = frame.cut?.seed ?? 0;
	let barX = ticketWidth * 0.32;
	for (let bar = 0; bar < 18; bar += 1) {
		const barWidth = ticketWidth * (0.002 + layoutUnit(seed, bar, 91) * 0.006);
		ctx.fillRect(barX, ticketHeight * 0.22, barWidth, ticketHeight * 0.18);
		barX += barWidth + ticketWidth * 0.004;
	}
	ctx.restore();
}
