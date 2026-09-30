import { layoutGlyphs, layoutSigned, layoutUnit } from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import {
	layoutCDrawDisc,
	layoutCDrawStripes,
	layoutCPhase,
	layoutCSeed,
	layoutCSize,
	layoutCText,
} from "./layouts-c-utils";
import {
	layoutDColor,
	layoutDDrawSquareDot,
	layoutDDrawText,
} from "./layouts-d-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const EFFECT_LAYOUTS = new Set([
	"contour",
	"glitchGrid",
	"halftoneBig",
	"maskReveal",
	"mosaicTiles",
	"origami",
	"sliceStack",
	"stencil",
	"wall",
	"zipper",
]);

export function drawLayoutsDEffects(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !EFFECT_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "contour":
			drawContour(options);
			break;
		case "glitchGrid":
			drawGlitchGrid(options);
			break;
		case "halftoneBig":
			drawHalftoneBig(options);
			break;
		case "maskReveal":
			drawMaskReveal(options);
			break;
		case "mosaicTiles":
			drawMosaicTiles(options);
			break;
		case "origami":
			drawOrigami(options);
			break;
		case "sliceStack":
			drawSliceStack(options);
			break;
		case "stencil":
			drawStencil(options);
			break;
		case "wall":
			drawWall(options);
			break;
		case "zipper":
			drawZipper(options);
			break;
	}
	return true;
}

function drawWall(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const horizonY = height * 0.52;
	const vanishX = width * (0.42 + 0.06 * Math.sin(phase * 0.35));
	const baseAlpha = ctx.globalAlpha;
	ctx.fillStyle = frame.palette.secondary;
	ctx.globalAlpha = baseAlpha * 0.18;
	ctx.fillRect(0, horizonY, width, height - horizonY);
	ctx.globalAlpha = baseAlpha;
	for (const side of [-1, 1]) {
		for (let line = 0; line < 7; line += 1) {
			const edgeX = side < 0 ? 0 : width;
			const edgeY = height * (0.12 + line * 0.13);
			layoutADrawLine({
				alpha: 0.22 + line * 0.035,
				color: line === 4 ? frame.palette.accent : frame.palette.secondary,
				ctx,
				fromX: vanishX,
				fromY: horizonY,
				thickness: Math.max(1, width * 0.002),
				toX: edgeX,
				toY: edgeY,
			});
		}
	}
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.18,
		maxWidthRatio: 0.54,
		text,
		width,
	});
	ctx.save();
	ctx.translate(width * 0.64, height * 0.48);
	ctx.transform(0.82, -0.08, -0.32, 0.92, 0, 0);
	layoutADrawPlate({
		alpha: 0.82,
		color: frame.palette.background,
		ctx,
		height: height * 0.5,
		width: width * 0.56,
		x: 0,
		y: 0,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: width * 0.44,
		options,
		size,
		text,
		x: 0,
		y: 0,
	});
	for (let row = -2; row <= 2; row += 1) {
		layoutDDrawText({
			alpha: 0.22 + 0.04 * Math.sin(phase + row),
			color: frame.palette.secondary,
			maxWidth: width * 0.4,
			options,
			size: Math.max(9, size * 0.18),
			text: "PERSPECTIVE / WALL / SIGNAL",
			x: 0,
			y: row * size * 0.7,
		});
	}
	ctx.restore();
}

function drawOrigami(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const side = Math.min(width, height) * 0.62;
	const centerX = width / 2;
	const centerY = height / 2;
	layoutADrawPlate({
		alpha: 0.28,
		color: frame.palette.foreground,
		ctx,
		height: side,
		width: side,
		x: centerX + side * 0.03,
		y: centerY + side * 0.04,
	});
	layoutADrawPlate({
		color: frame.palette.background,
		ctx,
		height: side,
		width: side,
		x: centerX,
		y: centerY,
	});
	for (let flap = 0; flap < 4; flap += 1) {
		const angle = flap * (Math.PI / 2);
		const fold = 0.18 + 0.72 * Math.abs(Math.cos(phase * 0.55 + flap));
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate(angle);
		ctx.scale(1, fold);
		layoutADrawPlate({
			alpha: 0.72,
			color: flap % 2 === 0 ? frame.palette.accent : frame.palette.secondary,
			ctx,
			height: side * 0.44,
			width: side * 0.92,
			x: 0,
			y: -side * 0.24,
		});
		layoutADrawLine({
			alpha: 0.6,
			color: frame.palette.foreground,
			ctx,
			fromX: -side * 0.46,
			fromY: -side * 0.02,
			thickness: Math.max(1, side * 0.006),
			toX: side * 0.46,
			toY: -side * 0.46,
		});
		ctx.restore();
	}
	const size = layoutCSize({
		height: side,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.64,
		text,
		width: side,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: side * 0.7,
		options,
		size,
		text,
		x: centerX,
		y: centerY,
	});
}

function drawZipper(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const gapMax = height * 0.22;
	const segments = 28;
	const segmentWidth = width / segments + 1;
	const centerY = height / 2;
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.2,
		maxWidthRatio: 0.72,
		text,
		width,
	});
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: width * 0.76,
		options,
		size,
		text,
		x: width / 2,
		y: centerY,
	});
	for (let segment = 0; segment < segments; segment += 1) {
		const unit = (segment + 0.5) / segments;
		const opening = Math.pow(Math.sin(unit * Math.PI), 0.8);
		const gap = gapMax * opening * (0.62 + 0.28 * Math.sin(phase * 0.75));
		const x = segment * (width / segments);
		ctx.fillStyle =
			segment % 2 === 0 ? frame.palette.accent : frame.palette.secondary;
		ctx.fillRect(x, 0, segmentWidth, centerY - gap);
		ctx.fillRect(x, centerY + gap, segmentWidth, height - centerY - gap);
		if (segment % 2 === 0) {
			layoutDDrawSquareDot({
				color: frame.palette.foreground,
				options,
				size: Math.max(3, segmentWidth * 0.44),
				x: x + segmentWidth / 2,
				y: centerY - gap - segmentWidth * 0.28,
			});
			layoutDDrawSquareDot({
				color: frame.palette.foreground,
				options,
				size: Math.max(3, segmentWidth * 0.44),
				x: x + segmentWidth / 2,
				y: centerY + gap + segmentWidth * 0.28,
			});
		}
	}
	const sliderX = width * (0.12 + 0.76 * frame.progress);
	layoutADrawPlate({
		color: frame.palette.foreground,
		ctx,
		height: Math.max(14, size * 0.34),
		width: Math.max(10, size * 0.2),
		x: sliderX,
		y: centerY,
	});
}

function drawSliceStack(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const slices = 9;
	const blockHeight = height * 0.56;
	const top = height / 2 - blockHeight / 2;
	const sliceHeight = blockHeight / slices;
	const size = layoutCSize({
		height: blockHeight,
		maxHeightRatio: 0.26,
		maxWidthRatio: 0.72,
		text,
		width,
	});
	for (let slice = 0; slice < slices; slice += 1) {
		const y = top + slice * sliceHeight;
		const offset = Math.sin(phase * 1.1 + slice * 0.74) * width * 0.055;
		ctx.save();
		ctx.beginPath();
		ctx.rect(width * 0.08, y, width * 0.84, sliceHeight - 1);
		ctx.clip();
		layoutDDrawText({
			color: slice % 3 === 0 ? frame.palette.accent : frame.palette.foreground,
			maxWidth: width * 0.72,
			options,
			size,
			text,
			x: width / 2 + offset,
			y: height / 2,
		});
		ctx.restore();
		layoutADrawLine({
			alpha: 0.28,
			color: frame.palette.secondary,
			ctx,
			fromX: width * 0.08 + offset,
			fromY: y + sliceHeight,
			thickness: Math.max(1, sliceHeight * 0.05),
			toX: width * 0.92 + offset,
			toY: y + sliceHeight,
		});
	}
}

function drawGlitchGrid(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const columns = height > width ? 3 : 4;
	const rows = height > width ? 5 : 3;
	const gutter = Math.min(width, height) * 0.012;
	const cellWidth = (width * 0.9 - gutter * (columns - 1)) / columns;
	const cellHeight = (height * 0.86 - gutter * (rows - 1)) / rows;
	const left = width * 0.05;
	const top = height * 0.07;
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	const baseAlpha = ctx.globalAlpha;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const index = row * columns + column;
			const x = left + column * (cellWidth + gutter);
			const y = top + row * (cellHeight + gutter);
			const clean =
				row === Math.floor(rows / 2) && column === Math.floor(columns / 2);
			ctx.fillStyle = clean
				? frame.palette.background
				: index % 3 === 0
					? frame.palette.foreground
					: frame.palette.background;
			ctx.globalAlpha =
				baseAlpha * (clean ? 1 : 0.45 + 0.2 * Math.sin(phase + index));
			ctx.fillRect(x, y, cellWidth, cellHeight);
			ctx.globalAlpha = baseAlpha;
			ctx.save();
			ctx.beginPath();
			ctx.rect(x, y, cellWidth, cellHeight);
			ctx.clip();
			const zoom = clean ? 1 : 1.4 + layoutUnit(seed, index, 921) * 1.7;
			layoutDDrawText({
				alpha: clean ? 1 : 0.62,
				color:
					clean || index % 3 !== 0
						? frame.palette.foreground
						: frame.palette.background,
				maxWidth: cellWidth * zoom,
				options,
				size: Math.min(cellHeight * 0.5, cellWidth * 0.22) * zoom,
				text,
				x:
					x +
					cellWidth / 2 +
					layoutSigned(seed, index, Math.floor(frame.progress * 10), 922) *
						cellWidth *
						0.22,
				y: y + cellHeight / 2,
			});
			ctx.restore();
			layoutADrawFrame({
				alpha: 0.6,
				color: clean ? frame.palette.accent : frame.palette.secondary,
				ctx,
				height: cellHeight,
				left: x,
				thickness: Math.max(1, gutter * 0.2),
				top: y,
				width: cellWidth,
			});
		}
	}
}

function drawMosaicTiles(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const columns = height > width ? 12 : 18;
	const rows = height > width ? 18 : 10;
	const tile = Math.min((width * 0.86) / columns, (height * 0.7) / rows);
	const left = width / 2 - (columns * tile) / 2;
	const top = height / 2 - (rows * tile) / 2;
	const seed = layoutCSeed(options);
	const phase = layoutCPhase(options);
	const baseAlpha = ctx.globalAlpha;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const centerBias =
				1 -
				Math.min(
					1,
					Math.hypot(
						(column - columns / 2) / (columns / 2),
						(row - rows / 2) / (rows / 2),
					),
				);
			const active =
				layoutUnit(seed, row, column, 931) < 0.18 + centerBias * 0.52;
			if (!active) continue;
			const pulse =
				0.62 + 0.38 * Math.sin(phase * 1.2 + row * 0.55 + column * 0.35);
			ctx.fillStyle = layoutDColor({ index: row + column, options });
			ctx.globalAlpha = baseAlpha * pulse;
			const inset = tile * (0.1 + layoutUnit(seed, row, column, 932) * 0.08);
			ctx.fillRect(
				left + column * tile + inset,
				top + row * tile + inset,
				tile - inset * 2,
				tile - inset * 2,
			);
		}
	}
	ctx.globalAlpha = baseAlpha;
	const size = layoutCSize({
		height: rows * tile,
		maxHeightRatio: 0.28,
		maxWidthRatio: 0.68,
		text,
		width: columns * tile,
	});
	layoutDDrawText({
		alpha: 0.88,
		color: frame.palette.foreground,
		maxWidth: columns * tile * 0.72,
		options,
		size,
		text,
		x: width / 2,
		y: height / 2,
	});
}

function drawMaskReveal(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.34,
		maxWidthRatio: 0.86,
		text,
		width,
	});
	const blockWidth = width * 0.86;
	const blockHeight = Math.min(height * 0.58, size * 2.4);
	const left = width / 2 - blockWidth / 2;
	const top = height / 2 - blockHeight / 2;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left, top, blockWidth, blockHeight);
	ctx.clip();
	layoutCDrawStripes({
		alpha: 0.88,
		colorA: frame.palette.accent,
		colorB: frame.palette.secondary,
		height: blockHeight,
		left,
		options,
		phase: phase * size * 0.2,
		stripeWidth: Math.max(8, size * 0.16),
		top,
		width: blockWidth,
	});
	ctx.restore();
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: blockWidth * 0.92,
		options,
		size,
		text,
		x: width / 2,
		y: height / 2,
	});
	ctx.strokeStyle = frame.palette.background;
	ctx.lineWidth = Math.max(2, size * 0.035);
	ctx.textAlign = "center";
	options.setFontSize(size);
	ctx.strokeText(text, width / 2, height / 2, blockWidth * 0.92);
	layoutDDrawText({
		color: frame.palette.secondary,
		maxWidth: blockWidth * 0.5,
		options,
		size: Math.max(9, size * 0.12),
		text: `MASK WINDOW / ${String(Math.floor(frame.progress * 100)).padStart(2, "0")}`,
		x: width / 2,
		y: top + blockHeight * 0.92,
	});
}

function drawContour(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, setFontSize, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const glyph = layoutGlyphs(text)[0] ?? "A";
	const bigSize = Math.min(height * 0.82, width * 0.58);
	const centerX = width * (height > width ? 0.54 : 0.66);
	const centerY = height * 0.46;
	ctx.save();
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	setFontSize(bigSize);
	for (let ring = 6; ring >= 1; ring -= 1) {
		ctx.strokeStyle =
			ring % 2 === 0 ? frame.palette.secondary : frame.palette.accent;
		ctx.lineWidth = Math.max(1, bigSize * (0.008 + ring * 0.013));
		ctx.globalAlpha = baseAlpha * (0.12 + ring * 0.08);
		ctx.strokeText(
			glyph,
			centerX + Math.sin(phase * 0.6 + ring) * bigSize * 0.012,
			centerY,
			bigSize,
		);
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.background;
	ctx.fillText(glyph, centerX, centerY, bigSize);
	ctx.restore();
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.11,
		maxWidthRatio: height > width ? 0.72 : 0.42,
		text,
		width,
	});
	const x = height > width ? width / 2 : width * 0.28;
	const y = height > width ? height * 0.79 : height * 0.68;
	layoutDDrawText({
		color: frame.palette.foreground,
		maxWidth: width * (height > width ? 0.78 : 0.46),
		options,
		size,
		text,
		x,
		y,
	});
	layoutADrawLine({
		color: frame.palette.accent,
		ctx,
		fromX: x - width * 0.16,
		fromY: y + size * 0.7,
		thickness: Math.max(2, size * 0.06),
		toX: x + width * (0.08 + frame.progress * 0.14),
		toY: y + size * 0.7,
	});
}

function drawHalftoneBig(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const phase = layoutCPhase(options);
	const columns = height > width ? 12 : 18;
	const rows = height > width ? 18 : 10;
	const cellWidth = width / columns;
	const cellHeight = height / rows;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const wave =
				0.5 + 0.5 * Math.sin(phase * 0.75 + column * 0.48 - row * 0.36);
			const center =
				1 -
				Math.min(
					1,
					Math.hypot(
						(column - columns / 2) / (columns / 2),
						(row - rows / 2) / (rows / 2),
					),
				);
			if (center < 0.12) continue;
			const dot =
				Math.min(cellWidth, cellHeight) * (0.14 + wave * center * 0.62);
			layoutDDrawSquareDot({
				alpha: 0.35 + center * 0.55,
				color:
					(row + column) % 5 === 0
						? frame.palette.accent
						: frame.palette.foreground,
				options,
				size: dot,
				x: (column + 0.5) * cellWidth,
				y: (row + 0.5) * cellHeight,
			});
		}
	}
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.34,
		maxWidthRatio: 0.88,
		text,
		width,
	});
	ctx.strokeStyle = frame.palette.background;
	ctx.lineWidth = Math.max(3, size * 0.08);
	ctx.textAlign = "center";
	options.setFontSize(size);
	ctx.strokeText(text, width / 2, height / 2, width * 0.88);
	layoutDDrawText({
		alpha: 0.18,
		color: frame.palette.background,
		maxWidth: width * 0.86,
		options,
		size,
		text,
		x: width / 2,
		y: height / 2,
	});
}

function drawStencil(options: TypographyLayoutOptions): void {
	const { ctx, frame, height, width } = options;
	const text = layoutCText(options);
	const glyphs = layoutGlyphs(text).slice(0, 14);
	const phase = layoutCPhase(options);
	const seed = layoutCSeed(options);
	const size = layoutCSize({
		height,
		maxHeightRatio: 0.26,
		maxWidthRatio: 0.78,
		text,
		width,
	});
	layoutDDrawText({
		color: frame.palette.accent,
		maxWidth: width * 0.82,
		options,
		size,
		text,
		x: width / 2,
		y: height / 2,
	});
	const span = Math.min(width * 0.76, glyphs.length * size * 0.66);
	for (const [index] of glyphs.entries()) {
		const x =
			width / 2 +
			(index - (glyphs.length - 1) / 2) * (span / Math.max(1, glyphs.length));
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(
			x - size * 0.035,
			height / 2 - size * 0.58,
			size * 0.07,
			size * 1.16,
		);
		if (index % 2 === 1) {
			ctx.fillRect(
				x - size * 0.28,
				height / 2 - size * 0.03,
				size * 0.56,
				size * 0.06,
			);
		}
	}
	for (let dot = 0; dot < 70; dot += 1) {
		const angle = layoutUnit(seed, dot, 941) * Math.PI * 2;
		const distance = size * (0.5 + layoutUnit(seed, dot, 942) * 1.9);
		const x = width / 2 + Math.cos(angle) * distance * 1.8;
		const y = height / 2 + Math.sin(angle) * distance * 0.62;
		layoutDDrawSquareDot({
			alpha: 0.18 + 0.22 * Math.sin(phase + dot),
			color: frame.palette.accent,
			options,
			size: Math.max(1, size * (0.008 + layoutUnit(seed, dot, 943) * 0.018)),
			x,
			y,
		});
	}
	const headX = width * (0.12 + frame.progress * 0.76);
	layoutCDrawDisc({
		color: frame.palette.foreground,
		options,
		radius: Math.max(4, size * 0.06),
		x: headX,
		y: height * 0.3,
	});
	layoutADrawLine({
		alpha: 0.5,
		color: frame.palette.secondary,
		ctx,
		fromX: headX,
		fromY: height * 0.32,
		thickness: Math.max(2, size * 0.04),
		toX: headX,
		toY: height * 0.42,
	});
}
