import { layoutGlyphs, layoutSigned } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawBarcode,
	layoutCDrawDashedLine,
	layoutCDrawDisc,
	layoutCDrawFolio,
	layoutCDrawPaper,
	layoutCDrawPerforation,
	layoutCDrawRing,
	layoutCDrawVerticalGlyphs,
	layoutCDrawWave,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
	layoutCUnits,
} from "./layouts-c-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const MEDIA_LAYOUTS = new Set([
	"bookSpine",
	"calendar",
	"cassette",
	"letterPaper",
	"polaroid",
	"postcard",
	"stampSheet",
	"vinyl",
]);

export function drawLayoutsCMedia(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !MEDIA_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "bookSpine":
			drawBookSpine(options);
			break;
		case "calendar":
			drawCalendar(options);
			break;
		case "cassette":
			drawCassette(options);
			break;
		case "letterPaper":
			drawLetterPaper(options);
			break;
		case "polaroid":
			drawPolaroid(options);
			break;
		case "postcard":
			drawPostcard(options);
			break;
		case "stampSheet":
			drawStampSheet(options);
			break;
		case "vinyl":
			drawVinyl(options);
			break;
	}
	return true;
}

function drawVinyl(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const radius = Math.min(width, height) * (portrait ? 0.36 : 0.4);
	const centerX = width * (portrait ? 0.5 : 0.43);
	const centerY = height / 2;
	const phase = layoutCPhase(options);
	layoutCDrawDisc({
		color: frame.palette.foreground,
		options,
		radius,
		x: centerX,
		y: centerY,
	});
	for (let groove = 1; groove <= 8; groove += 1) {
		layoutCDrawRing({
			alpha: 0.2 + groove * 0.025,
			color: frame.palette.secondary,
			innerColor: frame.palette.foreground,
			options,
			radius: radius * (0.28 + groove * 0.08),
			thickness: Math.max(1, radius * 0.009),
			x: centerX,
			y: centerY,
		});
	}
	layoutCDrawDisc({
		color: frame.palette.accent,
		options,
		radius: radius * 0.27,
		x: centerX,
		y: centerY,
	});
	layoutCDrawDisc({
		color: frame.palette.background,
		options,
		radius: radius * 0.045,
		x: centerX,
		y: centerY,
	});
	ctx.save();
	ctx.translate(centerX, centerY);
	ctx.rotate(phase);
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	const labelSize = Math.max(10, radius * 0.075);
	setFontSize(labelSize);
	drawText({
		text: "SIDE A",
		x: 0,
		y: -radius * 0.1,
		maxWidth: radius * 0.38,
		size: labelSize,
	});
	ctx.fillRect(
		radius * 0.52,
		-Math.max(1, radius * 0.01),
		radius * 0.26,
		Math.max(2, radius * 0.02),
	);
	ctx.restore();
	const textSize = layoutCSize({
		height,
		maxHeightRatio: 0.12,
		maxWidthRatio: portrait ? 0.7 : 0.36,
		text,
		width,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = portrait ? "center" : "left";
	setFontSize(textSize);
	drawText({
		text,
		x: portrait ? width / 2 : width * 0.76,
		y: portrait ? height * 0.9 : height * 0.45,
		maxWidth: portrait ? width * 0.78 : width * 0.38,
		size: textSize,
	});
	if (!portrait) {
		layoutCDrawFolio({
			label: "33⅓ RPM / 01",
			options,
			x: width * 0.92,
			y: height * 0.62,
		});
	}
}

function drawCassette(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const bodyWidth = Math.min(width * 0.78, height * 1.45);
	const bodyHeight = bodyWidth * 0.62;
	const left = width / 2 - bodyWidth / 2;
	const top = height / 2 - bodyHeight / 2;
	layoutADrawPlate({
		alpha: 0.25,
		color: frame.palette.foreground,
		ctx,
		height: bodyHeight,
		width: bodyWidth,
		x: width / 2 + bodyHeight * 0.03,
		y: height / 2 + bodyHeight * 0.04,
	});
	layoutADrawPlate({
		color: frame.palette.background,
		ctx,
		height: bodyHeight,
		width: bodyWidth,
		x: width / 2,
		y: height / 2,
	});
	layoutADrawFrame({
		color: frame.palette.foreground,
		ctx,
		height: bodyHeight,
		left,
		thickness: Math.max(3, bodyHeight * 0.025),
		top,
		width: bodyWidth,
	});
	const windowLeft = left + bodyWidth * 0.14;
	const windowTop = top + bodyHeight * 0.25;
	const windowWidth = bodyWidth * 0.72;
	const windowHeight = bodyHeight * 0.38;
	layoutADrawPlate({
		color: frame.palette.secondary,
		ctx,
		height: windowHeight,
		width: windowWidth,
		x: width / 2,
		y: windowTop + windowHeight / 2,
	});
	const reelRadius = windowHeight * 0.28;
	const reelGap = windowWidth * 0.3;
	for (const direction of [-1, 1]) {
		const x = width / 2 + direction * reelGap;
		layoutCDrawRing({
			color: frame.palette.background,
			innerColor: frame.palette.secondary,
			options,
			radius: reelRadius,
			thickness: reelRadius * 0.22,
			x,
			y: windowTop + windowHeight / 2,
		});
		for (let spoke = 0; spoke < 6; spoke += 1) {
			const angle =
				layoutCPhase(options) * direction + (spoke / 6) * Math.PI * 2;
			layoutADrawLine({
				color: frame.palette.background,
				ctx,
				fromX: x + Math.cos(angle) * reelRadius * 0.18,
				fromY:
					windowTop + windowHeight / 2 + Math.sin(angle) * reelRadius * 0.18,
				thickness: Math.max(1, reelRadius * 0.08),
				toX: x + Math.cos(angle) * reelRadius * 0.75,
				toY: windowTop + windowHeight / 2 + Math.sin(angle) * reelRadius * 0.75,
			});
		}
	}
	const labelSize = Math.max(10, bodyHeight * 0.07);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(labelSize);
	drawText({
		text: "A  /  60  /  NORMAL POSITION",
		x: width / 2,
		y: top + bodyHeight * 0.12,
		maxWidth: bodyWidth * 0.72,
		size: labelSize,
	});
	const size = layoutCSize({
		height: bodyHeight,
		maxHeightRatio: 0.12,
		maxWidthRatio: 0.64,
		text,
		width: bodyWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: width / 2,
		y: top + bodyHeight * 0.76,
		maxWidth: bodyWidth * 0.72,
		size,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		windowLeft,
		top + bodyHeight * 0.88,
		windowWidth * (0.16 + frame.progress * 0.84),
		Math.max(3, bodyHeight * 0.018),
	);
}

function drawBookSpine(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const count = portrait ? 5 : 8;
	const shelfTop = height * 0.16;
	const shelfBottom = height * 0.86;
	const spineWidth = (width * 0.82) / count;
	const left = width * 0.09;
	const hero = Math.floor(frame.progress * count) % count;
	for (let index = 0; index < count; index += 1) {
		const x = left + index * spineWidth;
		const offset = index === hero ? -height * 0.08 : 0;
		const color =
			index === hero
				? frame.palette.accent
				: index % 2 === 0
					? frame.palette.foreground
					: frame.palette.secondary;
		ctx.fillStyle = color;
		ctx.fillRect(
			x + spineWidth * 0.05,
			shelfTop + offset,
			spineWidth * 0.9,
			shelfBottom - shelfTop - offset,
		);
		ctx.fillStyle =
			index === hero ? frame.palette.background : frame.palette.background;
		ctx.fillRect(
			x + spineWidth * 0.12,
			shelfTop + offset + spineWidth * 0.22,
			spineWidth * 0.76,
			Math.max(2, spineWidth * 0.08),
		);
		const glyphs =
			index === hero
				? layoutGlyphs(text).slice(0, 10)
				: layoutGlyphs(`VOL${index + 1}`);
		layoutCDrawVerticalGlyphs({
			alpha: index === hero ? 1 : 0.7,
			color: frame.palette.background,
			fontSize: Math.min(
				spineWidth * 0.42,
				(height * 0.48) / Math.max(1, glyphs.length),
			),
			glyphs,
			options,
			x: x + spineWidth / 2,
			y: shelfTop + offset + spineWidth * 0.65,
		});
	}
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		width * 0.05,
		shelfBottom,
		width * 0.9,
		Math.max(5, height * 0.02),
	);
	layoutCDrawFolio({
		label: "LIBRARY / COLLECTION",
		options,
		x: width * 0.93,
		y: height * 0.94,
	});
}

function drawPolaroid(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const cardWidth = Math.min(width * 0.62, height * 0.62);
	const cardHeight = cardWidth * 1.2;
	const rotation =
		layoutSigned(layoutCSeed(options), 501) * 0.09 +
		Math.sin(layoutCPhase(options)) * 0.025;
	ctx.save();
	ctx.translate(width / 2, height / 2);
	ctx.rotate(rotation);
	layoutCDrawPaper({
		color: frame.palette.background,
		height: cardHeight,
		left: -cardWidth / 2,
		options,
		top: -cardHeight / 2,
		width: cardWidth,
	});
	const margin = cardWidth * 0.075;
	const photoHeight = cardWidth * 0.76;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(
		-cardWidth / 2 + margin,
		-cardHeight / 2 + margin,
		cardWidth - margin * 2,
		photoHeight,
	);
	layoutCDrawDisc({
		alpha: 0.84,
		color: frame.palette.accent,
		options,
		radius: photoHeight * (0.18 + frame.progress * 0.025),
		x: cardWidth * 0.16,
		y: -cardHeight / 2 + margin + photoHeight * 0.38,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		-cardWidth / 2 + margin,
		-cardHeight / 2 + margin + photoHeight * 0.76,
		cardWidth - margin * 2,
		photoHeight * 0.24,
	);
	const size = layoutCSize({
		height: cardHeight,
		maxHeightRatio: 0.08,
		maxWidthRatio: 0.72,
		text,
		width: cardWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text,
		x: 0,
		y: cardHeight * 0.37,
		maxWidth: cardWidth * 0.78,
		size,
	});
	ctx.restore();
	layoutCDrawFolio({
		label: "INSTANT / 01",
		options,
		x: width * 0.9,
		y: height * 0.9,
	});
}

function drawStampSheet(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const columns = portrait ? 4 : 7;
	const rows = portrait ? 6 : 4;
	const cell = Math.min((width * 0.82) / columns, (height * 0.76) / rows);
	const left = width / 2 - (columns * cell) / 2;
	const top = height / 2 - (rows * cell) / 2;
	const heroColumn = Math.min(
		columns - 2,
		Math.floor(frame.progress * Math.max(1, columns - 1)),
	);
	const heroRow = Math.min(
		rows - 2,
		Math.floor(frame.progress * Math.max(1, rows - 1)),
	);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x = left + column * cell;
			const y = top + row * cell;
			const hero =
				column >= heroColumn &&
				column < heroColumn + 2 &&
				row >= heroRow &&
				row < heroRow + 2;
			if (hero) continue;
			ctx.fillStyle =
				(column + row) % 3 === 0
					? frame.palette.accent
					: (column + row) % 2 === 0
						? frame.palette.secondary
						: frame.palette.foreground;
			ctx.fillRect(x + cell * 0.1, y + cell * 0.1, cell * 0.8, cell * 0.8);
			layoutCDrawPerforation({
				alpha: 0.7,
				color: frame.palette.background,
				height: cell,
				left: x,
				options,
				step: Math.max(4, cell * 0.13),
				top: y,
				width: cell,
			});
		}
	}
	const heroLeft = left + heroColumn * cell;
	const heroTop = top + heroRow * cell;
	ctx.save();
	ctx.translate(heroLeft + cell, heroTop + cell);
	ctx.rotate(Math.sin(layoutCPhase(options)) * 0.035);
	ctx.translate(-heroLeft - cell, -heroTop - cell);
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		heroLeft + cell * 0.08,
		heroTop + cell * 0.08,
		cell * 1.84,
		cell * 1.84,
	);
	layoutCDrawPerforation({
		color: frame.palette.background,
		height: cell * 2,
		left: heroLeft,
		options,
		step: Math.max(5, cell * 0.14),
		top: heroTop,
		width: cell * 2,
	});
	const size = layoutCSize({
		height: cell * 2,
		maxHeightRatio: 0.24,
		maxWidthRatio: 0.72,
		text,
		width: cell * 2,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text,
		x: heroLeft + cell,
		y: heroTop + cell,
		maxWidth: cell * 1.6,
		size,
	});
	ctx.restore();
}

function drawPostcard(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const cardWidth = portrait ? width * 0.82 : width * 0.68;
	const cardHeight = portrait ? cardWidth * 1.38 : cardWidth * 0.68;
	const rotation = Math.sin(layoutCPhase(options)) * 0.025;
	ctx.save();
	ctx.translate(width / 2, height / 2);
	ctx.rotate(rotation);
	const left = -cardWidth / 2;
	const top = -cardHeight / 2;
	layoutCDrawPaper({
		color: frame.palette.background,
		height: cardHeight,
		left,
		options,
		top,
		width: cardWidth,
	});
	const stampSize = Math.min(cardWidth, cardHeight) * 0.2;
	const stampLeft = left + cardWidth * 0.07;
	const stampTop = top + cardHeight * 0.08;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(stampLeft, stampTop, stampSize, stampSize * 1.15);
	layoutCDrawPerforation({
		color: frame.palette.background,
		height: stampSize * 1.15,
		left: stampLeft,
		options,
		step: Math.max(3, stampSize * 0.12),
		top: stampTop,
		width: stampSize,
	});
	layoutCDrawDisc({
		color: frame.palette.background,
		options,
		radius: stampSize * 0.26,
		x: stampLeft + stampSize / 2,
		y: stampTop + stampSize * 0.63,
	});
	const boxSize = Math.min(cardWidth, cardHeight) * 0.055;
	for (let index = 0; index < 7; index += 1) {
		layoutADrawFrame({
			color: frame.palette.accent,
			ctx,
			height: boxSize * 1.2,
			left: left + cardWidth - cardWidth * 0.07 - (7 - index) * boxSize * 1.3,
			thickness: Math.max(1, boxSize * 0.06),
			top: stampTop,
			width: boxSize,
		});
	}
	const lineTop = top + cardHeight * 0.44;
	for (let line = 0; line < 4; line += 1) {
		layoutCDrawDashedLine({
			alpha: 0.42,
			color: frame.palette.foreground,
			dashes: 28,
			fromX: left + cardWidth * 0.08,
			fromY: lineTop + line * cardHeight * 0.12,
			options,
			thickness: Math.max(1, cardHeight * 0.004),
			toX: left + cardWidth * 0.92,
			toY: lineTop + line * cardHeight * 0.12,
		});
	}
	const size = layoutCSize({
		height: cardHeight,
		maxHeightRatio: 0.13,
		maxWidthRatio: 0.72,
		text,
		width: cardWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: left + cardWidth * 0.1,
		y: lineTop + cardHeight * 0.16,
		maxWidth: cardWidth * 0.78,
		size,
	});
	const postmarkX = stampLeft + stampSize * 1.05;
	const postmarkY = stampTop + stampSize * 0.62;
	layoutCDrawRing({
		alpha: 0.72,
		color: frame.palette.foreground,
		innerColor: frame.palette.background,
		options,
		radius: stampSize * 0.62,
		thickness: Math.max(2, stampSize * 0.05),
		x: postmarkX,
		y: postmarkY,
	});
	for (let line = 0; line < 3; line += 1) {
		layoutCDrawWave({
			alpha: 0.66,
			amplitude: stampSize * 0.07,
			color: frame.palette.foreground,
			cycles: 2,
			fromX: postmarkX + stampSize * 0.55,
			options,
			phase: layoutCPhase(options),
			thickness: Math.max(1, stampSize * 0.035),
			toX: postmarkX + stampSize * 1.8,
			y: postmarkY + (line - 1) * stampSize * 0.22,
		});
	}
	ctx.restore();
}

function drawLetterPaper(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const paperWidth = portrait ? width * 0.86 : width * 0.76;
	const paperHeight = portrait ? height * 0.76 : height * 0.82;
	const left = width / 2 - paperWidth / 2;
	const top = height / 2 - paperHeight / 2;
	layoutCDrawPaper({
		color: frame.palette.background,
		height: paperHeight,
		left,
		options,
		top,
		width: paperWidth,
	});
	const margin = paperWidth * 0.09;
	const lineGap = Math.max(18, paperHeight * 0.085);
	const lineCount = Math.floor((paperHeight * 0.7) / lineGap);
	for (let line = 0; line <= lineCount; line += 1) {
		layoutADrawLine({
			alpha: 0.46,
			color: frame.palette.accent,
			ctx,
			fromX: left + margin,
			fromY: top + paperHeight * 0.18 + line * lineGap,
			thickness: Math.max(1, lineGap * 0.035),
			toX: left + paperWidth - margin,
			toY: top + paperHeight * 0.18 + line * lineGap,
		});
	}
	for (const fold of [1 / 3, 2 / 3]) {
		layoutCDrawDashedLine({
			alpha: 0.24,
			color: frame.palette.secondary,
			dashes: 30,
			fromX: left,
			fromY: top + paperHeight * fold,
			options,
			thickness: 1,
			toX: left + paperWidth,
			toY: top + paperHeight * fold,
		});
	}
	const units = layoutCUnits({
		count: Math.min(3, Math.max(1, Math.ceil(layoutGlyphs(text).length / 8))),
		text,
	});
	const size = Math.min(
		lineGap * 0.72,
		(paperWidth * 0.76) /
			Math.max(
				1,
				Math.max(...units.map((unit) => layoutGlyphs(unit).length)) * 0.62,
			),
	);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	for (const [index, unit] of units.entries()) {
		drawText({
			text: unit,
			x: left + margin,
			y: top + paperHeight * 0.18 + lineGap * (2 + index),
			maxWidth: paperWidth * 0.76,
			size,
		});
	}
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		left + margin,
		top + paperHeight * 0.12,
		(paperWidth - margin * 2) * (0.2 + frame.progress * 0.8),
		Math.max(2, size * 0.05),
	);
	layoutCDrawFolio({
		label: "— No.01",
		options,
		x: left + paperWidth - margin,
		y: top + paperHeight * 0.88,
	});
}

function drawCalendar(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const gridWidth = width * (portrait ? 0.9 : 0.78);
	const gridHeight = height * 0.68;
	const left = width / 2 - gridWidth / 2;
	const top = height * 0.22;
	const columns = 7;
	const rows = 5;
	const cellWidth = gridWidth / columns;
	const cellHeight = gridHeight / rows;
	const selected = Math.floor(frame.progress * 31) + 1;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	const monthSize = Math.max(20, Math.min(width, height) * 0.075);
	setFontSize(monthSize);
	drawText({
		text: "09",
		x: left,
		y: height * 0.1,
		maxWidth: width * 0.18,
		size: monthSize,
	});
	const labelSize = Math.max(9, monthSize * 0.24);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(labelSize);
	drawText({
		text: "SEPTEMBER / 2026",
		x: left + monthSize * 1.25,
		y: height * 0.1,
		maxWidth: width * 0.36,
		size: labelSize,
	});
	for (let column = 0; column <= columns; column += 1) {
		layoutADrawLine({
			alpha: 0.5,
			color: frame.palette.secondary,
			ctx,
			fromX: left + column * cellWidth,
			fromY: top,
			thickness: 1,
			toX: left + column * cellWidth,
			toY: top + gridHeight,
		});
	}
	for (let row = 0; row <= rows; row += 1) {
		layoutADrawLine({
			alpha: 0.5,
			color: frame.palette.secondary,
			ctx,
			fromX: left,
			fromY: top + row * cellHeight,
			thickness: 1,
			toX: left + gridWidth,
			toY: top + row * cellHeight,
		});
	}
	for (let day = 1; day <= 31; day += 1) {
		const index = day + 1;
		const column = index % 7;
		const row = Math.floor(index / 7) % rows;
		const x = left + column * cellWidth;
		const y = top + row * cellHeight;
		if (day === selected) {
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(x, y, cellWidth, cellHeight);
		}
		const daySize = Math.max(8, Math.min(cellWidth, cellHeight) * 0.22);
		ctx.fillStyle =
			day === selected ? frame.palette.background : frame.palette.foreground;
		ctx.textAlign = "left";
		setFontSize(daySize);
		drawText({
			text: String(day),
			x: x + cellWidth * 0.1,
			y: y + cellHeight * 0.22,
			maxWidth: cellWidth * 0.3,
			size: daySize,
		});
	}
	const panelWidth = gridWidth * 0.56;
	const panelHeight = cellHeight * 1.5;
	const panelX = width / 2 - panelWidth / 2;
	const panelY = top + gridHeight / 2 - panelHeight / 2;
	layoutADrawPlate({
		alpha: 0.94,
		color: frame.palette.accent,
		ctx,
		height: panelHeight,
		width: panelWidth,
		x: width / 2,
		y: panelY + panelHeight / 2,
	});
	const textSize = layoutCSize({
		height: panelHeight,
		maxHeightRatio: 0.42,
		maxWidthRatio: 0.82,
		text,
		width: panelWidth,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(textSize);
	drawText({
		text,
		x: panelX + panelWidth / 2,
		y: panelY + panelHeight / 2,
		maxWidth: panelWidth * 0.86,
		size: textSize,
	});
	const ringRadius = Math.min(width, height) * 0.018;
	for (const x of [left + gridWidth * 0.28, left + gridWidth * 0.72]) {
		layoutCDrawRing({
			color: frame.palette.foreground,
			innerColor: frame.palette.background,
			options,
			radius: ringRadius,
			thickness: ringRadius * 0.34,
			x,
			y: top - ringRadius * 1.5,
		});
	}
	layoutCDrawBarcode({
		alpha: 0.5,
		color: frame.palette.secondary,
		height: height * 0.025,
		left: left,
		options,
		seed: layoutCSeed(options),
		top: top + gridHeight + height * 0.025,
		width: gridWidth * 0.24,
	});
}
