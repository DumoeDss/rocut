import { signedRandom, unitRandom } from "./deterministic-random";
import { clamp01, lerp } from "./horror-frame-utils";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface HorrorScreenEffectDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly effect: string;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawHorrorScreenEffect(
	options: HorrorScreenEffectDraw,
): boolean {
	switch (options.effect) {
		case "hrSubliminal":
			drawSubliminal(options);
			return true;
		case "hrSignalLoss":
			drawSignalLoss(options);
			return true;
		case "hrPassingShadow":
			drawPassingShadow(options);
			return true;
		default:
			return false;
	}
}

function drawSubliminal(options: HorrorScreenEffectDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const progress = options.frame.localTime / Math.max(1, cut.duration);
	const flash = clamp01(1 - Math.abs(progress - 0.24) / 0.12);
	if (flash <= 0.001) return;
	const unit = Math.min(options.width, options.height);
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.globalAlpha = baseAlpha * flash * 0.22;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(0, 0, options.width, options.height);
	options.ctx.globalAlpha = baseAlpha * flash * 0.85;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.textAlign = "center";
	options.ctx.textBaseline = "middle";
	options.ctx.font = `${options.frame.font.style} ${options.frame.font.weight} ${Math.max(28, unit * 0.28)}px ${quoteFamily(options.frame.font.family)}`;
	const scale = 1.22 + unitRandom({ seed: cut.seed, salt: 2201 }) * 0.18;
	const x =
		options.width * (0.5 + signedRandom({ seed: cut.seed, salt: 2202 }) * 0.08);
	const y =
		options.height *
		(0.5 + signedRandom({ seed: cut.seed, salt: 2203 }) * 0.08);
	options.ctx.translate(x, y);
	options.ctx.scale(scale, scale);
	options.ctx.fillText(cut.text, 0, 0, options.width * 0.92);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
}

function drawSignalLoss(options: HorrorScreenEffectDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const progress = options.frame.localTime / Math.max(1, cut.duration);
	const step = Math.floor(options.frame.localTime / 4_000);
	const baseAlpha = options.ctx.globalAlpha;
	if (progress < 0.3) {
		const intensity = progress / 0.3;
		options.ctx.fillStyle = "#000000";
		for (let index = 0; index < 10; index += 1) {
			if (
				unitRandom({ seed: cut.seed, salt: 2300 + step * 31 + index }) >
				intensity * 0.75
			) {
				continue;
			}
			const bandHeight = Math.ceil(options.height / 10);
			const offset =
				signedRandom({ seed: cut.seed, salt: 2400 + step * 31 + index }) *
				options.width *
				0.12 *
				intensity;
			options.ctx.globalAlpha = baseAlpha * (0.3 + intensity * 0.45);
			options.ctx.fillRect(
				offset,
				index * bandHeight,
				options.width,
				bandHeight * 0.72,
			);
		}
		options.ctx.globalAlpha = baseAlpha;
		return;
	}
	if (progress < 0.78) {
		const unit = Math.min(options.width, options.height);
		options.ctx.globalAlpha = baseAlpha * 0.94;
		options.ctx.fillStyle = "#000000";
		options.ctx.fillRect(0, 0, options.width, options.height);
		options.ctx.globalAlpha = baseAlpha * (step % 4 < 3 ? 0.88 : 0.34);
		options.ctx.fillStyle = "#ffffff";
		options.ctx.textAlign = "left";
		options.ctx.textBaseline = "middle";
		options.ctx.font = `normal 700 ${Math.max(11, unit * 0.035)}px monospace`;
		options.ctx.fillText(
			"NO SIGNAL",
			options.width * 0.06,
			options.height * 0.08,
		);
		options.ctx.globalAlpha = baseAlpha * 0.62;
		options.ctx.fillText(
			`CH ${String(3 + (Math.abs(cut.seed) % 9)).padStart(2, "0")}`,
			options.width * 0.06,
			options.height * 0.14,
		);
		options.ctx.globalAlpha = baseAlpha;
		return;
	}
	const returnProgress = (progress - 0.78) / 0.22;
	const gapY = lerp({
		start: options.height * 0.55,
		end: options.height * 0.04,
		progress: returnProgress,
	});
	options.ctx.globalAlpha = baseAlpha * (1 - returnProgress) * 0.9;
	options.ctx.fillStyle = "#000000";
	options.ctx.fillRect(0, 0, options.width, gapY);
	options.ctx.fillRect(
		0,
		gapY + options.height * 0.03,
		options.width,
		Math.max(0, options.height - gapY - options.height * 0.03),
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawPassingShadow(options: HorrorScreenEffectDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const progress = options.frame.localTime / Math.max(1, cut.duration);
	const unit = Math.min(options.width, options.height);
	const direction = unitRandom({ seed: cut.seed, salt: 2501 }) >= 0.5 ? 1 : -1;
	const position = direction > 0 ? progress : 1 - progress;
	const x = lerp({
		start: -options.width * 0.25,
		end: options.width * 1.25,
		progress: position,
	});
	const figureWidth =
		unit * (0.22 + unitRandom({ seed: cut.seed, salt: 2502 }) * 0.1);
	const top =
		options.height * (0.05 + unitRandom({ seed: cut.seed, salt: 2503 }) * 0.15);
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle =
		options.frame.palette.background === "#050505"
			? options.frame.palette.secondary
			: "#000000";
	options.ctx.globalAlpha = baseAlpha * 0.14;
	options.ctx.fillRect(
		x - figureWidth * 0.62,
		top,
		figureWidth * 1.24,
		options.height - top,
	);
	options.ctx.globalAlpha = baseAlpha * 0.48;
	options.ctx.fillRect(
		x - figureWidth * 0.48,
		top + figureWidth * 0.38,
		figureWidth * 0.96,
		options.height - top,
	);
	options.ctx.fillRect(
		x - figureWidth * 0.3,
		top,
		figureWidth * 0.6,
		figureWidth * 0.72,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
