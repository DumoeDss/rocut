import { drawHorrorTransition } from "./horror-transitions";
import { drawKineticTransition } from "./kinetic-transitions";
import { drawTreatTransTransition } from "./treat-trans-transitions";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface TypographyTransitionDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawCurrent: () => void;
	readonly drawPrevious: () => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawTypographyTransition(
	options: TypographyTransitionDraw,
): boolean {
	if (!options.frame.previousCut) return false;
	if (drawHorrorTransition(options)) return true;
	if (drawKineticTransition(options)) return true;
	if (drawTreatTransTransition(options)) return true;
	switch (options.frame.cut?.preset.trans) {
		case "tyRuleWipe":
			drawRuleWipe(options);
			return true;
		case "tyGridCells":
			drawGridCells(options);
			return true;
		default:
			return false;
	}
}

function drawRuleWipe(options: TypographyTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (progress <= 0) {
		options.drawPrevious();
		return;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return;
	}
	options.drawPrevious();
	const bands = 9;
	const bandHeight = options.height / bands;
	const stagger = 0.5 / bands;
	const denominator = 1 - (bands - 1) * stagger;
	for (let index = 0; index < bands; index += 1) {
		const phase = inOutCubic(clamp((progress - index * stagger) / denominator));
		if (phase <= 0) continue;
		const y = Math.round(index * bandHeight);
		const height = Math.round((index + 1) * bandHeight) - y;
		const revealedWidth = options.width * phase;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(0, y, revealedWidth, height);
		options.ctx.clip();
		options.drawCurrent();
		options.ctx.restore();
		if (phase < 1) {
			options.ctx.fillStyle = options.frame.palette.accent;
			const cursorWidth = Math.max(3, bandHeight * 0.14);
			options.ctx.fillRect(
				revealedWidth,
				y + bandHeight * 0.2,
				cursorWidth,
				bandHeight * 0.6,
			);
		}
	}
	const alpha = 0.6 * Math.sin(Math.PI * clamp(progress));
	if (alpha <= 0) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	const line = Math.max(1, Math.min(options.width, options.height) * 0.0015);
	for (let index = 1; index < bands; index += 1) {
		options.ctx.fillRect(
			0,
			Math.round(index * bandHeight) - line / 2,
			options.width,
			line,
		);
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawGridCells(options: TypographyTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (progress <= 0) {
		options.drawPrevious();
		return;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return;
	}
	options.drawPrevious();
	const rows = 5;
	const cell = options.height / rows;
	const columns = Math.ceil(options.width / cell);
	const offsetX = (options.width - columns * cell) / 2;
	const total = rows * columns;
	const position = inOutCubic(clamp(progress / 0.92)) * total;
	for (
		let index = 0;
		index <= Math.floor(position) && index < total;
		index += 1
	) {
		const column = columns - 1 - Math.floor(index / rows);
		const row = index % rows;
		const x = offsetX + column * cell;
		const y = row * cell;
		const partial = index === Math.floor(position) ? position - index : 1;
		if (partial <= 0) continue;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(x, y, cell + 1, cell + 1);
		options.ctx.clip();
		options.ctx.globalAlpha *= partial;
		options.drawCurrent();
		options.ctx.restore();
		if (partial < 1) drawCellOutline({ ...options, cell, x, y });
	}
	const alpha = 0.5 * Math.sin(Math.PI * clamp(progress));
	if (alpha <= 0) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	const line = Math.max(1, Math.min(options.width, options.height) * 0.0016);
	for (let column = 0; column <= columns; column += 1) {
		options.ctx.fillRect(
			Math.round(offsetX + column * cell) - line / 2,
			0,
			line,
			options.height,
		);
	}
	for (let row = 1; row < rows; row += 1) {
		options.ctx.fillRect(
			0,
			Math.round(row * cell) - line / 2,
			options.width,
			line,
		);
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawCellOutline({
	cell,
	ctx,
	frame,
	x,
	y,
}: TypographyTransitionDraw & {
	readonly cell: number;
	readonly x: number;
	readonly y: number;
}): void {
	const line = Math.max(2, cell * 0.045);
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(x + line, y + line, cell - line * 2, line);
	ctx.fillRect(x + line, y + cell - line * 2, cell - line * 2, line);
	ctx.fillRect(x + line, y + line, line, cell - line * 2);
	ctx.fillRect(x + cell - line * 2, y + line, line, cell - line * 2);
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function inOutCubic(value: number): number {
	const progress = clamp(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
