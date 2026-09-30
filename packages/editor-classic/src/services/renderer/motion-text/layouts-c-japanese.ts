import { layoutGlyphs, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawBodyRows,
	layoutCDrawDisc,
	layoutCDrawFolio,
	layoutCDrawPaper,
	layoutCDrawVerticalGlyphs,
	layoutCDrawWave,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
	layoutCUnits,
} from "./layouts-c-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const JAPANESE_LAYOUTS = new Set([
	"chochin",
	"ema",
	"kakejiku",
	"karuta",
	"noren",
	"omikuji",
	"shoji",
	"stationSign",
	"tanzaku",
]);

export function drawLayoutsCJapanese(
	options: TypographyLayoutOptions,
): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !JAPANESE_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "chochin":
			drawChochin(options);
			break;
		case "ema":
			drawEma(options);
			break;
		case "kakejiku":
			drawKakejiku(options);
			break;
		case "karuta":
			drawKaruta(options);
			break;
		case "noren":
			drawNoren(options);
			break;
		case "omikuji":
			drawOmikuji(options);
			break;
		case "shoji":
			drawShoji(options);
			break;
		case "stationSign":
			drawStationSign(options);
			break;
		case "tanzaku":
			drawTanzaku(options);
			break;
	}
	return true;
}

function drawEma(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const seed = layoutCSeed(options);
	const beamY = height * 0.16;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(width * 0.04, beamY, width * 0.92, Math.max(5, height * 0.025));
	const backgroundCount = height > width ? 4 : 7;
	for (let index = 0; index < backgroundCount; index += 1) {
		const plaqueWidth = Math.min(width * 0.12, height * 0.16);
		const plaqueHeight = plaqueWidth * 0.72;
		const x = width * (0.08 + (0.84 * (index + 0.5)) / backgroundCount);
		const sway = Math.sin(layoutCPhase(options) * 0.34 + index) * 0.06;
		ctx.save();
		ctx.translate(x, beamY + plaqueHeight * 0.85);
		ctx.rotate(sway);
		layoutADrawLine({
			alpha: 0.64,
			color: frame.palette.secondary,
			ctx,
			fromX: -plaqueWidth * 0.08,
			fromY: -plaqueHeight * 0.85,
			thickness: Math.max(1, plaqueWidth * 0.012),
			toX: 0,
			toY: -plaqueHeight * 0.42,
		});
		layoutADrawLine({
			alpha: 0.64,
			color: frame.palette.secondary,
			ctx,
			fromX: plaqueWidth * 0.08,
			fromY: -plaqueHeight * 0.85,
			thickness: Math.max(1, plaqueWidth * 0.012),
			toX: 0,
			toY: -plaqueHeight * 0.42,
		});
		layoutADrawPlate({
			alpha: 0.46,
			color: frame.palette.background,
			ctx,
			height: plaqueHeight,
			width: plaqueWidth,
			x: 0,
			y: 0,
		});
		layoutADrawLine({
			alpha: 0.55,
			color: frame.palette.secondary,
			ctx,
			fromX: -plaqueWidth / 2,
			fromY: -plaqueHeight / 2,
			thickness: Math.max(2, plaqueWidth * 0.035),
			toX: 0,
			toY: -plaqueHeight * 0.72,
		});
		layoutADrawLine({
			alpha: 0.55,
			color: frame.palette.secondary,
			ctx,
			fromX: 0,
			fromY: -plaqueHeight * 0.72,
			thickness: Math.max(2, plaqueWidth * 0.035),
			toX: plaqueWidth / 2,
			toY: -plaqueHeight / 2,
		});
		ctx.restore();
	}
	const plaqueWidth = Math.min(
		width * (height > width ? 0.74 : 0.5),
		height * 0.76,
	);
	const plaqueHeight = plaqueWidth * 0.7;
	const centerX = width / 2;
	const centerY = height * 0.58;
	const swing = Math.sin(layoutCPhase(options) * 0.72) * 0.07;
	ctx.save();
	ctx.translate(centerX, centerY);
	ctx.rotate(swing);
	layoutADrawLine({
		color: frame.palette.accent,
		ctx,
		fromX: -plaqueWidth * 0.06,
		fromY: -plaqueHeight * 0.96,
		thickness: Math.max(2, plaqueWidth * 0.012),
		toX: 0,
		toY: -plaqueHeight * 0.58,
	});
	layoutADrawLine({
		color: frame.palette.accent,
		ctx,
		fromX: plaqueWidth * 0.06,
		fromY: -plaqueHeight * 0.96,
		thickness: Math.max(2, plaqueWidth * 0.012),
		toX: 0,
		toY: -plaqueHeight * 0.58,
	});
	layoutADrawPlate({
		color: frame.palette.background,
		ctx,
		height: plaqueHeight,
		width: plaqueWidth,
		x: 0,
		y: 0,
	});
	layoutADrawFrame({
		alpha: 0.7,
		color: frame.palette.secondary,
		ctx,
		height: plaqueHeight,
		left: -plaqueWidth / 2,
		thickness: Math.max(2, plaqueWidth * 0.012),
		top: -plaqueHeight / 2,
		width: plaqueWidth,
	});
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: -plaqueWidth / 2,
		fromY: -plaqueHeight / 2,
		thickness: Math.max(4, plaqueWidth * 0.03),
		toX: 0,
		toY: -plaqueHeight * 0.72,
	});
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: 0,
		fromY: -plaqueHeight * 0.72,
		thickness: Math.max(4, plaqueWidth * 0.03),
		toX: plaqueWidth / 2,
		toY: -plaqueHeight / 2,
	});
	layoutCDrawDisc({
		color: frame.palette.accent,
		options,
		radius: plaqueHeight * 0.075,
		x: -plaqueWidth * 0.32,
		y: -plaqueHeight * 0.24,
	});
	const text = layoutCText(options);
	const size = layoutCSize({
		height: plaqueHeight,
		maxHeightRatio: 0.28,
		maxWidthRatio: 0.72,
		text,
		width: plaqueWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text,
		x: 0,
		y: plaqueHeight * 0.08,
		maxWidth: plaqueWidth * 0.76,
		size,
	});
	ctx.textAlign = "right";
	const metaSize = Math.max(9, size * 0.2);
	setFontSize(metaSize);
	drawText({
		text: `奉納 / No.${String((Math.abs(seed) % 90) + 10)}`,
		x: plaqueWidth * 0.42,
		y: plaqueHeight * 0.4,
		maxWidth: plaqueWidth * 0.4,
		size: metaSize,
	});
	ctx.restore();
}

function drawChochin(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const units = layoutCUnits({
		count: Math.min(6, Math.max(1, layoutGlyphs(layoutCText(options)).length)),
		text: layoutCText(options),
	});
	const portrait = height > width;
	const rows = portrait && units.length > 3 ? 2 : 1;
	const perRow = Math.ceil(units.length / rows);
	const spacing = (width * 0.84) / Math.max(1, perRow);
	const lanternWidth = Math.min(
		spacing * 0.74,
		height * (rows > 1 ? 0.18 : 0.28),
	);
	const lanternHeight = lanternWidth * 1.38;
	const phase = layoutCPhase(options);
	for (let row = 0; row < rows; row += 1) {
		const count = Math.min(perRow, units.length - row * perRow);
		const wireY = rows > 1 ? height * (0.15 + row * 0.43) : height * 0.22;
		layoutCDrawWave({
			alpha: 0.72,
			amplitude: height * 0.035,
			color: frame.palette.secondary,
			cycles: 0.5,
			fromX: width * 0.03,
			options,
			phase: 0,
			thickness: Math.max(2, height * 0.003),
			toX: width * 0.97,
			y: wireY,
		});
		for (let column = 0; column < count; column += 1) {
			const index = row * perRow + column;
			const x = width / 2 + (column - (count - 1) / 2) * spacing;
			const top = wireY + lanternWidth * 0.13;
			const sway = Math.sin(phase * 0.55 + index * 0.9) * 0.055;
			ctx.save();
			ctx.translate(x, top);
			ctx.rotate(sway);
			layoutADrawLine({
				color: frame.palette.secondary,
				ctx,
				fromX: 0,
				fromY: -lanternWidth * 0.13,
				thickness: Math.max(1, lanternWidth * 0.012),
				toX: 0,
				toY: 0,
			});
			const baseAlpha = ctx.globalAlpha;
			const lanternAlpha =
				baseAlpha * (0.78 + 0.18 * Math.sin(phase * 1.4 + index));
			for (let band = 0; band < 14; band += 1) {
				const unit = (band + 0.5) / 14;
				const halfWidth =
					lanternWidth * 0.5 * (0.64 + Math.sin(unit * Math.PI) * 0.36);
				ctx.fillStyle = frame.palette.accent;
				ctx.globalAlpha = lanternAlpha;
				ctx.fillRect(
					-halfWidth,
					unit * lanternHeight,
					halfWidth * 2,
					lanternHeight / 14 + 1,
				);
			}
			ctx.globalAlpha = baseAlpha;
			ctx.fillStyle = frame.palette.foreground;
			ctx.fillRect(
				-lanternWidth * 0.34,
				-lanternHeight * 0.02,
				lanternWidth * 0.68,
				lanternHeight * 0.07,
			);
			ctx.fillRect(
				-lanternWidth * 0.34,
				lanternHeight * 0.95,
				lanternWidth * 0.68,
				lanternHeight * 0.07,
			);
			const glyphs = layoutGlyphs(units[index] ?? "");
			const size = Math.min(
				lanternWidth * 0.38,
				(lanternHeight * 0.7) / Math.max(1, glyphs.length),
			);
			layoutCDrawVerticalGlyphs({
				color: frame.palette.background,
				fontSize: size,
				glyphs,
				options,
				x: 0,
				y: lanternHeight * 0.15,
			});
			ctx.restore();
		}
	}
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	const labelSize = Math.max(9, Math.min(width, height) * 0.016);
	setFontSize(labelSize);
	drawText({
		text: "祭 / NIGHT LANTERN",
		x: width / 2,
		y: height * 0.94,
		maxWidth: width * 0.42,
		size: labelSize,
	});
}

function drawStationSign(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const signWidth = width * (height > width ? 0.88 : 0.82);
	const signHeight = Math.min(height * 0.42, signWidth * 0.36);
	const left = width / 2 - signWidth / 2;
	const top = height / 2 - signHeight / 2;
	layoutADrawPlate({
		alpha: 0.28,
		color: frame.palette.foreground,
		ctx,
		height: signHeight,
		width: signWidth,
		x: width / 2 + signHeight * 0.05,
		y: height / 2 + signHeight * 0.07,
	});
	layoutADrawPlate({
		color: frame.palette.background,
		ctx,
		height: signHeight,
		width: signWidth,
		x: width / 2,
		y: height / 2,
	});
	layoutADrawFrame({
		color: frame.palette.foreground,
		ctx,
		height: signHeight,
		left,
		thickness: Math.max(3, signHeight * 0.025),
		top,
		width: signWidth,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(left, top + signHeight * 0.78, signWidth, signHeight * 0.12);
	const size = layoutCSize({
		height: signHeight,
		maxHeightRatio: 0.34,
		maxWidthRatio: 0.68,
		text,
		width: signWidth,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text,
		x: width / 2,
		y: top + signHeight * 0.42,
		maxWidth: signWidth * 0.72,
		size,
	});
	const small = Math.max(9, size * 0.2);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(small);
	drawText({
		text: text.toUpperCase().replace(/\s+/gu, "-") || "STATION",
		x: width / 2,
		y: top + signHeight * 0.65,
		maxWidth: signWidth * 0.54,
		size: small,
	});
	for (const direction of [-1, 1]) {
		const x = width / 2 + direction * signWidth * 0.39;
		layoutCDrawDisc({
			color: frame.palette.accent,
			options,
			radius: signHeight * 0.11,
			x,
			y: top + signHeight * 0.42,
		});
		ctx.fillStyle = frame.palette.background;
		ctx.textAlign = "center";
		setFontSize(small * 0.9);
		drawText({
			text: direction < 0 ? "←" : "→",
			x,
			y: top + signHeight * 0.42,
			maxWidth: signHeight * 0.16,
			size: small * 0.9,
		});
	}
	const stopX = left + signWidth * (0.12 + frame.progress * 0.76);
	layoutCDrawDisc({
		color: frame.palette.foreground,
		options,
		radius: signHeight * 0.035,
		x: stopX,
		y: top + signHeight * 0.84,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		left + signWidth * 0.18,
		top + signHeight,
		signHeight * 0.055,
		height * 0.22,
	);
	ctx.fillRect(
		left + signWidth * 0.78,
		top + signHeight,
		signHeight * 0.055,
		height * 0.22,
	);
}

function drawNoren(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const glyphs = layoutGlyphs(text);
	const panels = Math.min(6, Math.max(3, glyphs.length));
	const totalWidth = width * 0.82;
	const panelWidth = totalWidth / panels;
	const top = height * 0.18;
	const panelHeight = height * 0.56;
	const left = width / 2 - totalWidth / 2;
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		left - panelWidth * 0.05,
		top - height * 0.035,
		totalWidth * 1.1,
		Math.max(5, height * 0.024),
	);
	for (let panel = 0; panel < panels; panel += 1) {
		const part = panel - (panels - 1) / 2;
		const open = Math.sin(layoutCPhase(options)) * 0.025 * part;
		ctx.save();
		ctx.translate(left + (panel + 0.5) * panelWidth, top);
		ctx.rotate(open);
		ctx.fillStyle =
			panel % 2 === 0 ? frame.palette.accent : frame.palette.secondary;
		ctx.fillRect(-panelWidth * 0.48, 0, panelWidth * 0.96, panelHeight);
		const notch = panelWidth * 0.18;
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(-notch / 2, panelHeight - notch * 0.55, notch, notch * 0.65);
		layoutCDrawVerticalGlyphs({
			color: frame.palette.background,
			fontSize: Math.min(panelWidth * 0.48, panelHeight * 0.16),
			glyphs: glyphs.filter((_, index) => index % panels === panel).slice(0, 4),
			options,
			x: 0,
			y: panelHeight * 0.2,
		});
		ctx.restore();
	}
	layoutCDrawFolio({
		label: "暖簾 / OPEN",
		options,
		x: width * 0.9,
		y: height * 0.86,
	});
}

function drawTanzaku(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const units = layoutCUnits({
		count: Math.min(5, Math.max(2, layoutGlyphs(layoutCText(options)).length)),
		text: layoutCText(options),
	});
	const count = units.length;
	const stripWidth = Math.min(width * 0.13, height * 0.16);
	const stripHeight = Math.min(height * 0.62, stripWidth * 4.2);
	const spacing = (width * 0.76) / Math.max(1, count);
	const phase = layoutCPhase(options);
	for (const [index, unit] of units.entries()) {
		const x = width / 2 + (index - (count - 1) / 2) * spacing;
		const top =
			height * 0.2 +
			layoutUnit(layoutCSeed(options), index, 601) * height * 0.08;
		const sway = Math.sin(phase * 0.6 + index * 0.8) * 0.075;
		ctx.save();
		ctx.translate(x, top);
		ctx.rotate(sway);
		layoutADrawLine({
			color: frame.palette.secondary,
			ctx,
			fromX: 0,
			fromY: -height * 0.16,
			thickness: Math.max(1, stripWidth * 0.016),
			toX: 0,
			toY: 0,
		});
		ctx.fillStyle =
			index % 2 === 0 ? frame.palette.accent : frame.palette.background;
		ctx.fillRect(-stripWidth / 2, 0, stripWidth, stripHeight);
		layoutADrawFrame({
			alpha: 0.5,
			color: frame.palette.secondary,
			ctx,
			height: stripHeight,
			left: -stripWidth / 2,
			thickness: Math.max(1, stripWidth * 0.018),
			top: 0,
			width: stripWidth,
		});
		layoutCDrawDisc({
			color: frame.palette.background,
			options,
			radius: stripWidth * 0.06,
			x: 0,
			y: stripWidth * 0.12,
		});
		layoutCDrawVerticalGlyphs({
			color:
				index % 2 === 0 ? frame.palette.background : frame.palette.foreground,
			fontSize: Math.min(
				stripWidth * 0.48,
				(stripHeight * 0.68) / Math.max(1, layoutGlyphs(unit).length),
			),
			glyphs: layoutGlyphs(unit),
			options,
			x: 0,
			y: stripHeight * 0.23,
		});
		ctx.restore();
	}
}

function drawOmikuji(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const paperWidth = Math.min(
		width * (height > width ? 0.7 : 0.38),
		height * 0.42,
	);
	const paperHeight = height * 0.78;
	const phase = layoutCPhase(options);
	ctx.save();
	ctx.translate(width / 2, height / 2);
	ctx.rotate(Math.sin(phase * 0.55) * 0.045);
	layoutCDrawPaper({
		color: frame.palette.background,
		height: paperHeight,
		left: -paperWidth / 2,
		options,
		top: -paperHeight / 2,
		width: paperWidth,
	});
	const headerHeight = paperHeight * 0.13;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(-paperWidth / 2, -paperHeight / 2, paperWidth, headerHeight);
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	const headerSize = Math.max(12, headerHeight * 0.35);
	setFontSize(headerSize);
	drawText({
		text: "御 神 籤",
		x: 0,
		y: -paperHeight / 2 + headerHeight / 2,
		maxWidth: paperWidth * 0.72,
		size: headerSize,
	});
	const fortuneSize = paperWidth * 0.2;
	layoutADrawFrame({
		color: frame.palette.accent,
		ctx,
		height: fortuneSize * 1.4,
		left: -fortuneSize * 0.7,
		thickness: Math.max(2, fortuneSize * 0.06),
		top: -paperHeight * 0.28,
		width: fortuneSize * 1.4,
	});
	ctx.fillStyle = frame.palette.accent;
	setFontSize(fortuneSize);
	drawText({
		text: "大吉",
		x: 0,
		y: -paperHeight * 0.28 + fortuneSize * 0.7,
		maxWidth: fortuneSize * 1.2,
		size: fortuneSize,
	});
	const glyphs = layoutGlyphs(text).slice(0, 14);
	layoutCDrawVerticalGlyphs({
		color: frame.palette.foreground,
		fontSize: Math.min(
			paperWidth * 0.18,
			(paperHeight * 0.42) / Math.max(1, glyphs.length),
		),
		glyphs,
		options,
		x: 0,
		y: paperHeight * 0.02,
	});
	layoutCDrawBodyRows({
		alpha: 0.32,
		color: frame.palette.secondary,
		left: -paperWidth * 0.38,
		options,
		rowGap: Math.max(5, paperHeight * 0.018),
		rows: 6,
		seed: layoutCSeed(options),
		top: paperHeight * 0.3,
		width: paperWidth * 0.76,
	});
	ctx.restore();
}

function drawKakejiku(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const portrait = height > width;
	const scrollWidth = portrait
		? width * 0.58
		: Math.min(width * 0.34, height * 0.48);
	const scrollHeight = height * 0.78;
	const centerX = width / 2;
	const top = height * 0.11;
	const open = 0.86 + Math.sin(layoutCPhase(options)) * 0.08;
	ctx.save();
	ctx.beginPath();
	ctx.rect(centerX - scrollWidth, top, scrollWidth * 2, scrollHeight * open);
	ctx.clip();
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(centerX - scrollWidth / 2, top, scrollWidth, scrollHeight);
	const paperLeft = centerX - scrollWidth * 0.39;
	const paperTop = top + scrollHeight * 0.18;
	const paperWidth = scrollWidth * 0.78;
	const paperHeight = scrollHeight * 0.64;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		paperLeft - scrollWidth * 0.025,
		paperTop - scrollHeight * 0.025,
		paperWidth + scrollWidth * 0.05,
		paperHeight + scrollHeight * 0.05,
	);
	ctx.fillStyle = frame.palette.background;
	ctx.fillRect(paperLeft, paperTop, paperWidth, paperHeight);
	const glyphs = layoutGlyphs(layoutCText(options));
	layoutCDrawVerticalGlyphs({
		color: frame.palette.foreground,
		fontSize: Math.min(
			paperWidth * 0.35,
			(paperHeight * 0.84) / Math.max(1, glyphs.length),
		),
		glyphs,
		options,
		x: centerX,
		y: paperTop + paperHeight * 0.08,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		paperLeft + paperWidth * 0.08,
		paperTop + paperHeight * 0.78,
		paperWidth * 0.13,
		paperWidth * 0.13,
	);
	ctx.restore();
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		centerX - scrollWidth * 0.57,
		top - scrollWidth * 0.03,
		scrollWidth * 1.14,
		scrollWidth * 0.06,
	);
	ctx.fillRect(
		centerX - scrollWidth * 0.62,
		top + scrollHeight * open - scrollWidth * 0.03,
		scrollWidth * 1.24,
		scrollWidth * 0.08,
	);
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: centerX - scrollWidth * 0.3,
		fromY: top,
		thickness: Math.max(1, scrollWidth * 0.012),
		toX: centerX,
		toY: top - height * 0.07,
	});
	layoutADrawLine({
		color: frame.palette.secondary,
		ctx,
		fromX: centerX,
		fromY: top - height * 0.07,
		thickness: Math.max(1, scrollWidth * 0.012),
		toX: centerX + scrollWidth * 0.3,
		toY: top,
	});
}

function drawShoji(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const panels = height > width ? 2 : 4;
	const panelWidth = width / panels;
	const opening = width * (0.12 + frame.progress * 0.18);
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.24,
		maxWidthRatio: 0.68,
		text,
		width,
	});
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.72, size });
	for (let panel = 0; panel < panels; panel += 1) {
		const leftSide = panel < panels / 2;
		const offset = (leftSide ? -1 : 1) * opening;
		const left = panel * panelWidth + offset;
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(left, 0, panelWidth, height);
		const frameWidth = Math.max(4, panelWidth * 0.055);
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(left, 0, panelWidth, frameWidth);
		ctx.fillRect(left, height - frameWidth, panelWidth, frameWidth);
		ctx.fillRect(left, 0, frameWidth, height);
		ctx.fillRect(left + panelWidth - frameWidth, 0, frameWidth, height);
		for (let column = 1; column < 3; column += 1) {
			ctx.fillRect(
				left + (panelWidth * column) / 3,
				0,
				Math.max(2, frameWidth * 0.28),
				height,
			);
		}
		for (let row = 1; row < 6; row += 1) {
			ctx.fillRect(
				left,
				(height * row) / 6,
				panelWidth,
				Math.max(2, frameWidth * 0.25),
			);
		}
	}
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width / 2 - opening,
		height * 0.88,
		opening * 2,
		Math.max(3, height * 0.01),
	);
}

function drawKaruta(options: TypographyLayoutOptions): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const portrait = height > width;
	const cardHeight = Math.min(
		height * (portrait ? 0.36 : 0.7),
		(width * (portrait ? 0.58 : 0.34)) / 0.72,
	);
	const cardWidth = cardHeight * 0.72;
	const gap = cardWidth * 0.18;
	const phase = layoutCPhase(options);
	const positions = portrait
		? [
				[width / 2, height / 2 - (cardHeight + gap) / 2],
				[width / 2, height / 2 + (cardHeight + gap) / 2],
			]
		: [
				[width / 2 - (cardWidth + gap) / 2, height / 2],
				[width / 2 + (cardWidth + gap) / 2, height / 2],
			];
	for (const [index, [x, y]] of positions.entries()) {
		const slap = Math.sin(phase + index * 0.8) * cardWidth * 0.025;
		ctx.save();
		ctx.translate(x + slap, y);
		ctx.rotate((index === 0 ? -1 : 1) * 0.045 + (slap / cardWidth) * 0.4);
		layoutCDrawPaper({
			color: frame.palette.background,
			height: cardHeight,
			left: -cardWidth / 2,
			options,
			top: -cardHeight / 2,
			width: cardWidth,
		});
		layoutADrawFrame({
			color: frame.palette.accent,
			ctx,
			height: cardHeight * 0.9,
			left: -cardWidth * 0.44,
			thickness: Math.max(2, cardWidth * 0.025),
			top: -cardHeight * 0.45,
			width: cardWidth * 0.88,
		});
		if (index === 0) {
			const glyphs = layoutGlyphs(text).slice(0, 10);
			layoutCDrawVerticalGlyphs({
				color: frame.palette.foreground,
				fontSize: Math.min(
					cardWidth * 0.27,
					(cardHeight * 0.72) / Math.max(1, glyphs.length),
				),
				glyphs,
				options,
				x: 0,
				y: -cardHeight * 0.34,
			});
			ctx.fillStyle = frame.palette.accent;
			ctx.textAlign = "right";
			const mark = Math.max(9, cardWidth * 0.08);
			setFontSize(mark);
			drawText({
				text: "読",
				x: cardWidth * 0.34,
				y: -cardHeight * 0.38,
				maxWidth: mark,
				size: mark,
			});
		} else {
			layoutCDrawDisc({
				color: frame.palette.accent,
				options,
				radius: cardWidth * 0.2,
				x: cardWidth * 0.19,
				y: -cardHeight * 0.24,
			});
			const first = layoutGlyphs(text)[0] ?? "字";
			ctx.fillStyle = frame.palette.background;
			ctx.textAlign = "center";
			setFontSize(cardWidth * 0.22);
			drawText({
				text: first,
				x: cardWidth * 0.19,
				y: -cardHeight * 0.24,
				maxWidth: cardWidth * 0.3,
				size: cardWidth * 0.22,
			});
			for (let wave = 0; wave < 3; wave += 1) {
				layoutCDrawWave({
					alpha: 0.8,
					amplitude: cardWidth * 0.035,
					color: frame.palette.secondary,
					cycles: 1.5,
					fromX: -cardWidth * 0.34,
					options,
					phase,
					thickness: Math.max(2, cardWidth * 0.02),
					toX: cardWidth * 0.34,
					y: cardHeight * (0.06 + wave * 0.12),
				});
			}
		}
		ctx.restore();
	}
}
