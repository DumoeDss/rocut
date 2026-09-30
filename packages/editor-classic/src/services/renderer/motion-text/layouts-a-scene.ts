import { layoutGlyphs, layoutSigned } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
	layoutASize,
	layoutAText,
	layoutAUnits,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const SCENE_LAYOUTS = new Set([
	"edgeFrame",
	"genkou",
	"hanko",
	"mirror",
	"panels",
	"perspective",
	"sideways",
]);

export function drawLayoutsAScene(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !SCENE_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "edgeFrame":
			drawEdgeFrame(options);
			break;
		case "genkou":
			drawGenkou(options);
			break;
		case "hanko":
			drawHanko(options);
			break;
		case "mirror":
			drawMirror(options);
			break;
		case "panels":
			drawPanels(options);
			break;
		case "perspective":
			drawPerspective(options);
			break;
		case "sideways":
			drawSideways(options);
			break;
	}
	return true;
}

function drawMirror(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.7,
		text,
		width,
	});
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: width / 2,
		y: height * 0.43,
		maxWidth: width * 0.72,
		size,
	});
	ctx.save();
	ctx.translate(width / 2, height * 0.57);
	ctx.scale(1, -0.64);
	ctx.globalAlpha *= 0.2 + frame.progress * 0.28;
	ctx.fillStyle = frame.palette.secondary;
	drawText({ text, x: 0, y: 0, maxWidth: width * 0.72, size });
	ctx.restore();
	const lineWidth = width * (0.2 + frame.progress * 0.45);
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(width / 2 - lineWidth / 2, height / 2, lineWidth, 2);
}

function drawSideways(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const size = Math.min(height * 0.14, width * 0.09);
	const right = Math.abs(frame.cut?.seed ?? 0) % 2 === 1;
	const x = right ? width * 0.76 : width * 0.24;
	ctx.save();
	ctx.translate(x, height / 2);
	ctx.rotate(((right ? 1 : -1) * Math.PI) / 2);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: 0, y: 0, maxWidth: height * 0.72, size });
	ctx.restore();
	const ruleX = right ? width * 0.48 : width * 0.52;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(ruleX, height * 0.12, 3, height * (0.35 + frame.progress * 0.5));
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = right ? "right" : "left";
	setFontSize(Math.max(11, size * 0.22));
	drawText({
		text: "SIDE / TYPE / AXIS",
		x: right ? width * 0.43 : width * 0.57,
		y: height * 0.82,
		maxWidth: width * 0.3,
		size: Math.max(11, size * 0.22),
	});
}

function drawEdgeFrame(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const margin = Math.min(width, height) * 0.075;
	const thickness = Math.max(2, margin * 0.08);
	layoutADrawFrame({
		alpha: 0.42,
		color: frame.palette.secondary,
		ctx,
		height: height - margin * 2,
		left: margin,
		thickness,
		top: margin,
		width: width - margin * 2,
	});
	const marker = (width - margin * 2) * frame.progress;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(margin, margin - thickness, marker, thickness * 3);
	const text = layoutAText(options);
	const size = layoutASize({
		height,
		maxHeightRatio: 0.18,
		maxWidthRatio: 0.62,
		text,
		width,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.66, size });
	const label = Math.max(10, size * 0.18);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(label);
	for (const [index, labelText] of [
		"01",
		"EDGE FRAME",
		"MOTION",
		"04",
	].entries()) {
		const x = index % 2 === 0 ? margin * 1.4 : width - margin * 1.4;
		const y = index < 2 ? margin * 1.45 : height - margin * 1.45;
		ctx.textAlign = index % 2 === 0 ? "left" : "right";
		drawText({ text: labelText, x, y, maxWidth: width * 0.22, size: label });
	}
}

function drawPerspective(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutAText(options);
	const seed = frame.cut?.seed ?? 0;
	for (let layer = 3; layer >= 0; layer -= 1) {
		const ratio = layer / 3;
		const size = height * (0.09 + (1 - ratio) * 0.11);
		const x = width / 2 + layoutSigned(seed, layer, 44) * width * 0.015;
		const y = height * (0.24 + ratio * 0.105);
		ctx.save();
		ctx.translate(x, y);
		ctx.transform(
			1 - ratio * 0.08,
			0,
			-0.38 + frame.progress * 0.18,
			0.7 + ratio * 0.08,
			0,
			0,
		);
		ctx.globalAlpha *= 0.18 + (1 - ratio) * 0.14;
		ctx.fillStyle =
			layer === 0 ? frame.palette.accent : frame.palette.secondary;
		ctx.textAlign = "center";
		setFontSize(size);
		drawText({ text, x: 0, y: 0, maxWidth: width * 0.72, size });
		ctx.restore();
	}
	for (let ray = 0; ray < 7; ray += 1) {
		const x = width * (0.12 + ray * 0.126);
		layoutADrawLine({
			alpha: 0.34,
			color: frame.palette.secondary,
			ctx,
			fromX: width / 2,
			fromY: height * 0.16,
			thickness: 1,
			toX: x,
			toY: height * 0.86,
		});
	}
}

function drawHanko(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 4);
	if (glyphs.length === 0) return;
	const side = Math.min(width, height) * 0.52;
	const x = width / 2;
	const y = height / 2;
	layoutADrawFrame({
		alpha: 0.82,
		color: frame.palette.accent,
		ctx,
		height: side,
		left: x - side / 2,
		thickness: side * 0.045,
		top: y - side / 2,
		width: side,
	});
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(
		layoutSigned(frame.cut?.seed ?? 0, 77) * 0.045 + frame.progress * 0.025,
	);
	ctx.fillStyle = frame.palette.accent;
	ctx.textAlign = "center";
	const size = side * 0.32;
	setFontSize(size);
	for (const [index, glyph] of glyphs.entries()) {
		const column = index % 2;
		const row = Math.floor(index / 2);
		drawText({
			text: glyph,
			x: (column - 0.5) * side * 0.38,
			y: (row - 0.5) * side * 0.38,
			maxWidth: side * 0.34,
			size,
		});
	}
	ctx.restore();
}

function drawGenkou(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutAText(options)).slice(0, 20);
	if (glyphs.length === 0) return;
	const columns = 10;
	const rows = Math.ceil(glyphs.length / columns);
	const cell = Math.min(width * 0.075, height * 0.2);
	const left = width / 2 - (columns * cell) / 2;
	const top = height / 2 - (rows * cell) / 2;
	const cursor = Math.floor(frame.progress * glyphs.length) % glyphs.length;
	for (let index = 0; index < glyphs.length; index += 1) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const x = left + column * cell;
		const y = top + row * cell;
		layoutADrawFrame({
			alpha: index === cursor ? 0.95 : 0.35,
			color: index === cursor ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: cell,
			left: x,
			thickness: 1,
			top: y,
			width: cell,
		});
		layoutADrawLine({
			alpha: 0.18,
			color: frame.palette.secondary,
			ctx,
			fromX: x,
			fromY: y,
			thickness: 1,
			toX: x + cell,
			toY: y + cell,
		});
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(cell * 0.64);
		drawText({
			text: glyphs[index] ?? "",
			x: x + cell / 2,
			y: y + cell / 2,
			maxWidth: cell * 0.8,
			size: cell * 0.64,
		});
	}
}

function drawPanels(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutAUnits({ count: 3, text: layoutAText(options) });
	const gap = width * 0.015;
	const panelWidth = (width * 0.84 - gap * 2) / 3;
	const left = width * 0.08;
	const panelHeight = height * 0.6;
	for (let index = 0; index < 3; index += 1) {
		const x = left + index * (panelWidth + gap);
		const offset =
			Math.sin(frame.progress * Math.PI * 2 + index) * height * 0.025;
		const color =
			index === 1
				? frame.palette.accent
				: index === 2
					? frame.palette.secondary
					: frame.palette.foreground;
		layoutADrawPlate({
			alpha: index === 2 ? 0.36 : 0.9,
			color,
			ctx,
			height: panelHeight,
			width: panelWidth,
			x: x + panelWidth / 2,
			y: height / 2 + offset,
		});
		ctx.fillStyle =
			index === 2 ? frame.palette.foreground : frame.palette.background;
		ctx.textAlign = "center";
		const size = Math.min(height * 0.12, panelWidth * 0.18);
		setFontSize(size);
		drawText({
			text: units[index] ?? units[0] ?? "",
			x: x + panelWidth / 2,
			y: height / 2 + offset,
			maxWidth: panelWidth * 0.76,
			size,
		});
	}
}
