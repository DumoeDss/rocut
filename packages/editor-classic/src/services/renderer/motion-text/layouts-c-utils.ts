import {
	drawDiscBands,
	estimatedTextWidth,
	layoutGlyphs,
	layoutUnit,
} from "./core-layout-utils";
import {
	layoutADrawFrame,
	layoutADrawLine,
	layoutADrawPlate,
} from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function layoutCText(options: TypographyLayoutOptions): string {
	return options.frame.cut?.text.trim() || "MOTION TEXT";
}

export function layoutCSeed(options: TypographyLayoutOptions): number {
	return options.frame.cut?.seed ?? 0;
}

export function layoutCPhase(options: TypographyLayoutOptions): number {
	return options.frame.progress * Math.PI * 2;
}

export function layoutCUnits({
	count,
	text,
}: {
	readonly count: number;
	readonly text: string;
}): string[] {
	const normalized = text.trim().replace(/\s+/gu, " ");
	const words = normalized.split(" ").filter(Boolean);
	if (words.length >= count) {
		return Array.from({ length: count }, (_, index) => {
			const start = Math.floor((index * words.length) / count);
			const end = Math.max(
				start + 1,
				Math.floor(((index + 1) * words.length) / count),
			);
			return words.slice(start, end).join(" ");
		});
	}
	const glyphs = layoutGlyphs(normalized);
	if (glyphs.length === 0) return [normalized];
	const actualCount = Math.min(count, glyphs.length);
	return Array.from({ length: actualCount }, (_, index) => {
		const start = Math.floor((index * glyphs.length) / actualCount);
		const end = Math.max(
			start + 1,
			Math.floor(((index + 1) * glyphs.length) / actualCount),
		);
		return glyphs.slice(start, end).join("");
	});
}

export function layoutCSize({
	height,
	maxHeightRatio,
	maxWidthRatio,
	text,
	width,
}: {
	readonly height: number;
	readonly maxHeightRatio: number;
	readonly maxWidthRatio: number;
	readonly text: string;
	readonly width: number;
}): number {
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	return Math.max(
		12,
		Math.min(
			height * maxHeightRatio,
			(width * maxWidthRatio) / Math.max(1, glyphCount * 0.62),
		),
	);
}

export function layoutCDrawDisc({
	alpha = 1,
	color,
	options,
	radius,
	scaleX = 1,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly options: TypographyLayoutOptions;
	readonly radius: number;
	readonly scaleX?: number;
	readonly x: number;
	readonly y: number;
}): void {
	drawDiscBands({
		alpha,
		color,
		ctx: options.ctx,
		radius,
		scaleX,
		x,
		y,
	});
}

export function layoutCDrawRing({
	alpha = 1,
	color,
	innerColor,
	options,
	radius,
	thickness,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly innerColor: string;
	readonly options: TypographyLayoutOptions;
	readonly radius: number;
	readonly thickness: number;
	readonly x: number;
	readonly y: number;
}): void {
	layoutCDrawDisc({ alpha, color, options, radius, x, y });
	layoutCDrawDisc({
		alpha,
		color: innerColor,
		options,
		radius: Math.max(0, radius - thickness),
		x,
		y,
	});
}

export function layoutCDrawDashedLine({
	alpha = 1,
	color,
	dashes = 16,
	fromX,
	fromY,
	options,
	thickness,
	toX,
	toY,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly dashes?: number;
	readonly fromX: number;
	readonly fromY: number;
	readonly options: TypographyLayoutOptions;
	readonly thickness: number;
	readonly toX: number;
	readonly toY: number;
}): void {
	for (let index = 0; index < dashes; index += 2) {
		const start = index / dashes;
		const end = Math.min(1, (index + 1) / dashes);
		layoutADrawLine({
			alpha,
			color,
			ctx: options.ctx,
			fromX: fromX + (toX - fromX) * start,
			fromY: fromY + (toY - fromY) * start,
			thickness,
			toX: fromX + (toX - fromX) * end,
			toY: fromY + (toY - fromY) * end,
		});
	}
}

export function layoutCDrawPerforation({
	alpha = 1,
	color,
	height,
	left,
	options,
	step,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly left: number;
	readonly options: TypographyLayoutOptions;
	readonly step: number;
	readonly top: number;
	readonly width: number;
}): void {
	const dot = Math.max(1, step * 0.22);
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	for (let x = left; x <= left + width; x += step) {
		ctx.fillRect(x - dot / 2, top - dot / 2, dot, dot);
		ctx.fillRect(x - dot / 2, top + height - dot / 2, dot, dot);
	}
	for (let y = top; y <= top + height; y += step) {
		ctx.fillRect(left - dot / 2, y - dot / 2, dot, dot);
		ctx.fillRect(left + width - dot / 2, y - dot / 2, dot, dot);
	}
	ctx.globalAlpha = baseAlpha;
}

export function layoutCDrawStripes({
	alpha = 1,
	colorA,
	colorB,
	height,
	left,
	options,
	phase = 0,
	stripeWidth,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly colorA: string;
	readonly colorB: string;
	readonly height: number;
	readonly left: number;
	readonly options: TypographyLayoutOptions;
	readonly phase?: number;
	readonly stripeWidth: number;
	readonly top: number;
	readonly width: number;
}): void {
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left, top, width, height);
	ctx.clip();
	ctx.globalAlpha = baseAlpha * alpha;
	const offset =
		((phase % (stripeWidth * 2)) + stripeWidth * 2) % (stripeWidth * 2);
	for (
		let index = -2, x = left - stripeWidth * 2 + offset;
		x < left + width + stripeWidth * 2;
		index += 1, x += stripeWidth
	) {
		ctx.fillStyle = index % 2 === 0 ? colorA : colorB;
		ctx.fillRect(x, top, stripeWidth + 0.5, height);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

export function layoutCDrawWave({
	alpha = 1,
	amplitude,
	color,
	cycles,
	fromX,
	options,
	phase = 0,
	thickness,
	toX,
	y,
}: {
	readonly alpha?: number;
	readonly amplitude: number;
	readonly color: string;
	readonly cycles: number;
	readonly fromX: number;
	readonly options: TypographyLayoutOptions;
	readonly phase?: number;
	readonly thickness: number;
	readonly toX: number;
	readonly y: number;
}): void {
	const segments = 24;
	let previousX = fromX;
	let previousY = y + Math.sin(phase) * amplitude;
	for (let index = 1; index <= segments; index += 1) {
		const unit = index / segments;
		const x = fromX + (toX - fromX) * unit;
		const nextY = y + Math.sin(phase + unit * Math.PI * 2 * cycles) * amplitude;
		layoutADrawLine({
			alpha,
			color,
			ctx: options.ctx,
			fromX: previousX,
			fromY: previousY,
			thickness,
			toX: x,
			toY: nextY,
		});
		previousX = x;
		previousY = nextY;
	}
}

export function layoutCDrawBarcode({
	alpha = 1,
	color,
	height,
	left,
	options,
	seed,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly left: number;
	readonly options: TypographyLayoutOptions;
	readonly seed: number;
	readonly top: number;
	readonly width: number;
}): void {
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	let x = left;
	let index = 0;
	while (x < left + width && index < 72) {
		const barWidth = Math.max(
			1,
			width * (0.008 + layoutUnit(seed, index, 301) * 0.018),
		);
		const gap = width * (0.005 + layoutUnit(seed, index, 302) * 0.012);
		ctx.fillRect(
			x,
			top,
			barWidth,
			height * (0.72 + layoutUnit(seed, index, 303) * 0.28),
		);
		x += barWidth + gap;
		index += 1;
	}
	ctx.globalAlpha = baseAlpha;
}

export function layoutCDrawBodyRows({
	alpha = 0.42,
	color,
	left,
	options,
	rowGap,
	rows,
	seed,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly left: number;
	readonly options: TypographyLayoutOptions;
	readonly rowGap: number;
	readonly rows: number;
	readonly seed: number;
	readonly top: number;
	readonly width: number;
}): void {
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	for (let row = 0; row < rows; row += 1) {
		const length =
			width * (row === rows - 1 ? 0.38 + layoutUnit(seed, row, 311) * 0.44 : 1);
		const dashes = Math.min(
			24,
			Math.max(8, Math.round(length / Math.max(3, rowGap * 0.34))),
		);
		const thickness = Math.max(1, rowGap * 0.28);
		const y = top + row * rowGap - thickness / 2;
		for (let dash = 0; dash < dashes; dash += 2) {
			const start = dash / dashes;
			const end = Math.min(1, (dash + 1) / dashes);
			ctx.fillRect(left + length * start, y, length * (end - start), thickness);
		}
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function layoutCDrawVerticalGlyphs({
	alpha = 1,
	color,
	fontSize,
	glyphs,
	options,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly fontSize: number;
	readonly glyphs: readonly string[];
	readonly options: TypographyLayoutOptions;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx, drawText, setFontSize } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.textAlign = "center";
	setFontSize(fontSize);
	for (const [index, glyph] of glyphs.entries()) {
		drawText({
			text: glyph,
			x,
			y: y + index * fontSize * 1.03,
			maxWidth: fontSize,
			size: fontSize,
		});
	}
	ctx.globalAlpha = baseAlpha;
}

export function layoutCDrawFolio({
	label,
	options,
	x,
	y,
}: {
	readonly label: string;
	readonly options: TypographyLayoutOptions;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx, drawText, frame, height, setFontSize, width } = options;
	const size = Math.max(9, Math.min(width, height) * 0.018);
	const pulse = 0.62 + 0.25 * Math.sin(layoutCPhase(options));
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "right";
	setFontSize(size);
	drawText({ text: label, x, y, maxWidth: width * 0.3, size });
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(x - width * 0.12, y + size * 0.66, width * 0.12 * pulse, 2);
}

export function layoutCDrawPaper({
	alpha = 1,
	color,
	height,
	left,
	options,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly left: number;
	readonly options: TypographyLayoutOptions;
	readonly top: number;
	readonly width: number;
}): void {
	const shadow = Math.max(3, Math.min(options.width, options.height) * 0.012);
	layoutADrawPlate({
		alpha: alpha * 0.28,
		color: options.frame.palette.foreground,
		ctx: options.ctx,
		height,
		width,
		x: left + width / 2 + shadow,
		y: top + height / 2 + shadow,
	});
	layoutADrawPlate({
		alpha,
		color,
		ctx: options.ctx,
		height,
		width,
		x: left + width / 2,
		y: top + height / 2,
	});
	layoutADrawFrame({
		alpha: alpha * 0.5,
		color: options.frame.palette.secondary,
		ctx: options.ctx,
		height,
		left,
		thickness: Math.max(1, Math.min(width, height) * 0.004),
		top,
		width,
	});
}

export function layoutCTextWidth({
	maxWidth,
	size,
	text,
}: {
	readonly maxWidth: number;
	readonly size: number;
	readonly text: string;
}): number {
	return Math.min(maxWidth, estimatedTextWidth({ size, text }));
}
