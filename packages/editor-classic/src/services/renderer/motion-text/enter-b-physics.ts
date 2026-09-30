import {
	clamp01,
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
	enterBOutQuart,
	enterBOutQuint,
	enterBPhase,
	enterBRandom,
	enterBRandomSigned,
	enterBSpring,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	type EnterBDraw,
} from "./enter-b-drawing";

export function drawEnterBPhysics(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "springIn":
			drawSpringIn(options);
			return true;
		case "pendulum":
			drawPendulum(options);
			return true;
		case "rollIn":
			drawRollIn(options);
			return true;
		case "slingshot":
			drawSlingshot(options);
			return true;
		case "rockSettle":
			drawRockSettle(options);
			return true;
		case "bounceBall":
			drawBounceBall(options);
			return true;
		case "snapRail":
			drawSnapRail(options);
			return true;
		case "fanOpen":
			drawFanOpen(options);
			return true;
		case "cylinder":
			drawCylinder(options);
			return true;
		case "shuffle":
			drawShuffle(options);
			return true;
		case "stopMotion":
			drawStopMotion(options);
			return true;
		case "ripple":
			drawRipple(options);
			return true;
		case "zipper":
			drawZipper(options);
			return true;
		case "zoomAlt":
			drawZoomAlt(options);
			return true;
		case "tiltUp":
			drawTiltUp(options);
			return true;
		case "stickerPeel":
			drawStickerPeel(options);
			return true;
		default:
			return false;
	}
}

function drawSpringIn(options: EnterBDraw): void {
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterBPhase({
				options,
				order: glyph.order,
				spread: 0.45,
			});
			if (progress <= 0) return null;
			const spring = enterBSpring({
				frequency: 3,
				progress,
				strength: 4.2,
			});
			const stretch = 1 + Math.min(0.48, Math.abs(spring) * 0.62);
			return {
				alpha: clamp01(progress * 6),
				scaleX: 1 / Math.sqrt(stretch),
				scaleY: stretch,
				translateY: spring * options.size * 1.7,
			};
		},
	});
}

function drawPendulum(options: EnterBDraw): void {
	const direction = enterBDirection(options, 41);
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.45,
		});
		if (progress <= 0) continue;
		const angle =
			direction *
			degrees(62) *
			enterBSpring({ frequency: 2.4, progress, strength: 3.1 });
		const length = options.size * 0.92;
		const translateX = -Math.sin(angle) * length;
		const translateY = Math.cos(angle) * length - length;
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 5),
				rotation: angle,
				translateX,
				translateY,
			},
		});
		const lineAlpha =
			clamp01(progress * 5) * (1 - clamp01((progress - 0.46) / 0.44));
		drawEnterBLine({
			alpha: lineAlpha,
			color: options.frame.palette.secondary,
			from: [glyph.x, glyph.y - length],
			options,
			to: [glyph.x + translateX, glyph.y + translateY],
			width: Math.max(1.2, options.size * 0.012),
		});
		drawEnterBDot({
			alpha: lineAlpha,
			color: options.frame.palette.accent,
			options,
			radius: Math.max(2, options.size * 0.035),
			x: glyph.x,
			y: glyph.y - length,
		});
	}
}

function drawRollIn(options: EnterBDraw): void {
	const direction = enterBDirection(options, 43);
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const order = direction > 0 ? glyph.order : 1 - glyph.order;
			const progress = enterBPhase({ options, order, spread: 0.22 });
			if (progress <= 0) return null;
			const offset =
				direction * options.size * 2.3 * (1 - enterBOutBack(progress, 1.25));
			return {
				alpha: clamp01(progress * 5),
				rotation: -offset / Math.max(4, options.size * 0.36),
				scaleX: lerp({ start: 0.72, end: 1, progress: outCubic(progress) }),
				scaleY: lerp({ start: 0.72, end: 1, progress: outCubic(progress) }),
				translateX: offset,
			};
		},
	});
}

function drawSlingshot(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterBBounds(options, options.size * 0.08);
	let displacement: number;
	let scaleX: number;
	let scaleY: number;
	let alpha = 1;
	let bandAlpha = 1;
	if (progress < 0.36) {
		const pull = outCubic(progress / 0.36);
		displacement =
			options.size * lerp({ start: 0.15, end: 0.92, progress: pull });
		scaleX = 1 + 0.08 * pull;
		scaleY = 1 - 0.14 * pull;
		alpha = clamp01(progress * 8);
	} else {
		const release = (progress - 0.36) / 0.64;
		displacement =
			options.size *
			0.92 *
			enterBSpring({ frequency: 2.6, progress: release, strength: 4.6 });
		scaleY = 1 + Math.abs(displacement / options.size) * 0.22;
		scaleX = 1 / Math.sqrt(scaleY);
		bandAlpha = 1 - clamp01(release / 0.2);
	}
	drawEnterBWhole({
		alpha,
		options,
		scaleX,
		scaleY,
		translateY: displacement,
	});
	const postY = bounds.bottom + options.size * 0.3;
	for (const x of [bounds.left, bounds.right]) {
		drawEnterBLine({
			alpha: bandAlpha,
			color: options.frame.palette.accent,
			from: [x, postY],
			options,
			to: [options.x + (x - options.x) * 0.72, options.y + displacement],
			width: Math.max(1.5, options.size * 0.03),
		});
		drawEnterBDot({
			alpha: bandAlpha,
			color: options.frame.palette.accent,
			options,
			radius: options.size * 0.05,
			x,
			y: postY,
		});
	}
}

function drawRockSettle(options: EnterBDraw): void {
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterBPhase({
				options,
				order: glyph.order,
				spread: 0.4,
			});
			if (progress <= 0) return null;
			const sign = enterBRandom(options, glyph.index, 45) < 0.5 ? -1 : 1;
			const startAngle =
				sign * (16 + 10 * enterBRandom(options, glyph.index, 46));
			const landing = 0.3;
			const rotation =
				progress < landing
					? startAngle
					: startAngle *
						(1 - (progress - landing) / (1 - landing)) ** 1.5 *
						Math.cos(
							Math.PI *
								(1.4 * ((progress - landing) / (1 - landing)) +
									1.9 * ((progress - landing) / (1 - landing)) ** 2),
						);
			return {
				alpha: clamp01(progress * 8),
				rotation: degrees(rotation),
				translateY:
					progress < landing
						? -(1 - (progress / landing) ** 2) * options.size * 2
						: 0,
			};
		},
	});
}

function drawBounceBall(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	const progress = options.frame.enterProgress;
	for (const glyph of glyphs) {
		const hit = lerp({ start: 0.16, end: 0.76, progress: glyph.order });
		if (progress < hit) continue;
		const landing = clamp01((progress - hit) / 0.2);
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				scaleX: 1 + 0.3 * (1 - enterBOutQuint(landing)),
				scaleY: lerp({
					start: 0.55,
					end: 1,
					progress: enterBOutBack(landing, 2.4),
				}),
			},
		});
	}
	if (glyphs.length === 0) return;
	const scaled = clamp01((progress - 0.1) / 0.76) * (glyphs.length - 1);
	const index = Math.min(glyphs.length - 1, Math.floor(scaled));
	const next = Math.min(glyphs.length - 1, index + 1);
	const fraction = scaled - index;
	const x = lerp({
		start: glyphs[index]!.x,
		end: glyphs[next]!.x,
		progress: fraction,
	});
	const y =
		options.y -
		options.size * 0.72 -
		Math.sin(Math.PI * fraction) * options.size * 0.62;
	drawEnterBDot({
		alpha: 1 - clamp01((progress - 0.82) / 0.18),
		color: options.frame.palette.accent,
		options,
		radius: options.size * 0.13,
		x,
		y,
	});
}

function drawSnapRail(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const appear = clamp01(
				(progress - enterBRandom(options, glyph.index, 53) * 0.2) / 0.2,
			);
			if (appear <= 0) return null;
			const snapAt = 0.46 + enterBRandom(options, glyph.index, 54) * 0.06;
			const sign = enterBRandom(options, glyph.index, 51) < 0.5 ? -1 : 1;
			const start =
				sign *
				options.size *
				(0.3 + 0.6 * enterBRandom(options, glyph.index, 52));
			const settle =
				progress < snapAt
					? 0.14 * (progress / snapAt)
					: enterBOutBack(clamp01((progress - snapAt) / 0.28), 2.1);
			return {
				alpha: appear,
				rotation:
					degrees(enterBRandomSigned(options, glyph.index, 55) * 16) *
					(1 - settle),
				scaleY: 1 - 0.14 * Math.sin(Math.PI * clamp01(settle)),
				translateY: start * (1 - settle),
			};
		},
	});
	const bounds = enterBBounds(options);
	const grow = enterBOutQuart(progress / 0.4);
	const vanish = clamp01((progress - 0.68) / 0.27);
	const length = bounds.width * grow * (1 - vanish);
	drawEnterBLine({
		alpha: 1 - vanish,
		color: options.frame.palette.accent,
		from: [options.x - length / 2, bounds.bottom + options.size * 0.04],
		options,
		to: [options.x + length / 2, bounds.bottom + options.size * 0.04],
		width: options.size * 0.035,
	});
}

function drawFanOpen(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	const bounds = enterBBounds(options);
	const pivotX = bounds.left + options.size * 0.2;
	const pivotY = bounds.bottom + options.size * 0.72;
	const eased = enterBOutBack(options.frame.enterProgress, 1.15);
	for (const glyph of glyphs) {
		const finalAngle = Math.atan2(glyph.y - pivotY, glyph.x - pivotX);
		const startAngle = -2.45;
		const delta = (startAngle - finalAngle) * (1 - eased);
		const vx = glyph.x - pivotX;
		const vy = glyph.y - pivotY;
		const cosine = Math.cos(delta);
		const sine = Math.sin(delta);
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(options.frame.enterProgress * 3.5),
				rotation: delta,
				translateX: cosine * vx - sine * vy - vx,
				translateY: sine * vx + cosine * vy - vy,
			},
		});
	}
	drawEnterBDot({
		alpha: 1 - clamp01((options.frame.enterProgress - 0.72) / 0.28),
		color: options.frame.palette.accent,
		options,
		radius: options.size * 0.055,
		x: pivotX,
		y: pivotY,
	});
}

function drawCylinder(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	const bounds = enterBBounds(options);
	const radius = Math.max(options.size * 0.6, bounds.width / 2) / 1.2;
	const direction = enterBDirection(options, 61);
	const phi =
		direction * (1 - enterBOutQuart(options.frame.enterProgress)) * 2.4;
	const flat = clamp01((options.frame.enterProgress - 0.5) / 0.5);
	for (const glyph of glyphs) {
		const local = glyph.x - bounds.centerX;
		const angle = local / radius + phi;
		const cosine = Math.cos(angle);
		if (cosine <= 0.04 && flat < 0.5) continue;
		const wrapped = lerp({
			start: radius * Math.sin(angle),
			end: local,
			progress: flat,
		});
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha:
					clamp01(options.frame.enterProgress * 6) *
					lerp({ start: clamp01(cosine * 1.6), end: 1, progress: flat }),
				scaleX: lerp({ start: Math.max(0.04, cosine), end: 1, progress: flat }),
				translateX: wrapped - local,
			},
		});
	}
}

function drawShuffle(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	const count = glyphs.length;
	for (const glyph of glyphs) {
		const sourceIndex =
			count <= 1
				? 0
				: (glyph.index +
						1 +
						Math.floor(enterBRandom(options, glyph.index, 71) * (count - 1))) %
					count;
		const source = glyphs[sourceIndex] ?? glyph;
		const progress = enterBPhase({
			options,
			order: enterBRandom(options, glyph.index, 72),
			spread: 0.3,
		});
		const eased = inOutCubic(progress);
		const deltaX = source.x - glyph.x;
		const direction = deltaX >= 0 ? 1 : -1;
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(options.frame.enterProgress / 0.12),
				scaleX: 1 + direction * 0.12 * Math.sin(Math.PI * eased),
				scaleY: 1 + direction * 0.12 * Math.sin(Math.PI * eased),
				translateX: deltaX * (1 - eased),
				translateY:
					-direction *
					Math.min(options.size * 0.85, Math.abs(deltaX) * 0.4) *
					Math.sin(Math.PI * eased),
			},
		});
	}
}

function drawStopMotion(options: EnterBDraw): void {
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const delay =
				enterBRandom(options, glyph.index, 81) * 0.5 + glyph.order * 0.5;
			const progress = enterBPhase({ options, order: delay, spread: 0.45 });
			if (progress <= 0) return null;
			const key = Math.min(4, Math.floor(progress * 5));
			if (key >= 4) return {};
			const remaining = 1 - outCubic(key / 4);
			const angle = enterBRandom(options, glyph.index, 82) * Math.PI * 2;
			const distance =
				options.size * (0.7 + 0.5 * enterBRandom(options, glyph.index, 83));
			return {
				rotation:
					degrees(
						enterBRandomSigned(options, glyph.index + key * 13, 86) * 22,
					) * remaining,
				scaleX:
					1 +
					enterBRandomSigned(options, glyph.index + key * 7, 88) *
						0.14 *
						remaining,
				scaleY:
					1 +
					enterBRandomSigned(options, glyph.index + key * 7, 88) *
						0.14 *
						remaining,
				translateX:
					Math.cos(angle) * distance * remaining +
					enterBRandomSigned(options, glyph.index + key, 84) *
						options.size *
						0.05,
				translateY:
					Math.sin(angle) * distance * remaining +
					enterBRandomSigned(options, glyph.index + key, 85) *
						options.size *
						0.05,
			};
		},
	});
}

function drawRipple(options: EnterBDraw): void {
	const bounds = enterBBounds(options);
	const radius =
		Math.hypot(bounds.width, bounds.height) / 2 + options.size * 0.3;
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const dx = glyph.x - bounds.centerX;
			const dy = glyph.y - bounds.centerY;
			const distance = Math.hypot(dx, dy);
			const progress = clamp01(
				(options.frame.enterProgress - (0.68 * distance) / radius) / 0.32,
			);
			if (progress <= 0) return null;
			const wave = Math.sin(progress * Math.PI * 2) * (1 - progress) ** 2;
			return {
				alpha: clamp01(progress * 5),
				scaleX: 1 + 0.4 * Math.sin(Math.PI * progress) * (1 - progress),
				scaleY: 1 + 0.4 * Math.sin(Math.PI * progress) * (1 - progress),
				translateX:
					distance > 1 ? (dx / distance) * options.size * 0.28 * wave : 0,
				translateY:
					distance > 1 ? (dy / distance) * options.size * 0.28 * wave : 0,
			};
		},
	});
	for (let ring = 0; ring < 2; ring += 1) {
		const phase = clamp01(options.frame.enterProgress / 0.68 - ring * 0.12);
		drawEnterBRing({
			alpha: (1 - phase) * (ring === 0 ? 0.85 : 0.5),
			color: options.frame.palette.accent,
			options,
			radius: radius * phase,
			width: Math.max(1.5, options.size * 0.022) * (1 - phase * 0.5),
			x: bounds.centerX,
			y: bounds.centerY,
		});
	}
}

function drawZipper(options: EnterBDraw): void {
	const bounds = enterBBounds(options);
	const edge = lerp({
		start: bounds.left - options.size * 0.3,
		end: bounds.right + options.size * 0.4,
		progress: inOutSine(options.frame.enterProgress / 0.92),
	});
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const open = clamp01((glyph.x - edge) / (options.size * 2.4) + 0.25);
			const sign = glyph.index % 2 === 0 ? -1 : 1;
			return {
				alpha: clamp01(options.frame.enterProgress * 5),
				rotation: degrees(sign * 14 * open),
				translateY: sign * options.size * 0.8 * open ** 0.8,
			};
		},
	});
	const fade = 1 - clamp01((options.frame.enterProgress - 0.82) / 0.16);
	const sliderW = options.size * 0.3;
	options.ctx.save();
	options.ctx.globalAlpha *= fade;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		edge - sliderW / 2,
		options.y - options.size * 0.23,
		sliderW,
		options.size * 0.46,
	);
	options.ctx.restore();
}

function drawZoomAlt(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.35,
		});
		if (progress <= 0) continue;
		const even = glyph.index % 2 === 0;
		const eased = even
			? enterBOutQuint(progress)
			: enterBOutBack(progress, 2.2);
		const scale = even
			? lerp({ start: 2.4, end: 1, progress: eased })
			: Math.max(0.02, eased);
		if (even && progress < 0.72) {
			for (let ghost = 2; ghost >= 1; ghost -= 1) {
				drawEnterBGlyph({
					glyph,
					options,
					transform: {
						alpha: clamp01(progress * 2.5) * 0.13,
						scaleX: scale + ghost * 0.09,
						scaleY: scale + ghost * 0.09,
					},
				});
			}
		}
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * (even ? 2.5 : 4)),
				scaleX: scale,
				scaleY: scale,
			},
		});
	}
}

function drawTiltUp(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const angle =
		degrees(86) * enterBSpring({ frequency: 1.25, progress, strength: 3.2 });
	const scaleY = Math.max(0.03, Math.cos(angle));
	drawEnterBWhole({
		alpha: clamp01(progress * 6),
		options,
		scaleY,
		translateY: options.size * 0.55 * (1 - scaleY),
	});
	const bounds = enterBBounds(options);
	drawEnterBLine({
		alpha: 1 - clamp01((progress - 0.35) / 0.45),
		color: options.frame.palette.accent,
		from: [bounds.left - options.size * 0.2, bounds.bottom],
		options,
		to: [bounds.right + options.size * 0.2, bounds.bottom],
		width: Math.max(1.5, options.size * 0.025),
	});
}

function drawStickerPeel(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.5,
		});
		if (progress <= 0) continue;
		const eased = inOutCubic(progress);
		const reveal = Math.max(0.02, eased);
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 6),
				clipX: [-0.66, -0.66 + 1.32 * reveal],
				clipY: [0.66 - 1.32 * reveal, 0.66],
			},
		});
		if (progress < 0.96) {
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					alpha: 0.42 * (1 - progress),
					color: options.frame.palette.secondary,
					rotation: degrees(-18 * (1 - eased)),
					scaleX: Math.max(0.08, 1 - eased),
					scaleY: 0.72,
					translateX: options.size * 0.24 * (1 - eased),
					translateY: -options.size * 0.2 * (1 - eased),
				},
			});
		}
	}
	const bounds = enterBBounds(options);
	const diagonal =
		inOutCubic(options.frame.enterProgress) * (bounds.width + bounds.height);
	drawEnterBClipped({
		alpha: 0.08 * (1 - options.frame.enterProgress),
		color: options.frame.palette.accent,
		height: options.size * 0.06,
		left: bounds.left,
		options,
		rotation: degrees(-45),
		top: bounds.bottom - diagonal * 0.22,
		width: bounds.width,
	});
}
