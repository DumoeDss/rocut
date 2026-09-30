import { unitRandom } from "./deterministic-random";
import {
	currentKineticWord,
	kineticWordOnsets,
	kineticWordSegments,
} from "./kinetic-words";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

const TICKS_PER_SECOND = 120_000;

interface KineticDecorDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly decor: string;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

interface Bounds {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}

export function drawKineticDecor(options: KineticDecorDraw): boolean {
	switch (options.decor) {
		case "knSpeedTrail":
			drawSpeedTrail(options);
			return true;
		case "knWordTicks":
			drawWordTicks(options);
			return true;
		default:
			return false;
	}
}

function drawSpeedTrail(options: KineticDecorDraw): void {
	const alpha = decorAlpha(options.frame);
	if (alpha <= 0.003) return;
	const bounds = textBounds(options);
	const seed = options.frame.cut?.seed ?? 0;
	const unit = Math.min(options.width, options.height);
	const vertical = bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.3;
	const negativeRoom = vertical ? bounds.y0 : bounds.x0;
	const positiveRoom = vertical
		? options.height - bounds.y1
		: options.width - bounds.x1;
	const side =
		Math.abs(negativeRoom - positiveRoom) < unit * 0.05
			? unitRandom({ seed, salt: 501 }) >= 0.5
				? 1
				: -1
			: positiveRoom > negativeRoom
				? 1
				: -1;
	const count = 8 + Math.floor(unitRandom({ seed, salt: 502 }) * 6);
	const seconds = options.frame.localTime / TICKS_PER_SECOND;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.secondary;
	for (let index = 0; index < count; index += 1) {
		const across = (index + 0.5) / count;
		const phase =
			(seconds * (1.3 + unitRandom({ seed, salt: index + 520 }) * 1.5) +
				unitRandom({ seed, salt: index + 550 })) %
			1;
		const length =
			unit *
			(0.16 + unitRandom({ seed, salt: index + 580 }) * 0.26) *
			alpha *
			(0.45 + (1 - phase) * 0.55);
		const thickness = Math.max(
			1.5,
			unit * (0.003 + unitRandom({ seed, salt: index + 610 }) * 0.006),
		);
		options.ctx.globalAlpha = baseAlpha * alpha * (0.32 + (1 - phase) * 0.35);
		if (vertical) {
			const x = bounds.x0 + (bounds.x1 - bounds.x0) * across;
			const edge = side < 0 ? bounds.y0 : bounds.y1;
			options.ctx.fillRect(
				x - thickness / 2,
				side < 0 ? edge - length : edge,
				thickness,
				length,
			);
		} else {
			const y = bounds.y0 + (bounds.y1 - bounds.y0) * across;
			const edge = side < 0 ? bounds.x0 : bounds.x1;
			options.ctx.fillRect(
				side < 0 ? edge - length : edge,
				y - thickness / 2,
				length,
				thickness,
			);
		}
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawWordTicks(options: KineticDecorDraw): void {
	const alpha = decorAlpha(options.frame);
	if (alpha <= 0.003) return;
	const words = kineticWordSegments({ text: options.frame.cut?.text ?? "" });
	if (words.length === 0) return;
	const onsets = kineticWordOnsets({
		count: words.length,
		frame: options.frame,
	});
	const current = currentKineticWord({ frame: options.frame, onsets });
	const bounds = textBounds(options);
	const unit = Math.min(options.width, options.height);
	const gap = unit * 0.014;
	const segmentWidth = Math.min(
		unit * 0.06,
		(options.width * 0.56 - gap * (words.length - 1)) / words.length,
	);
	const segmentHeight = Math.max(4, unit * 0.011);
	const total = words.length * segmentWidth + (words.length - 1) * gap;
	const below = bounds.y1 + unit * 0.08 < options.height * 0.93;
	const y = below ? bounds.y1 + unit * 0.06 : bounds.y0 - unit * 0.06;
	const x0 = clampRange({
		value: (bounds.x0 + bounds.x1 - total) / 2,
		minimum: options.width * 0.06,
		maximum: options.width * 0.72 - total,
	});
	const baseAlpha = options.ctx.globalAlpha;
	for (let index = 0; index < words.length; index += 1) {
		const x = x0 + index * (segmentWidth + gap);
		options.ctx.globalAlpha = baseAlpha * alpha * 0.35;
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.fillRect(x, y - segmentHeight / 2, segmentWidth, segmentHeight);
		const phase = outExpo(
			clamp01((options.frame.localTime - onsets[index]) / 21_600),
		);
		if (index > current || phase <= 0) continue;
		options.ctx.globalAlpha = baseAlpha * alpha;
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(
			x,
			y -
				segmentHeight / 2 -
				(index === current ? segmentHeight * 0.6 * (1 - phase) : 0),
			segmentWidth * phase,
			segmentHeight * (index === current ? 1 + 1.2 * (1 - phase) : 1),
		);
	}
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.textAlign = "left";
	options.ctx.textBaseline = "middle";
	options.ctx.font = `${options.frame.font.style} ${options.frame.font.weight} ${Math.max(12, unit * 0.028)}px ${quoteFamily(options.frame.font.family)}`;
	options.ctx.fillText(
		`${String(Math.max(1, current + 1)).padStart(2, "0")} / ${String(words.length).padStart(2, "0")}`,
		x0 + total + unit * 0.02,
		y,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function textBounds(options: KineticDecorDraw): Bounds {
	const characters = Array.from(options.frame.cut?.text ?? "");
	const size = Math.min(
		options.height * 0.22,
		options.width / Math.max(4, characters.length * 0.72),
	);
	const vertical = options.frame.cut?.preset.layout === "vcols";
	const width = vertical
		? size * 1.2
		: Math.min(
				options.width * 0.86,
				Math.max(size, characters.length * size * 0.62),
			);
	const height = vertical
		? Math.min(
				options.height * 0.8,
				Math.max(size, characters.length * size * 1.05),
			)
		: size * 1.25;
	return {
		x0: options.width / 2 - width / 2,
		x1: options.width / 2 + width / 2,
		y0: options.height / 2 - height / 2,
		y1: options.height / 2 + height / 2,
	};
}

function decorAlpha(frame: MotionTextRenderFrame): number {
	return smooth(frame.enterProgress) * smooth(1 - frame.exitProgress);
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll('"', '\\"')}"`;
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function smooth(value: number): number {
	const progress = clamp01(value);
	return progress * progress * (3 - 2 * progress);
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function clampRange({
	value,
	minimum,
	maximum,
}: {
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
}): number {
	return Math.min(maximum, Math.max(minimum, value));
}
