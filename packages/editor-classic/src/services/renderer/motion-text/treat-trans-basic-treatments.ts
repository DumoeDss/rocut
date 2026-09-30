import {
	clamp01,
	drawTreatGlyph,
	drawTreatText,
	paletteMix,
	treatBounds,
	treatRandom,
	treatSeconds,
	treatTransGlyphs,
	type TreatTransTreatmentDraw,
	withRectClip,
} from "./treat-trans-drawing";

const BASIC_TREATMENTS = new Set([
	"neonOutline",
	"chrome",
	"rainbow",
	"glitchSplit",
	"shadowStack",
	"stencilGap",
	"waterline",
	"karaoke",
	"sizeWave",
]);

export function drawTreatTransBasicTreatment(
	options: TreatTransTreatmentDraw,
): boolean {
	const treat = options.frame.cut?.preset.treat;
	if (!treat || !BASIC_TREATMENTS.has(treat)) return false;
	switch (treat) {
		case "neonOutline":
			drawNeonOutline(options);
			break;
		case "chrome":
			drawChrome(options);
			break;
		case "rainbow":
			drawRainbow(options);
			break;
		case "glitchSplit":
			drawGlitchSplit(options);
			break;
		case "shadowStack":
			drawShadowStack(options);
			break;
		case "stencilGap":
			drawStencilGap(options);
			break;
		case "waterline":
			drawWaterline(options);
			break;
		case "karaoke":
			drawKaraoke(options);
			break;
		case "sizeWave":
			drawSizeWave(options);
			break;
	}
	return true;
}

function drawNeonOutline(options: TreatTransTreatmentDraw): void {
	const { ctx, frame, size } = options;
	const pulse =
		0.5 +
		0.5 *
			Math.sin(treatSeconds(options) * 17 + treatRandom(options, 0, 901) * 6);
	const flicker = 0.78 + 0.22 * (pulse > 0.9 ? pulse * 0.25 : pulse);
	ctx.save();
	ctx.textAlign = "center";
	ctx.shadowColor = frame.palette.accent;
	ctx.shadowBlur = size * 0.18;
	ctx.globalAlpha *= flicker * 0.38;
	ctx.lineWidth = Math.max(4, size * 0.12);
	ctx.strokeStyle = frame.palette.accent;
	ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	ctx.shadowBlur = size * 0.06;
	ctx.globalAlpha = flicker;
	ctx.lineWidth = Math.max(1.5, size * 0.028);
	ctx.strokeStyle = paletteMix(
		options,
		frame.palette.foreground,
		"#ffffff",
		0.45,
	);
	ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	ctx.restore();
}

function drawChrome(options: TreatTransTreatmentDraw): void {
	const rect = treatBounds(options);
	const horizon = rect.top + rect.height * 0.53;
	drawTreatText(options, {
		color: paletteMix(
			options,
			options.frame.palette.foreground,
			"#ffffff",
			0.72,
		),
		strokeColor: paletteMix(
			options,
			options.frame.palette.foreground,
			"#000000",
			0.68,
		),
		strokeWidth: Math.max(1.2, options.size * 0.024),
	});
	withRectClip(
		options.ctx,
		[rect.left, horizon, rect.width, rect.bottom - horizon],
		() =>
			drawTreatText(options, {
				color: paletteMix(
					options,
					options.frame.palette.accent,
					"#ffffff",
					0.48,
				),
			}),
	);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.globalAlpha *= 0.72;
	options.ctx.fillRect(
		rect.left,
		horizon,
		rect.width,
		Math.max(1, options.size * 0.025),
	);
}

function drawRainbow(options: TreatTransTreatmentDraw): void {
	const colors = [
		options.frame.palette.foreground,
		options.frame.palette.accent,
		options.frame.palette.secondary,
	];
	const phase = Math.floor(treatSeconds(options) * 5);
	for (const glyph of treatTransGlyphs(options)) {
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: colors[(glyph.order + phase) % colors.length],
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawGlitchSplit(options: TreatTransTreatmentDraw): void {
	const time = treatSeconds(options);
	const step = Math.floor(time * 24);
	const hit = treatRandom(options, step, 911) > 0.62;
	const distance =
		options.size *
		((hit ? 0.1 : 0.055) + treatRandom(options, step, 912) * 0.03);
	drawTreatText(options, {
		alpha: 0.78,
		color: options.frame.palette.accent,
		offsetX: -distance,
		offsetY: hit ? options.size * 0.02 : 0,
	});
	drawTreatText(options, {
		alpha: 0.72,
		color: options.frame.palette.secondary,
		offsetX: distance,
		offsetY: hit ? -options.size * 0.025 : 0,
	});
	drawTreatText(options, {
		alpha: 0.86,
		color: options.frame.palette.foreground,
	});
}

function drawShadowStack(options: TreatTransTreatmentDraw): void {
	const colors = [
		options.frame.palette.secondary,
		options.frame.palette.accent,
		paletteMix(
			options,
			options.frame.palette.accent,
			options.frame.palette.background,
			0.42,
		),
	];
	for (let copy = colors.length; copy >= 1; copy -= 1) {
		drawTreatText(options, {
			color: colors[copy - 1],
			offsetX: options.size * 0.052 * copy,
			offsetY: options.size * 0.044 * copy,
			strokeColor: options.frame.palette.background,
			strokeWidth: Math.max(1, options.size * 0.02),
		});
	}
	drawTreatText(options, { color: options.frame.palette.foreground });
}

function drawStencilGap(options: TreatTransTreatmentDraw): void {
	const rect = treatBounds(options);
	const gap = options.size * 0.075;
	const center =
		options.y + Math.sin(treatSeconds(options) * 1.8) * options.size * 0.035;
	withRectClip(
		options.ctx,
		[rect.left, rect.top, rect.width, center - gap - rect.top],
		() => drawTreatText(options, { color: options.frame.palette.foreground }),
	);
	withRectClip(
		options.ctx,
		[rect.left, center + gap, rect.width, rect.bottom - center - gap],
		() => drawTreatText(options, { color: options.frame.palette.foreground }),
	);
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.globalAlpha *= 0.7;
	options.ctx.fillRect(rect.left, center - 0.75, rect.width, 1.5);
}

function drawWaterline(options: TreatTransTreatmentDraw): void {
	const rect = treatBounds(options);
	const level =
		rect.top +
		rect.height *
			(0.47 +
				0.12 * Math.sin(treatSeconds(options) * 2.6 + treatSeedPhase(options)));
	drawTreatText(options, {
		alpha: 0.9,
		color: options.frame.palette.background,
		strokeColor: options.frame.palette.foreground,
		strokeWidth: Math.max(1.3, options.size * 0.026),
	});
	withRectClip(
		options.ctx,
		[rect.left, level, rect.width, rect.bottom - level],
		() => drawTreatText(options, { color: options.frame.palette.accent }),
	);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.fillRect(
		rect.left,
		level - 1,
		rect.width,
		Math.max(2, options.size * 0.03),
	);
}

function drawKaraoke(options: TreatTransTreatmentDraw): void {
	const rect = treatBounds(options);
	drawTreatText(options, {
		alpha: 0.54,
		color: options.frame.palette.foreground,
	});
	const progress = clamp01((options.frame.progress - 0.08) / 0.78);
	withRectClip(
		options.ctx,
		[rect.left, rect.top, rect.width * progress, rect.height],
		() =>
			drawTreatText(options, {
				color: options.frame.palette.accent,
				strokeColor: options.frame.palette.background,
				strokeWidth: Math.max(1, options.size * 0.025),
			}),
	);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.fillRect(
		rect.left,
		rect.bottom + options.size * 0.08,
		rect.width * progress,
		Math.max(2, options.size * 0.035),
	);
}

function drawSizeWave(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options);
	for (const glyph of glyphs) {
		const scale =
			0.72 +
			0.34 *
				(0.5 +
					0.5 * Math.sin(glyph.order * 1.28 + treatSeconds(options) * 1.3));
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color:
				scale > 0.95
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			scaleX: scale,
			scaleY: scale,
			x: glyph.x,
			y: glyph.y + (1 - scale) * options.size * 0.38,
		});
	}
}

function treatSeedPhase(options: TreatTransTreatmentDraw): number {
	return treatRandom(options, 0, 919) * Math.PI * 2;
}
