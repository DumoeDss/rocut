import { layoutGlyphs, layoutSigned, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
	layoutASize,
	layoutAText,
	layoutAUnits,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const TYPE_LAYOUTS = new Set([
	"curtain",
	"equalizer",
	"halfVertical",
	"kanjiFocus",
	"tape",
	"typeSpecimen",
]);

export function drawLayoutsBType(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !TYPE_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "curtain":
			drawCurtain(options);
			break;
		case "equalizer":
			drawEqualizer(options);
			break;
		case "halfVertical":
			drawHalfVertical(options);
			break;
		case "kanjiFocus":
			drawKanjiFocus(options);
			break;
		case "tape":
			drawTape(options);
			break;
		case "typeSpecimen":
			drawTypeSpecimen(options);
			break;
	}
	return true;
}

function drawTypeSpecimen(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const glyphs = layoutGlyphs(text);
	const sizes = [0.2, 0.13, 0.085, 0.055];
	let y = height * 0.2;
	for (const [index, ratio] of sizes.entries()) {
		const size = height * ratio;
		ctx.fillStyle =
			index === 0
				? frame.palette.foreground
				: index === 1
					? frame.palette.accent
					: frame.palette.secondary;
		ctx.textAlign = "left";
		setFontSize(size);
		drawText({
			text:
				index === 0
					? text
					: index === 1
						? glyphs.join(" ")
						: `${text.toUpperCase()} / ${glyphs.length} GLYPHS`,
			x: width * 0.16,
			y,
			maxWidth: width * 0.7,
			size,
		});
		ctx.fillStyle = frame.palette.secondary;
		ctx.textAlign = "right";
		setFontSize(Math.max(9, size * 0.22));
		drawText({
			text: `${Math.round(size)} PX`,
			x: width * 0.9,
			y,
			maxWidth: width * 0.12,
			size: Math.max(9, size * 0.22),
		});
		y += size * (0.92 + frame.progress * 0.12);
	}
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(width * 0.1, height * 0.1, 3, height * 0.78);
}

function drawKanjiFocus(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options));
	if (glyphs.length === 0) return;
	const focus = Math.floor(frame.progress * glyphs.length) % glyphs.length;
	const focusGlyph = glyphs[focus] ?? glyphs[0] ?? "字";
	const size = Math.min(height * 0.58, width * 0.38);
	ctx.fillStyle = frame.palette.accent;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text: focusGlyph,
		x: width / 2,
		y: height / 2,
		maxWidth: width * 0.42,
		size,
	});
	layoutADrawFrame({
		alpha: 0.45,
		color: frame.palette.secondary,
		ctx,
		height: size * 0.92,
		left: width / 2 - size * 0.46,
		thickness: 2,
		top: height / 2 - size * 0.46,
		width: size * 0.92,
	});
	const small = Math.max(11, size * 0.09);
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(small);
	for (const [index, glyph] of glyphs.entries()) {
		const angle = (index / glyphs.length) * Math.PI * 2 - Math.PI / 2;
		drawText({
			text: `${String(index + 1).padStart(2, "0")} ${glyph}`,
			x: width / 2 + Math.cos(angle) * size * 0.72,
			y: height / 2 + Math.sin(angle) * size * 0.58,
			maxWidth: size * 0.28,
			size: small,
		});
	}
}

function drawHalfVertical(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 2, text: layoutAText(options) });
	const horizontal = units[0] ?? "";
	const vertical = layoutGlyphs(units[1] ?? units[0] ?? "");
	const size = layoutASize({
		height,
		maxHeightRatio: 0.16,
		maxWidthRatio: 0.36,
		text: horizontal,
		width,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "right";
	setFontSize(size);
	drawText({
		text: horizontal,
		x: width * 0.47,
		y: height / 2,
		maxWidth: width * 0.36,
		size,
	});
	const verticalSize = Math.min(height * 0.11, width * 0.08);
	ctx.textAlign = "center";
	for (const [index, glyph] of vertical.entries()) {
		ctx.fillStyle =
			index === Math.floor(frame.progress * vertical.length) % vertical.length
				? frame.palette.accent
				: frame.palette.foreground;
		setFontSize(verticalSize);
		drawText({
			text: glyph,
			x: width * 0.62,
			y: height / 2 + (index - (vertical.length - 1) / 2) * verticalSize * 1.05,
			maxWidth: verticalSize,
			size: verticalSize,
		});
	}
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: width * 0.535,
		fromY: height * 0.16,
		thickness: 2,
		toX: width * 0.535,
		toY: height * (0.35 + frame.progress * 0.5),
	});
}

function drawCurtain(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.66,
		text,
		width,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.7, size });
	const strips = 18;
	const stripWidth = width / strips;
	const baseAlpha = ctx.globalAlpha;
	for (let strip = 0; strip < strips; strip += 1) {
		const wave =
			0.5 + 0.5 * Math.sin(frame.progress * Math.PI * 4 + strip * 0.55);
		const stripHeight = height * (0.12 + wave * 0.38);
		ctx.globalAlpha = baseAlpha * (0.2 + wave * 0.48);
		ctx.fillStyle =
			strip % 3 === 0 ? frame.palette.accent : frame.palette.background;
		ctx.fillRect(
			strip * stripWidth,
			strip % 2 === 0 ? 0 : height - stripHeight,
			stripWidth + 1,
			stripHeight,
		);
	}
	ctx.globalAlpha = baseAlpha;
}

function drawEqualizer(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 18);
	if (glyphs.length === 0) return;
	const barWidth = (width * 0.8) / glyphs.length;
	const left = width * 0.1;
	const baseAlpha = ctx.globalAlpha;
	for (const [index, glyph] of glyphs.entries()) {
		const amplitude =
			0.18 +
			Math.abs(Math.sin(frame.progress * Math.PI * 6 + index * 0.74)) * 0.68;
		const barHeight = height * amplitude;
		const x = left + (index + 0.5) * barWidth;
		ctx.globalAlpha = baseAlpha * (0.18 + amplitude * 0.42);
		ctx.fillStyle =
			index % 4 === 0 ? frame.palette.accent : frame.palette.secondary;
		ctx.fillRect(
			x - barWidth * 0.36,
			height / 2 - barHeight / 2,
			barWidth * 0.72,
			barHeight,
		);
		ctx.globalAlpha = baseAlpha;
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(Math.min(height * 0.12, barWidth * 0.68));
		drawText({
			text: glyph,
			x,
			y: height / 2,
			maxWidth: barWidth * 0.74,
			size: Math.min(height * 0.12, barWidth * 0.68),
		});
	}
}

function drawTape(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const seed = frame.cut?.seed ?? 0;
	const size = layoutASize({
		height,
		maxHeightRatio: 0.15,
		maxWidthRatio: 0.62,
		text,
		width,
	});
	for (let strip = 0; strip < 3; strip += 1) {
		const angle =
			layoutSigned(seed, strip, 71) * 0.16 +
			(frame.progress - 0.5) * (strip - 1) * 0.06;
		const y = height / 2 + (strip - 1) * size * 1.05;
		ctx.save();
		ctx.translate(width / 2, y);
		ctx.rotate(angle);
		layoutADrawPlate({
			alpha: 0.62 + strip * 0.14,
			color: strip === 1 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: size * 1.28,
			width: width * (0.58 + layoutUnit(seed, strip, 72) * 0.2),
			x: 0,
			y: 0,
		});
		ctx.fillStyle =
			strip === 1 ? frame.palette.background : frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(size * (strip === 1 ? 1 : 0.68));
		drawText({
			text:
				strip === 1
					? text
					: `${text.toUpperCase()} / ${String(strip + 1).padStart(2, "0")}`,
			x: 0,
			y: 0,
			maxWidth: width * 0.64,
			size: size * (strip === 1 ? 1 : 0.68),
		});
		ctx.restore();
	}
}
