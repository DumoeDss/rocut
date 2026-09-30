import {
	degrees,
	drawExitHoldGlyph,
	drawGlyphSet,
	exitHoldGlyphs,
	frameStep,
	mixHex,
	randomSigned,
	randomUnit,
	secondsOf,
	smoothNoise,
	type ExitHoldDraw,
} from "./exit-hold-geometry";
import { drawExitBWhole, exitBRect } from "./exit-b-drawing";

const EXIT_B_HOLDS = new Set([
	"glowFlicker",
	"windGust",
	"dangle",
	"eqBounce",
	"flashBox",
	"glintSweep",
	"flipSwap",
	"shadowSway",
	"magnetJiggle",
	"typeRattle",
	"focusRack",
	"pluckString",
]);

const KANA = Array.from("アイウエオカキクケコサシスセソナニヌネノ");

export function drawExitBHold(options: ExitHoldDraw): boolean {
	const hold = options.frame.cut?.preset.hold;
	if (!hold || !EXIT_B_HOLDS.has(hold)) return false;
	const state = captureState(options);
	options.ctx.save();
	try {
		switch (hold) {
			case "glowFlicker":
				drawGlowFlicker(options);
				break;
			case "windGust":
				drawWindGust(options);
				break;
			case "dangle":
				drawDangle(options);
				break;
			case "eqBounce":
				drawEqualizerBounce(options);
				break;
			case "flashBox":
				drawFlashBox(options);
				break;
			case "glintSweep":
				drawGlintSweep(options);
				break;
			case "flipSwap":
				drawFlipSwap(options);
				break;
			case "shadowSway":
				drawShadowSway(options);
				break;
			case "magnetJiggle":
				drawMagnetJiggle(options);
				break;
			case "typeRattle":
				drawTypeRattle(options);
				break;
			case "focusRack":
				drawFocusRack(options);
				break;
			case "pluckString":
				drawPluckString(options);
				break;
		}
	} finally {
		options.ctx.restore();
		restoreState({ options, state });
	}
	return true;
}

function drawGlowFlicker(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const flicker =
		0.68 +
		0.22 * smoothNoise({ seed, salt: 610, value: time * 3.3 }) +
		0.1 * smoothNoise({ seed, salt: 611, value: time * 11 });
	options.ctx.shadowColor = options.frame.palette.accent;
	options.ctx.shadowBlur = options.size * (0.08 + 0.28 * flicker);
	drawGlyphSet(options, (glyph) => {
		const stretch =
			1 +
			0.026 *
				(0.5 +
					0.5 *
						smoothNoise({
							seed,
							salt: glyph.index + 612,
							value: time * 6 + glyph.index * 2.3,
						}));
		return {
			alpha: 0.84 + 0.16 * flicker,
			color: mixHex({
				from: options.frame.palette.foreground,
				to: options.frame.palette.accent,
				progress: 0.08 + flicker * 0.08,
			}),
			scaleY: stretch,
			translateY: -(stretch - 1) * options.size * 0.5,
		};
	});
}

function drawWindGust(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const period = 2.2;
	const cycle = Math.floor((time - 0.45) / period);
	const since = time - 0.45 - cycle * period;
	const direction = randomUnit(seed, cycle, 620) < 0.5 ? -1 : 1;
	drawGlyphSet(options, (glyph) => {
		const order = direction > 0 ? glyph.order : 1 - glyph.order;
		const age = since - order * 0.42;
		if (age <= 0 || age > 1.65) return {};
		const response =
			age < 0.25
				? Math.sin((age / 0.25) * (Math.PI / 2))
				: Math.cos((age - 0.25) * 8.5) * Math.exp(-(age - 0.25) * 3.4);
		return {
			rotation: degrees(direction * response * 3.2),
			skewX: degrees(-direction * response * 18),
			translateX: direction * response * options.size * 0.13,
		};
	});
}

function drawDangle(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		const speed =
			Math.PI * 2 * (0.5 + 0.28 * randomUnit(seed, glyph.index, 630));
		const phase = randomUnit(seed, glyph.index, 631) * Math.PI * 2;
		const angle = degrees(
			6.5 * Math.sin(speed * time + phase) +
				1.6 * Math.sin(speed * 2.7 * time + phase * 2),
		);
		const halfHeight = glyph.height * 0.5;
		return {
			rotation: angle,
			translateX: -halfHeight * Math.sin(angle),
			translateY: halfHeight * (Math.cos(angle) - 1),
		};
	});
}

function drawEqualizerBounce(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const base =
		0.52 + 0.38 * smoothNoise({ seed, salt: 640, value: time * 2.6 });
	drawGlyphSet(options, (glyph) => {
		const band = Math.max(
			0,
			Math.min(
				1,
				base *
					(0.58 +
						0.42 *
							smoothNoise({
								seed,
								salt: glyph.index + 641,
								value: time * 6.5 + glyph.index * 1.9,
							})),
			),
		);
		const scale = 1 + 0.34 * band;
		return {
			color: band > 0.7 ? options.frame.palette.accent : undefined,
			scaleY: scale,
			translateY: -(scale - 1) * glyph.height * 0.5,
		};
	});
}

function drawFlashBox(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	if (glyphs.length === 0) return;
	const time = secondsOf(options.frame);
	const beatLength = 0.62;
	const beat = Math.floor(time / beatLength);
	const phase = (time % beatLength) / beatLength;
	const picked = Math.floor(
		randomUnit(options.frame.cut?.seed ?? 0, beat, 650) * glyphs.length,
	);
	if (phase >= 0.62) {
		for (const glyph of glyphs) drawExitHoldGlyph({ glyph, options });
		return;
	}
	const pop = 1 + 0.12 * Math.sin(Math.PI * Math.min(1, phase / 0.22));
	for (const glyph of glyphs) {
		if (glyph.index !== picked) {
			drawExitHoldGlyph({ glyph, options });
			continue;
		}
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(
			glyph.x - glyph.width * 0.58 * pop,
			glyph.y - glyph.height * 0.64 * pop,
			glyph.width * 1.16 * pop,
			glyph.height * 1.18 * pop,
		);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				color: options.frame.palette.background,
				scaleX: pop,
				scaleY: pop,
			},
		});
	}
}

function drawGlintSweep(options: ExitHoldDraw): void {
	options.drawGlyph(options);
	const time = secondsOf(options.frame);
	const phase = (((time - 0.45) % 2.4) + 2.4) % 2.4;
	if (phase >= 0.75) return;
	const rect = exitBRect(options, options.size * 0.15);
	const progress = phase / 0.75;
	const width = options.size * 0.34;
	const x = rect.left - width + (rect.width + width * 2) * progress;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.translate(x, rect.y);
	options.ctx.rotate(degrees(-18));
	options.ctx.rect(-width / 2, -rect.height, width, rect.height * 2);
	options.ctx.clip();
	options.ctx.translate(-x, -rect.y);
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = mixHex({
		from: options.frame.palette.foreground,
		to: "#ffffff",
		progress: 0.82,
	});
	options.drawGlyph(options);
	options.ctx.fillStyle = baseFill;
	options.ctx.restore();
}

function drawFlipSwap(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	if (glyphs.length === 0) return;
	const time = secondsOf(options.frame) - 0.45;
	const cycle = Math.floor(time / 1.6);
	const phase = (time - cycle * 1.6) / 0.95;
	const selected = Math.floor(
		randomUnit(options.frame.cut?.seed ?? 0, cycle, 660) * glyphs.length,
	);
	for (const glyph of glyphs) {
		if (glyph.index !== selected || phase < 0 || phase >= 1) {
			drawExitHoldGlyph({ glyph, options });
			continue;
		}
		const angle = phase < 0.5 ? phase * Math.PI : (1 - phase) * Math.PI;
		const scaleX = Math.max(0.025, Math.abs(Math.cos(angle)));
		const alternate = phase >= 0.18 && phase <= 0.82;
		const character =
			KANA[
				Math.floor(
					randomUnit(options.frame.cut?.seed ?? 0, cycle, 661) * KANA.length,
				)
			] ?? glyph.character;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				character: alternate ? character : glyph.character,
				color: alternate ? options.frame.palette.accent : undefined,
				scaleX,
			},
		});
	}
}

function drawShadowSway(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const angle = degrees(60 + 42 * Math.sin((time * Math.PI * 2) / 5.5 + seed));
	const length =
		options.size * (0.15 + 0.05 * Math.sin((time * Math.PI * 2) / 3.3));
	for (let copy = 12; copy >= 1; copy -= 1) {
		const progress = copy / 12;
		drawExitBWhole({
			alpha: 0.11 * (1 - progress * 0.45),
			color: mixHex({
				from: options.frame.palette.background,
				to: options.frame.palette.accent,
				progress: 0.38,
			}),
			options,
			translateX: Math.cos(angle) * length * progress,
			translateY: Math.sin(angle) * length * progress,
		});
	}
	options.drawGlyph(options);
}

function drawMagnetJiggle(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const rect = exitBRect(options);
	const magnetX = rect.x + Math.sin(time * 0.9 + (seed % 9)) * rect.width * 0.5;
	const magnetY = rect.y + Math.sin(time * 1.7 + 1) * rect.height * 0.65;
	const step = frameStep(options.frame);
	drawGlyphSet(options, (glyph) => {
		const dx = magnetX - glyph.x;
		const dy = magnetY - glyph.y;
		const distance = Math.max(1, Math.hypot(dx, dy));
		const force = 1 / (1 + (distance / (options.size * 1.1)) ** 2);
		const pull = options.size * 0.2 * force;
		const buzz =
			force > 0.3
				? randomSigned(seed, step, glyph.index, 670) *
					options.size *
					0.018 *
					force
				: 0;
		return {
			rotation: degrees((dx / distance) * 7 * force),
			translateX: (dx / distance) * pull + buzz,
			translateY: (dy / distance) * pull,
		};
	});
}

function drawTypeRattle(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const beat = Math.floor(time / 0.45);
	const since = time - beat * 0.45;
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		let episode = beat;
		for (let offset = 0; offset < 7; offset += 1) {
			if (randomUnit(seed, beat - offset, glyph.index, 680) < 0.3) {
				episode = beat - offset;
				break;
			}
		}
		const hit = episode === beat && since < 0.1 ? 1 - since / 0.1 : 0;
		return {
			alpha: 0.82 + 0.18 * randomUnit(seed, episode, glyph.index, 681),
			rotation: degrees(randomSigned(seed, episode, glyph.index, 682) * 3.2),
			translateX:
				randomSigned(seed, episode, glyph.index, 683) * options.size * 0.012,
			translateY:
				randomSigned(seed, episode, glyph.index, 684) * options.size * 0.045 +
				hit * options.size * 0.04,
		};
	});
}

function drawFocusRack(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const focus = 0.5 + 0.62 * Math.sin((time * Math.PI * 2) / 4.6);
	for (const glyph of exitHoldGlyphs(options)) {
		const distance = Math.max(0, (Math.abs(glyph.order - focus) - 0.08) / 0.52);
		const softness = Math.min(1, distance);
		if (softness > 0.04) {
			for (const direction of [-1, 1] as const) {
				drawExitHoldGlyph({
					glyph,
					options,
					transform: {
						alpha: 0.13 * softness,
						scaleX: 1 + 0.04 * softness,
						scaleY: 1 + 0.04 * softness,
						translateX: direction * softness * options.size * 0.035,
					},
				});
			}
		}
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - 0.28 * softness,
				scaleX: 1 + 0.035 * softness,
				scaleY: 1 + 0.035 * softness,
			},
		});
	}
}

function drawPluckString(options: ExitHoldDraw): void {
	const time = secondsOf(options.frame);
	const period = 2.4;
	const age = (((time - 0.45) % period) + period) % period;
	const amplitude =
		options.size * 0.19 * Math.exp(-age * 1.7) * Math.min(1, age / 0.04);
	const glyphs = exitHoldGlyphs(options);
	for (const glyph of glyphs) {
		const position = (glyph.index + 1) / (glyphs.length + 1);
		const displacement =
			amplitude *
			(Math.sin(Math.PI * position) * Math.cos(age * Math.PI * 2 * 3.2) +
				0.3 *
					Math.sin(Math.PI * 2 * position) *
					Math.cos(age * Math.PI * 2 * 6.6 + 1));
		drawExitHoldGlyph({
			glyph,
			options,
			transform: { translateY: displacement },
		});
	}
	if (amplitude <= 0.25) options.drawGlyph(options);
}

function captureState(options: ExitHoldDraw) {
	return {
		fillStyle: options.ctx.fillStyle,
		filter: options.ctx.filter,
		globalAlpha: options.ctx.globalAlpha,
		lineWidth: options.ctx.lineWidth,
		shadowBlur: options.ctx.shadowBlur,
		shadowColor: options.ctx.shadowColor,
		strokeStyle: options.ctx.strokeStyle,
		textAlign: options.ctx.textAlign,
	} as const;
}

function restoreState({
	options,
	state,
}: {
	readonly options: ExitHoldDraw;
	readonly state: ReturnType<typeof captureState>;
}): void {
	options.ctx.fillStyle = state.fillStyle;
	options.ctx.filter = state.filter;
	options.ctx.globalAlpha = state.globalAlpha;
	options.ctx.lineWidth = state.lineWidth;
	options.ctx.shadowBlur = state.shadowBlur;
	options.ctx.shadowColor = state.shadowColor;
	options.ctx.strokeStyle = state.strokeStyle;
	options.ctx.textAlign = state.textAlign;
}
