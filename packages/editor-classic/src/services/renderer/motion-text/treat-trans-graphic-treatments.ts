import {
	drawCircle,
	drawTreatGlyph,
	drawTreatText,
	paletteMix,
	treatBounds,
	treatRandom,
	treatRandomSigned,
	treatSeconds,
	treatTransGlyphs,
	type TreatTransTreatmentDraw,
	withRectClip,
} from "./treat-trans-drawing";

const GRAPHIC_TREATMENTS = new Set([
	"rotateAlt",
	"baselineShift",
	"fauxBold",
	"circled",
	"bracketsQuote",
	"reflection",
	"inline",
	"sticker",
	"gradientSweep",
]);

export function drawTreatTransGraphicTreatment(
	options: TreatTransTreatmentDraw,
): boolean {
	const treat = options.frame.cut?.preset.treat;
	if (!treat || !GRAPHIC_TREATMENTS.has(treat)) return false;
	options.ctx.save();
	try {
		switch (treat) {
			case "rotateAlt":
				drawRotateAlt(options);
				break;
			case "baselineShift":
				drawBaselineShift(options);
				break;
			case "fauxBold":
				drawFauxBold(options);
				break;
			case "circled":
				drawCircled(options);
				break;
			case "bracketsQuote":
				drawBracketsQuote(options);
				break;
			case "reflection":
				drawReflection(options);
				break;
			case "inline":
				drawInline(options);
				break;
			case "sticker":
				drawSticker(options);
				break;
			case "gradientSweep":
				drawGradientSweep(options);
				break;
		}
	} finally {
		options.ctx.restore();
	}
	return true;
}

function drawRotateAlt(options: TreatTransTreatmentDraw): void {
	for (const glyph of treatTransGlyphs(options)) {
		const sign = glyph.order % 2 === 0 ? -1 : 1;
		const jitter = 0.78 + treatRandom(options, glyph.order, 931) * 0.44;
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: options.frame.palette.foreground,
			rotation: sign * jitter * 0.19,
			scaleX: 0.94,
			scaleY: 0.94,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawBaselineShift(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options);
	const denominator = Math.max(1, glyphs.length - 1);
	for (const glyph of glyphs) {
		const arc = Math.sin((glyph.order / denominator) * Math.PI);
		const alternate = glyph.order % 2 === 0 ? -1 : 1;
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color:
				glyph.order % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			x: glyph.x,
			y: glyph.y + (alternate * 0.07 - arc * 0.1) * options.size,
		});
	}
}

function drawFauxBold(options: TreatTransTreatmentDraw): void {
	drawTreatText(options, {
		color: options.frame.palette.foreground,
		strokeColor: options.frame.palette.foreground,
		strokeWidth: Math.max(2, options.size * 0.055),
	});
}

function drawCircled(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options, 0.18);
	for (const glyph of glyphs) {
		drawCircle(options.ctx, {
			alpha: 0.92,
			color:
				glyph.order % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			radius: options.size * 0.48,
			x: glyph.x,
			y: glyph.y - options.size * 0.04,
		});
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: options.frame.palette.background,
			scaleX: 0.74,
			scaleY: 0.74,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawBracketsQuote(options: TreatTransTreatmentDraw): void {
	drawTreatText(options, { color: options.frame.palette.foreground });
	const rect = treatBounds(options);
	const arm = options.size * 0.38;
	const line = Math.max(2, options.size * 0.045);
	const gap = options.size * 0.22;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(rect.left - gap, rect.top - gap, arm, line);
	options.ctx.fillRect(rect.left - gap, rect.top - gap, line, arm * 1.5);
	options.ctx.fillRect(
		rect.right + gap - arm,
		rect.bottom + gap - line,
		arm,
		line,
	);
	options.ctx.fillRect(
		rect.right + gap - line,
		rect.bottom + gap - arm * 1.5,
		line,
		arm * 1.5,
	);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.fillRect(
		rect.left - gap + line * 2.2,
		rect.top - gap + line * 2.2,
		arm * 0.6,
		line * 0.45,
	);
}

function drawReflection(options: TreatTransTreatmentDraw): void {
	drawTreatText(options, { color: options.frame.palette.foreground });
	const rect = treatBounds(options);
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		rect.left - options.size * 0.1,
		rect.bottom + options.size * 0.05,
		rect.width + options.size * 0.2,
		options.size * 0.75,
	);
	options.ctx.clip();
	options.ctx.translate(0, options.y * 2 + options.size * 0.2);
	options.ctx.scale(1, -0.68);
	options.ctx.globalAlpha *= 0.34;
	options.ctx.fillStyle = paletteMix(
		options,
		options.frame.palette.foreground,
		options.frame.palette.background,
		0.42,
	);
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.restore();
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.globalAlpha *= 0.55;
	options.ctx.fillRect(
		rect.left,
		rect.bottom + options.size * 0.045,
		rect.width,
		1.5,
	);
}

function drawInline(options: TreatTransTreatmentDraw): void {
	const width = Math.max(1.5, options.size * 0.035);
	drawTreatText(options, {
		color: options.frame.palette.foreground,
		strokeColor: options.frame.palette.foreground,
		strokeWidth: width * 3.2,
	});
	options.ctx.lineWidth = width;
	options.ctx.strokeStyle = options.frame.palette.background;
	options.ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.lineWidth = Math.max(0.8, width * 0.36);
	options.ctx.strokeStyle = options.frame.palette.accent;
	options.ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
}

function drawSticker(options: TreatTransTreatmentDraw): void {
	const angle = treatRandomSigned(options, 0, 941) * 0.06;
	options.ctx.translate(options.x, options.y);
	options.ctx.rotate(angle);
	options.ctx.translate(-options.x, -options.y);
	options.ctx.shadowColor = "rgba(0,0,0,0.45)";
	options.ctx.shadowBlur = options.size * 0.06;
	options.ctx.lineWidth = options.size * 0.18;
	options.ctx.strokeStyle = "#ffffff";
	options.ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.shadowBlur = 0;
	options.ctx.lineWidth = options.size * 0.12;
	options.ctx.strokeStyle = "#ffffff";
	options.ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
}

function drawGradientSweep(options: TreatTransTreatmentDraw): void {
	const rect = treatBounds(options);
	drawTreatText(options, { color: options.frame.palette.foreground });
	const sweep =
		rect.left +
		((((treatSeconds(options) / 1.9 + treatRandom(options, 0, 947)) % 1) + 1) %
			1) *
			rect.width;
	const width = options.size * 0.42;
	withRectClip(
		options.ctx,
		[sweep - width / 2, rect.top, width, rect.height],
		() =>
			drawTreatText(options, {
				color: paletteMix(
					options,
					options.frame.palette.accent,
					"#ffffff",
					0.68,
				),
			}),
	);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.globalAlpha *= 0.45;
	options.ctx.fillRect(
		sweep,
		rect.top,
		Math.max(1, options.size * 0.018),
		rect.height,
	);
}
