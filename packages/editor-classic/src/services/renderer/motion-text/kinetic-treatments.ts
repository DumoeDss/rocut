import { unitRandom } from "./deterministic-random";
import { approximateTextWidth, kineticWordSegments } from "./kinetic-words";
import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface KineticTreatmentDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
}

export function drawKineticTreatment(options: KineticTreatmentDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "knWordScale":
			drawWordScale(options);
			return true;
		case "knWordPlate":
			drawWordPlate(options);
			return true;
		default:
			return false;
	}
}

function drawWordScale(options: KineticTreatmentDraw): void {
	const words = kineticWordSegments({ text: options.text });
	if (words.length < 2) {
		options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const keyIndex = longestWordIndex({ seed, words });
	const large = 1.28 + unitRandom({ seed, salt: 401 }) * 0.14;
	const small = 0.78 + unitRandom({ seed, salt: 402 }) * 0.08;
	const gap = options.size * 0.22;
	const widths = words.map((word) =>
		approximateTextWidth({ size: options.size, text: word }),
	);
	const scales = words.map((_, index) => (index === keyIndex ? large : small));
	const natural =
		widths.reduce((total, width, index) => total + width * scales[index], 0) +
		gap * (words.length - 1);
	const fit = Math.min(1, options.maxWidth / Math.max(1, natural));
	let cursor = options.x - (natural * fit) / 2;
	for (const [index, word] of words.entries()) {
		const scaledWidth = widths[index] * scales[index] * fit;
		const center = cursor + scaledWidth / 2;
		options.ctx.save();
		options.ctx.translate(center, options.y);
		options.ctx.scale(scales[index] * fit, scales[index] * fit);
		options.ctx.textAlign = "center";
		options.ctx.fillStyle =
			index === keyIndex
				? options.frame.palette.accent
				: options.frame.palette.foreground;
		options.ctx.fillText(word, 0, 0, widths[index]);
		options.ctx.restore();
		cursor += scaledWidth + gap * fit;
	}
}

function drawWordPlate(options: KineticTreatmentDraw): void {
	const words = kineticWordSegments({ text: options.text });
	if (words.length < 2) {
		options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const widths = words.map((word) =>
		approximateTextWidth({ size: options.size, text: word }),
	);
	const gap = options.size * 0.24;
	const natural =
		widths.reduce((total, width) => total + width, 0) +
		gap * (words.length - 1);
	const fit = Math.min(1, options.maxWidth / Math.max(1, natural));
	const first = unitRandom({ seed, salt: 411 }) >= 0.5 ? 0 : 1;
	const tilt = unitRandom({ seed, salt: 412 }) >= 0.6 ? 0.035 : 0;
	let cursor = options.x - (natural * fit) / 2;
	for (const [index, word] of words.entries()) {
		const wordWidth = widths[index] * fit;
		const center = cursor + wordWidth / 2;
		const plated = index % 2 === first;
		options.ctx.save();
		options.ctx.translate(center, options.y);
		if (plated && tilt > 0) options.ctx.rotate(index % 2 === 0 ? -tilt : tilt);
		if (plated) {
			const pad = options.size * 0.11;
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillRect(
				-wordWidth / 2 - pad,
				-options.size * 0.62,
				wordWidth + pad * 2,
				options.size * 1.24,
			);
			options.ctx.fillStyle = options.frame.palette.background;
		} else {
			options.ctx.fillStyle = options.frame.palette.foreground;
		}
		options.ctx.textAlign = "center";
		options.ctx.fillText(word, 0, 0, wordWidth);
		options.ctx.restore();
		cursor += wordWidth + gap * fit;
	}
}

function longestWordIndex({
	words,
	seed,
}: {
	readonly words: readonly string[];
	readonly seed: number;
}): number {
	let selected = Math.abs(seed) % words.length;
	let score = -1;
	for (const [index, word] of words.entries()) {
		const next = Array.from(word).length;
		if (
			next > score ||
			(next === score && index === Math.abs(seed) % words.length)
		) {
			selected = index;
			score = next;
		}
	}
	return selected;
}
