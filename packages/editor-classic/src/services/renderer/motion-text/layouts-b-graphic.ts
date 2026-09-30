import {
	drawDiscBands,
	layoutGlyphs,
	layoutSigned,
	layoutUnit,
} from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
	layoutASize,
	layoutAText,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const GRAPHIC_LAYOUTS = new Set([
	"bubbles",
	"crossBands",
	"flipBoard",
	"keycaps",
	"neon",
	"slotMachine",
	"stickerBomb",
]);

export function drawLayoutsBGraphic(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !GRAPHIC_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "bubbles":
			drawBubbles(options);
			break;
		case "crossBands":
			drawCrossBands(options);
			break;
		case "flipBoard":
			drawFlipBoard(options);
			break;
		case "keycaps":
			drawKeycaps(options);
			break;
		case "neon":
			drawNeon(options);
			break;
		case "slotMachine":
			drawSlotMachine(options);
			break;
		case "stickerBomb":
			drawStickerBomb(options);
			break;
	}
	return true;
}

function drawCrossBands(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.14,
		maxWidthRatio: 0.66,
		text,
		width,
	});
	const angle = 0.16 + Math.sin(frame.progress * Math.PI * 2) * 0.025;
	for (const [index, direction] of [1, -1].entries()) {
		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.rotate(angle * direction);
		layoutADrawPlate({
			alpha: index === 0 ? 0.95 : 0.72,
			color: index === 0 ? frame.palette.accent : frame.palette.foreground,
			ctx,
			height: size * 1.45,
			width: width * 1.35,
			x: 0,
			y: (index - 0.5) * size * 1.3,
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(size * (index === 0 ? 1 : 0.72));
		drawText({
			text: index === 0 ? text : `${text.toUpperCase()} / CROSS BAND`,
			x: (frame.progress - 0.5) * width * (index === 0 ? -0.12 : 0.12),
			y: (index - 0.5) * size * 1.3,
			maxWidth: width * 0.8,
			size: size * (index === 0 ? 1 : 0.72),
		});
		ctx.restore();
	}
}

function drawStickerBomb(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const seed = frame.cut?.seed ?? 0;
	for (let sticker = 0; sticker < 8; sticker += 1) {
		const size = height * (0.035 + layoutUnit(seed, sticker, 41) * 0.055);
		const x = width * (0.08 + layoutUnit(seed, sticker, 42) * 0.84);
		const y = height * (0.1 + layoutUnit(seed, sticker, 43) * 0.8);
		const label =
			sticker % 3 === 0
				? text
				: sticker % 3 === 1
					? "MOTION"
					: `No.${String(sticker + 1).padStart(2, "0")}`;
		const plateWidth = Math.min(
			width * 0.3,
			size * Math.max(3, label.length * 0.72),
		);
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(
			layoutSigned(seed, sticker, 44) * 0.46 +
				frame.progress * (sticker % 2 === 0 ? 0.05 : -0.04),
		);
		layoutADrawPlate({
			alpha: 0.72 + (sticker % 3) * 0.1,
			color:
				sticker % 4 === 0
					? frame.palette.accent
					: sticker % 2 === 0
						? frame.palette.foreground
						: frame.palette.secondary,
			ctx,
			height: size * 1.45,
			width: plateWidth,
			x: 0,
			y: 0,
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(size);
		drawText({ text: label, x: 0, y: 0, maxWidth: plateWidth * 0.88, size });
		ctx.restore();
	}
}

function drawNeon(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.22,
		maxWidthRatio: 0.66,
		text,
		width,
	});
	const pulse = 0.68 + Math.sin(frame.progress * Math.PI * 8) * 0.22;
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	setFontSize(size);
	for (let echo = 5; echo >= 1; echo -= 1) {
		ctx.globalAlpha = baseAlpha * 0.035 * echo * pulse;
		ctx.fillStyle = frame.palette.accent;
		for (const [dx, dy] of [
			[echo, 0],
			[-echo, 0],
			[0, echo],
			[0, -echo],
		]) {
			drawText({
				text,
				x: width / 2 + dx,
				y: height / 2 + dy,
				maxWidth: width * 0.7,
				size,
			});
		}
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.foreground;
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.7, size });
	layoutADrawFrame({
		alpha: pulse,
		color: frame.palette.accent,
		ctx,
		height: size * 1.8,
		left: width / 2 - width * 0.38,
		thickness: Math.max(2, size * 0.025),
		top: height / 2 - size * 0.9,
		width: width * 0.76,
	});
}

function drawKeycaps(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const columns = Math.min(7, glyphs.length);
	const rows = Math.ceil(glyphs.length / columns);
	const cell = Math.min((width * 0.78) / columns, (height * 0.62) / rows);
	const left = width / 2 - (columns * cell) / 2;
	const top = height / 2 - (rows * cell) / 2;
	const active = Math.floor(frame.progress * glyphs.length) % glyphs.length;
	for (let index = 0; index < glyphs.length; index += 1) {
		const x = left + ((index % columns) + 0.5) * cell;
		const y = top + (Math.floor(index / columns) + 0.5) * cell;
		const pressed = index === active;
		layoutADrawPlate({
			color: pressed ? frame.palette.accent : frame.palette.foreground,
			ctx,
			height: cell * (pressed ? 0.72 : 0.8),
			width: cell * 0.82,
			x,
			y: y + (pressed ? cell * 0.06 : 0),
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(cell * 0.48);
		drawText({
			text: glyphs[index] ?? "",
			x,
			y: y + (pressed ? cell * 0.06 : 0),
			maxWidth: cell * 0.6,
			size: cell * 0.48,
		});
	}
}

function drawBubbles(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 14);
	if (glyphs.length === 0) return;
	const seed = frame.cut?.seed ?? 0;
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const radius = height * (0.035 + layoutUnit(seed, index, 51) * 0.07);
		const x = width * (0.1 + layoutUnit(seed, index, 52) * 0.8);
		const baseY = height * (0.15 + layoutUnit(seed, index, 53) * 0.7);
		const y =
			baseY - Math.sin(frame.progress * Math.PI * 2 + index) * height * 0.05;
		drawDiscBands({
			alpha: 0.28 + (index % 3) * 0.18,
			color: index % 4 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			radius,
			x,
			y,
		});
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(radius * 0.9);
		drawText({ text: glyph, x, y, maxWidth: radius * 1.2, size: radius * 0.9 });
	}
}

function drawSlotMachine(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 8);
	if (glyphs.length === 0) return;
	const reelWidth = Math.min(width * 0.1, (width * 0.72) / glyphs.length);
	const reelHeight = height * 0.46;
	const left = width / 2 - (glyphs.length * reelWidth) / 2;
	for (const [index, glyph] of glyphs.entries()) {
		const x = left + index * reelWidth;
		layoutADrawFrame({
			color: index % 3 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: reelHeight,
			left: x,
			thickness: 2,
			top: height / 2 - reelHeight / 2,
			width: reelWidth,
		});
		const offset = (frame.progress * (2 + (index % 3)) + index * 0.13) % 1;
		for (let row = -1; row <= 1; row += 1) {
			const y = height / 2 + (row + offset - 0.5) * reelHeight * 0.52;
			ctx.fillStyle =
				row === 0 ? frame.palette.foreground : frame.palette.secondary;
			ctx.textAlign = "center";
			setFontSize(reelWidth * 0.62);
			drawText({
				text:
					row === 0
						? glyph
						: (glyphs[(index + row + glyphs.length) % glyphs.length] ?? glyph),
				x: x + reelWidth / 2,
				y,
				maxWidth: reelWidth * 0.8,
				size: reelWidth * 0.62,
			});
		}
	}
}

function drawFlipBoard(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 10);
	if (glyphs.length === 0) return;
	const cell = Math.min(height * 0.24, (width * 0.82) / glyphs.length);
	const left = width / 2 - (glyphs.length * cell) / 2;
	const flip = 0.08 + Math.abs(Math.cos(frame.progress * Math.PI * 3.3)) * 0.92;
	for (const [index, glyph] of glyphs.entries()) {
		const x = left + (index + 0.5) * cell;
		const y = height / 2;
		layoutADrawPlate({
			color: frame.palette.foreground,
			ctx,
			height: cell * 1.12,
			width: cell * 0.9,
			x,
			y,
		});
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(1, Math.max(0.08, flip));
		ctx.fillStyle =
			index % 4 === 0 ? frame.palette.accent : frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(cell * 0.68);
		drawText({
			text: glyph,
			x: 0,
			y: 0,
			maxWidth: cell * 0.76,
			size: cell * 0.68,
		});
		ctx.restore();
		layoutADrawLine({
			alpha: 0.6,
			color: frame.palette.secondary,
			ctx,
			fromX: x - cell * 0.45,
			fromY: y,
			thickness: 1,
			toX: x + cell * 0.45,
			toY: y,
		});
	}
}
