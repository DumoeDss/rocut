import { unitRandom } from "./deterministic-random";
import {
	approximateLooksTextWidth,
	looksGlyphs,
	treatmentPhase,
	treatmentProgress,
	type LooksTreatmentDraw,
	withLooksContext,
} from "./looks-treatment-types";

export function drawLooksBasicTreatment(options: LooksTreatmentDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "doubleOutline":
			drawDoubleOutline(options);
			return true;
		case "extrude":
			drawExtrude({ long: false, options });
			return true;
		case "longShadow":
			drawExtrude({ long: true, options });
			return true;
		case "hardShadow":
			drawHardShadow(options);
			return true;
		case "softShadow":
			drawSoftShadow(options);
			return true;
		case "marker":
			drawMarker(options);
			return true;
		case "strike":
			drawStrike(options);
			return true;
		case "boxed":
			drawBoxed(options);
			return true;
		default:
			return false;
	}
}

function drawDoubleOutline(options: LooksTreatmentDraw): void {
	withLooksContext({
		draw: () => {
			options.ctx.textAlign = "center";
			options.ctx.lineWidth = Math.max(5, options.size * 0.13);
			options.ctx.strokeStyle = options.frame.palette.accent;
			options.ctx.strokeText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
			options.ctx.lineWidth = Math.max(2, options.size * 0.065);
			options.ctx.strokeStyle = options.frame.palette.background;
			options.ctx.strokeText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
		},
		options,
	});
}

function drawExtrude({
	long,
	options,
}: {
	readonly long: boolean;
	readonly options: LooksTreatmentDraw;
}): void {
	const seed = options.frame.cut?.seed ?? 0;
	const direction =
		unitRandom({ seed, salt: long ? 1102 : 1101 }) > 0.5 ? 1 : -1;
	const layers = long ? 11 : 5;
	const distance = options.size * (long ? 0.48 : 0.12);
	const phase = treatmentPhase(options);
	withLooksContext({
		draw: () => {
			options.ctx.textAlign = "center";
			for (let layer = layers; layer >= 1; layer -= 1) {
				const amount = layer / layers;
				options.ctx.globalAlpha *= long ? 0.12 + amount * 0.035 : 0.28;
				options.ctx.fillStyle = options.frame.palette.secondary;
				options.ctx.fillText(
					options.text,
					options.x + distance * amount * direction,
					options.y +
						distance * amount * (0.7 + Math.sin(phase) * (long ? 0.18 : 0.12)),
					options.maxWidth,
				);
				options.ctx.globalAlpha /= long ? 0.12 + amount * 0.035 : 0.28;
			}
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
		},
		options,
	});
}

function drawHardShadow(options: LooksTreatmentDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const direction = unitRandom({ seed, salt: 1111 }) > 0.5 ? 1 : -1;
	const offset = options.size * 0.075;
	withLooksContext({
		draw: () => {
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillText(
				options.text,
				options.x + offset * direction,
				options.y + offset,
				options.maxWidth,
			);
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
		},
		options,
	});
}

function drawSoftShadow(options: LooksTreatmentDraw): void {
	withLooksContext({
		draw: () => {
			options.ctx.shadowColor = options.frame.palette.secondary;
			options.ctx.shadowBlur = Math.max(4, options.size * 0.12);
			options.ctx.translate(options.size * 0.025, options.size * 0.055);
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
		},
		options,
	});
}

function drawMarker(options: LooksTreatmentDraw): void {
	const width = approximateLooksTextWidth(options);
	const progress = Math.max(0.08, treatmentProgress(options));
	withLooksContext({
		draw: () => {
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.globalAlpha *= 0.78;
			options.ctx.fillRect(
				options.x - width / 2,
				options.y - options.size * 0.12,
				width * progress,
				options.size * 0.48,
			);
			options.ctx.globalAlpha /= 0.78;
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
		},
		options,
	});
}

function drawStrike(options: LooksTreatmentDraw): void {
	const width = approximateLooksTextWidth(options);
	const progress = Math.max(0.05, treatmentProgress(options));
	withLooksContext({
		draw: () => {
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.translate(options.x, options.y);
			options.ctx.rotate(Math.sin(treatmentPhase(options) * 0.1) * 0.035);
			options.ctx.fillRect(
				-width / 2,
				-Math.max(1, options.size * 0.035),
				width * progress,
				Math.max(2, options.size * 0.07),
			);
		},
		options,
	});
}

function drawBoxed(options: LooksTreatmentDraw): void {
	const progress = Math.max(0.18, treatmentProgress(options));
	withLooksContext({
		draw: () => {
			for (const glyph of looksGlyphs(options)) {
				const stagger = Math.min(1, progress * 1.3 - glyph.index * 0.035);
				if (stagger <= 0) continue;
				const width = Math.max(options.size * 0.46, glyph.width * 0.98);
				options.ctx.fillStyle =
					glyph.index % 2 === 0
						? options.frame.palette.foreground
						: options.frame.palette.accent;
				options.ctx.fillRect(
					glyph.x - (width * stagger) / 2,
					options.y - options.size * 0.55 * stagger,
					width * stagger,
					options.size * 1.1 * stagger,
				);
				options.ctx.fillStyle = options.frame.palette.background;
				options.ctx.textAlign = "center";
				options.ctx.fillText(glyph.character, glyph.x, options.y, glyph.width);
			}
		},
		options,
	});
}
