import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	drawGlyphSet,
	exitHoldGlyphs,
	inCubic,
	inOutCubic,
	inOutSine,
	inQuad,
	mixHex,
	randomUnit,
	smooth,
	stagger,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const MASK_EXITS = new Set([
	"sinkMask",
	"riseOut",
	"flipOutX",
	"flipOutY",
	"foldOut",
	"squash",
	"trackOutWide",
	"collapse",
]);

export function drawExitHoldMaskExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !MASK_EXITS.has(exit)) return false;
	switch (exit) {
		case "sinkMask":
			drawSinkMask(options);
			break;
		case "riseOut":
			drawRiseOut(options);
			break;
		case "flipOutX":
			drawFlipOutX(options);
			break;
		case "flipOutY":
			drawFlipOutY(options);
			break;
		case "foldOut":
			drawFoldOut(options);
			break;
		case "squash":
			drawSquash(options);
			break;
		case "trackOutWide":
			drawTrackOutWide(options);
			break;
		case "collapse":
			drawCollapse(options);
			break;
	}
	return true;
}

function drawSinkMask(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	drawGlyphSet(options, (glyph) => {
		const phase = stagger({ order: glyph.order, progress, spread: 0.5 });
		if (phase >= 0.999) return null;
		const distance =
			(inOutCubic(phase) - 0.06 * Math.sin(Math.PI * clamp01(phase / 0.3))) *
			glyph.height *
			1.4;
		return {
			clipY: [-1.2 - distance / glyph.height, 0.72 - distance / glyph.height],
			translateY: distance,
		};
	});
}

function drawRiseOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		const phase = stagger({
			order: randomUnit(seed, glyph.index, 201),
			progress,
			spread: 0.5,
		});
		if (phase >= 0.999) return null;
		const distance = -(phase ** 2.2) * glyph.height * 1.5;
		const stretch = 1 + 0.5 * Math.sin(Math.PI * phase) * phase;
		return {
			alpha: 1 - smooth((phase - 0.8) / 0.2),
			clipY: [
				-1.2 - distance / glyph.height / stretch,
				0.72 - distance / glyph.height / stretch,
			],
			scaleX: 1 - 0.1 * (stretch - 1),
			scaleY: stretch,
			translateY: distance,
		};
	});
}

function drawFlipOutX(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = ((options.frame.cut?.seed ?? 0) & 1) === 0 ? -1 : 1;
	drawGlyphSet(options, (glyph) => {
		const phase = stagger({ order: glyph.order, progress, spread: 0.5 });
		if (phase >= 0.999) return null;
		const angle = inQuad(phase) * (Math.PI / 2);
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		return {
			alpha: 1 - smooth((phase - 0.8) / 0.2),
			color: mixHex({
				from: options.frame.palette.foreground,
				to: options.frame.palette.background,
				progress: sine * 0.55,
			}),
			scaleX: cosine,
			scaleY: 1 + sine * 0.14,
			translateX: direction * (1 - cosine) * glyph.width * 0.5,
		};
	});
}

function drawFlipOutY(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		const phase = stagger({
			order: randomUnit(seed, glyph.index, 211),
			progress,
			spread: 0.5,
		});
		if (phase >= 0.999) return null;
		const angle = inQuad(phase) * (Math.PI / 2);
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		return {
			color: mixHex({
				from: options.frame.palette.foreground,
				to: options.frame.palette.background,
				progress: sine * 0.6,
			}),
			scaleX: 1 - sine * 0.12,
			scaleY: cosine,
			translateY: (1 - cosine) * glyph.height * 0.5,
		};
	});
}

function drawFoldOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = stagger({ order: glyph.order, progress, spread: 0.3 });
		if (phase >= 0.999) continue;
		const bottom = clamp01((phase - 0.5) / 0.5);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - smooth((phase - 0.85) / 0.15),
				clipY: [0, 1.2],
				scaleY: Math.cos(inQuad(bottom) * (Math.PI / 2)),
			},
		});
		const top = inOutSine(clamp01(phase / 0.5));
		const topScale =
			Math.cos(top * Math.PI) * Math.cos(inQuad(bottom) * (Math.PI / 2));
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - smooth((phase - 0.85) / 0.15),
				clipY: [-1.2, 0.01],
				color:
					topScale < 0
						? mixHex({
								from: options.frame.palette.foreground,
								to: options.frame.palette.accent,
								progress: 0.75,
							})
						: undefined,
				scaleY: topScale,
			},
		});
	}
}

function drawSquash(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const vertical = 1 - 0.97 * inCubic(clamp01(progress / 0.42));
	const horizontal =
		(1 + 0.08 * (1 - (1 - clamp01(progress / 0.42)) ** 3)) *
		(1 - inOutCubic(clamp01((progress - 0.4) / 0.45)));
	const alpha = 1 - smooth((progress - 0.7) / 0.2);
	if (horizontal > 0.01 && alpha > 0.003) {
		options.ctx.save();
		options.ctx.translate(options.x, options.y);
		options.ctx.scale(horizontal, vertical);
		options.ctx.translate(-options.x, -options.y);
		const baseAlpha = options.ctx.globalAlpha;
		options.ctx.globalAlpha = baseAlpha * alpha;
		options.drawGlyph(options);
		options.ctx.globalAlpha = baseAlpha;
		options.ctx.restore();
	}
	const dotAlpha =
		smooth((progress - 0.6) / 0.2) * (1 - smooth((progress - 0.88) / 0.12));
	if (dotAlpha <= 0.01) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * dotAlpha;
	options.ctx.fillStyle = options.frame.palette.foreground;
	const radius = options.size * 0.08;
	options.ctx.fillRect(
		options.x - radius,
		options.y - radius,
		radius * 2,
		radius * 2,
	);
	options.ctx.fillRect(
		options.x - radius * 5,
		options.y - radius * 0.12,
		radius * 10,
		radius * 0.24,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawTrackOutWide(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const glyphs = exitHoldGlyphs(options);
	const center =
		glyphs.length > 0
			? (glyphs[0]!.x + glyphs[glyphs.length - 1]!.x) / 2
			: options.x;
	const spread = inQuad(progress) * 1.6 + progress * 0.3;
	const thin = 1 - 0.6 * inQuad(progress);
	const alpha = 1 - smooth((progress - 0.2) / 0.8);
	for (const glyph of glyphs) {
		const offset = (glyph.x - center) * spread;
		const softness = Math.min(options.size * 0.035 * inQuad(progress), 3);
		if (softness > 0.1) {
			for (const direction of [-1, 1] as const) {
				drawExitHoldGlyph({
					glyph,
					options,
					transform: {
						alpha: alpha * 0.16,
						scaleX: thin,
						translateX: offset + direction * softness,
					},
				});
			}
		}
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha,
				scaleX: thin,
				translateX: offset,
			},
		});
	}
}

function drawCollapse(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = ((options.frame.cut?.seed ?? 0) & 2) === 0 ? -1 : 1;
	const contraction = 1 - inQuad(progress);
	const scale = Math.max(0.02, 1 - inQuad(progress) * 0.94);
	const glyphs = exitHoldGlyphs(options);
	const radius = Math.max(options.maxWidth / 2, options.size);
	for (const glyph of glyphs) {
		const px = glyph.x - options.x;
		const py = glyph.y - options.y;
		const turn =
			direction *
			inQuad(progress) *
			degrees(140 + 220 * (1 - clamp01(Math.hypot(px, py) / radius)));
		const cosine = Math.cos(turn);
		const sine = Math.sin(turn);
		const x = (px * cosine - py * sine) * contraction;
		const y = (px * sine + py * cosine) * contraction;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - smooth((progress - 0.8) / 0.2),
				rotation: turn,
				scaleX: scale,
				scaleY: scale,
				translateX: x - px,
				translateY: y - py,
			},
		});
	}
}
