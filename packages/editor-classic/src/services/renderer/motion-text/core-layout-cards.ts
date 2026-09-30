import {
	clamp01,
	drawDiscBands,
	drawRotatedRect,
	estimatedTextWidth,
	layoutGlyphs,
	layoutSigned,
} from "./core-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

const CARD_CORE_LAYOUTS = new Set([
	"circle",
	"diag",
	"gloss",
	"interlude",
	"pill",
	"title",
]);

export function drawCardCoreLayout(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !CARD_CORE_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "circle":
			drawCircle(options);
			break;
		case "diag":
			drawDiagonalBand(options);
			break;
		case "gloss":
			drawGloss(options);
			break;
		case "interlude":
			drawInterlude(options);
			break;
		case "pill":
			drawPill(options);
			break;
		case "title":
			drawTitle(options);
			break;
	}
	return true;
}

function drawGloss({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const text = cut.text.trim();
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	const backgroundSize = height * 0.26;
	const repeated = layoutGlyphs(text).join("").repeat(6);
	const baseAlpha = ctx.globalAlpha;
	ctx.textAlign = "center";
	setFontSize(backgroundSize);
	for (let row = 0; row < 3; row += 1) {
		ctx.globalAlpha = baseAlpha * (0.08 + row * 0.025);
		ctx.fillStyle = frame.palette.secondary;
		drawText({
			text: repeated,
			x:
				width / 2 +
				(frame.progress - 0.5) * width * (row % 2 === 0 ? -0.16 : 0.16),
			y: height * (0.18 + row * 0.32),
			maxWidth: width * 1.8,
			size: backgroundSize,
		});
	}
	ctx.globalAlpha = baseAlpha;
	const right = cut.seed % 2 === 0;
	const size = Math.max(
		20,
		Math.min(height * 0.22, (width * 0.5) / (glyphCount * 0.62)),
	);
	const textX = right ? width * 0.4 : width * 0.6;
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({
		text,
		x: textX,
		y: height * 0.54,
		maxWidth: width * 0.5,
		size,
	});

	const anchorX = textX + (right ? size * 1.35 : -size * 1.35);
	const anchorY = height * 0.47;
	const noteX = right ? width * 0.78 : width * 0.22;
	const noteY = height * 0.26;
	const middleX = anchorX + (noteX - anchorX) * 0.45;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(
		Math.min(anchorX, middleX),
		anchorY,
		Math.abs(middleX - anchorX),
		Math.max(1, size * 0.018),
	);
	const dx = noteX - middleX;
	const dy = noteY - anchorY;
	drawRotatedRect({
		color: frame.palette.secondary,
		ctx,
		height: Math.max(1, size * 0.018),
		rotation: Math.atan2(dy, dx),
		width: Math.hypot(dx, dy),
		x: middleX + dx / 2,
		y: anchorY + dy / 2,
	});
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(anchorX - 3, anchorY - 3, 6, 6);

	const noteSize = Math.max(11, height * 0.027);
	ctx.textAlign = right ? "left" : "right";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(noteSize * 1.12);
	drawText({
		text: `【${layoutGlyphs(text).join("")}】`,
		x: noteX,
		y: noteY - noteSize * 1.2,
		maxWidth: width * 0.28,
		size: noteSize * 1.12,
	});
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(noteSize);
	drawText({
		text: text.toUpperCase(),
		x: noteX,
		y: noteY + noteSize * 0.35,
		maxWidth: width * 0.3,
		size: noteSize,
	});
	ctx.fillStyle = frame.palette.accent;
	setFontSize(noteSize * 0.78);
	drawText({
		text: `No.${String((Math.abs(cut.seed) % 97) + 1).padStart(2, "0")}`,
		x: noteX,
		y: noteY + noteSize * 1.8,
		maxWidth: width * 0.2,
		size: noteSize * 0.78,
	});
}

function drawDiagonalBand({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const text = cut.text.trim();
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	const size = Math.max(
		22,
		Math.min(height * 0.19, (width * 0.7) / (glyphCount * 0.62)),
	);
	const angle =
		((cut.seed % 2 === 0 ? -1 : 1) *
			(12 + (Math.abs(cut.seed) % 9)) *
			Math.PI) /
		180;
	const reveal =
		clamp01(frame.enterProgress * 1.35) * (1 - frame.exitProgress ** 2);
	const bandHeight = size * 1.6;
	ctx.save();
	ctx.translate(width / 2, height / 2);
	ctx.rotate(angle);
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		-width * 1.15,
		(-bandHeight * reveal) / 2,
		width * 2.3,
		bandHeight * reveal,
	);
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(
		-width * 1.15,
		bandHeight * 0.79,
		width * 2.3 * reveal,
		bandHeight * 0.3,
	);
	const tickerSize = Math.max(10, bandHeight * 0.16);
	const unit = `${text}\u3000/\u3000`;
	const period = Math.max(
		tickerSize * 4,
		estimatedTextWidth({ text: unit, size: tickerSize }),
	);
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "left";
	setFontSize(tickerSize);
	drawText({
		text: unit.repeat(Math.ceil((width * 2.5) / period) + 2),
		x: -width - ((frame.progress * period * 4) % period),
		y: bandHeight * 0.94,
		maxWidth: width * 3,
		size: tickerSize,
	});
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: 0, y: 0, maxWidth: width * 0.72, size });
	ctx.restore();
}

function drawCircle({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const text = layoutGlyphs(cut.text).join("");
	if (!text) return;
	const variant = Math.abs(cut.seed) % 3;
	const centerX = width / 2 + layoutSigned(cut.seed, 51) * width * 0.09;
	const centerY = height / 2;
	const radius = Math.min(height * 0.3, width * 0.38);
	const reveal =
		Math.max(0.08, clamp01(frame.enterProgress * 1.25)) *
		(1 - frame.exitProgress ** 2);
	if (variant === 0) {
		drawDiscBands({
			color: frame.palette.accent,
			ctx,
			radius: radius * reveal,
			x: centerX,
			y: centerY,
		});
	} else if (variant === 1) {
		drawDiscBands({
			alpha: 0.92,
			color: frame.palette.background,
			ctx,
			radius: radius * 0.72 * reveal,
			scaleX: 1.32,
			x: centerX + (frame.progress - 0.5) * width * 0.12,
			y: centerY + height * 0.1,
		});
	} else {
		const angleOffset =
			frame.progress * Math.PI * (cut.seed % 2 === 0 ? 0.24 : -0.24);
		for (let tick = 0; tick < 48; tick += 1) {
			const angle = (tick / 48) * Math.PI * 2 + angleOffset;
			drawRotatedRect({
				alpha: 0.35 + (tick % 6 === 0 ? 0.45 : 0),
				color: tick % 6 === 0 ? frame.palette.accent : frame.palette.secondary,
				ctx,
				height: Math.max(1, radius * 0.012),
				rotation: angle,
				width: radius * (tick % 6 === 0 ? 0.16 : 0.08) * reveal,
				x: centerX + Math.cos(angle) * radius,
				y: centerY + Math.sin(angle) * radius,
			});
		}
	}
	const size = Math.max(
		20,
		Math.min(radius * 0.72, (radius * 1.35) / Math.max(1, text.length * 0.62)),
	);
	ctx.fillStyle =
		variant === 0 ? frame.palette.background : frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({ text, x: centerX, y: centerY, maxWidth: radius * 1.45, size });
}

function drawPill({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const text = cut.text.trim();
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	const size = Math.max(
		20,
		Math.min(height * 0.17, (width * 0.6) / (glyphCount * 0.62)),
	);
	const textWidth = Math.min(width * 0.62, estimatedTextWidth({ text, size }));
	const pillHeight = size * 1.62;
	const targetWidth = textWidth + size * 1.35;
	const reveal =
		clamp01(frame.enterProgress * 1.25) * (1 - frame.exitProgress ** 2);
	const pillWidth = Math.max(pillHeight, targetWidth * reveal);
	const left = width / 2 - pillWidth / 2 + pillHeight / 2;
	const right = width / 2 + pillWidth / 2 - pillHeight / 2;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		left,
		height / 2 - pillHeight / 2,
		Math.max(0, right - left),
		pillHeight,
	);
	drawDiscBands({
		color: frame.palette.accent,
		ctx,
		radius: pillHeight / 2,
		x: left,
		y: height / 2,
	});
	drawDiscBands({
		color: frame.palette.secondary,
		ctx,
		radius: pillHeight / 2,
		x: right,
		y: height / 2,
	});
	ctx.save();
	ctx.beginPath();
	ctx.rect(width / 2 - pillWidth / 2, 0, pillWidth, height);
	ctx.clip();
	ctx.fillStyle = frame.palette.background;
	ctx.textAlign = "center";
	setFontSize(size);
	drawText({
		text,
		x: width / 2,
		y: height / 2,
		maxWidth: targetWidth * 0.86,
		size,
	});
	ctx.restore();

	const labels = [
		text.toUpperCase(),
		`No.${String((Math.abs(cut.seed) % 89) + 1).padStart(2, "0")}`,
		`${(frame.localTime / 120_000).toFixed(2)}s`,
	];
	const labelSize = Math.max(10, height * 0.022);
	for (const [index, label] of labels.entries()) {
		const x = width / 2 + (index - 1) * targetWidth * 0.32;
		const y = height / 2 + (index === 1 ? -pillHeight * 0.9 : pillHeight * 0.9);
		ctx.fillStyle = frame.palette.foreground;
		ctx.textAlign = "center";
		setFontSize(labelSize);
		drawText({
			text: label,
			x,
			y,
			maxWidth: targetWidth * 0.38,
			size: labelSize,
		});
	}
}

function drawTitle({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text.trim() || "TITLE";
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	const size = Math.max(
		24,
		Math.min(height * 0.17, (width * 0.68) / (glyphCount * 0.64)),
	);
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	drawText({ text, x: width / 2, y: height / 2, maxWidth: width * 0.7, size });
	const ruleWidth = width * 0.42 * clamp01(frame.progress * 1.8);
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width / 2 - ruleWidth / 2,
		height / 2 + size * 0.72,
		ruleWidth,
		Math.max(2, size * 0.035),
	);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(Math.max(11, size * 0.2));
	drawText({
		text: "TITLE CARD / MOTION TEXT",
		x: width / 2,
		y: height / 2 + size * 1.18,
		maxWidth: width * 0.5,
		size: Math.max(11, size * 0.2),
	});
}

function drawInterlude({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const remainingSeconds =
		Math.max(0, cut.duration - frame.localTime) / 120_000;
	const centerX = width / 2;
	const centerY = height / 2;
	const baseRadius = Math.min(width, height) * 0.2;
	for (let ring = 0; ring < 3; ring += 1) {
		const radius =
			baseRadius *
			(1 + ring * 0.5) *
			(1 + 0.04 * Math.sin(frame.progress * Math.PI * 4 + ring));
		const ticks = 20 + ring * 8;
		for (let tick = 0; tick < ticks; tick += 1) {
			const angle =
				(tick / ticks) * Math.PI * 2 +
				frame.progress * (ring % 2 === 0 ? 0.7 : -0.45);
			drawRotatedRect({
				alpha: tick % 5 === 0 ? 0.62 : 0.24,
				color: tick % 5 === 0 ? frame.palette.accent : frame.palette.secondary,
				ctx,
				height: Math.max(1, height * 0.003),
				rotation: angle,
				width: height * (tick % 5 === 0 ? 0.026 : 0.014),
				x: centerX + Math.cos(angle) * radius,
				y: centerY + Math.sin(angle) * radius,
			});
		}
	}
	const counterSize = height * 0.29;
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	setFontSize(counterSize);
	drawText({
		text: remainingSeconds.toFixed(1),
		x: centerX,
		y: centerY,
		maxWidth: width * 0.42,
		size: counterSize,
	});
	const footerSize = Math.max(11, height * 0.024);
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(footerSize);
	drawText({
		text: cut.text || "— INTERLUDE —",
		x: centerX,
		y: height * 0.83,
		maxWidth: width * 0.68,
		size: footerSize,
	});
}
