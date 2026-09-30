import {
	clamp01,
	degrees,
	drawEnterAClipped,
	drawEnterAGlyph,
	drawEnterALine,
	drawEnterAOutlineGlyph,
	drawEnterAWhole,
	enterABounds,
	enterADirection,
	enterAFrameStep,
	enterAGlyphs,
	enterAInCubic,
	enterAInQuad,
	enterAOutBack,
	enterAOutQuart,
	enterAPhase,
	enterARandom,
	enterARandomSigned,
	enterASmooth,
	lerp,
	outCubic,
	type EnterADraw,
} from "./enter-a-drawing";

const SIGNS = Array.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&+<>[]");

export function drawEnterADigitalFamily(options: EnterADraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "glitchIn":
			drawGlitchIn(options);
			return true;
		case "echoIn":
			drawEchoIn(options);
			return true;
		case "resolve":
			drawResolve(options);
			return true;
		case "magnet":
			drawMagnet(options);
			return true;
		case "inkBleed":
			drawInkBleed(options);
			return true;
		case "neonOn":
			drawNeonOn(options);
			return true;
		case "cursorSweep":
			drawCursorSweep(options);
			return true;
		case "stamp":
			drawStamp(options);
			return true;
		default:
			return false;
	}
}

function drawGlitchIn(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const step = enterAFrameStep(options);
	const colors = [
		options.frame.palette.accent,
		options.frame.palette.secondary,
		"#ff3b8d",
		"#35d8ff",
	];
	for (const glyph of enterAGlyphs(options)) {
		const settle = 0.38 + 0.52 * enterARandom(options, glyph.index, 71);
		if (progress >= settle) {
			drawEnterAGlyph({ glyph, options });
			continue;
		}
		const phase = progress / settle;
		if (
			enterARandom(options, glyph.index + step * 31, 72) >
			0.25 * clamp01(progress * 12) + 0.75 * phase
		) {
			continue;
		}
		const remaining = 1 - phase;
		const scaleX =
			enterARandom(options, glyph.index + step * 37, 77) < 0.35
				? lerp({
						start: 0.55,
						end: 1.9,
						progress: enterARandom(options, glyph.index + step * 41, 78),
					})
				: 1;
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				color:
					colors[
						Math.floor(
							enterARandom(options, glyph.index + step * 43, 75) *
								colors.length,
						) % colors.length
					],
				scaleX,
				translateX:
					enterARandomSigned(options, glyph.index + step * 47, 73) *
					options.size *
					0.5 *
					remaining,
				translateY:
					enterARandomSigned(options, glyph.index + step * 53, 74) *
					options.size *
					0.14 *
					remaining,
			},
		});
	}
	const bounds = enterABounds(options, options.size * 0.2);
	const remaining = (1 - progress) ** 1.2;
	if (progress >= 0.85 || remaining <= 0) return;
	const cuts = Array.from({ length: 6 }, (_, index) =>
		enterARandom(options, index + 1, 80),
	).sort((left, right) => left - right);
	for (let index = 1; index < cuts.length; index += 1) {
		if (enterARandom(options, index + step * 59, 81) >= 0.7) continue;
		const top = bounds.top + bounds.height * (cuts[index - 1] ?? 0);
		const bottom = bounds.top + bounds.height * (cuts[index] ?? 1);
		drawEnterAClipped({
			alpha: 0.65 * remaining,
			color: colors[index % colors.length],
			height: bottom - top,
			left: bounds.left,
			options,
			top,
			translateX:
				enterARandomSigned(options, index + step * 61, 82) *
				options.size *
				0.6 *
				remaining,
			width: bounds.width,
		});
	}
}

function drawEchoIn(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.35 });
		if (progress <= 0) continue;
		const remaining = 1 - enterAOutQuart(progress);
		for (let layer = 3; layer >= 1; layer -= 1) {
			drawEnterAOutlineGlyph({
				alpha:
					(0.95 - layer * 0.2) *
					Math.min(1, remaining * 1.8) *
					clamp01(progress * 6),
				color: options.frame.palette.accent,
				glyph,
				lineWidth: Math.max(1.4, options.size * 0.02),
				options,
				transform: {
					scaleX: 1 + layer * 0.3 * remaining,
					scaleY: 1 + layer * 0.3 * remaining,
				},
			});
		}
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 2.2),
				scaleX: lerp({
					start: 0.88,
					end: 1,
					progress: enterAOutQuart(progress),
				}),
				scaleY: lerp({
					start: 0.88,
					end: 1,
					progress: enterAOutQuart(progress),
				}),
			},
		});
	}
}

function drawResolve(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = enterAGlyphs(options);
	if (progress < 0.03 || glyphs.length === 0) return;
	const step = enterAFrameStep(options);
	const frontValue = progress * (glyphs.length + 1.8);
	const front = Math.floor(frontValue);
	for (const glyph of glyphs) {
		if (glyph.index < front) {
			drawEnterAGlyph({
				glyph,
				options,
				transform: {
					color:
						frontValue - glyph.index - 1 < 0.6
							? options.frame.palette.accent
							: undefined,
				},
			});
			continue;
		}
		if (glyph.index === front || glyph.index > front + 4) continue;
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: 0.5,
				character:
					SIGNS[
						Math.floor(
							enterARandom(options, glyph.index + step * 67, 51) * SIGNS.length,
						) % SIGNS.length
					],
				color: options.frame.palette.secondary,
			},
		});
	}
	const active = glyphs[front];
	if (!active) return;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.globalAlpha = baseAlpha * 0.92;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		active.x - active.width * 0.45,
		active.y - active.height * 0.49,
		active.width * 0.9,
		active.height * 0.98,
	);
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawMagnet(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const delay = enterARandom(options, glyph.index, 81) * 0.3;
		const progress = clamp01((options.frame.enterProgress - delay) / 0.7);
		if (progress <= 0) continue;
		const angle = enterARandom(options, glyph.index, 82) * Math.PI * 2;
		const distance =
			options.size * (1.3 + 1.5 * enterARandom(options, glyph.index, 83));
		const startRotation =
			enterARandomSigned(options, glyph.index, 84) * degrees(55);
		let factor: number;
		let alpha: number;
		if (progress < 0.36) {
			factor = 1 - 0.16 * outCubic(progress / 0.36);
			alpha = 0.5 * clamp01(progress * 8);
		} else if (progress < 0.6) {
			const phase = (progress - 0.36) / 0.24;
			factor = 0.84 * (1 - enterAInCubic(phase));
			alpha = lerp({ start: 0.5, end: 1, progress: clamp01(phase * 3) });
		} else {
			const phase = (progress - 0.6) / 0.4;
			factor = -0.1 * Math.sin(phase * Math.PI * 2) * (1 - phase);
			alpha = 1;
		}
		const scale = 1 + 0.14 * Math.exp(-(((progress - 0.6) / 0.05) ** 2));
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha,
				rotation: startRotation * factor,
				scaleX: scale,
				scaleY: scale,
				translateX: Math.cos(angle) * distance * factor,
				translateY: Math.sin(angle) * distance * factor,
			},
		});
	}
}

function drawInkBleed(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const delay = enterARandom(options, glyph.index, 91) * 0.45;
		const progress = clamp01((options.frame.enterProgress - delay) / 0.55);
		if (progress <= 0) continue;
		const eased = outCubic(progress);
		const scale = lerp({
			start: 0.5,
			end: 1,
			progress: enterAOutBack(progress, 1.1),
		});
		const bleed = (1 - eased) ** 1.3;
		for (let layer = 4; layer >= 1; layer -= 1) {
			const angle =
				enterARandom(options, glyph.index + layer * 17, 92) * Math.PI * 2;
			const distance = options.size * 0.07 * layer * bleed;
			drawEnterAGlyph({
				glyph,
				options,
				transform: {
					alpha: 0.08 * layer * bleed * clamp01(progress * 5),
					color: options.frame.palette.secondary,
					scaleX: scale * (1 + layer * 0.035 * bleed),
					scaleY: scale * (1 + layer * 0.035 * bleed),
					translateX: Math.cos(angle) * distance,
					translateY: Math.sin(angle) * distance,
				},
			});
		}
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 3.2),
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawNeonOn(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const step = enterAFrameStep(options);
	for (const glyph of enterAGlyphs(options)) {
		const ignition = 0.3 + 0.45 * enterARandom(options, glyph.index, 101);
		let alpha = 1;
		if (progress < ignition - 0.22) alpha = 0.1 * clamp01(progress * 8);
		else if (progress < ignition + 0.12) {
			const chance = 0.25 + 0.75 * clamp01((progress - ignition + 0.22) / 0.34);
			alpha =
				enterARandom(options, glyph.index + step * 71, 102) < chance ? 1 : 0.1;
		}
		const glow =
			enterASmooth({ start: 0.1, end: 0.4, value: progress }) *
			(1 - enterASmooth({ start: 0.62, end: 0.92, value: progress }));
		for (let layer = 3; layer >= 1; layer -= 1) {
			drawEnterAOutlineGlyph({
				alpha: alpha * glow * 0.16 * layer,
				color: options.frame.palette.accent,
				glyph,
				lineWidth: options.size * (0.025 + layer * 0.018),
				options,
				transform: {
					scaleX: 1 + layer * 0.025 * glow,
					scaleY: 1 + layer * 0.025 * glow,
				},
			});
		}
		drawEnterAGlyph({ glyph, options, transform: { alpha } });
	}
}

function drawCursorSweep(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterABounds(options);
	const barWidth = options.size * 0.28;
	const start = bounds.left - barWidth;
	const end = bounds.right + barWidth * 1.5;
	const position = lerp({
		start,
		end,
		progress: 1 - (1 - clamp01(progress / 0.85)) ** 2,
	});
	for (const glyph of enterAGlyphs(options)) {
		const reveal = clamp01(
			(position - barWidth / 2 - (glyph.x - glyph.width / 2)) /
				(glyph.width + options.size * 0.2),
		);
		if (reveal <= 0) continue;
		const eased = enterAOutQuart(reveal);
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(reveal * 3),
				scaleX: lerp({ start: 0.7, end: 1, progress: eased }),
				scaleY: lerp({ start: 0.7, end: 1, progress: eased }),
				translateX: (1 - eased) * options.size * 0.3,
			},
		});
	}
	const thickness =
		barWidth * (1 - enterASmooth({ start: 0.78, end: 0.94, value: progress }));
	if (thickness < 0.5) return;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		position - thickness / 2,
		bounds.top - options.size * 0.15,
		thickness,
		bounds.height + options.size * 0.3,
	);
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawStamp(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const impactAt = 0.42;
	const direction = enterADirection(options, 37);
	if (progress < impactAt) {
		const phase = enterAInQuad(progress / impactAt);
		drawEnterAWhole({
			alpha: clamp01((progress / impactAt) * 3),
			options,
			rotation: direction * degrees(-22) * (1 - phase),
			scaleX: lerp({ start: 2.3, end: 1, progress: phase }),
			scaleY: lerp({ start: 2.3, end: 1, progress: phase }),
		});
		return;
	}
	const phase = (progress - impactAt) / (1 - impactAt);
	const decay = (1 - phase) ** 2;
	const step = enterAFrameStep(options);
	const scale = 1 - 0.05 * Math.exp(-phase * 9) * (1 - phase);
	drawEnterAWhole({
		options,
		scaleX: scale,
		scaleY: scale,
		translateX:
			enterARandomSigned(options, step, 1) * options.size * 0.05 * decay,
		translateY:
			enterARandomSigned(options, step, 2) * options.size * 0.03 * decay,
	});
	const burst = clamp01(phase / 0.7);
	if (burst >= 1) return;
	const bounds = enterABounds(options, options.size * 0.28);
	const rays = enterAGlyphs(options).length <= 1 ? 6 : 12;
	const eased = enterAOutQuart(burst);
	for (let index = 0; index < rays; index += 1) {
		const angle = (index / rays) * Math.PI * 2 + 0.26;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const radiusX = bounds.width / 2 + options.size * 0.28;
		const radiusY = bounds.height / 2 + options.size * 0.28;
		const startX =
			bounds.centerX +
			cosine * radiusX * (1 + 0.08 * eased) +
			cosine * options.size * 0.25 * eased;
		const startY =
			bounds.centerY +
			sine * radiusY * (1 + 0.08 * eased) +
			sine * options.size * 0.25 * eased;
		drawEnterALine({
			alpha: 1 - burst,
			color: options.frame.palette.accent,
			from: [startX, startY],
			options,
			to: [
				startX + cosine * options.size * 0.42 * (1 - eased * 0.6),
				startY + sine * options.size * 0.42 * (1 - eased * 0.6),
			],
			width: Math.max(2, options.size * 0.05),
		});
	}
}
