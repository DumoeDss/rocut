import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	drawExitHoldOutline,
	drawGlyphSet,
	exitHoldGlyphs,
	inCubic,
	inOutSine,
	inQuad,
	mixHex,
	outCubic,
	randomSigned,
	randomUnit,
	smooth,
	stagger,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const MOTION_EXITS = new Set([
	"zoomThrough",
	"zoomFar",
	"spinOut",
	"twist",
	"waveOut",
	"blurOutStagger",
	"whipOut",
	"gravity",
]);

export function drawExitHoldMotionExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !MOTION_EXITS.has(exit)) return false;
	switch (exit) {
		case "zoomThrough":
			drawZoomThrough(options);
			break;
		case "zoomFar":
			drawZoomFar(options);
			break;
		case "spinOut":
			drawSpinOut(options);
			break;
		case "twist":
			drawTwist(options);
			break;
		case "waveOut":
			drawWaveOut(options);
			break;
		case "blurOutStagger":
			drawBlurOutStagger(options);
			break;
		case "whipOut":
			drawWhipOut(options);
			break;
		case "gravity":
			drawGravity(options);
			break;
	}
	return true;
}

function drawZoomThrough(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const scale = Math.min(8, 1 + 4.5 * inCubic(progress) + 0.25 * progress);
	const alpha = 1 - smooth((progress - 0.3) / 0.58);
	for (let copy = 2; copy >= 0; copy -= 1) {
		const echoScale = scale * 0.84 ** copy;
		const echoAlpha =
			copy === 0
				? alpha
				: alpha * 0.45 * 0.62 ** (copy - 1) * smooth(progress / 0.25);
		drawWholeTransform(options, {
			alpha: echoAlpha,
			scaleX: echoScale,
			scaleY: echoScale,
		});
	}
}

function drawZoomFar(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const eased = 1 - (1 - progress) ** 2.6;
	const scale = 1 - 0.9 * eased;
	const alpha = 1 - smooth((progress - 0.5) / 0.5);
	const translateY = -options.size * 0.35 * eased;
	drawWholeTransform(options, {
		alpha,
		scaleX: scale,
		scaleY: scale,
		translateY,
	});
	const glyphs = exitHoldGlyphs(options);
	for (let copy = 1; copy <= 3; copy += 1) {
		const echoScale = scale * 1.2 ** copy;
		const echoAlpha = 0.6 * smooth(progress / 0.2) * 0.62 ** (copy - 1) * alpha;
		for (const glyph of glyphs) {
			drawExitHoldOutline({
				alpha: echoAlpha,
				color: options.frame.palette.foreground,
				glyph: {
					...glyph,
					y: glyph.y + translateY + copy * options.size * 0.06 * eased,
				},
				lineWidth: Math.max(1, options.size * 0.016),
				options,
				scale: echoScale,
			});
		}
	}
}

function drawSpinOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = ((options.frame.cut?.seed ?? 0) & 4) === 0 ? -1 : 1;
	drawGlyphSet(options, (glyph) => {
		const phase = stagger({ order: glyph.order, progress, spread: 0.45 });
		if (phase >= 0.999) return null;
		return {
			alpha: 1 - smooth((phase - 0.8) / 0.2),
			rotation:
				degrees(direction * (glyph.index % 2 === 0 ? 0.8 : 1) * 250) *
				inQuad(phase),
			scaleX: Math.max(0.01, 1 - inCubic(phase)),
			scaleY: Math.max(0.01, 1 - inCubic(phase)),
			translateY: -Math.sin(Math.PI * phase) * glyph.height * 0.18,
		};
	});
}

function drawTwist(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const flatten = 1 - inQuad(clamp01((progress - 0.55) / 0.45));
	const eased = progress ** 1.3;
	drawGlyphSet(options, (glyph) => {
		const angle = eased * (0.5 + 2 * glyph.order) * Math.PI;
		const cosine = Math.cos(angle) * flatten;
		return {
			alpha: 1 - smooth((progress - 0.9) / 0.1),
			color:
				cosine < 0
					? mixHex({
							from: options.frame.palette.foreground,
							to: options.frame.palette.background,
							progress: 0.5,
						})
					: undefined,
			scaleY: cosine,
			skewX: degrees(Math.sin(angle) * 12 * flatten),
		};
	});
}

function drawWaveOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	drawGlyphSet(options, (glyph) => {
		const phase = stagger({ order: glyph.order, progress, spread: 0.55 });
		if (phase >= 0.999) return null;
		const amplitude = options.size * 0.42;
		return {
			alpha: 1 - smooth((phase - 0.45) / 0.55),
			rotation: degrees(Math.sin(phase * Math.PI * 1.5) * 28 + phase * 30),
			translateX: phase * amplitude * 0.6,
			translateY:
				-Math.sin(phase * Math.PI) * amplitude +
				phase * phase * amplitude * 2.6,
		};
	});
}

function drawBlurOutStagger(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = stagger({ order: glyph.order, progress, spread: 0.55 });
		if (phase >= 0.999) continue;
		const eased = inOutSine(phase);
		const softness = eased * Math.min(options.size * 0.045, 4);
		for (const direction of [-1, 1] as const) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: (1 - phase) * 0.18,
					scaleX: 1 + eased * 0.22,
					scaleY: 1 + eased * 0.22,
					translateX: direction * softness,
					translateY: -eased * options.size * 0.12,
				},
			});
		}
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - phase,
				scaleX: 1 + eased * 0.22,
				scaleY: 1 + eased * 0.22,
				translateY: -eased * options.size * 0.12,
			},
		});
	}
}

function drawWhipOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = ((options.frame.cut?.seed ?? 0) & 8) === 0 ? -1 : 1;
	const pullBack = options.size * 0.14 * outCubic(clamp01(progress / 0.28));
	const phase = clamp01((progress - 0.26) / 0.74);
	const velocity = Math.min(1.6, 2 * phase);
	const distance = options.maxWidth + options.size * 5;
	const offset = direction * (distance * phase ** 2 - pullBack * (1 - phase));
	for (let copy = 4; copy >= 0; copy -= 1) {
		const trail = copy / 4;
		drawWholeTransform(options, {
			alpha:
				(1 - smooth((progress - 0.9) / 0.1)) *
				(copy === 0 ? 1 : 0.4 * (1 - trail)),
			scaleX: 1 + velocity * 0.55,
			scaleY: 1 - velocity * 0.08,
			skewX: degrees(-direction * Math.min(28, velocity * 16)),
			translateX:
				offset - direction * options.size * 0.45 * Math.min(1, velocity) * copy,
		});
	}
}

function drawGravity(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		const delay = randomUnit(seed, glyph.index, 901) * 0.4;
		const phase = clamp01((progress - delay) / 0.6);
		if (phase >= 0.999) return null;
		const hop =
			options.size * (0.12 + 0.22 * randomUnit(seed, glyph.index, 902));
		const distance = options.size * 6;
		const initial = 2 * hop + Math.sqrt(4 * hop * hop + 4 * hop * distance);
		const down = -initial * phase + (distance + initial) * phase ** 2;
		return {
			alpha: 1 - smooth((phase - 0.92) / 0.08),
			rotation: degrees(
				randomSigned(seed, glyph.index, 904) * 240 * phase ** 2,
			),
			translateX:
				randomSigned(seed, glyph.index, 903) * options.size * 0.9 * phase,
			translateY: down,
		};
	});
}

// The transform object is kept separate from the draw options at call sites.
// eslint-disable-next-line opencut/prefer-object-params
function drawWholeTransform(
	options: ExitHoldDraw,
	{
		alpha = 1,
		scaleX = 1,
		scaleY = 1,
		skewX = 0,
		translateX = 0,
		translateY = 0,
	}: {
		readonly alpha?: number;
		readonly scaleX?: number;
		readonly scaleY?: number;
		readonly skewX?: number;
		readonly translateX?: number;
		readonly translateY?: number;
	},
): void {
	if (alpha <= 0.003 || scaleX <= 0.003 || scaleY <= 0.003) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.translate(options.x + translateX, options.y + translateY);
	if (skewX) options.ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	options.ctx.scale(scaleX, scaleY);
	options.ctx.translate(-options.x, -options.y);
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
}
