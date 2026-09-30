import {
	degrees,
	drawExitHoldGlyph,
	drawGlyphSet,
	exitHoldGlyphs,
	frameStep,
	mixHex,
	outQuad,
	randomSigned,
	randomUnit,
	secondsOf,
	smoothNoise,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const EXIT_HOLD_IDS = new Set([
	"shimmer",
	"colorRun",
	"rotateSlow",
	"trackBreathe",
	"skewWobble",
	"beatHop",
	"hWave",
	"heartbeat",
	"orbitSmall",
	"jelly",
	"scanBand",
	"noiseDrift",
	"tilt",
	"zoomSlow",
	"stretchPulse",
	"glitchJump",
	"echoTrail",
]);

export function drawExitHoldHold(options: ExitHoldDraw): boolean {
	const hold = options.frame.cut?.preset.hold;
	if (!hold || !EXIT_HOLD_IDS.has(hold)) return false;
	const base = captureDrawingState(options);
	options.ctx.save();
	try {
		switch (hold) {
			case "shimmer":
				drawShimmer(options);
				break;
			case "colorRun":
				drawColorRun(options);
				break;
			case "rotateSlow":
				drawWholeTransform(options, {
					rotation:
						degrees(Math.min(10, secondsOf(options.frame) * 2.6)) *
						(seedDirection(options) * 0.82),
				});
				break;
			case "trackBreathe":
				drawTrackBreathe(options);
				break;
			case "skewWobble":
				drawWholeTransform(options, {
					skewX:
						degrees(12) *
						Math.sin((secondsOf(options.frame) * Math.PI * 2) / 1.9),
				});
				break;
			case "beatHop":
				drawBeatHop(options);
				break;
			case "hWave":
				drawHorizontalWave(options);
				break;
			case "heartbeat":
				drawHeartbeat(options);
				break;
			case "orbitSmall":
				drawOrbit(options);
				break;
			case "jelly":
				drawJelly(options);
				break;
			case "scanBand":
				drawScanBand(options);
				break;
			case "noiseDrift":
				drawNoiseDrift(options);
				break;
			case "tilt":
				drawTilt(options);
				break;
			case "zoomSlow":
				drawWholeTransform(options, {
					scaleX: 1 + 0.07 * outQuad(options.frame.progress),
					scaleY: 1 + 0.07 * outQuad(options.frame.progress),
				});
				break;
			case "stretchPulse":
				drawStretchPulse(options);
				break;
			case "glitchJump":
				drawGlitchJump(options);
				break;
			case "echoTrail":
				drawEchoTrail(options);
				break;
		}
	} finally {
		options.ctx.restore();
		restoreDrawingState({ options, state: base });
	}
	return true;
}

function captureDrawingState(options: ExitHoldDraw) {
	return {
		fillStyle: options.ctx.fillStyle,
		filter: options.ctx.filter,
		globalAlpha: options.ctx.globalAlpha,
		lineWidth: options.ctx.lineWidth,
		strokeStyle: options.ctx.strokeStyle,
		textAlign: options.ctx.textAlign,
	} as const;
}

function restoreDrawingState({
	options,
	state,
}: {
	readonly options: ExitHoldDraw;
	readonly state: ReturnType<typeof captureDrawingState>;
}): void {
	options.ctx.fillStyle = state.fillStyle;
	options.ctx.filter = state.filter;
	options.ctx.globalAlpha = state.globalAlpha;
	options.ctx.lineWidth = state.lineWidth;
	options.ctx.strokeStyle = state.strokeStyle;
	options.ctx.textAlign = state.textAlign;
}

function drawShimmer(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const step = frameStep(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		const shimmer =
			0.5 +
			0.5 *
				smoothNoise({
					seed,
					salt: glyph.index + 401,
					value: time * 3.2 + glyph.index * 1.7,
				});
		const spark = randomUnit(seed, step, glyph.index, 402) < 0.08;
		return {
			alpha: 1 - 0.42 * shimmer ** 2,
			color: spark ? options.frame.palette.accent : undefined,
			scaleX: spark ? 1.06 : 1,
			scaleY: spark ? 1.06 : 1,
		};
	});
}

function drawColorRun(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	const position = ((secondsOf(options.frame) * 7) % (glyphs.length + 5)) - 2.5;
	for (const glyph of glyphs) {
		const distance = glyph.index - position;
		const weight = Math.exp(-(distance * distance) / 1.6);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				color:
					weight >= 0.02
						? mixHex({
								from: options.frame.palette.foreground,
								to: options.frame.palette.accent,
								progress: weight * 0.9,
							})
						: undefined,
				translateY: -weight * options.size * 0.035,
			},
		});
	}
}

function drawTrackBreathe(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	const center =
		glyphs.length > 0
			? (glyphs[0]!.x + glyphs[glyphs.length - 1]!.x) / 2
			: options.x;
	const amount =
		Math.sin((secondsOf(options.frame) * Math.PI * 2) / 2.8) * 0.075;
	for (const glyph of glyphs) {
		drawExitHoldGlyph({
			glyph,
			options,
			transform: { translateX: (glyph.x - center) * amount },
		});
	}
}

function drawBeatHop(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	const period = 0.45;
	const time = secondsOf(options.frame);
	const position = Math.floor(time / period) % Math.max(1, glyphs.length);
	const phase = (time % period) / (period * 0.85);
	const hop = phase < 1 ? Math.sin(Math.PI * phase) ** 0.7 : 0;
	for (const glyph of glyphs) {
		const distance = Math.abs(glyph.index - position);
		const weight = distance === 0 ? 1 : distance === 1 ? 0.3 : 0;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				scaleX: 1 - 0.05 * hop * weight,
				scaleY: 1 + 0.08 * hop * weight,
				translateY: -hop * weight * options.size * 0.2,
			},
		});
	}
}

function drawHorizontalWave(options: ExitHoldDraw): void {
	const phase = secondsOf(options.frame) * Math.PI * 2 * 0.55;
	drawGlyphSet(options, (glyph) => {
		const angle = phase - glyph.index * 0.9;
		return {
			skewX: degrees(-Math.cos(angle) * 9),
			translateX: Math.sin(angle) * options.size * 0.085,
		};
	});
}

function drawHeartbeat(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame) % 1.05;
	const pulse =
		Math.exp(-time * 9) + (time > 0.2 ? 0.75 * Math.exp(-(time - 0.2) * 9) : 0);
	const scale = 1 + 0.055 * pulse;
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = mixHex({
		from: options.frame.palette.foreground,
		to: options.frame.palette.accent,
		progress: Math.min(0.85, pulse * 0.6),
	});
	drawWholeTransform(options, { scaleX: scale, scaleY: scale });
	options.ctx.fillStyle = baseFill;
}

function drawOrbit(options: ExitHoldDraw): void {
	const direction = seedDirection(options);
	const phase = (secondsOf(options.frame) * Math.PI * 2 * direction) / 1.7;
	const radius = options.size * 0.05;
	drawGlyphSet(options, (glyph) => ({
		translateX: Math.cos(phase + glyph.index * 0.9) * radius,
		translateY: Math.sin(phase + glyph.index * 0.9) * radius,
	}));
}

function drawJelly(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	drawGlyphSet(options, (glyph) => {
		const wave = Math.sin(time * Math.PI * 2 * 1.1 - glyph.index * 0.55);
		const amount = wave * 0.1;
		return {
			scaleX: 1 + amount,
			scaleY: 1 - amount,
			translateY: amount * options.size * 0.5,
		};
	});
}

function drawScanBand(options: ExitHoldDraw): void {
	options.drawGlyph(options);
	const period = 2.2;
	const time = secondsOf(options.frame);
	const cycle = Math.floor(time / period);
	const phase = (time % period) / (period * 0.7);
	if (phase >= 1) return;
	const height = Math.max(options.size * 0.24, options.size * 0.32);
	const top =
		options.y - options.size * 0.9 + (options.size * 1.8 + height) * phase;
	const direction =
		randomUnit(options.frame.cut?.seed ?? 0, cycle, 451) < 0.5 ? -1 : 1;
	const offset = direction * options.size * 0.075;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - options.maxWidth / 2,
		top,
		options.maxWidth,
		height,
	);
	options.ctx.clip();
	options.ctx.translate(offset, 0);
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.globalAlpha *= 0.55;
	options.ctx.fillRect(
		options.x - options.maxWidth / 2,
		top + height - Math.max(1, options.size * 0.012),
		options.maxWidth,
		Math.max(1, options.size * 0.012),
	);
	options.ctx.globalAlpha /= 0.55;
}

function drawNoiseDrift(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame) * 0.35;
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => ({
		rotation: degrees(
			smoothNoise({
				seed: seed + 37,
				salt: glyph.index,
				value: time * 1.3 + glyph.index * 0.9,
			}) * 7,
		),
		translateX:
			smoothNoise({
				seed: seed + 11,
				salt: glyph.index,
				value: time + glyph.index * 1.7,
			}) *
			options.size *
			0.075,
		translateY:
			smoothNoise({
				seed: seed + 23,
				salt: glyph.index,
				value: time + glyph.index * 2.3,
			}) *
			options.size *
			0.075,
	}));
}

function drawTilt(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	const center =
		glyphs.length > 0
			? (glyphs[0]!.x + glyphs[glyphs.length - 1]!.x) / 2
			: options.x;
	const seed = options.frame.cut?.seed ?? 0;
	const tangent = Math.tan(
		degrees(
			Math.sin((secondsOf(options.frame) * Math.PI * 2) / 4.2 + (seed % 5)) * 4,
		),
	);
	for (const glyph of glyphs) {
		drawExitHoldGlyph({
			glyph,
			options,
			transform: { translateY: (glyph.x - center) * tangent },
		});
	}
}

function drawStretchPulse(options: ExitHoldDraw): void {
	const since = secondsOf(options.frame) % 0.5;
	const kick = Math.exp(-since * 8);
	drawWholeTransform(options, {
		scaleX: 1 + 0.12 * kick,
		scaleY: 1 - 0.045 * kick,
	});
}

function drawGlitchJump(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	const slot = Math.floor(step / 8);
	const phase = step - slot * 8;
	if (phase > 2 || randomUnit(seed, slot, 501) > 0.62) {
		options.drawGlyph(options);
		return;
	}
	const dx = randomSigned(seed, slot, 502) * options.size * 0.2;
	const dy = randomSigned(seed, slot, 503) * options.size * 0.04;
	options.ctx.save();
	options.ctx.translate(dx, dy);
	options.drawGlyph(options);
	options.ctx.restore();
	if (phase !== 0) return;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.globalAlpha = baseAlpha * 0.35;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - options.maxWidth / 2,
		options.y - options.size * 0.1,
		options.maxWidth,
		options.size * 0.18,
	);
	options.ctx.clip();
	options.ctx.translate(-dx * 1.8, 0);
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawEchoTrail(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const phase = (seed % 100) * 0.1;
	const angular = (Math.PI * 2) / 3.4;
	const x = Math.sin(angular * time + phase) * options.size * 0.09;
	const y = Math.sin(angular * 1.37 * time + phase * 1.3) * options.size * 0.05;
	const vx = Math.cos(angular * time + phase) * angular * options.size * 0.09;
	const vy =
		Math.cos(angular * 1.37 * time + phase * 1.3) *
		angular *
		1.37 *
		options.size *
		0.05;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	for (let copy = 3; copy >= 1; copy -= 1) {
		options.ctx.save();
		options.ctx.globalAlpha = baseAlpha * 0.34 * 0.62 ** (copy - 1);
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.translate(x - vx * 0.3 * copy, y - vy * 0.3 * copy);
		options.drawGlyph(options);
		options.ctx.restore();
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
	options.ctx.save();
	options.ctx.translate(x, y);
	options.drawGlyph(options);
	options.ctx.restore();
}

// The transform object is kept separate from the draw options at call sites.
// eslint-disable-next-line opencut/prefer-object-params
function drawWholeTransform(
	options: ExitHoldDraw,
	{
		rotation = 0,
		scaleX = 1,
		scaleY = 1,
		skewX = 0,
	}: {
		readonly rotation?: number;
		readonly scaleX?: number;
		readonly scaleY?: number;
		readonly skewX?: number;
	},
): void {
	options.ctx.save();
	options.ctx.translate(options.x, options.y);
	if (rotation) options.ctx.rotate(rotation);
	if (skewX) options.ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	options.ctx.scale(scaleX, scaleY);
	options.ctx.translate(-options.x, -options.y);
	options.drawGlyph(options);
	options.ctx.restore();
}

function seedDirection(options: ExitHoldDraw): -1 | 1 {
	return ((options.frame.cut?.seed ?? 0) >>> 1) & 1 ? 1 : -1;
}
