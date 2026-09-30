import {
	clamp01,
	drawDiscBands,
	drawRotatedRect,
	estimatedTextWidth,
	layoutGlyphs,
	layoutSigned,
	layoutUnit,
} from "./core-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const GRAPHIC_CORE_LAYOUTS = new Set([
	"condensed",
	"labels",
	"ring",
	"scatter",
	"tile",
	"wave",
]);

export function drawGraphicCoreLayout(
	options: TypographyLayoutOptions,
): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !GRAPHIC_CORE_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "condensed":
			drawCondensed(options);
			break;
		case "labels":
			drawLabels(options);
			break;
		case "ring":
			drawRing(options);
			break;
		case "scatter":
			drawScatter(options);
			break;
		case "tile":
			drawTile(options);
			break;
		case "wave":
			drawWave(options);
			break;
	}
	return true;
}

function drawTile({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text.trim() || "TILE";
	const rowCount = 14;
	const rowHeight = height / rowCount;
	const tileSize = Math.max(9, rowHeight * 0.62);
	const unit = `${text}\u3000`;
	const unitWidth = Math.max(
		tileSize * 2,
		estimatedTextWidth({ text: unit, size: tileSize }),
	);
	const repeated = unit.repeat(Math.ceil((width * 1.8) / unitWidth) + 2);
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "left";
	setFontSize(tileSize);
	for (let row = 0; row <= rowCount; row += 1) {
		const direction = row % 2 === 0 ? -1 : 1;
		const offset =
			((frame.progress * unitWidth * 2.4 * direction + row * unitWidth * 0.37) %
				unitWidth) -
			unitWidth;
		ctx.globalAlpha = baseAlpha * (0.22 + (row % 3) * 0.06);
		ctx.fillStyle =
			row % 4 === 0 ? frame.palette.accent : frame.palette.secondary;
		drawText({
			text: repeated,
			x: offset,
			y: (row + 0.45) * rowHeight,
			maxWidth: width * 2.2,
			size: tileSize,
		});
	}
	ctx.globalAlpha = baseAlpha;
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	const size = Math.max(
		20,
		Math.min(height * 0.22, (width * 0.7) / (glyphCount * 0.62)),
	);
	const textWidth = Math.min(width * 0.74, estimatedTextWidth({ text, size }));
	const reveal = clamp01(frame.enterProgress * 1.4);
	ctx.fillStyle = frame.palette.background;
	ctx.fillRect(
		width / 2 - (textWidth / 2 + size * 0.42) * reveal,
		height / 2 - size * 0.78,
		(textWidth + size * 0.84) * reveal,
		size * 1.56,
	);
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.74, size });
}

function drawScatter({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const characters = layoutGlyphs(cut.text).slice(0, 16);
	if (characters.length === 0) return;
	const seed = cut.seed;
	const baseSize = Math.min(height * 0.24, (width * 0.82) / characters.length);
	const reveal = clamp01(frame.progress * 2.2);
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	for (let copy = 0; copy < 8; copy += 1) {
		const appear = layoutUnit(seed, copy, 11) * 0.55;
		if (reveal < appear) continue;
		const size = height * (0.025 + layoutUnit(seed, copy, 12) * 0.025);
		const top = layoutUnit(seed, copy, 13) < 0.5;
		ctx.fillStyle = frame.palette.secondary;
		ctx.globalAlpha = baseAlpha * 0.55;
		setFontSize(size);
		ctx.save();
		ctx.translate(
			width * (0.1 + layoutUnit(seed, copy, 14) * 0.8),
			height *
				(top
					? 0.1 + layoutUnit(seed, copy, 15) * 0.18
					: 0.72 + layoutUnit(seed, copy, 15) * 0.18),
		);
		ctx.rotate((layoutSigned(seed, copy, 16) * 18 * Math.PI) / 180);
		drawText({ text: cut.text, x: 0, y: 0, maxWidth: width * 0.45, size });
		ctx.restore();
	}
	ctx.globalAlpha = baseAlpha;
	for (const [index, character] of characters.entries()) {
		const scale = 0.62 + layoutUnit(seed, index, 21) * 0.85;
		const size = baseSize * scale;
		const x =
			width * (0.1 + (0.8 * (index + 0.5)) / characters.length) +
			layoutSigned(seed, index, 22) * width * 0.035;
		const y = height / 2 + layoutSigned(seed, index, 23) * height * 0.18;
		ctx.fillStyle =
			layoutUnit(seed, index, 24) < 0.18
				? frame.palette.accent
				: frame.palette.foreground;
		setFontSize(size);
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate((layoutSigned(seed, index, 25) * 24 * Math.PI) / 180);
		drawText({ text: character, x: 0, y: 0, maxWidth: size * 0.9, size });
		ctx.restore();
	}
}

function drawRing({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const characters = [...layoutGlyphs(cut.text), "・"];
	if (characters.length <= 1) return;
	const radius = Math.min(height * 0.32, width * 0.36);
	const centerX = width / 2;
	const centerY = height / 2;
	const count = Math.max(
		characters.length,
		Math.min(36, characters.length * 2),
	);
	const size = Math.min(height * 0.07, (Math.PI * 2 * radius) / (count * 1.3));
	const angleOffset =
		frame.progress * Math.PI * 2 * (cut.seed % 2 === 0 ? 0.32 : -0.32);
	ctx.textAlign = "center";
	for (let tick = 0; tick < 32; tick += 1) {
		const angle = (tick / 32) * Math.PI * 2;
		drawRotatedRect({
			alpha: tick % 4 === 0 ? 0.65 : 0.28,
			color: frame.palette.secondary,
			ctx,
			height: Math.max(1, size * 0.035),
			rotation: angle,
			width: tick % 4 === 0 ? size * 0.36 : size * 0.18,
			x: centerX + Math.cos(angle) * radius * 1.14,
			y: centerY + Math.sin(angle) * radius * 1.14,
		});
	}
	for (let index = 0; index < count; index += 1) {
		const angle = (index / count) * Math.PI * 2 + angleOffset - Math.PI / 2;
		const character = characters[index % characters.length] ?? "・";
		ctx.fillStyle =
			character === "・" ? frame.palette.accent : frame.palette.foreground;
		setFontSize(size);
		ctx.save();
		ctx.translate(
			centerX + Math.cos(angle) * radius,
			centerY + Math.sin(angle) * radius,
		);
		ctx.rotate(angle + Math.PI / 2);
		drawText({ text: character, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
	}
	const centerText = layoutGlyphs(cut.text).join("");
	const centerSize = Math.min(
		height * 0.18,
		(radius * 1.25) / Math.max(1, centerText.length * 0.62),
	);
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(centerSize);
	drawText({
		text: centerText,
		x: centerX,
		y: centerY,
		maxWidth: radius * 1.35,
		size: centerSize,
	});
}

function drawWave({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const characters = layoutGlyphs(frame.cut?.text ?? "").slice(0, 16);
	if (characters.length === 0) return;
	const size = Math.min(height * 0.18, (width * 0.72) / characters.length);
	const step = size * 1.05;
	const center = width / 2 - ((characters.length - 1) * step) / 2;
	const travel = (frame.progress - 0.5) * width * 0.22;
	const phase = frame.progress * Math.PI * 2 * 1.3;
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	for (let trail = 6; trail >= 1; trail -= 1) {
		ctx.globalAlpha = baseAlpha * 0.07 * (7 - trail);
		ctx.fillStyle = frame.palette.secondary;
		for (const [index, character] of characters.entries()) {
			const x = center + index * step - travel + trail * size * 0.14;
			const angle = phase + (x / width) * Math.PI * 3.2;
			const y = height / 2 + Math.sin(angle) * height * 0.13;
			setFontSize(size * (1 - trail * 0.025));
			drawText({
				text: character,
				x,
				y,
				maxWidth: size,
				size: size * (1 - trail * 0.025),
			});
		}
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	for (const [index, character] of characters.entries()) {
		const x = center + index * step - travel;
		const angle = phase + (x / width) * Math.PI * 3.2;
		const y = height / 2 + Math.sin(angle) * height * 0.13;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(Math.atan(Math.cos(angle) * 0.65));
		drawText({ text: character, x: 0, y: 0, maxWidth: size, size });
		ctx.restore();
	}
}

function drawLabels({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const units = layoutGlyphs(cut.text).filter(
		(character) => !/[,.!?。、]/u.test(character),
	);
	if (units.length === 0) units.push(cut.text || "LABEL");
	const count = Math.max(10, units.length);
	const radius = Math.min(height * 0.31, width * 0.36);
	const size = Math.min(height * 0.065, width * 0.05);
	const rotation = frame.progress * Math.PI * 0.7;
	for (let index = 0; index < count; index += 1) {
		const angle = (index / count) * Math.PI * 2 + rotation - Math.PI / 2;
		const label = units[index % units.length] ?? "?";
		const labelWidth = Math.max(
			size * 1.25,
			estimatedTextWidth({ text: label, size }) + size * 0.68,
		);
		const x = width / 2 + Math.cos(angle) * radius;
		const y = height / 2 + Math.sin(angle) * radius;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle + Math.PI / 2);
		ctx.fillStyle = frame.palette.foreground;
		ctx.fillRect(-labelWidth / 2, -size * 0.7, labelWidth, size * 1.4);
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(size);
		drawText({ text: label, x: 0, y: 0, maxWidth: labelWidth * 0.86, size });
		ctx.restore();
	}
	const centerText = layoutGlyphs(cut.text).join("");
	const centerSize = Math.min(
		height * 0.16,
		(radius * 1.1) / Math.max(1, centerText.length * 0.62),
	);
	drawDiscBands({
		alpha: 0.92,
		color: frame.palette.accent,
		ctx,
		radius: radius * 0.43,
		x: width / 2,
		y: height / 2,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(centerSize);
	drawText({
		text: centerText,
		x: width / 2,
		y: height / 2,
		maxWidth: radius * 0.78,
		size: centerSize,
	});
}

function drawCondensed({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = layoutGlyphs(frame.cut?.text ?? "").join("");
	if (!text) return;
	const count = text.length <= 4 ? 3 : text.length <= 7 ? 2 : 1;
	const slot = (width * 0.9) / count;
	const size = Math.min(height * 0.52, slot / Math.max(1, text.length * 0.38));
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	for (let index = 0; index < count; index += 1) {
		const x = width / 2 + (index - (count - 1) / 2) * slot;
		ctx.save();
		ctx.translate(x, height / 2);
		ctx.scale(0.5, 1.2);
		drawText({ text, x: 0, y: 0, maxWidth: slot * 1.7, size });
		ctx.restore();
		if (index === Math.floor(count / 2)) {
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(x - size * 0.04, height * 0.16, size * 0.08, height * 0.68);
			ctx.fillStyle = frame.palette.foreground;
		}
	}
}
