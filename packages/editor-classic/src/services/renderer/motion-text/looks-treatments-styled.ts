import { unitRandom } from "./deterministic-random";
import {
	approximateLooksTextWidth,
	drawLooksGlyphs,
	looksGlyphs,
	treatmentPhase,
	treatmentProgress,
	type LooksTreatmentDraw,
	withLooksContext,
} from "./looks-treatment-types";

export function drawLooksStyledTreatment(options: LooksTreatmentDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "gradientV":
			drawGradient(options);
			return true;
		case "splitColor":
			drawSplitColor(options);
			return true;
		case "halftone":
			drawPattern({ kind: "halftone", options });
			return true;
		case "stripes":
			drawPattern({ kind: "stripes", options });
			return true;
		case "hatch":
			drawPattern({ kind: "hatch", options });
			return true;
		case "dotted":
			drawDotted(options);
			return true;
		case "alternate":
			drawAlternate(options);
			return true;
		case "italic":
			drawScaled({ options, scaleX: 1, scaleY: 1, skewX: -0.2 });
			return true;
		case "wide":
			drawScaled({ options, scaleX: 1.12, scaleY: 0.84, skewX: 0 });
			return true;
		case "tall":
			drawScaled({ options, scaleX: 0.8, scaleY: 1.08, skewX: 0 });
			return true;
		case "echoOutline":
			drawEchoOutline(options);
			return true;
		case "emphasisDots":
			drawEmphasisDots(options);
			return true;
		default:
			return false;
	}
}

function drawGradient(options: LooksTreatmentDraw): void {
	withLooksContext({
		draw: () => {
			options.ctx.fillStyle = options.frame.palette.secondary;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y + options.size * 0.018,
				options.maxWidth,
			);
			options.ctx.globalAlpha *= 0.72;
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y - options.size * 0.028,
				options.maxWidth,
			);
		},
		options,
	});
}

function drawSplitColor(options: LooksTreatmentDraw): void {
	withLooksContext({
		draw: () => {
			options.ctx.save();
			options.ctx.beginPath();
			options.ctx.rect(
				options.x - options.maxWidth / 2,
				options.y - options.size,
				options.maxWidth,
				options.size,
			);
			options.ctx.clip();
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
			options.ctx.restore();
			options.ctx.save();
			options.ctx.beginPath();
			options.ctx.rect(
				options.x - options.maxWidth / 2,
				options.y,
				options.maxWidth,
				options.size,
			);
			options.ctx.clip();
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
			options.ctx.restore();
		},
		options,
	});
}

function drawPattern({
	kind,
	options,
}: {
	readonly kind: "halftone" | "hatch" | "stripes";
	readonly options: LooksTreatmentDraw;
}): void {
	const width = approximateLooksTextWidth(options);
	const left = options.x - width / 2;
	const top = options.y - options.size * 0.5;
	const phase = treatmentPhase(options);
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
			options.ctx.globalAlpha *= 0.42;
			if (kind === "halftone") {
				const step = Math.max(5, options.size * 0.1);
				for (let row = 0; row < 5; row += 1) {
					for (
						let column = 0;
						column < Math.min(28, Math.ceil(width / step));
						column += 1
					) {
						const radius = Math.max(1.2, options.size * (0.017 + row * 0.002));
						options.ctx.fillRect(
							left + column * step + Math.sin(phase + row) * 1.5,
							top + row * options.size * 0.22,
							radius,
							radius,
						);
					}
				}
			} else {
				const count = kind === "hatch" ? 11 : 7;
				for (let index = 0; index < count; index += 1) {
					options.ctx.save();
					options.ctx.translate(
						left + (width * (index + 0.5)) / count,
						options.y,
					);
					options.ctx.rotate(kind === "hatch" ? -0.55 : 0.08);
					options.ctx.fillRect(
						-Math.max(1, options.size * 0.018),
						-options.size * 0.55,
						Math.max(2, options.size * 0.036),
						options.size * 1.1,
					);
					options.ctx.restore();
				}
			}
		},
		options,
	});
}

function drawDotted(options: LooksTreatmentDraw): void {
	const width = approximateLooksTextWidth(options);
	const count = Math.max(
		8,
		Math.min(34, Math.round(width / (options.size * 0.13))),
	);
	const phase = treatmentPhase(options);
	withLooksContext({
		draw: () => {
			options.ctx.lineWidth = Math.max(1.5, options.size * 0.028);
			options.ctx.strokeStyle = options.frame.palette.foreground;
			options.ctx.strokeText(
				options.text,
				options.x,
				options.y,
				options.maxWidth,
			);
			options.ctx.fillStyle = options.frame.palette.accent;
			for (let index = 0; index < count; index += 1) {
				const x =
					options.x - width / 2 + (width * index) / Math.max(1, count - 1);
				const offset =
					Math.sin(phase * 0.45 + index * 0.8) * options.size * 0.025;
				options.ctx.fillRect(
					x - options.size * 0.018,
					options.y + options.size * 0.57 + offset,
					Math.max(2, options.size * 0.036),
					Math.max(2, options.size * 0.036),
				);
			}
		},
		options,
	});
}

function drawAlternate(options: LooksTreatmentDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const offset = unitRandom({ seed, salt: 1191 }) > 0.5 ? 0 : 1;
	withLooksContext({
		draw: () => {
			drawLooksGlyphs({
				colorAt: (glyph) =>
					(glyph.index + offset) % 2 === 0
						? options.frame.palette.foreground
						: options.frame.palette.accent,
				options,
			});
		},
		options,
	});
}

function drawScaled({
	options,
	scaleX,
	scaleY,
	skewX,
}: {
	readonly options: LooksTreatmentDraw;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly skewX: number;
}): void {
	withLooksContext({
		draw: () => {
			options.ctx.translate(options.x, options.y);
			if (Math.abs(skewX) > Number.EPSILON) {
				options.ctx.transform(1, 0, skewX, 1, 0, 0);
			}
			options.ctx.scale(scaleX, scaleY);
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.textAlign = "center";
			options.ctx.fillText(
				options.text,
				0,
				0,
				options.maxWidth / Math.max(1, scaleX),
			);
		},
		options,
	});
}

function drawEchoOutline(options: LooksTreatmentDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const direction = unitRandom({ seed, salt: 1201 }) > 0.5 ? 1 : -1;
	const amount =
		options.size * (0.035 + 0.02 * Math.sin(treatmentPhase(options) * 0.55));
	withLooksContext({
		draw: () => {
			options.ctx.textAlign = "center";
			options.ctx.strokeStyle = options.frame.palette.accent;
			options.ctx.lineWidth = Math.max(1.5, options.size * 0.025);
			for (let echo = 4; echo >= 1; echo -= 1) {
				options.ctx.globalAlpha *= 0.55;
				options.ctx.strokeText(
					options.text,
					options.x + amount * echo * direction,
					options.y - amount * echo * 0.45,
					options.maxWidth,
				);
				options.ctx.globalAlpha /= 0.55;
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

function drawEmphasisDots(options: LooksTreatmentDraw): void {
	const progress = Math.max(0.08, treatmentProgress(options));
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
			for (const glyph of looksGlyphs(options)) {
				const reveal = Math.min(1, progress * 1.35 - glyph.index * 0.04);
				if (reveal <= 0) continue;
				const radius = Math.max(2, options.size * 0.055 * reveal);
				options.ctx.fillRect(
					glyph.x - radius / 2,
					options.y - options.size * 0.7 - radius / 2,
					radius,
					radius,
				);
			}
		},
		options,
	});
}
