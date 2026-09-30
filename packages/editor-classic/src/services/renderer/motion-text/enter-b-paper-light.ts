import { mixHex } from "./exit-hold-geometry";
import {
	clamp01,
	clipEnterBPolygon,
	degrees,
	drawEnterBClipped,
	drawEnterBDot,
	drawEnterBGlyph,
	drawEnterBGlyphs,
	drawEnterBLine,
	drawEnterBRing,
	drawEnterBWhole,
	enterBBounds,
	enterBDirection,
	enterBGlyphs,
	enterBOutBack,
	enterBPhase,
	enterBRandom,
	enterBRandomSigned,
	enterBSeconds,
	inOutSine,
	lerp,
	outCubic,
	type EnterBDraw,
} from "./enter-b-drawing";

export function drawEnterBPaperLight(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "crumple":
			drawCrumple(options);
			return true;
		case "noteUnfold":
			drawNoteUnfold(options);
			return true;
		case "tornJoin":
			drawTornJoin(options);
			return true;
		case "splitFlap":
			drawSplitFlap(options);
			return true;
		case "overexpose":
			drawOverexpose(options);
			return true;
		case "glint":
			drawGlint(options);
			return true;
		case "loupe":
			drawLoupe(options);
			return true;
		case "filmFeed":
			drawFilmFeed(options);
			return true;
		case "backlight":
			drawBacklight(options);
			return true;
		case "lightLeak":
			drawLightLeak(options);
			return true;
		case "heatHaze":
			drawHeatHaze(options);
			return true;
		default:
			return false;
	}
}

function drawCrumple(options: EnterBDraw): void {
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterBPhase({
				options,
				order: glyph.order,
				spread: 0.45,
			});
			if (progress <= 0) return null;
			const eased = enterBOutBack(progress, 1.6);
			const angle = enterBRandom(options, glyph.index, 91) * Math.PI * 2;
			const squeeze = 1 - eased;
			return {
				alpha: clamp01(progress * 4),
				rotation:
					degrees(enterBRandomSigned(options, glyph.index, 92) * 160) * squeeze,
				scaleX: lerp({ start: 0.28, end: 1, progress: eased }),
				scaleY: lerp({ start: 0.36, end: 1, progress: eased }),
				translateX:
					Math.cos(angle) * options.size * 0.48 * squeeze +
					enterBRandomSigned(options, glyph.index, 93) *
						options.size *
						0.08 *
						squeeze,
				translateY:
					Math.sin(angle) * options.size * 0.48 * squeeze +
					enterBRandomSigned(options, glyph.index, 94) *
						options.size *
						0.08 *
						squeeze,
			};
		},
	});
}

function drawNoteUnfold(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.45,
		});
		if (progress <= 0) continue;
		const right = outCubic(clamp01((progress - 0.14) / 0.38));
		const bottom = outCubic(clamp01((progress - 0.5) / 0.44));
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress / 0.14),
				clipX: [-0.66, 0],
				clipY: [-0.66, 0],
				scaleX: lerp({
					start: 0.86,
					end: 1,
					progress: enterBOutBack(progress / 0.18, 2),
				}),
				scaleY: lerp({
					start: 0.86,
					end: 1,
					progress: enterBOutBack(progress / 0.18, 2),
				}),
			},
		});
		if (right > 0) {
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					clipX: [0, 0.66],
					clipY: [-0.66, 0],
					color: mixHex({
						from: options.frame.palette.secondary,
						to: options.frame.palette.foreground,
						progress: right,
					}),
					scaleX: Math.max(0.03, right),
				},
			});
		}
		if (bottom > 0) {
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					clipX: [-0.7, 0.7],
					clipY: [0, 0.66],
					color: mixHex({
						from: options.frame.palette.secondary,
						to: options.frame.palette.foreground,
						progress: bottom,
					}),
					scaleY: Math.max(0.03, bottom),
				},
			});
		}
		const creaseAlpha = 0.48 * (1 - clamp01((progress - 0.82) / 0.18));
		drawEnterBLine({
			alpha: creaseAlpha,
			color: options.frame.palette.secondary,
			from: [glyph.x, glyph.y - options.size * 0.48],
			options,
			to: [glyph.x, glyph.y + options.size * 0.48 * bottom],
			width: Math.max(1, options.size * 0.012),
		});
	}
}

function drawTornJoin(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.14);
	const progress = options.frame.enterProgress;
	const remaining = 1 - clamp01(outCubic(progress / 0.72));
	const distance = options.size * 2 + bounds.width * 0.25;
	drawEnterBClipped({
		alpha: clamp01(progress * 5),
		height: bounds.height,
		left: bounds.left - distance,
		options,
		rotation: degrees(-5 * remaining),
		top: bounds.top,
		translateX: -distance * remaining,
		width: bounds.width / 2 + distance,
	});
	drawEnterBClipped({
		alpha: clamp01(progress * 5),
		height: bounds.height,
		left: bounds.centerX,
		options,
		rotation: degrees(5 * remaining),
		top: bounds.top,
		translateX: distance * remaining,
		width: bounds.width / 2 + distance,
	});
	const seamAlpha = 1 - clamp01((progress - 0.7) / 0.25);
	const points: Array<readonly [number, number]> = [];
	for (let index = 0; index <= 10; index += 1) {
		points.push([
			bounds.centerX +
				enterBRandomSigned(options, index, 95) * options.size * 0.08,
			lerp({ start: bounds.top, end: bounds.bottom, progress: index / 10 }),
		]);
	}
	for (let index = 1; index < points.length; index += 1) {
		drawEnterBLine({
			alpha: seamAlpha,
			color: options.frame.palette.secondary,
			from: points[index - 1]!,
			options,
			to: points[index]!,
			width: Math.max(1, options.size * 0.018),
		});
	}
}

function drawSplitFlap(options: EnterBDraw): void {
	const pool = Array.from("0123456789アイウエオカキクケコ#%&+");
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.4,
		});
		if (progress <= 0) continue;
		const flips = 3 + (glyph.index % 2);
		const stepped = Math.min(flips - 0.001, progress * flips);
		const key = Math.floor(stepped);
		const phase = stepped - key;
		const oldCharacter =
			key === 0
				? glyph.character
				: pool[
						Math.floor(
							enterBRandom(options, glyph.index + key * 37, 97) * pool.length,
						) % pool.length
					];
		const nextCharacter =
			key >= flips - 1
				? glyph.character
				: pool[
						Math.floor(
							enterBRandom(options, glyph.index + (key + 1) * 37, 98) *
								pool.length,
						) % pool.length
					];
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				character: phase < 0.5 ? oldCharacter : nextCharacter,
				clipY: phase < 0.5 ? [-0.66, 0] : [0, 0.66],
				color: mixHex({
					from: options.frame.palette.secondary,
					to: options.frame.palette.foreground,
					progress: Math.abs(phase - 0.5) * 2,
				}),
				scaleY: Math.max(0.04, Math.abs(Math.cos(phase * Math.PI))),
			},
		});
		drawEnterBLine({
			alpha: progress < 1 ? 0.72 : 0,
			color: options.frame.palette.background,
			from: [glyph.x - glyph.width * 0.53, glyph.y],
			options,
			to: [glyph.x + glyph.width * 0.53, glyph.y],
			width: Math.max(1, options.size * 0.018),
		});
	}
}

function drawOverexpose(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const flash = progress < 0.12 ? 1 : 1 - inOutSine((progress - 0.12) / 0.88);
	const hot = mixHex({
		from: options.frame.palette.foreground,
		to: "#ffffff",
		progress: 0.94 * flash,
	});
	for (let layer = 3; layer >= 1; layer -= 1) {
		drawEnterBWhole({
			alpha: flash * 0.1 * layer,
			color: hot,
			options,
			scaleX: 1 + flash * layer * 0.028,
			scaleY: 1 + flash * layer * 0.028,
		});
	}
	drawEnterBWhole({
		alpha: progress < 0.12 ? outCubic(progress / 0.12) : 1,
		color: hot,
		options,
		scaleX: 1 + flash * 0.06,
		scaleY: 1 + flash * 0.06,
	});
}

function drawGlint(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.3);
	const progress = options.frame.enterProgress;
	const edge = lerp({
		start: bounds.left - options.size * 0.8,
		end: bounds.right + options.size * 0.8,
		progress: inOutSine(progress / 0.9),
	});
	drawEnterBWhole({
		alpha: 0.2 * clamp01(progress * 6),
		color: options.frame.palette.secondary,
		options,
	});
	const slope = 0.42;
	const topEdge = edge - slope * bounds.height;
	clipEnterBPolygon({
		draw: () => drawEnterBWhole({ options }),
		options,
		points: [
			[bounds.left - options.size, bounds.top],
			[topEdge, bounds.top],
			[edge, bounds.bottom],
			[bounds.left - options.size, bounds.bottom],
		],
	});
	for (const [width, alpha] of [
		[options.size * 0.62, 0.38],
		[options.size * 0.24, 0.9],
	] as const) {
		clipEnterBPolygon({
			draw: () =>
				drawEnterBWhole({
					alpha: alpha * (1 - clamp01((progress - 0.85) / 0.15)),
					color: "#ffffff",
					options,
				}),
			options,
			points: [
				[topEdge - width, bounds.top],
				[topEdge, bounds.top],
				[edge, bounds.bottom],
				[edge - width, bounds.bottom],
			],
		});
	}
}

function drawLoupe(options: EnterBDraw): void {
	const bounds = enterBBounds(options);
	const progress = options.frame.enterProgress;
	const radius = Math.max(options.size * 0.95, bounds.height * 0.62);
	const lensX = lerp({
		start: bounds.left - radius * 0.7,
		end: bounds.right + radius * 1.4,
		progress: inOutSine(progress / 0.9),
	});
	for (const glyph of enterBGlyphs(options)) {
		const distance = Math.abs(glyph.x - lensX) / radius;
		if (distance >= 1) {
			if (glyph.x > lensX) {
				drawEnterBGlyph({
					glyph,
					options,
					transform: { alpha: 0.14 * clamp01(progress * 5) },
				});
			} else drawEnterBGlyph({ glyph, options });
			continue;
		}
		const magnify = 1 - distance ** 2;
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 6),
				scaleX: 1 + 0.6 * magnify,
				scaleY: 1 + 0.6 * magnify,
				translateX: (glyph.x - lensX) * 0.35 * magnify,
			},
		});
	}
	const lensAlpha =
		clamp01(progress * 8) * (1 - clamp01((progress - 0.8) / 0.17));
	drawEnterBRing({
		alpha: lensAlpha,
		color: options.frame.palette.accent,
		options,
		radius,
		width: Math.max(2, options.size * 0.05),
		x: lensX,
		y: bounds.centerY,
	});
	const handleStart: readonly [number, number] = [
		lensX + radius * 0.71,
		bounds.centerY + radius * 0.71,
	];
	drawEnterBLine({
		alpha: lensAlpha,
		color: options.frame.palette.accent,
		from: handleStart,
		options,
		to: [handleStart[0] + radius * 0.55, handleStart[1] + radius * 0.55],
		width: Math.max(3, options.size * 0.1),
	});
}

function drawFilmFeed(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.35);
	const progress = options.frame.enterProgress;
	const frameHeight = bounds.height + options.size * 0.7;
	const eased = outCubic(progress / 0.82);
	const offset =
		(((frameHeight * 2.35 * (1 - eased)) % frameHeight) + frameHeight) %
		frameHeight;
	const flicker = 1 - clamp01((progress - 0.55) / 0.4);
	const jitter =
		enterBRandomSigned(options, Math.floor(enterBSeconds(options) * 24), 98) *
		options.size *
		0.02 *
		flicker;
	drawEnterBClipped({
		alpha:
			clamp01(progress * 7) *
			(1 -
				0.42 *
					flicker *
					enterBRandom(options, Math.floor(enterBSeconds(options) * 24), 99)),
		height: frameHeight,
		left: bounds.left,
		options,
		top: bounds.centerY - frameHeight / 2,
		translateX: jitter,
		translateY: offset,
		width: bounds.width,
	});
	drawEnterBClipped({
		alpha: clamp01(progress * 7),
		height: frameHeight,
		left: bounds.left,
		options,
		top: bounds.centerY - frameHeight / 2,
		translateX: jitter,
		translateY: offset - frameHeight,
		width: bounds.width,
	});
	drawEnterBLine({
		alpha: clamp01(progress * 7),
		color: mixHex({
			from: options.frame.palette.background,
			to: options.frame.palette.foreground,
			progress: 0.18,
		}),
		from: [
			bounds.left - options.size * 0.3,
			bounds.centerY - frameHeight / 2 + offset,
		],
		options,
		to: [
			bounds.right + options.size * 0.3,
			bounds.centerY - frameHeight / 2 + offset,
		],
		width: options.size * 0.12,
	});
}

function drawBacklight(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterBBounds(options);
	const rise = outCubic(progress / 0.4);
	const lit = inOutSine((progress - 0.3) / 0.6);
	const halo = rise * (1 - clamp01((progress - 0.45) / 0.55));
	for (let layer = 5; layer >= 1; layer -= 1) {
		drawEnterBDot({
			alpha: halo * (0.025 + layer * 0.012),
			color: options.frame.palette.accent,
			options,
			radius:
				(Math.hypot(bounds.width, bounds.height) / 2 + options.size * 0.8) *
				(layer / 5),
			x: bounds.centerX,
			y: bounds.centerY,
		});
	}
	drawEnterBWhole({
		alpha: clamp01(progress * 5),
		color: mixHex({
			from: options.frame.palette.background,
			to: options.frame.palette.foreground,
			progress: Math.max(0.12, lit),
		}),
		options,
		scaleX: 1 + 0.035 * (1 - lit),
		scaleY: 1 + 0.035 * (1 - lit),
	});
}

function drawLightLeak(options: EnterBDraw): void {
	const bounds = enterBBounds(options);
	const progress = options.frame.enterProgress;
	for (const glyph of enterBGlyphs(options)) {
		const phase = clamp01((progress - 0.55 * glyph.order) / 0.45);
		if (phase <= 0) continue;
		const heat = 1 - outCubic(phase);
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(phase * 4),
				color: mixHex({
					from: options.frame.palette.foreground,
					to: "#ffffff",
					progress: heat * 0.82,
				}),
				scaleX: 1 + 0.07 * heat,
				scaleY: 1 + 0.07 * heat,
			},
		});
	}
	const centerX = lerp({
		start: bounds.left - options.size * 0.5,
		end: bounds.right + options.size * 0.5,
		progress: clamp01(progress / 0.62),
	});
	const leakAlpha =
		clamp01(progress * 6) * (1 - clamp01((progress - 0.55) / 0.4));
	for (let layer = 4; layer >= 1; layer -= 1) {
		drawEnterBDot({
			alpha: leakAlpha * (0.025 + layer * 0.018),
			color: options.frame.palette.accent,
			options,
			radius: Math.max(options.size * 1.4, bounds.height * 1.1) * (layer / 4),
			x: centerX,
			y: bounds.centerY,
		});
	}
}

function drawHeatHaze(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.3);
	const progress = options.frame.enterProgress;
	const amplitude = options.size * 0.36 * (1 - inOutSine(progress));
	const bands = 12;
	for (let band = 0; band < bands; band += 1) {
		const top = bounds.top + (bounds.height * band) / bands;
		const height = bounds.height / bands + 0.8;
		const offset =
			amplitude *
			Math.sin(band * 0.9 + enterBSeconds(options) * 17) *
			(0.55 + 0.45 * Math.sin(band * 0.37 + enterBSeconds(options) * 6));
		drawEnterBClipped({
			alpha: outCubic(clamp01(progress * 2.4)),
			height,
			left: bounds.left,
			options,
			top,
			translateX: offset,
			width: bounds.width,
		});
	}
	const direction = enterBDirection(options, 991);
	drawEnterBLine({
		alpha: (1 - progress) * 0.2,
		color: options.frame.palette.accent,
		from: [bounds.centerX - direction * amplitude, bounds.top],
		options,
		to: [bounds.centerX + direction * amplitude, bounds.bottom],
		width: Math.max(1, options.size * 0.012),
	});
}
