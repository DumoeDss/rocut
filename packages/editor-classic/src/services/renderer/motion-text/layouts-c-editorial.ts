import { layoutGlyphs, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawBodyRows,
	layoutCDrawDashedLine,
	layoutCDrawDisc,
	layoutCDrawFolio,
	layoutCDrawPaper,
	layoutCDrawPerforation,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
	layoutCTextWidth,
	layoutCUnits,
} from "./layouts-c-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const EDITORIAL_LAYOUTS = new Set([
	"contents",
	"dictionary",
	"footnote",
	"headlineDeck",
	"magazine",
	"newspaper",
	"numbered",
	"poster",
	"proofread",
	"swissGrid",
]);

export function drawLayoutsCEditorial(
	options: TypographyLayoutOptions,
): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !EDITORIAL_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "contents":
			drawContents(options);
			break;
		case "dictionary":
			drawDictionary(options);
			break;
		case "footnote":
			drawFootnote(options);
			break;
		case "headlineDeck":
			drawHeadlineDeck(options);
			break;
		case "magazine":
			drawMagazine(options);
			break;
		case "newspaper":
			drawNewspaper(options);
			break;
		case "numbered":
			drawNumbered(options);
			break;
		case "poster":
			drawPoster(options);
			break;
		case "proofread":
			drawProofread(options);
			break;
		case "swissGrid":
			drawSwissGrid(options);
			break;
	}
	return true;
}

function drawMagazine(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width * 1.08;
	const spreadWidth = width * (portrait ? 0.84 : 0.82);
	const pageWidth = portrait ? spreadWidth : spreadWidth / 2;
	const pageHeight = height * (portrait ? 0.36 : 0.78);
	const left = width / 2 - (portrait ? pageWidth / 2 : pageWidth);
	const top = height / 2 - (portrait ? pageHeight : pageHeight / 2);
	const turn = 0.78 + Math.sin(layoutCPhase(options)) * 0.2;
	const seed = layoutCSeed(options);
	layoutCDrawPaper({
		color: frame.palette.background,
		height: pageHeight,
		left,
		options,
		top,
		width: pageWidth,
	});
	const secondLeft = portrait ? left : width / 2;
	const secondTop = portrait ? height / 2 : top;
	ctx.save();
	ctx.translate(
		portrait ? 0 : secondLeft,
		portrait ? secondLeft + pageWidth / 2 : 0,
	);
	ctx.scale(portrait ? 1 : turn, portrait ? turn : 1);
	ctx.translate(
		portrait ? 0 : -secondLeft,
		portrait ? -(secondLeft + pageWidth / 2) : 0,
	);
	layoutCDrawPaper({
		alpha: 0.96,
		color: frame.palette.background,
		height: pageHeight,
		left: secondLeft,
		options,
		top: secondTop,
		width: pageWidth,
	});
	ctx.restore();

	const margin = pageWidth * 0.1;
	const size = layoutCSize({
		height: pageHeight,
		maxHeightRatio: 0.16,
		maxWidthRatio: 0.72,
		text,
		width: pageWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: left + margin,
		y: top + pageHeight * 0.33,
		maxWidth: pageWidth - margin * 2,
		size,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		left + margin,
		top + pageHeight * 0.13,
		pageWidth * (0.18 + 0.12 * frame.progress),
		Math.max(3, size * 0.045),
	);
	layoutCDrawBodyRows({
		color: frame.palette.secondary,
		left: left + margin,
		options,
		rowGap: Math.max(8, pageHeight * 0.025),
		rows: 7,
		seed,
		top: top + pageHeight * 0.56,
		width: pageWidth - margin * 2,
	});
	const photoLeft = secondLeft + pageWidth * 0.1;
	const photoTop = secondTop + pageHeight * 0.1;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(photoLeft, photoTop, pageWidth * 0.8, pageHeight * 0.36);
	layoutCDrawDisc({
		alpha: 0.72,
		color: frame.palette.accent,
		options,
		radius: Math.min(pageWidth, pageHeight) * (0.09 + frame.progress * 0.025),
		x: photoLeft + pageWidth * 0.52,
		y: photoTop + pageHeight * 0.18,
	});
	layoutCDrawBodyRows({
		alpha: 0.34,
		color: frame.palette.foreground,
		left: photoLeft,
		options,
		rowGap: Math.max(7, pageHeight * 0.022),
		rows: 8,
		seed: seed + 17,
		top: secondTop + pageHeight * 0.54,
		width: pageWidth * 0.36,
	});
	layoutCDrawBodyRows({
		alpha: 0.34,
		color: frame.palette.foreground,
		left: secondLeft + pageWidth * 0.54,
		options,
		rowGap: Math.max(7, pageHeight * 0.022),
		rows: 8,
		seed: seed + 29,
		top: secondTop + pageHeight * 0.54,
		width: pageWidth * 0.36,
	});
	const gutterX = portrait ? left : width / 2;
	const gutterY = portrait ? height / 2 : top;
	ctx.fillStyle = frame.palette.foreground;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * 0.12;
	ctx.fillRect(
		portrait ? left : gutterX - pageWidth * 0.025,
		portrait ? gutterY - pageHeight * 0.025 : top,
		portrait ? pageWidth : pageWidth * 0.05,
		portrait ? pageHeight * 0.05 : pageHeight,
	);
	ctx.globalAlpha = baseAlpha;
	layoutCDrawFolio({
		label: "FEATURE / 042",
		options,
		x: secondLeft + pageWidth * 0.9,
		y: secondTop + pageHeight * 0.9,
	});
}

function drawHeadlineDeck(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.23,
		maxWidthRatio: 0.72,
		text,
		width,
	});
	const left = width * 0.1;
	const top = height * 0.22;
	const kickerSize = Math.max(11, size * 0.2);
	const plateWidth = Math.min(width * 0.34, kickerSize * 10);
	layoutADrawPlate({
		color: frame.palette.accent,
		ctx,
		height: kickerSize * 1.65,
		width: plateWidth,
		x: left + plateWidth / 2,
		y: top,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "left";
	setFontSize(kickerSize);
	drawText({
		text: "FEATURE  /  01",
		x: left + kickerSize * 0.55,
		y: top,
		maxWidth: plateWidth * 0.9,
		size: kickerSize,
	});
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: left,
		y: height * 0.46,
		maxWidth: width * 0.78,
		size,
	});
	const ruleY = height * 0.62;
	layoutADrawLine({
		color: frame.palette.foreground,
		ctx,
		fromX: left,
		fromY: ruleY,
		thickness: Math.max(2, size * 0.025),
		toX: left + width * (0.28 + frame.progress * 0.56),
		toY: ruleY,
	});
	const deckSize = Math.max(10, size * 0.22);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(deckSize);
	drawText({
		text: `${text} — EDITORIAL DECK / ${String(layoutGlyphs(text).length).padStart(2, "0")} GLYPHS`,
		x: left,
		y: ruleY + deckSize * 1.8,
		maxWidth: width * 0.7,
		size: deckSize,
	});
	layoutCDrawFolio({
		label: "COVER STORY",
		options,
		x: width * 0.9,
		y: height * 0.88,
	});
}

function drawContents(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const entries = [text, ...layoutCUnits({ count: 4, text })].slice(0, 5);
	const left = width * 0.14;
	const right = width * 0.86;
	const top = height * 0.2;
	const rowHeight = (height * 0.6) / entries.length;
	const current = Math.floor(frame.progress * entries.length) % entries.length;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	const titleSize = Math.max(16, Math.min(width, height) * 0.055);
	setFontSize(titleSize);
	drawText({
		text: "CONTENTS",
		x: left,
		y: top - titleSize,
		maxWidth: width * 0.4,
		size: titleSize,
	});
	for (const [index, entry] of entries.entries()) {
		const y = top + rowHeight * (index + 0.5);
		const size = Math.min(rowHeight * 0.34, width * 0.035);
		if (index === current) {
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(
				left - size * 0.5,
				y - rowHeight * 0.36,
				width * 0.72,
				rowHeight * 0.72,
			);
		}
		ctx.fillStyle =
			index === current ? frame.palette.background : frame.palette.foreground;
		setFontSize(size);
		drawText({
			text: String(index + 1).padStart(2, "0"),
			x: left,
			y,
			maxWidth: width * 0.08,
			size,
		});
		drawText({
			text: entry,
			x: left + width * 0.1,
			y,
			maxWidth: width * 0.43,
			size,
		});
		layoutCDrawDashedLine({
			alpha: index === current ? 0.9 : 0.45,
			color:
				index === current ? frame.palette.background : frame.palette.secondary,
			dashes: 22,
			fromX: left + width * 0.53,
			fromY: y,
			options,
			thickness: Math.max(1, size * 0.06),
			toX: right - width * 0.06,
			toY: y,
		});
		ctx.textAlign = "right";
		drawText({
			text: String(12 + index * 7),
			x: right,
			y,
			maxWidth: width * 0.06,
			size,
		});
		ctx.textAlign = "left";
	}
}

function drawFootnote(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.68,
		text,
		width,
	});
	const left = width * 0.12;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: left,
		y: height * 0.42,
		maxWidth: width * 0.74,
		size,
	});
	const markerSize = Math.max(10, size * 0.28);
	ctx.fillStyle = frame.palette.accent;
	setFontSize(markerSize);
	drawText({
		text: "1",
		x:
			left +
			layoutCTextWidth({ maxWidth: width * 0.7, size, text }) +
			markerSize * 0.2,
		y: height * 0.42 - size * 0.45,
		maxWidth: markerSize,
		size: markerSize,
	});
	const railY = height * 0.72;
	layoutADrawLine({
		color: frame.palette.foreground,
		ctx,
		fromX: left,
		fromY: railY,
		thickness: Math.max(1, size * 0.018),
		toX: left + width * (0.18 + frame.progress * 0.62),
		toY: railY,
	});
	const noteSize = Math.max(10, size * 0.17);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(noteSize);
	drawText({
		text: `1  ${text} / NOTE ${String(layoutGlyphs(text).length).padStart(2, "0")}`,
		x: left,
		y: railY + noteSize * 1.8,
		maxWidth: width * 0.7,
		size: noteSize,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width * (0.1 + frame.progress * 0.74),
		height * 0.12,
		Math.max(2, size * 0.03),
		height * 0.14,
	);
}

function drawProofread(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const paperWidth = width * (height > width ? 0.86 : 0.72);
	const paperHeight = height * 0.82;
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
	const crop = Math.min(width, height) * 0.025;
	for (const [x, y, dx, dy] of [
		[left, top, -1, -1],
		[left + paperWidth, top, 1, -1],
		[left, top + paperHeight, -1, 1],
		[left + paperWidth, top + paperHeight, 1, 1],
	] as const) {
		layoutADrawLine({
			color: frame.palette.secondary,
			ctx,
			fromX: x + dx * crop * 0.25,
			fromY: y,
			thickness: 1,
			toX: x + dx * crop,
			toY: y,
		});
		layoutADrawLine({
			color: frame.palette.secondary,
			ctx,
			fromX: x,
			fromY: y + dy * crop * 0.25,
			thickness: 1,
			toX: x,
			toY: y + dy * crop,
		});
	}
	const size = layoutCSize({
		height: paperHeight,
		maxHeightRatio: 0.14,
		maxWidthRatio: 0.72,
		text,
		width: paperWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: left + paperWidth * 0.1,
		y: top + paperHeight * 0.42,
		maxWidth: paperWidth * 0.76,
		size,
	});
	const glyphs = layoutGlyphs(text);
	const correction = Math.floor(frame.progress * Math.max(1, glyphs.length));
	const correctionX =
		left +
		paperWidth * 0.1 +
		Math.min(paperWidth * 0.66, correction * size * 0.52);
	layoutCDrawDisc({
		alpha: 0.88,
		color: frame.palette.accent,
		options,
		radius: size * 0.36,
		scaleX: 1.25,
		x: correctionX,
		y: top + paperHeight * 0.42,
	});
	layoutCDrawDisc({
		color: frame.palette.background,
		options,
		radius: size * 0.29,
		scaleX: 1.25,
		x: correctionX,
		y: top + paperHeight * 0.42,
	});
	layoutADrawLine({
		color: frame.palette.accent,
		ctx,
		fromX: correctionX,
		fromY: top + paperHeight * 0.42 - size * 0.42,
		thickness: Math.max(2, size * 0.035),
		toX: left + paperWidth * 0.86,
		toY: top + paperHeight * 0.18,
	});
	const note = Math.max(10, size * 0.2);
	ctx.fillStyle = frame.palette.accent;
	ctx.textAlign = "right";
	setFontSize(note);
	drawText({
		text: "要確認 / REVISE",
		x: left + paperWidth * 0.9,
		y: top + paperHeight * 0.14,
		maxWidth: paperWidth * 0.28,
		size: note,
	});
	layoutCDrawBodyRows({
		alpha: 0.28,
		color: frame.palette.secondary,
		left: left + paperWidth * 0.1,
		options,
		rowGap: Math.max(7, paperHeight * 0.025),
		rows: 7,
		seed: layoutCSeed(options),
		top: top + paperHeight * 0.62,
		width: paperWidth * 0.8,
	});
}

function drawNumbered(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutCUnits({ count: 3, text: layoutCText(options) });
	const rowHeight = (height * 0.68) / units.length;
	const top = height * 0.16;
	const left = width * 0.1;
	for (const [index, unit] of units.entries()) {
		const y = top + rowHeight * (index + 0.5);
		const numberSize = Math.min(rowHeight * 0.62, width * 0.09);
		ctx.fillStyle =
			index === 0 ? frame.palette.accent : frame.palette.secondary;
		ctx.textAlign = "left";
		setFontSize(numberSize);
		drawText({
			text: String(index + 1).padStart(2, "0"),
			x: left,
			y,
			maxWidth: width * 0.1,
			size: numberSize,
		});
		const textSize = layoutCSize({
			height: rowHeight,
			maxHeightRatio: 0.44,
			maxWidthRatio: 0.56,
			text: unit,
			width,
		});
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(textSize);
		drawText({
			text: unit,
			x: left + width * 0.18,
			y,
			maxWidth: width * 0.62,
			size: textSize,
		});
		layoutADrawLine({
			alpha: 0.62,
			color: frame.palette.secondary,
			ctx,
			fromX: left,
			fromY: top + rowHeight * (index + 1),
			thickness: Math.max(1, textSize * 0.025),
			toX:
				left +
				width * Math.min(0.8, 0.28 + frame.progress * 0.5 + index * 0.04),
			toY: top + rowHeight * (index + 1),
		});
	}
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width * 0.92,
		height * (0.1 + frame.progress * 0.72),
		Math.max(3, width * 0.008),
		height * 0.08,
	);
}

function drawPoster(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const units = layoutCUnits({
		count: Math.min(4, Math.max(2, Math.ceil(layoutGlyphs(text).length / 5))),
		text,
	});
	const left = width * 0.07;
	const usableHeight = height * 0.66;
	const top = height * 0.16;
	const rowHeight = usableHeight / units.length;
	layoutCDrawDisc({
		alpha: 0.82,
		color: frame.palette.accent,
		options,
		radius:
			Math.min(width, height) * (0.2 + 0.025 * Math.sin(layoutCPhase(options))),
		x: width * 0.76,
		y: height * 0.34,
	});
	for (const [index, unit] of units.entries()) {
		const size = Math.min(
			rowHeight * 0.86,
			(width * 0.84) / Math.max(1, layoutGlyphs(unit).length * 0.58),
		);
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "left";
		setFontSize(size);
		drawText({
			text: unit,
			x: left,
			y: top + rowHeight * (index + 0.5),
			maxWidth: width * 0.84,
			size,
		});
	}
	const metaSize = Math.max(9, Math.min(width, height) * 0.022);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(metaSize);
	drawText({
		text: "LIVE / TOUR / SIDE A",
		x: left,
		y: height * 0.08,
		maxWidth: width * 0.44,
		size: metaSize,
	});
	layoutADrawLine({
		color: frame.palette.foreground,
		ctx,
		fromX: left,
		fromY: height * 0.88,
		thickness: Math.max(3, metaSize * 0.24),
		toX: left + width * (0.34 + frame.progress * 0.5),
		toY: height * 0.88,
	});
	layoutCDrawFolio({
		label: "DATE / WORDS / 01",
		options,
		x: width * 0.92,
		y: height * 0.93,
	});
}

function drawSwissGrid(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const portrait = height > width;
	const columns = portrait ? 4 : 6;
	const rows = portrait ? 8 : 6;
	const left = width * 0.1;
	const top = height * 0.1;
	const gridWidth = width * 0.82;
	const gridHeight = height * 0.8;
	const cellWidth = gridWidth / columns;
	const cellHeight = gridHeight / rows;
	for (let column = 0; column <= columns; column += 1) {
		layoutADrawLine({
			alpha: 0.34,
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
			alpha: 0.34,
			color: frame.palette.secondary,
			ctx,
			fromX: left,
			fromY: top + row * cellHeight,
			thickness: 1,
			toX: left + gridWidth,
			toY: top + row * cellHeight,
		});
	}
	const units = layoutCUnits({ count: 3, text: layoutCText(options) });
	for (const [index, unit] of units.entries()) {
		const startColumn = Math.min(columns - 1, index * 2);
		const startRow =
			1 + index * Math.max(1, Math.floor((rows - 2) / units.length));
		const size = Math.min(
			cellHeight * (index === 0 ? 0.72 : 0.5),
			(cellWidth * Math.max(2, columns - startColumn)) /
				Math.max(1, layoutGlyphs(unit).length * 0.62),
		);
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "left";
		setFontSize(size);
		drawText({
			text: unit,
			x: left + startColumn * cellWidth + cellWidth * 0.08,
			y: top + (startRow + 0.55) * cellHeight,
			maxWidth: gridWidth - startColumn * cellWidth,
			size,
		});
		ctx.fillStyle = frame.palette.foreground;
		ctx.fillRect(
			left + startColumn * cellWidth,
			top + startRow * cellHeight - Math.max(2, size * 0.06),
			cellWidth * Math.min(columns - startColumn, 2 + frame.progress * 2),
			Math.max(2, size * 0.06),
		);
	}
	layoutCDrawDisc({
		color: frame.palette.accent,
		options,
		radius: Math.min(cellWidth, cellHeight) * 0.38,
		x: left + (columns - 0.5 - frame.progress * 0.5) * cellWidth,
		y: top + (rows - 0.7) * cellHeight,
	});
	ctx.save();
	ctx.translate(width * 0.045, height / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "center";
	const labelSize = Math.max(9, Math.min(width, height) * 0.016);
	setFontSize(labelSize);
	drawText({
		text: "SWISS GRID / 06 × 06",
		x: 0,
		y: 0,
		maxWidth: height * 0.54,
		size: labelSize,
	});
	ctx.restore();
}

function drawDictionary(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const left = width * 0.12;
	const top = height * 0.12;
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.18,
		maxWidthRatio: 0.64,
		text,
		width,
	});
	const highlightWidth =
		layoutCTextWidth({ maxWidth: width * 0.66, size, text }) *
		(0.36 + frame.progress * 0.64);
	ctx.fillStyle = frame.palette.accent;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * 0.36;
	ctx.fillRect(left, height * 0.42 - size * 0.24, highlightWidth, size * 0.58);
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "left";
	setFontSize(size);
	drawText({
		text,
		x: left + size * 0.45,
		y: height * 0.42,
		maxWidth: width * 0.66,
		size,
	});
	const markerSize = Math.max(12, size * 0.3);
	ctx.fillStyle = frame.palette.accent;
	setFontSize(markerSize);
	drawText({
		text: "◆",
		x: left,
		y: height * 0.42,
		maxWidth: markerSize,
		size: markerSize,
	});
	const pillWidth = Math.max(markerSize * 2.2, width * 0.08);
	layoutADrawFrame({
		color: frame.palette.foreground,
		ctx,
		height: markerSize * 1.3,
		left: width * 0.82 - pillWidth,
		thickness: Math.max(1, markerSize * 0.06),
		top: height * 0.42 - markerSize * 0.65,
		width: pillWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(markerSize * 0.7);
	drawText({
		text: "名",
		x: width * 0.82 - pillWidth / 2,
		y: height * 0.42,
		maxWidth: pillWidth * 0.8,
		size: markerSize * 0.7,
	});
	const definitionSize = Math.max(10, size * 0.19);
	ctx.textAlign = "left";
	for (let index = 0; index < 2; index += 1) {
		const y = height * 0.62 + index * definitionSize * 1.9;
		layoutCDrawDisc({
			color: frame.palette.foreground,
			options,
			radius: definitionSize * 0.52,
			x: left + definitionSize * 0.52,
			y,
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(definitionSize * 0.62);
		drawText({
			text: String(index + 1),
			x: left + definitionSize * 0.52,
			y,
			maxWidth: definitionSize,
			size: definitionSize * 0.62,
		});
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "left";
		setFontSize(definitionSize);
		drawText({
			text:
				index === 0
					? `${text} — lyric entry and reading`
					: `${String(layoutGlyphs(text).length)} glyphs / editorial definition`,
			x: left + definitionSize * 1.5,
			y,
			maxWidth: width * 0.62,
			size: definitionSize,
		});
	}
	layoutCDrawFolio({
		label: "DICTIONARY / 384",
		options,
		x: width * 0.87,
		y: top,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width * 0.94,
		height * (0.14 + frame.progress * 0.58),
		width * 0.06,
		height * 0.16,
	);
}

function drawNewspaper(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const paperWidth = width * 0.88;
	const paperHeight = height * 0.86;
	const left = -paperWidth / 2;
	const top = -paperHeight / 2;
	const rotation = Math.sin(layoutCPhase(options)) * 0.018;
	ctx.save();
	ctx.translate(width / 2, height / 2);
	ctx.rotate(rotation);
	layoutCDrawPaper({
		color: frame.palette.background,
		height: paperHeight,
		left,
		options,
		top,
		width: paperWidth,
	});
	const margin = paperWidth * 0.04;
	const mastSize = Math.max(16, paperHeight * 0.075);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(mastSize);
	drawText({
		text: "字 面 新 聞",
		x: 0,
		y: top + mastSize,
		maxWidth: paperWidth * 0.56,
		size: mastSize,
	});
	layoutADrawLine({
		color: frame.palette.foreground,
		ctx,
		fromX: left + margin,
		fromY: top + mastSize * 1.65,
		thickness: Math.max(2, mastSize * 0.06),
		toX: left + paperWidth - margin,
		toY: top + mastSize * 1.65,
	});
	const headlineSize = layoutCSize({
		height: paperHeight,
		maxHeightRatio: 0.14,
		maxWidthRatio: 0.72,
		text,
		width: paperWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(headlineSize);
	drawText({
		text,
		x: 0,
		y: top + paperHeight * 0.31,
		maxWidth: paperWidth * 0.84,
		size: headlineSize,
	});
	const columnTop = top + paperHeight * 0.47;
	const columnWidth = (paperWidth - margin * 2) / 4;
	for (let column = 0; column < 4; column += 1) {
		layoutCDrawBodyRows({
			alpha: 0.38,
			color: frame.palette.foreground,
			left: left + margin + column * columnWidth,
			options,
			rowGap: Math.max(6, paperHeight * 0.018),
			rows: 16,
			seed: layoutCSeed(options) + column * 19,
			top: columnTop,
			width: columnWidth * 0.88,
		});
	}
	const photoLeft = left + margin + columnWidth;
	const photoTop = columnTop + paperHeight * 0.06;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(photoLeft, photoTop, columnWidth * 1.8, paperHeight * 0.22);
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * 0.56;
	ctx.fillStyle = frame.palette.foreground;
	const seed = layoutCSeed(options);
	for (let row = 0; row < 8; row += 1) {
		for (let column = 0; column < 13; column += 1) {
			const radius = Math.max(
				1,
				paperHeight * 0.004 * (0.5 + layoutUnit(seed, row, column, 401)),
			);
			ctx.fillRect(
				photoLeft + ((column + 0.5) / 13) * columnWidth * 1.8 - radius,
				photoTop + ((row + 0.5) / 8) * paperHeight * 0.22 - radius,
				radius * 2,
				radius * 2,
			);
		}
	}
	ctx.globalAlpha = baseAlpha;
	layoutCDrawPerforation({
		alpha: 0.28,
		color: frame.palette.secondary,
		height: paperHeight * 0.22,
		left: photoLeft,
		options,
		step: Math.max(5, paperHeight * 0.018),
		top: photoTop,
		width: columnWidth * 1.8,
	});
	ctx.restore();
}
