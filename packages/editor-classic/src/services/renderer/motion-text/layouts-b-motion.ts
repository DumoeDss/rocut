import { layoutGlyphs, layoutSigned, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawLine,
	layoutASize,
	layoutAText,
	layoutAUnits,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const MOTION_LAYOUTS = new Set([
	"bounceLine",
	"elastic",
	"hanging",
	"orbit",
	"rain",
	"tunnel",
	"wordCloud",
]);

export function drawLayoutsBMotion(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !MOTION_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "bounceLine":
			drawBounceLine(options);
			break;
		case "elastic":
			drawElastic(options);
			break;
		case "hanging":
			drawHanging(options);
			break;
		case "orbit":
			drawOrbit(options);
			break;
		case "rain":
			drawRain(options);
			break;
		case "tunnel":
			drawTunnel(options);
			break;
		case "wordCloud":
			drawWordCloud(options);
			break;
	}
	return true;
}

function drawRain(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 18);
	if (glyphs.length === 0) return;
	const seed = frame.cut?.seed ?? 0;
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	for (let column = 0; column < Math.max(12, glyphs.length); column += 1) {
		const x =
			width * (0.05 + (0.9 * (column + 0.5)) / Math.max(12, glyphs.length));
		const speed = 0.65 + layoutUnit(seed, column, 10) * 1.2;
		const progress =
			(frame.progress * speed + layoutUnit(seed, column, 11)) % 1;
		const size = height * (0.045 + layoutUnit(seed, column, 12) * 0.055);
		for (let trail = 0; trail < 4; trail += 1) {
			const y = ((progress - trail * 0.11 + 1) % 1) * height;
			ctx.globalAlpha = baseAlpha * (0.18 + (3 - trail) * 0.16);
			ctx.fillStyle =
				trail === 0 ? frame.palette.accent : frame.palette.secondary;
			setFontSize(size * (1 - trail * 0.06));
			drawText({
				text: glyphs[(column + trail) % glyphs.length] ?? "",
				x,
				y,
				maxWidth: size,
				size: size * (1 - trail * 0.06),
			});
		}
	}
	ctx.globalAlpha = baseAlpha;
}

function drawHanging(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const seed = frame.cut?.seed ?? 0;
	const step = (width * 0.8) / glyphs.length;
	const size = Math.min(height * 0.15, step * 0.86);
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const anchorX = width * 0.1 + step * (index + 0.5);
		const length = height * (0.2 + layoutUnit(seed, index, 21) * 0.32);
		const sway =
			Math.sin(frame.progress * Math.PI * 4 + index * 0.7) * size * 0.22;
		layoutADrawLine({
			color: index % 4 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			fromX: anchorX,
			fromY: 0,
			thickness: Math.max(1, size * 0.018),
			toX: anchorX + sway,
			toY: length,
		});
		ctx.save();
		ctx.translate(anchorX + sway, length + size * 0.35);
		ctx.rotate(
			Math.atan2(sway, length) + Math.sin(frame.progress * 5 + index) * 0.08,
		);
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(size);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
	}
}

function drawOrbit(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 18);
	if (glyphs.length === 0) return;
	const radiusX = Math.min(width * 0.35, height * 0.54);
	const radiusY = radiusX * 0.48;
	const size = Math.min(height * 0.09, (Math.PI * radiusX) / glyphs.length);
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const angle =
			(index / glyphs.length) * Math.PI * 2 + frame.progress * Math.PI * 1.4;
		const depth = (Math.sin(angle) + 1) / 2;
		const x = width / 2 + Math.cos(angle) * radiusX;
		const y = height / 2 + Math.sin(angle) * radiusY;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle + Math.PI / 2);
		ctx.scale(0.7 + depth * 0.55, 0.7 + depth * 0.55);
		ctx.globalAlpha *= 0.35 + depth * 0.65;
		ctx.fillStyle =
			index % 5 === 0 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
	}
}

function drawTunnel(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const baseSize = layoutASize({
		height,
		maxHeightRatio: 0.16,
		maxWidthRatio: 0.62,
		text,
		width,
	});
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	for (let layer = 6; layer >= 0; layer -= 1) {
		const phase = (layer / 7 + frame.progress * 0.72) % 1;
		const scale = 0.22 + phase * 1.25;
		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.scale(scale, scale);
		ctx.rotate((phase - 0.5) * 0.18);
		ctx.globalAlpha = baseAlpha * (0.08 + phase * 0.48);
		ctx.fillStyle =
			layer % 3 === 0 ? frame.palette.accent : frame.palette.secondary;
		setFontSize(baseSize);
		drawText({ text, x: 0, y: 0, maxWidth: width * 0.68, size: baseSize });
		ctx.restore();
	}
	ctx.globalAlpha = baseAlpha;
}

function drawWordCloud(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const source = layoutAText(options);
	const units = [
		...layoutAUnits({ count: 5, text: source }),
		...layoutGlyphs(source).slice(0, 9),
	];
	const seed = frame.cut?.seed ?? 0;
	ctx.textAlign = "center";
	for (const [index, unit] of units.entries()) {
		const size = height * (0.035 + layoutUnit(seed, index, 31) * 0.11);
		const orbit = frame.progress * (index % 2 === 0 ? 0.22 : -0.16);
		const x =
			width * (0.1 + layoutUnit(seed, index, 32) * 0.8) +
			Math.cos(orbit * Math.PI * 2 + index) * width * 0.02;
		const y =
			height * (0.14 + layoutUnit(seed, index, 33) * 0.72) +
			Math.sin(orbit * Math.PI * 2 + index) * height * 0.02;
		ctx.fillStyle =
			index % 6 === 0
				? frame.palette.accent
				: index % 2 === 0
					? frame.palette.foreground
					: frame.palette.secondary;
		setFontSize(size);
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(layoutSigned(seed, index, 34) * 0.22);
		drawText({ text: unit, x: 0, y: 0, maxWidth: width * 0.28, size });
		ctx.restore();
	}
}

function drawBounceLine(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 18);
	if (glyphs.length === 0) return;
	const step = (width * 0.78) / glyphs.length;
	const size = Math.min(height * 0.16, step * 0.88);
	const baseline = height * 0.58;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(width * 0.11, baseline + size * 0.62, width * 0.78, 2);
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const phase = frame.progress * Math.PI * 6 - index * 0.65;
		const lift = Math.max(0, Math.sin(phase)) * height * 0.18;
		const x = width * 0.11 + step * (index + 0.5);
		const y = baseline - lift;
		ctx.fillStyle =
			lift > height * 0.1 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		drawText({ text: glyph, x, y, maxWidth: size, size });
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(x - 1, baseline + size * 0.62, 2, Math.max(2, lift * 0.25));
	}
}

function drawElastic(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const size = Math.min(height * 0.2, (width * 0.72) / glyphs.length);
	const step = (width * 0.72) / glyphs.length;
	ctx.textAlign = "center";
	for (const [index, glyph] of glyphs.entries()) {
		const wave = Math.sin(frame.progress * Math.PI * 4 + index * 0.72);
		const x = width * 0.14 + step * (index + 0.5);
		const y = height / 2 + wave * height * 0.06;
		const scaleX = 0.72 + (wave + 1) * 0.34;
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(scaleX, 1 / Math.sqrt(scaleX));
		ctx.fillStyle =
			index % 4 === 0 ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
		if (index > 0) {
			layoutADrawLine({
				alpha: 0.45,
				color: frame.palette.secondary,
				ctx,
				fromX: x - step,
				fromY:
					height / 2 +
					Math.sin(frame.progress * Math.PI * 4 + (index - 1) * 0.72) *
						height *
						0.06,
				thickness: 2,
				toX: x,
				toY: y,
			});
		}
	}
}
