import { layoutGlyphs, layoutSigned, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawBarcode,
	layoutCDrawDisc,
	layoutCDrawFolio,
	layoutCDrawPaper,
	layoutCDrawRing,
	layoutCDrawStripes,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
	layoutCUnits,
} from "./layouts-c-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const OBJECT_LAYOUTS = new Set([
	"clapper",
	"nameTag",
	"priceTag",
	"ransom",
	"routeMap",
	"stickyNotes",
	"warningLabel",
]);

export function drawLayoutsCObjects(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !OBJECT_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "clapper":
			drawClapper(options);
			break;
		case "nameTag":
			drawNameTag(options);
			break;
		case "priceTag":
			drawPriceTag(options);
			break;
		case "ransom":
			drawRansom(options);
			break;
		case "routeMap":
			drawRouteMap(options);
			break;
		case "stickyNotes":
			drawStickyNotes(options);
			break;
		case "warningLabel":
			drawWarningLabel(options);
			break;
	}
	return true;
}

function drawRansom(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 18);
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const perRow = portrait
		? Math.min(5, glyphs.length)
		: Math.min(9, glyphs.length);
	const rows = Math.ceil(glyphs.length / perRow);
	const cell = Math.min((width * 0.82) / perRow, (height * 0.66) / rows);
	const seed = layoutCSeed(options);
	const phase = layoutCPhase(options);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const x = width / 2 + (column - (count - 1) / 2) * cell * 1.02;
		const y = height / 2 + (row - (rows - 1) / 2) * cell * 1.18;
		const rotation =
			layoutSigned(seed, index, 701) * 0.2 + Math.sin(phase + index) * 0.025;
		const scale = 0.84 + layoutUnit(seed, index, 702) * 0.28;
		const plateWidth = cell * (0.64 + layoutUnit(seed, index, 703) * 0.2);
		const plateHeight = cell * (0.76 + layoutUnit(seed, index, 704) * 0.2);
		const color =
			index % 4 === 0
				? frame.palette.accent
				: index % 3 === 0
					? frame.palette.background
					: index % 2 === 0
						? frame.palette.foreground
						: frame.palette.secondary;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(rotation);
		ctx.scale(scale, scale);
		layoutADrawPlate({
			alpha: 0.24,
			color: frame.palette.foreground,
			ctx,
			height: plateHeight,
			width: plateWidth,
			x: cell * 0.045,
			y: cell * 0.06,
		});
		layoutADrawPlate({
			color,
			ctx,
			height: plateHeight,
			width: plateWidth,
			x: 0,
			y: 0,
		});
		if (index % 4 === 1) {
			layoutADrawFrame({
				color: frame.palette.foreground,
				ctx,
				height: plateHeight,
				left: -plateWidth / 2,
				thickness: Math.max(1, cell * 0.018),
				top: -plateHeight / 2,
				width: plateWidth,
			});
		}
		ctx.fillStyle =
			color === frame.palette.foreground
				? frame.palette.background
				: frame.palette.foreground;
		ctx.textAlign = "center";
		const size = cell * (0.48 + layoutUnit(seed, index, 705) * 0.12);
		setFontSize(size);
		drawText({ text: glyph, x: 0, y: 0, maxWidth: plateWidth * 0.82, size });
		ctx.restore();
	}
}

function drawRouteMap(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const portrait = height > width;
	const units = layoutCUnits({ count: 4, text: layoutCText(options) });
	const lineColor = frame.palette.accent;
	const thickness = Math.max(8, Math.min(width, height) * 0.024);
	const points = portrait
		? [
				[width * 0.24, height * 0.08],
				[width * 0.24, height * 0.92],
			]
		: [
				[width * 0.04, height * 0.38],
				[width * 0.42, height * 0.38],
				[width * 0.58, height * 0.64],
				[width * 0.96, height * 0.64],
			];
	for (let index = 1; index < points.length; index += 1) {
		layoutADrawLine({
			color: lineColor,
			ctx,
			fromX: points[index - 1]![0],
			fromY: points[index - 1]![1],
			thickness,
			toX: points[index]![0],
			toY: points[index]![1],
		});
	}
	for (const [index, unit] of units.entries()) {
		const progress = units.length === 1 ? 0.5 : index / (units.length - 1);
		let x: number;
		let y: number;
		if (portrait) {
			x = points[0]![0];
			y = height * (0.16 + progress * 0.68);
		} else if (progress < 0.5) {
			const local = progress * 2;
			x = width * (0.1 + local * 0.32);
			y = height * 0.38;
		} else {
			const local = (progress - 0.5) * 2;
			x = width * (0.58 + local * 0.32);
			y = height * 0.64;
		}
		layoutCDrawDisc({
			color: frame.palette.background,
			options,
			radius: thickness * 0.82,
			x,
			y,
		});
		layoutCDrawRing({
			color: lineColor,
			innerColor: frame.palette.background,
			options,
			radius: thickness * 0.72,
			thickness: thickness * 0.22,
			x,
			y,
		});
		const size = Math.max(10, Math.min(width, height) * 0.035);
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = portrait ? "left" : "center";
		setFontSize(size);
		drawText({
			text: unit,
			x: portrait ? x + thickness * 1.7 : x,
			y: portrait ? y : y + (index % 2 === 0 ? -1 : 1) * thickness * 2.4,
			maxWidth: portrait ? width * 0.6 : width * 0.22,
			size,
		});
		ctx.fillStyle = frame.palette.secondary;
		setFontSize(Math.max(8, size * 0.45));
		drawText({
			text: `J${String(index + 1).padStart(2, "0")}`,
			x: portrait ? x + thickness * 1.7 : x,
			y: portrait
				? y + size * 0.8
				: y + (index % 2 === 0 ? -1 : 1) * thickness * 3.4,
			maxWidth: width * 0.12,
			size: Math.max(8, size * 0.45),
		});
	}
	const vehicleProgress = frame.progress;
	const vehicleX = portrait
		? points[0]![0]
		: width * (0.04 + vehicleProgress * 0.92);
	const vehicleY = portrait
		? height * (0.08 + vehicleProgress * 0.84)
		: vehicleProgress < 0.42
			? height * 0.38
			: vehicleProgress > 0.58
				? height * 0.64
				: height * (0.38 + ((vehicleProgress - 0.42) / 0.16) * 0.26);
	layoutCDrawDisc({
		color: frame.palette.foreground,
		options,
		radius: thickness * 0.48,
		x: vehicleX,
		y: vehicleY,
	});
}

function drawClapper(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const bodyWidth = Math.min(width * 0.64, height * 1.15);
	const bodyHeight = bodyWidth * 0.62;
	const topBarHeight = bodyHeight * 0.15;
	const phase = layoutCPhase(options);
	ctx.save();
	ctx.translate(width / 2, height / 2 + bodyHeight * 0.07);
	ctx.rotate(Math.sin(phase * 0.5) * 0.035);
	layoutADrawPlate({
		color: frame.palette.foreground,
		ctx,
		height: bodyHeight,
		width: bodyWidth,
		x: 0,
		y: 0,
	});
	layoutCDrawStripes({
		colorA: frame.palette.foreground,
		colorB: frame.palette.background,
		height: topBarHeight,
		left: -bodyWidth / 2,
		options,
		phase: frame.progress * bodyWidth * 0.08,
		stripeWidth: bodyWidth * 0.055,
		top: -bodyHeight / 2,
		width: bodyWidth,
	});
	ctx.save();
	ctx.translate(-bodyWidth / 2, -bodyHeight / 2);
	ctx.rotate(-0.45 * Math.max(0, Math.sin(phase)));
	layoutCDrawStripes({
		colorA: frame.palette.foreground,
		colorB: frame.palette.background,
		height: topBarHeight,
		left: 0,
		options,
		stripeWidth: bodyWidth * 0.055,
		top: -topBarHeight * 1.05,
		width: bodyWidth,
	});
	ctx.restore();
	const chalk = frame.palette.background;
	const rowOne = bodyHeight * 0.18;
	const rowTwo = bodyHeight * 0.34;
	for (const y of [rowOne, rowTwo]) {
		layoutADrawLine({
			color: chalk,
			ctx,
			fromX: -bodyWidth / 2,
			fromY: y,
			thickness: Math.max(1, bodyHeight * 0.008),
			toX: bodyWidth / 2,
			toY: y,
		});
	}
	for (const x of [-bodyWidth / 6, bodyWidth / 6]) {
		layoutADrawLine({
			color: chalk,
			ctx,
			fromX: x,
			fromY: rowOne,
			thickness: Math.max(1, bodyHeight * 0.008),
			toX: x,
			toY: bodyHeight / 2,
		});
	}
	const size = layoutCSize({
		height: bodyHeight,
		maxHeightRatio: 0.18,
		maxWidthRatio: 0.74,
		text,
		width: bodyWidth,
	});
	ctx.fillStyle = chalk;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text,
		x: 0,
		y: -bodyHeight * 0.08,
		maxWidth: bodyWidth * 0.82,
		size,
	});
	const small = Math.max(8, bodyHeight * 0.04);
	ctx.textAlign = "left";
	setFontSize(small);
	for (const [index, label] of ["SCENE 01", "TAKE 04", "ROLL A2"].entries()) {
		drawText({
			text: label,
			x: -bodyWidth / 2 + bodyWidth * (index / 3 + 0.03),
			y: rowOne + bodyHeight * 0.085,
			maxWidth: bodyWidth * 0.29,
			size: small,
		});
	}
	ctx.restore();
}

function drawWarningLabel(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const labelWidth = Math.min(width * 0.82, height * 1.5);
	const labelHeight = labelWidth * (height > width ? 0.66 : 0.46);
	const left = width / 2 - labelWidth / 2;
	const top = height / 2 - labelHeight / 2;
	layoutCDrawPaper({
		color: frame.palette.background,
		height: labelHeight,
		left,
		options,
		top,
		width: labelWidth,
	});
	const stripeHeight = labelHeight * 0.13;
	layoutCDrawStripes({
		colorA: frame.palette.foreground,
		colorB: frame.palette.accent,
		height: stripeHeight,
		left,
		options,
		phase: frame.progress * labelWidth * 0.15,
		stripeWidth: labelHeight * 0.08,
		top,
		width: labelWidth,
	});
	layoutCDrawStripes({
		colorA: frame.palette.foreground,
		colorB: frame.palette.accent,
		height: stripeHeight,
		left,
		options,
		phase: -frame.progress * labelWidth * 0.15,
		stripeWidth: labelHeight * 0.08,
		top: top + labelHeight - stripeHeight,
		width: labelWidth,
	});
	const triangleSize = labelHeight * 0.24;
	const triangleX = width / 2;
	const triangleY = top + labelHeight * 0.34;
	for (const [fromX, fromY, toX, toY] of [
		[
			triangleX,
			triangleY - triangleSize * 0.55,
			triangleX + triangleSize * 0.58,
			triangleY + triangleSize * 0.48,
		],
		[
			triangleX + triangleSize * 0.58,
			triangleY + triangleSize * 0.48,
			triangleX - triangleSize * 0.58,
			triangleY + triangleSize * 0.48,
		],
		[
			triangleX - triangleSize * 0.58,
			triangleY + triangleSize * 0.48,
			triangleX,
			triangleY - triangleSize * 0.55,
		],
	] as const) {
		layoutADrawLine({
			color: frame.palette.accent,
			ctx,
			fromX,
			fromY,
			thickness: Math.max(4, triangleSize * 0.1),
			toX,
			toY,
		});
	}
	const flash = Math.floor(frame.progress * 12) % 2 === 0 ? 1 : 0.35;
	ctx.save();
	ctx.globalAlpha *= flash;
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		triangleX - triangleSize * 0.055,
		triangleY - triangleSize * 0.23,
		triangleSize * 0.11,
		triangleSize * 0.38,
	);
	layoutCDrawDisc({
		color: frame.palette.foreground,
		options,
		radius: triangleSize * 0.065,
		x: triangleX,
		y: triangleY + triangleSize * 0.29,
	});
	ctx.restore();
	const warningSize = Math.max(11, labelHeight * 0.065);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(warningSize);
	drawText({
		text: "WARNING  /  警告",
		x: width / 2,
		y: top + labelHeight * 0.55,
		maxWidth: labelWidth * 0.62,
		size: warningSize,
	});
	const size = layoutCSize({
		height: labelHeight,
		maxHeightRatio: 0.16,
		maxWidthRatio: 0.72,
		text,
		width: labelWidth,
	});
	setFontSize(size);
	drawText({
		text,
		x: width / 2,
		y: top + labelHeight * 0.7,
		maxWidth: labelWidth * 0.78,
		size,
	});
}

function drawPriceTag(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const tagWidth = Math.min(
		width * (height > width ? 0.66 : 0.38),
		height * 0.48,
	);
	const tagHeight = tagWidth * 1.42;
	const anchorX = width / 2;
	const anchorY = height * 0.08;
	const phase = layoutCPhase(options);
	const swing = Math.sin(phase * 0.66) * 0.08;
	ctx.save();
	ctx.translate(anchorX, anchorY);
	ctx.rotate(swing);
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: 0,
		fromY: 0,
		thickness: Math.max(2, tagWidth * 0.012),
		toX: 0,
		toY: height * 0.12,
	});
	const top = height * 0.12;
	layoutCDrawPaper({
		color: frame.palette.background,
		height: tagHeight,
		left: -tagWidth / 2,
		options,
		top,
		width: tagWidth,
	});
	layoutCDrawDisc({
		color: frame.palette.secondary,
		options,
		radius: tagWidth * 0.055,
		x: 0,
		y: top + tagWidth * 0.12,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		-tagWidth / 2,
		top + tagHeight * 0.14,
		tagWidth,
		tagHeight * 0.17,
	);
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	const headerSize = Math.max(10, tagWidth * 0.08);
	setFontSize(headerSize);
	drawText({
		text: "SALE  /  お買い得",
		x: 0,
		y: top + tagHeight * 0.225,
		maxWidth: tagWidth * 0.82,
		size: headerSize,
	});
	const size = layoutCSize({
		height: tagHeight,
		maxHeightRatio: 0.16,
		maxWidthRatio: 0.72,
		text,
		width: tagWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: 0,
		y: top + tagHeight * 0.49,
		maxWidth: tagWidth * 0.78,
		size,
	});
	const priceSize = tagWidth * 0.17;
	ctx.fillStyle = frame.palette.accent;
	setFontSize(priceSize);
	drawText({
		text: `¥${String(980 + (Math.abs(layoutCSeed(options)) % 7) * 100)}`,
		x: 0,
		y: top + tagHeight * 0.72,
		maxWidth: tagWidth * 0.78,
		size: priceSize,
	});
	layoutCDrawBarcode({
		alpha: 0.72,
		color: frame.palette.foreground,
		height: tagHeight * 0.08,
		left: -tagWidth * 0.36,
		options,
		seed: layoutCSeed(options),
		top: top + tagHeight * 0.84,
		width: tagWidth * 0.72,
	});
	ctx.restore();
}

function drawNameTag(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const badgeWidth = Math.min(width * 0.72, height * 1.08);
	const badgeHeight = badgeWidth * 0.58;
	const phase = layoutCPhase(options);
	ctx.save();
	ctx.translate(width / 2, height / 2);
	ctx.rotate(Math.sin(phase * 0.54) * 0.045);
	layoutADrawPlate({
		alpha: 0.26,
		color: frame.palette.foreground,
		ctx,
		height: badgeHeight,
		width: badgeWidth,
		x: badgeHeight * 0.04,
		y: badgeHeight * 0.06,
	});
	layoutADrawPlate({
		color: frame.palette.accent,
		ctx,
		height: badgeHeight,
		width: badgeWidth,
		x: 0,
		y: 0,
	});
	const headerHeight = badgeHeight * 0.28;
	ctx.fillStyle = frame.palette.background;
	ctx.fillRect(
		-badgeWidth * 0.46,
		-badgeHeight * 0.16,
		badgeWidth * 0.92,
		badgeHeight * 0.48,
	);
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	const headerSize = headerHeight * 0.38;
	setFontSize(headerSize);
	drawText({
		text: "HELLO",
		x: 0,
		y: -badgeHeight * 0.34,
		maxWidth: badgeWidth * 0.56,
		size: headerSize,
	});
	setFontSize(headerSize * 0.46);
	drawText({
		text: "my name is",
		x: 0,
		y: -badgeHeight * 0.23,
		maxWidth: badgeWidth * 0.5,
		size: headerSize * 0.46,
	});
	const size = layoutCSize({
		height: badgeHeight,
		maxHeightRatio: 0.22,
		maxWidthRatio: 0.76,
		text,
		width: badgeWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: 0,
		y: badgeHeight * 0.08,
		maxWidth: badgeWidth * 0.78,
		size,
	});
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: -badgeWidth * 0.28,
		fromY: -badgeHeight * 0.59,
		thickness: Math.max(2, badgeHeight * 0.018),
		toX: badgeWidth * 0.28,
		toY: -badgeHeight * 0.59,
	});
	layoutCDrawDisc({
		color: frame.palette.secondary,
		options,
		radius: badgeHeight * 0.035,
		x: badgeWidth * 0.28,
		y: -badgeHeight * 0.59,
	});
	ctx.restore();
	layoutCDrawFolio({
		label: "NAME / 01",
		options,
		x: width * 0.91,
		y: height * 0.88,
	});
}

function drawStickyNotes(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const units = layoutCUnits({
		count: Math.min(4, Math.max(1, Math.ceil(layoutGlyphs(text).length / 5))),
		text,
	});
	const portrait = height > width;
	const count = units.length;
	const noteSize = Math.min(
		(width * 0.82) / (portrait ? Math.min(2, count) : count),
		height * (portrait && count > 2 ? 0.34 : 0.56),
	);
	const seed = layoutCSeed(options);
	const phase = layoutCPhase(options);
	for (const [index, unit] of units.entries()) {
		const columns = portrait ? Math.min(2, count) : count;
		const rows = Math.ceil(count / columns);
		const row = Math.floor(index / columns);
		const column = index % columns;
		const rowCount = Math.min(columns, count - row * columns);
		const x = width / 2 + (column - (rowCount - 1) / 2) * noteSize * 0.92;
		const y = height / 2 + (row - (rows - 1) / 2) * noteSize * 0.86;
		const rotation =
			layoutSigned(seed, index, 801) * 0.11 + Math.sin(phase + index) * 0.02;
		const lift = Math.max(0, Math.sin(phase + index * 0.7)) * noteSize * 0.04;
		ctx.save();
		ctx.translate(x, y - lift);
		ctx.rotate(rotation);
		layoutADrawPlate({
			alpha: 0.24,
			color: frame.palette.foreground,
			ctx,
			height: noteSize,
			width: noteSize,
			x: noteSize * 0.04,
			y: noteSize * 0.055,
		});
		const color =
			index % 3 === 0
				? frame.palette.accent
				: index % 3 === 1
					? frame.palette.secondary
					: frame.palette.background;
		layoutADrawPlate({
			color,
			ctx,
			height: noteSize,
			width: noteSize,
			x: 0,
			y: 0,
		});
		ctx.fillStyle = frame.palette.foreground;
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * 0.1;
		ctx.fillRect(-noteSize / 2, -noteSize / 2, noteSize, noteSize * 0.1);
		ctx.globalAlpha = baseAlpha;
		const size = layoutCSize({
			height: noteSize,
			maxHeightRatio: 0.26,
			maxWidthRatio: 0.74,
			text: unit,
			width: noteSize,
		});
		ctx.fillStyle =
			color === frame.palette.foreground
				? frame.palette.background
				: frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(size);
		drawText({
			text: unit,
			x: 0,
			y: noteSize * 0.04,
			maxWidth: noteSize * 0.78,
			size,
		});
		ctx.restore();
	}
}
