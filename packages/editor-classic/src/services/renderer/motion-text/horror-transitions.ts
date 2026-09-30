import { unitRandom } from "./deterministic-random";
import { inOutCubic } from "./horror-frame-utils";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface HorrorTransitionDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawCurrent: () => void;
	readonly drawPrevious: () => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawHorrorTransition(options: HorrorTransitionDraw): boolean {
	if (!options.frame.previousCut) return false;
	switch (options.frame.cut?.preset.trans) {
		case "hrStaticCut":
			drawStaticCut(options);
			return true;
		case "hrBlink":
			drawBlink(options);
			return true;
		default:
			return false;
	}
}

function drawStaticCut(options: HorrorTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (drawBoundary({ options, progress })) return;
	const source = progress < 0.5 ? options.drawPrevious : options.drawCurrent;
	source();
	const snow =
		progress < 0.5
			? inOutCubic(progress / 0.5)
			: 1 - inOutCubic((progress - 0.5) / 0.5);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 3_000);
	const baseAlpha = options.ctx.globalAlpha;
	const cell = Math.max(3, Math.min(options.width, options.height) * 0.035);
	const columns = Math.ceil(options.width / cell);
	const rows = Math.ceil(options.height / cell);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			if (unitRandom({ seed, salt: step * 4099 + row * 131 + column }) > snow) {
				continue;
			}
			options.ctx.globalAlpha = baseAlpha * (0.22 + 0.62 * snow);
			options.ctx.fillStyle =
				unitRandom({ seed, salt: step * 8191 + row * 257 + column }) > 0.5
					? options.frame.palette.foreground
					: options.frame.palette.secondary;
			options.ctx.fillRect(column * cell, row * cell, cell + 1, cell + 1);
		}
	}
	options.ctx.globalAlpha = baseAlpha * snow * 0.55;
	options.ctx.fillStyle = "#000000";
	const bandY = unitRandom({ seed, salt: step + 931 }) * options.height * 0.88;
	options.ctx.fillRect(0, bandY, options.width, options.height * 0.12);
	options.ctx.globalAlpha = baseAlpha;
}

function drawBlink(options: HorrorTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (drawBoundary({ options, progress })) return;
	if (progress < 0.5) options.drawPrevious();
	else options.drawCurrent();
	const close =
		progress < 0.5
			? inOutCubic(progress / 0.5)
			: 1 - inOutCubic((progress - 0.5) / 0.5);
	const bands = 12;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = "#000000";
	options.ctx.globalAlpha = baseAlpha;
	for (let index = 0; index < bands; index += 1) {
		const across = (index + 0.5) / bands;
		const bow =
			Math.sin(Math.PI * across) * options.height * 0.09 * (1 - close);
		const x0 = (index * options.width) / bands;
		const x1 = ((index + 1) * options.width) / bands;
		const lid = options.height * 0.51 * close + bow;
		options.ctx.fillRect(x0, 0, x1 - x0 + 1, lid);
		options.ctx.fillRect(x0, options.height - lid, x1 - x0 + 1, lid);
	}
	options.ctx.globalAlpha = baseAlpha * close * 0.35;
	options.ctx.fillRect(0, 0, options.width, options.height * 0.05);
	options.ctx.fillRect(
		0,
		options.height * 0.95,
		options.width,
		options.height * 0.05,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawBoundary({
	options,
	progress,
}: {
	readonly options: HorrorTransitionDraw;
	readonly progress: number;
}): boolean {
	if (progress <= 0) {
		options.drawPrevious();
		return true;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return true;
	}
	return false;
}
