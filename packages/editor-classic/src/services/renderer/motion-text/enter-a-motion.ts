import {
	clamp01,
	degrees,
	drawEnterAGlyph,
	drawEnterAGlyphs,
	drawEnterAWhole,
	enterABounds,
	enterADirection,
	enterAGlyphs,
	enterAOutBack,
	enterAOutExpo,
	enterAPhase,
	enterARandom,
	enterARandomSigned,
	inOutSine,
	lerp,
	outCubic,
	type EnterADraw,
} from "./enter-a-drawing";

export function drawEnterAMotionFamily(options: EnterADraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "bounceBig":
			drawBounceBig(options);
			return true;
		case "squashDrop":
			drawSquashDrop(options);
			return true;
		case "rubber":
			drawRubber(options);
			return true;
		case "whip":
			drawWhip(options);
			return true;
		case "skewIn":
			drawSkewIn(options);
			return true;
		case "trackIn":
			drawTrackIn(options);
			return true;
		case "trackOut":
			drawTrackOut(options);
			return true;
		case "blurStagger":
			drawBlurStagger(options);
			return true;
		case "fadeStagger":
			drawFadeStagger(options);
			return true;
		case "waveIn":
			drawWaveIn(options);
			return true;
		case "spiralIn":
			drawSpiralIn(options);
			return true;
		case "zoomOut":
			drawZoomOut(options);
			return true;
		default:
			return false;
	}
}

function drawBounceBig(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.35 });
		if (progress <= 0) continue;
		let offset = 0;
		let rotation = 0;
		if (progress < 0.5) {
			const phase = progress / 0.5;
			offset = 7.666 * phase ** 2 - 9.266 * phase + 1.6;
			rotation =
				enterARandomSigned(options, glyph.index, 21) *
				degrees(28) *
				Math.sin(Math.PI * phase);
		} else if (progress < 0.76) {
			const phase = (progress - 0.5) / 0.26;
			offset = -0.24 * 4 * phase * (1 - phase);
		} else if (progress < 0.9) {
			const phase = (progress - 0.76) / 0.14;
			offset = -0.06 * 4 * phase * (1 - phase);
		}
		const impact =
			Math.exp(-(((progress - 0.5) / 0.035) ** 2)) +
			0.6 * Math.exp(-(((progress - 0.76) / 0.03) ** 2));
		const scaleY = 1 - 0.3 * impact;
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 7),
				rotation,
				scaleX: 1 + 0.24 * impact,
				scaleY,
				translateY: offset * glyph.height + (1 - scaleY) * glyph.height * 0.5,
			},
		});
	}
}

function drawSquashDrop(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.4,
			});
			if (progress <= 0) return null;
			let translateY = 0;
			let scaleY: number;
			if (progress < 0.22) {
				const phase = progress / 0.22;
				translateY = -(1 - phase ** 2) * glyph.height * 1.7;
				scaleY = 1 + 0.4 * phase;
			} else {
				const phase = (progress - 0.22) / 0.78;
				scaleY =
					1 - 0.58 * Math.exp(-3 * phase) * Math.cos(phase * 6.2) * (1 - phase);
			}
			return {
				alpha: clamp01(progress * 10),
				scaleX: 1 / Math.max(0.1, scaleY ** 0.8),
				scaleY,
				translateY: translateY + (1 - scaleY) * glyph.height * 0.5,
			};
		},
	});
}

function drawRubber(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.4,
			});
			if (progress <= 0) return null;
			const oscillation =
				(1 - progress) ** 2 * Math.cos(progress * 3.5 * Math.PI);
			const scaleX = Math.max(0.03, 1 - oscillation);
			return {
				alpha: clamp01(progress * 6),
				scaleX,
				scaleY: Math.min(1.45, Math.max(0.72, 1 + (1 - scaleX) * 0.45)),
			};
		},
	});
}

function drawWhip(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const direction = enterADirection(options, 19);
	const bounds = enterABounds(options);
	const distance = Math.max(options.size * 4.5, bounds.width * 0.9);
	const eased = enterAOutExpo(progress);
	const translateX = direction * distance * (1 - eased);
	const lean = direction * degrees(34) * (1 - eased) ** 0.7;
	const follow =
		-direction *
		degrees(14) *
		Math.sin(Math.PI * clamp01((progress - 0.3) / 0.7)) *
		(1 - clamp01((progress - 0.6) / 0.4));
	for (let layer = 6; layer >= 1; layer -= 1) {
		drawEnterAWhole({
			alpha: 0.08 * layer * (1 - eased),
			color: options.frame.palette.secondary,
			options,
			skewX: lean + follow,
			translateX:
				translateX + direction * options.size * 0.42 * layer * (1 - eased),
		});
	}
	drawEnterAWhole({
		alpha: clamp01(progress * 8),
		options,
		skewX: lean + follow,
		translateX,
	});
}

function drawSkewIn(options: EnterADraw): void {
	const direction = enterADirection(options, 23);
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.45,
			});
			if (progress <= 0) return null;
			const skew = Math.min(
				degrees(66),
				Math.max(
					-degrees(66),
					direction * degrees(60) * (1 - enterAOutBack(progress, 1.6)),
				),
			);
			return {
				alpha: clamp01(progress * 3),
				skewX: skew,
				translateX:
					-Math.tan(skew) * glyph.height * 0.5 +
					direction * (1 - enterAOutExpo(progress)) * options.size * 0.7,
			};
		},
	});
}

function drawTrackIn(options: EnterADraw): void {
	const eased = 1 - (1 - clamp01(options.frame.enterProgress)) ** 5;
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => ({
			alpha: outCubic(clamp01(options.frame.enterProgress * 1.7)),
			translateX: (glyph.x - options.x) * 1.6 * (1 - eased),
		}),
	});
}

function drawTrackOut(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const eased = 1 - (1 - clamp01(progress)) ** 5;
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => ({
			alpha:
				clamp01(progress * 2.5) *
				lerp({ start: 0.55, end: 1, progress: eased }),
			translateX: -(glyph.x - options.x) * 0.72 * (1 - eased),
		}),
	});
}

function drawBlurStagger(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.55 });
		if (progress <= 0) continue;
		const eased = outCubic(progress);
		const haze = 1 - eased;
		for (let layer = 3; layer >= 1; layer -= 1) {
			const distance = options.size * 0.14 * haze * layer;
			drawEnterAGlyph({
				glyph,
				options,
				transform: {
					alpha: 0.11 * layer * haze * clamp01(progress * 5),
					color: options.frame.palette.secondary,
					scaleX: lerp({ start: 1.35, end: 1, progress: eased }),
					scaleY: lerp({ start: 1.35, end: 1, progress: eased }),
					translateX: (layer % 2 === 0 ? -1 : 1) * distance,
					translateY: -haze * options.size * 0.16 + distance * 0.22,
				},
			});
		}
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: eased ** 0.6,
				scaleX: lerp({ start: 1.35, end: 1, progress: eased }),
				scaleY: lerp({ start: 1.35, end: 1, progress: eased }),
				translateY: -haze * options.size * 0.16,
			},
		});
	}
}

function drawFadeStagger(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.62,
			});
			if (progress <= 0) return null;
			return {
				alpha: inOutSine(progress),
				translateY: (1 - outCubic(progress)) * options.size * 0.07,
			};
		},
	});
}

function drawWaveIn(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const damping = (1 - progress) ** 1.6;
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const alpha = clamp01(progress * 2.4 - glyph.order * 1.3);
			if (alpha <= 0) return null;
			const phase = progress * 3.6 * Math.PI - glyph.index * 0.8;
			return {
				alpha,
				rotation: degrees(Math.cos(phase) * 13 * damping),
				translateY: -Math.sin(phase) * options.size * 0.66 * damping,
			};
		},
	});
}

function drawSpiralIn(options: EnterADraw): void {
	const bounds = enterABounds(options);
	const direction = enterADirection(options, 29);
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.15 });
		if (progress <= 0) continue;
		const eased = outCubic(progress);
		const remaining = 1 - eased;
		const relativeX = glyph.x - bounds.centerX;
		const relativeY = glyph.y - bounds.centerY;
		const angle = direction * remaining * degrees(200);
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const radiusScale = 1 + 0.7 * remaining;
		const orbitAngle =
			enterARandom(options, glyph.index, 31) * Math.PI * 2 + angle;
		const orbit = options.size * remaining;
		const nextX =
			(cosine * relativeX - sine * relativeY) * radiusScale +
			Math.cos(orbitAngle) * orbit;
		const nextY =
			(sine * relativeX + cosine * relativeY) * radiusScale +
			Math.sin(orbitAngle) * orbit;
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 5),
				rotation: direction * remaining * degrees(320),
				scaleX: lerp({ start: 0.45, end: 1, progress: eased }),
				scaleY: lerp({ start: 0.45, end: 1, progress: eased }),
				translateX: nextX - relativeX,
				translateY: nextY - relativeY,
			},
		});
	}
}

function drawZoomOut(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const eased = enterAOutExpo(progress);
	const dip = 0.035 * Math.sin(Math.PI * clamp01((progress - 0.22) / 0.58));
	const scale = 1 + 3.4 * (1 - eased) - dip;
	drawEnterAWhole({
		alpha: clamp01(progress * 6),
		options,
		scaleX: scale,
		scaleY: scale,
	});
}
