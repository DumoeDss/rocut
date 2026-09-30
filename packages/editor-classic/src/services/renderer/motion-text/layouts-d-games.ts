import { layoutGlyphs, layoutSigned, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawDisc,
	layoutCDrawRing,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
	layoutCUnits,
} from "./layouts-c-utils";
import {
	layoutDColor,
	layoutDDrawCard,
	layoutDDrawPanel,
	layoutDDrawSquareDot,
	layoutDDrawText,
} from "./layouts-d-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const GAME_LAYOUTS = new Set([
	"burst",
	"crossword",
	"dominoes",
	"fisheye",
	"kaleido",
	"puzzle",
	"shadowPlay",
	"wordSearch",
]);

export function drawLayoutsDGames(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !GAME_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "burst":
			drawBurst(options);
			break;
		case "crossword":
			drawCrossword(options);
			break;
		case "dominoes":
			drawDominoes(options);
			break;
		case "fisheye":
			drawFisheye(options);
			break;
		case "kaleido":
			drawKaleido(options);
			break;
		case "puzzle":
			drawPuzzle(options);
			break;
		case "shadowPlay":
			drawShadowPlay(options);
			break;
		case "wordSearch":
			drawWordSearch(options);
			break;
	}
	return true;
}

function drawCrossword(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 12);
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const columns = portrait ? 7 : 11;
	const rows = portrait ? 9 : 6;
	const cell = Math.min((width * 0.78) / columns, (height * 0.72) / rows);
	const left = width / 2 - (columns * cell) / 2;
	const top = height / 2 - (rows * cell) / 2;
	const mainRow = Math.floor(rows / 2);
	const startColumn = Math.max(0, Math.floor((columns - glyphs.length) / 2));
	const seed = layoutCSeed(options);
	const phase = layoutCPhase(options);
	const cursor = Math.floor(frame.progress * columns) % columns;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x = left + column * cell;
			const y = top + row * cell;
			const glyphIndex = row === mainRow ? column - startColumn : -1;
			const lyricCell = glyphIndex >= 0 && glyphIndex < glyphs.length;
			const blocked = !lyricCell && layoutUnit(seed, row, column, 871) < 0.24;
			ctx.fillStyle = blocked
				? frame.palette.foreground
				: lyricCell && column === cursor
					? frame.palette.accent
					: frame.palette.background;
			ctx.fillRect(x, y, cell - 1, cell - 1);
			layoutADrawFrame({
				alpha: blocked ? 0.2 : 0.55,
				color: frame.palette.secondary,
				ctx,
				height: cell - 1,
				left: x,
				thickness: Math.max(1, cell * 0.035),
				top: y,
				width: cell - 1,
			});
			if (lyricCell) {
				layoutDDrawText({
					color:
						column === cursor
							? frame.palette.background
							: frame.palette.foreground,
					maxWidth: cell * 0.72,
					options,
					size: cell * 0.56,
					text: glyphs[glyphIndex]!,
					x: x + cell / 2,
					y: y + cell / 2,
				});
			} else if (!blocked && (row + column) % 4 === 0) {
				layoutDDrawText({
					align: "left",
					alpha: 0.55 + 0.2 * Math.sin(phase + row + column),
					color: frame.palette.secondary,
					maxWidth: cell * 0.3,
					options,
					size: Math.max(6, cell * 0.14),
					text: String(((row * columns + column) % 9) + 1),
					x: x + cell * 0.08,
					y: y + cell * 0.14,
				});
			}
		}
	}
}

function drawWordSearch(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const target = layoutGlyphs(layoutCText(options)).slice(0, 12);
	if (target.length === 0) return;
	const portrait = height > width;
	const columns = portrait ? 8 : 12;
	const rows = portrait ? 12 : 8;
	const cell = Math.min((width * 0.82) / columns, (height * 0.78) / rows);
	const left = width / 2 - (columns * cell) / 2;
	const top = height / 2 - (rows * cell) / 2;
	const seed = layoutCSeed(options);
	const phase = layoutCPhase(options);
	const pathRow = Math.floor(rows / 2);
	const startColumn = Math.max(0, Math.floor((columns - target.length) / 2));
	layoutDDrawPanel({
		alpha: 0.9,
		color: frame.palette.background,
		height: rows * cell + cell * 0.5,
		left: left - cell * 0.25,
		options,
		top: top - cell * 0.25,
		width: columns * cell + cell * 0.5,
	});
	const pool = [...target, "A", "R", "S", "T", "?", "☆"];
	const baseAlpha = ctx.globalAlpha;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const targetIndex = row === pathRow ? column - startColumn : -1;
			const onPath = targetIndex >= 0 && targetIndex < target.length;
			const glyph = onPath
				? target[targetIndex]!
				: pool[Math.floor(layoutUnit(seed, row, column, 881) * pool.length)]!;
			const pulse =
				onPath &&
				Math.floor(frame.progress * Math.max(1, target.length)) === targetIndex;
			if (onPath) {
				ctx.fillStyle = pulse ? frame.palette.accent : frame.palette.secondary;
				ctx.globalAlpha = baseAlpha * (pulse ? 0.8 : 0.24);
				ctx.fillRect(
					left + column * cell + cell * 0.06,
					top + row * cell + cell * 0.08,
					cell * 0.88,
					cell * 0.84,
				);
				ctx.globalAlpha = baseAlpha;
			}
			layoutDDrawText({
				alpha: onPath ? 1 : 0.55 + 0.12 * Math.sin(phase + row + column),
				color: onPath ? frame.palette.foreground : frame.palette.secondary,
				maxWidth: cell * 0.72,
				options,
				size: cell * (onPath ? 0.52 : 0.38),
				text: glyph,
				x: left + (column + 0.5) * cell,
				y: top + (row + 0.5) * cell,
			});
		}
	}
}

function drawPuzzle(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const columns = height > width ? 3 : 4;
	const rows = 3;
	const panelWidth = width * 0.76;
	const panelHeight = Math.min(height * 0.64, panelWidth * 0.7);
	const pieceWidth = panelWidth / columns;
	const pieceHeight = panelHeight / rows;
	const left = width / 2 - panelWidth / 2;
	const top = height / 2 - panelHeight / 2;
	const seed = layoutCSeed(options);
	const phase = layoutCPhase(options);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const index = row * columns + column;
			const movement = 0.5 + 0.5 * Math.sin(phase * 0.8 + index * 0.74);
			const x =
				left +
				(column + 0.5) * pieceWidth +
				layoutSigned(seed, index, 891) * pieceWidth * 0.11 * movement;
			const y =
				top +
				(row + 0.5) * pieceHeight +
				layoutSigned(seed, index, 892) * pieceHeight * 0.12 * movement;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(layoutSigned(seed, index, 893) * 0.07 * movement);
			layoutADrawPlate({
				color:
					index % 3 === 0 ? frame.palette.accent : frame.palette.background,
				ctx,
				height: pieceHeight * 0.92,
				width: pieceWidth * 0.92,
				x: 0,
				y: 0,
			});
			layoutADrawFrame({
				alpha: 0.7,
				color: frame.palette.secondary,
				ctx,
				height: pieceHeight * 0.92,
				left: -pieceWidth * 0.46,
				thickness: Math.max(1, pieceWidth * 0.018),
				top: -pieceHeight * 0.46,
				width: pieceWidth * 0.92,
			});
			layoutDDrawSquareDot({
				color: index % 2 ? frame.palette.background : frame.palette.secondary,
				options,
				size: Math.min(pieceWidth, pieceHeight) * 0.18,
				x: pieceWidth * 0.46,
				y: 0,
			});
			ctx.restore();
		}
	}
	const size = layoutCSize({
		height: panelHeight,
		maxHeightRatio: 0.22,
		maxWidthRatio: 0.68,
		text,
		width: panelWidth,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: panelWidth * 0.72,
		options,
		size,
		text,
		x: width / 2,
		y: height / 2,
	});
}

function drawShadowPlay(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.68,
		text,
		width,
	});
	const horizon = height * 0.66;
	const baseAlpha = ctx.globalAlpha;
	ctx.fillStyle = frame.palette.secondary;
	ctx.globalAlpha = baseAlpha * 0.16;
	ctx.fillRect(0, horizon, width, height - horizon);
	ctx.globalAlpha = baseAlpha;
	const sunX = width / 2 + Math.sin(phase * 0.35) * width * 0.34;
	const sunY = height * 0.18 + Math.cos(phase * 0.35) * height * 0.04;
	layoutCDrawDisc({
		alpha: 0.78,
		color: frame.palette.accent,
		options,
		radius: Math.min(width, height) * 0.045,
		x: sunX,
		y: sunY,
	});
	ctx.save();
	ctx.translate(width / 2, horizon);
	ctx.transform(1, 0, Math.sin(phase * 0.45) * 0.72, 0.34, 0, 0);
	layoutDDrawText({
		alpha: 0.42,
		color: frame.palette.foreground,
		maxWidth: width * 0.7,
		options,
		size: size * 1.08,
		text,
		x: 0,
		y: size * 0.2,
	});
	ctx.restore();
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: width * 0.72,
		options,
		size,
		text,
		x: width / 2,
		y: horizon - size * 0.7,
	});
}

function drawKaleido(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const units = layoutCUnits({ count: 4, text: layoutCText(options) });
	const phase = layoutCPhase(options);
	const centerX = width / 2;
	const centerY = height / 2;
	const radius = Math.min(width, height) * 0.36;
	const wedges = 8;
	for (let wedge = 0; wedge < wedges; wedge += 1) {
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate((wedge / wedges) * Math.PI * 2 + phase * 0.11);
		ctx.scale(wedge % 2 === 0 ? 1 : -1, 1);
		for (let ring = 1; ring <= 2; ring += 1) {
			const size = Math.max(9, radius * (0.14 + ring * 0.045));
			layoutDDrawText({
				alpha: 0.3 + ring * 0.18,
				color: layoutDColor({ index: wedge + ring, options }),
				maxWidth: radius * 0.45,
				options,
				size,
				text: units[(wedge + ring) % units.length]!,
				x: radius * (0.24 + ring * 0.3),
				y: 0,
			});
		}
		layoutADrawLine({
			alpha: 0.3,
			color: frame.palette.secondary,
			ctx,
			fromX: radius * 0.08,
			fromY: 0,
			thickness: Math.max(1, radius * 0.008),
			toX: radius * 0.94,
			toY: 0,
		});
		ctx.restore();
	}
	layoutCDrawRing({
		color: frame.palette.accent,
		innerColor: frame.palette.background,
		options,
		radius: radius * (0.24 + 0.035 * Math.sin(phase)),
		thickness: Math.max(3, radius * 0.035),
		x: centerX,
		y: centerY,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: radius * 0.36,
		options,
		size: radius * 0.13,
		text: units[0]!,
		x: centerX,
		y: centerY,
	});
}

function drawDominoes(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 12);
	if (glyphs.length === 0) return;
	const portrait = height > width;
	const perRow = Math.min(portrait ? 5 : 8, glyphs.length);
	const rows = Math.ceil(glyphs.length / perRow);
	const tileWidth = Math.min(
		(width * 0.8) / perRow / 1.25,
		(height * 0.68) / rows / 2,
	);
	const tileHeight = tileWidth * 1.85;
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / perRow);
		const count = Math.min(perRow, glyphs.length - row * perRow);
		const column = index % perRow;
		const fall = Math.sin(phase * 1.05 - index * 0.44) * 0.28;
		const x = width / 2 + (column - (count - 1) / 2) * tileWidth * 1.32;
		const y = height / 2 + (row - (rows - 1) / 2) * tileHeight * 1.12;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(fall);
		layoutDDrawCard({
			color: frame.palette.background,
			height: tileHeight,
			options,
			text: glyph,
			textColor: frame.palette.foreground,
			textSize: tileWidth * 0.55,
			width: tileWidth,
			x: 0,
			y: tileHeight * 0.22,
		});
		layoutADrawLine({
			alpha: 0.6,
			color: frame.palette.secondary,
			ctx,
			fromX: -tileWidth * 0.34,
			fromY: 0,
			thickness: Math.max(1, tileWidth * 0.035),
			toX: tileWidth * 0.34,
			toY: 0,
		});
		const pips = 1 + (Math.floor(layoutUnit(seed, index, 901) * 6) % 6);
		for (let pip = 0; pip < pips; pip += 1) {
			const columnPip = pip % 2;
			const rowPip = Math.floor(pip / 2);
			layoutDDrawSquareDot({
				color: frame.palette.accent,
				options,
				size: tileWidth * 0.09,
				x: (columnPip - 0.5) * tileWidth * 0.34,
				y: -tileHeight * 0.32 + rowPip * tileWidth * 0.19,
			});
		}
		ctx.restore();
	}
}

function drawBurst(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const centerX = width / 2;
	const centerY = height / 2;
	const radius = Math.min(width, height) * 0.3;
	for (let spike = 0; spike < 22; spike += 1) {
		const angle = (spike / 22) * Math.PI * 2 + phase * 0.03;
		const inner = radius * (0.82 + 0.08 * Math.sin(phase * 1.7 + spike));
		const outer =
			radius * (1.18 + layoutUnit(layoutCSeed(options), spike, 911) * 0.35);
		layoutADrawLine({
			alpha: 0.45 + (spike % 3) * 0.18,
			color: spike % 2 ? frame.palette.secondary : frame.palette.accent,
			ctx,
			fromX: centerX + Math.cos(angle) * inner,
			fromY: centerY + Math.sin(angle) * inner,
			thickness: Math.max(2, radius * 0.035),
			toX: centerX + Math.cos(angle) * outer,
			toY: centerY + Math.sin(angle) * outer,
		});
	}
	layoutCDrawDisc({
		color: frame.palette.accent,
		options,
		radius: radius * (0.84 + 0.035 * Math.sin(phase * 2)),
		scaleX: 1.18,
		x: centerX,
		y: centerY,
	});
	const size = layoutCSize({
		height: radius * 2,
		maxHeightRatio: 0.3,
		maxWidthRatio: 0.72,
		text,
		width: radius * 2.2,
	});
	layoutDDrawText({
		color: frame.palette.background,
		maxWidth: radius * 1.6,
		options,
		size,
		text,
		x: centerX,
		y: centerY,
	});
}

function drawFisheye(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const glyphs = layoutGlyphs(layoutCText(options)).slice(0, 16);
	if (glyphs.length === 0) return;
	const phase = layoutCPhase(options);
	const baseSize = Math.min(
		height * 0.16,
		(width * 0.76) / glyphs.length / 0.62,
	);
	const lensX = width / 2 + Math.sin(phase * 0.55) * width * 0.28;
	const centerY = height / 2;
	let cursor = width / 2 - (glyphs.length * baseSize * 0.68) / 2;
	for (const [index, glyph] of glyphs.entries()) {
		const restX = cursor + baseSize * 0.34;
		const distance = (restX - lensX) / Math.max(1, baseSize * 2.2);
		const scale = 1 + Math.exp(-distance * distance) * 0.9;
		const advance = baseSize * 0.68 * scale;
		const x = cursor + advance / 2;
		cursor += advance;
		ctx.save();
		ctx.translate(x, centerY);
		ctx.scale(scale, scale);
		layoutDDrawText({
			color: scale > 1.45 ? frame.palette.accent : frame.palette.foreground,
			maxWidth: baseSize * 0.75,
			options,
			size: baseSize,
			text: glyph,
			x: 0,
			y: 0,
		});
		ctx.restore();
		if (index === glyphs.length - 1) break;
	}
	layoutCDrawRing({
		alpha: 0.64,
		color: frame.palette.accent,
		innerColor: frame.palette.background,
		options,
		radius: baseSize * 1.55,
		thickness: Math.max(2, baseSize * 0.05),
		x: lensX,
		y: centerY,
	});
	for (let ray = 0; ray < 8; ray += 1) {
		const angle = (ray / 8) * Math.PI * 2 + phase * 0.08;
		layoutADrawLine({
			alpha: 0.45,
			color: frame.palette.secondary,
			ctx,
			fromX: lensX + Math.cos(angle) * baseSize * 1.7,
			fromY: centerY + Math.sin(angle) * baseSize * 1.7,
			thickness: Math.max(1, baseSize * 0.025),
			toX: lensX + Math.cos(angle) * baseSize * 2.05,
			toY: centerY + Math.sin(angle) * baseSize * 2.05,
		});
	}
}
