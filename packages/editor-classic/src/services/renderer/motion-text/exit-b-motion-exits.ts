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
	outCubic,
	randomSigned,
	randomUnit,
	smooth,
	type ExitHoldDraw,
} from "./exit-hold-geometry";
import {
	drawExitBClipped,
	drawExitBLine,
	drawExitBRing,
	exitBBounce,
	exitBPhase,
	exitBRect,
	exitBSeedDirection,
} from "./exit-b-drawing";

const MOTION_EXITS = new Set([
	"vacuumOut",
	"dominoOut",
	"hingeOut",
	"rocketOff",
	"bounceOff",
	"balloonOff",
	"deflateOut",
	"hazeOut",
	"tornadoOut",
	"snakeOut",
	"flutterOut",
	"rollOff",
	"fanClose",
	"shockOut",
]);

export function drawExitBMotionExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !MOTION_EXITS.has(exit)) return false;
	if (options.frame.exitProgress >= 0.998) return true;
	switch (exit) {
		case "vacuumOut":
			drawVacuumOut(options);
			break;
		case "dominoOut":
			drawDominoOut(options);
			break;
		case "hingeOut":
			drawHingeOut(options);
			break;
		case "rocketOff":
			drawRocketOff(options);
			break;
		case "bounceOff":
			drawBounceOff(options);
			break;
		case "balloonOff":
			drawBalloonOff(options);
			break;
		case "deflateOut":
			drawDeflateOut(options);
			break;
		case "hazeOut":
			drawHazeOut(options);
			break;
		case "tornadoOut":
			drawTornadoOut(options);
			break;
		case "snakeOut":
			drawSnakeOut(options);
			break;
		case "flutterOut":
			drawFlutterOut(options);
			break;
		case "rollOff":
			drawRollOff(options);
			break;
		case "fanClose":
			drawFanClose(options);
			break;
		case "shockOut":
			drawShockOut(options);
			break;
	}
	return true;
}

function drawVacuumOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const direction = exitBSeedDirection(seed, 61);
	const rect = exitBRect(options);
	const targetX =
		direction > 0
			? rect.right + options.size * 0.85
			: rect.left - options.size * 0.85;
	const targetY = rect.y;
	const glyphs = exitHoldGlyphs(options);
	for (const glyph of glyphs) {
		const distance = Math.hypot(targetX - glyph.x, targetY - glyph.y);
		const order = 1 - Math.min(1, distance / Math.max(1, rect.width));
		const phase = exitBPhase({ order, progress, spread: 0.5 });
		if (phase >= 0.94) continue;
		const travel = inQuad(phase / 0.94);
		const vx = targetX - glyph.x;
		const vy = targetY - glyph.y;
		const normalX = -vy / Math.max(1, distance);
		const normalY = vx / Math.max(1, distance);
		const bend =
			randomSigned(seed, glyph.index, 610) *
			distance *
			0.11 *
			Math.sin(Math.PI * travel);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				rotation: degrees(direction * phase * 18),
				scaleX: (1 - 0.78 * travel) * (1 + 1.6 * phase ** 2),
				scaleY: (1 - 0.78 * travel) * (1 - 0.28 * phase ** 2),
				translateX: vx * travel + normalX * bend,
				translateY: vy * travel + normalY * bend,
			},
		});
	}
	const swallowed = glyphs.filter((glyph) => {
		const distance = Math.hypot(targetX - glyph.x, targetY - glyph.y);
		const order = 1 - Math.min(1, distance / Math.max(1, rect.width));
		return exitBPhase({ order, progress, spread: 0.5 }) >= 0.94;
	}).length;
	const radius =
		options.size *
		(0.05 + (swallowed / Math.max(1, glyphs.length)) * 0.1) *
		(1 - smooth((progress - 0.9) / 0.1));
	if (radius > 0.4) {
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(
			targetX - radius,
			targetY - radius,
			radius * 2,
			radius * 2,
		);
	}
	const ring = clamp01((progress - 0.86) / 0.14);
	if (ring > 0 && ring < 1) {
		drawExitBRing({
			alpha: 1 - ring,
			color: options.frame.palette.accent,
			options,
			radius: options.size * (0.15 + 0.5 * outCubic(ring)),
			width: Math.max(1, options.size * 0.025 * (1 - ring)),
			x: targetX,
			y: targetY,
		});
	}
}

function drawDominoOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 91);
	drawGlyphSet(options, (glyph) => {
		const order = direction > 0 ? glyph.order : 1 - glyph.order;
		const phase = exitBPhase({ order, progress, spread: 0.55 });
		if (phase >= 0.999) return null;
		const angle = degrees(direction * 90 * inCubic(Math.min(1, phase / 0.62)));
		const pivotX = direction * glyph.width * 0.5;
		const pivotY = glyph.height * 0.5;
		return {
			alpha: 1 - smooth((progress - 0.74) / 0.24),
			rotation: angle,
			translateX:
				pivotX + (-pivotX * Math.cos(angle) + pivotY * Math.sin(angle)),
			translateY:
				pivotY +
				(-pivotX * Math.sin(angle) - pivotY * Math.cos(angle)) +
				options.size * 0.9 * inQuad(clamp01((progress - 0.7) / 0.3)),
		};
	});
}

function drawHingeOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 102);
	const swingPhase = clamp01(progress / 0.64);
	const fall = clamp01((progress - 0.64) / 0.36);
	const angle = degrees(
		direction *
			(55 * (1 - Math.exp(-swingPhase * 4.5) * Math.cos(swingPhase * 12)) +
				30 * fall ** 2),
	);
	const rect = exitBRect(options);
	const pivotX =
		direction > 0
			? rect.left + options.size * 0.12
			: rect.right - options.size * 0.12;
	const pivotY = rect.top + options.size * 0.12;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.translate(pivotX, pivotY);
	options.ctx.rotate(angle);
	options.ctx.translate(
		-pivotX + direction * options.size * 0.4 * fall,
		-pivotY + options.size * 6 * fall ** 2,
	);
	options.ctx.globalAlpha = baseAlpha * (1 - smooth((progress - 0.9) / 0.1));
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	const pinAlpha = 1 - smooth((fall - 0.05) / 0.2);
	const radius = Math.max(2, options.size * 0.045);
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.globalAlpha *= pinAlpha;
	options.ctx.fillRect(
		pivotX - radius,
		pivotY - radius,
		radius * 2,
		radius * 2,
	);
	options.ctx.globalAlpha /= Math.max(0.001, pinAlpha);
	if (fall < 0.18) {
		const looseX = direction > 0 ? rect.right : rect.left;
		options.ctx.fillRect(
			looseX + direction * options.size * 0.55 * fall - radius,
			pivotY -
				options.size * 0.6 * fall +
				options.size * 3.5 * fall ** 2 -
				radius,
			radius * 2,
			radius * 2,
		);
	}
}

function drawRocketOff(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({
			order: randomUnit(seed, glyph.index, 111),
			progress,
			spread: 0.55,
		});
		if (phase >= 0.999) continue;
		if (phase < 0.3) {
			const squat = Math.sin((phase / 0.3) * (Math.PI / 2));
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					scaleX: 1 + 0.12 * squat,
					scaleY: 1 - 0.22 * squat,
					translateX:
						randomSigned(seed, glyph.index, Math.floor(phase * 120), 112) *
						options.size *
						0.025,
					translateY: glyph.height * 0.11 * squat,
				},
			});
			continue;
		}
		const launch = (phase - 0.3) / 0.7;
		const distance = options.size * 7 * launch ** 2.3;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				scaleX: 1 - 0.1 * Math.min(1, launch * 3),
				scaleY: 1 + Math.min(0.8, launch * launch * 3),
				translateY: -distance,
			},
		});
		const trail = Math.min(distance, options.size * 2.6);
		drawExitBLine({
			alpha: 0.75 * (1 - launch * 0.7),
			color: options.frame.palette.accent,
			from: [glyph.x, glyph.y - distance + glyph.height * 0.45],
			options,
			to: [glyph.x, glyph.y - distance + glyph.height * 0.45 + trail],
			width: Math.max(1.5, options.size * 0.08),
		});
	}
}

function drawBounceOff(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 121);
	const rect = exitBRect(options);
	drawGlyphSet(options, (glyph) => {
		const order = direction > 0 ? 1 - glyph.order : glyph.order;
		const phase = exitBPhase({ order, progress, spread: 0.42 });
		if (phase >= 0.999) return null;
		const along =
			(direction > 0 ? rect.right - glyph.x : glyph.x - rect.left) *
				phase ** 1.25 +
			options.size * 1.2 * phase;
		const height = exitBBounce(phase) * options.size * 1.45;
		const landing = Math.abs(Math.sin(phase * Math.PI * 3.5)) ** 14;
		return {
			rotation: degrees(direction * 16 * Math.sin(Math.PI * phase)),
			scaleX: 1 + 0.22 * landing,
			scaleY: 1 - 0.3 * landing,
			translateX: direction * along,
			translateY: -height + glyph.height * 0.15 * landing,
		};
	});
}

function drawBalloonOff(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({
			order: randomUnit(seed, glyph.index, 141),
			progress,
			spread: 0.45,
		});
		if (phase >= 0.999) continue;
		const oscillation =
			phase * (7 + 3 * randomUnit(seed, glyph.index, 142)) +
			randomUnit(seed, glyph.index, 143) * Math.PI * 2;
		const sway =
			Math.sin(oscillation) * options.size * 0.22 * Math.min(1, phase * 3);
		const lift = options.size * 7 * phase ** 1.7;
		const rotation = degrees(
			-Math.cos(oscillation) * 11 * Math.min(1, phase * 3),
		);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				rotation,
				scaleX: 1 + 0.07 * Math.sin(Math.PI * Math.min(1, phase * 2.5)),
				scaleY: 1 + 0.07 * Math.sin(Math.PI * Math.min(1, phase * 2.5)),
				translateX: sway,
				translateY: -lift,
			},
		});
		const baseX = glyph.x + sway - Math.sin(rotation) * glyph.height * 0.45;
		const baseY = glyph.y - lift + Math.cos(rotation) * glyph.height * 0.45;
		let previous: readonly [number, number] = [baseX, baseY];
		for (let segment = 1; segment <= 6; segment += 1) {
			const fraction = segment / 6;
			const next: readonly [number, number] = [
				baseX +
					Math.sin(oscillation - fraction * 1.6) *
						options.size *
						0.1 *
						fraction,
				baseY + options.size * 0.95 * fraction,
			];
			drawExitBLine({
				alpha: 0.78,
				color: options.frame.palette.secondary,
				from: previous,
				options,
				to: next,
				width: Math.max(1, options.size * 0.014),
			});
			previous = next;
		}
	}
}

function drawDeflateOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	drawGlyphSet(options, (glyph) => {
		const phase = exitBPhase({
			order: randomUnit(seed, glyph.index, 151),
			progress,
			spread: 0.4,
		});
		if (phase >= 0.97) return null;
		if (phase < 0.16) {
			const puff = outCubic(phase / 0.16);
			return {
				rotation: degrees(randomSigned(seed, glyph.index, 152) * 4 * puff),
				scaleX: 1 + 0.16 * puff + 0.05 * Math.sin(puff * 25),
				scaleY: 1 + 0.16 * puff - 0.05 * Math.sin(puff * 25),
			};
		}
		const travel = (phase - 0.16) / 0.81;
		const heading =
			randomUnit(seed, glyph.index, 153) * Math.PI * 2 +
			7 * smoothNoisePath({ seed, salt: glyph.index, value: travel * 5 }) +
			3 * travel;
		const distance = options.size * 6.8 * travel ** 1.3;
		const wobble = Math.sin(travel * 70) * 0.14 * (1 - travel);
		return {
			rotation: heading * 0.45,
			scaleX: Math.max(0.02, 1.16 * (1 - travel ** 1.3) * (1 + wobble)),
			scaleY: Math.max(0.02, 1.16 * (1 - travel ** 1.3) * (1 - wobble)),
			translateX: Math.cos(heading) * distance,
			translateY: Math.sin(heading) * distance,
		};
	});
}

function drawHazeOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.12);
	const slices = 10;
	const height = rect.height / slices;
	const amplitude = options.size * (0.02 + 0.26 * inOutSine(progress));
	const alpha = 1 - smooth((progress - 0.3) / 0.64);
	for (let index = 0; index < slices; index += 1) {
		const top = rect.top + index * height;
		const offset =
			Math.sin(index * 1.47 - progress * Math.PI * 5.8) *
			amplitude *
			(0.6 + 0.4 * Math.sin(index * 0.7 + progress * 4));
		drawExitBClipped({
			alpha,
			color: mixHex({
				from: options.frame.palette.foreground,
				to: options.frame.palette.accent,
				progress: 0.3 * smooth(progress / 0.7),
			}),
			height: height + 0.5,
			left: rect.left,
			options,
			top,
			translateX: offset,
			translateY: -options.size * 0.3 * inQuad(progress),
			width: rect.width,
		});
	}
}

function drawTornadoOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const direction = exitBSeedDirection(seed, 211);
	const rect = exitBRect(options);
	const radius = rect.width * 0.48 + options.size * 0.3;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({
			order: randomUnit(seed, glyph.index, 214),
			progress,
			spread: 0.25,
		});
		const start = Math.asin(
			Math.max(-1, Math.min(1, (glyph.x - rect.x) / Math.max(1, radius))),
		);
		const angle =
			start +
			direction *
				Math.PI *
				(3.2 + randomUnit(seed, glyph.index, 212)) *
				phase ** 2;
		const lift = options.size * 7 * phase ** 2.2;
		const orbitRadius =
			radius * (1 - 0.35 * outCubic(phase)) +
			lift * 0.25 +
			options.size * 0.6 * phase;
		const targetX = rect.x + Math.sin(angle) * orbitRadius;
		const depth = Math.cos(angle);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha:
					(0.3 + 0.7 * (depth + 1) * 0.5) *
					(1 - smooth((progress - 0.8) / 0.18)),
				rotation: degrees(-Math.sin(angle) * 14 * phase),
				scaleX: 0.72 + 0.28 * depth,
				scaleY: 0.72 + 0.28 * depth,
				translateX: targetX - glyph.x,
				translateY: -lift,
			},
		});
	}
}

function drawSnakeOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 231);
	const rect = exitBRect(options);
	const travel =
		(0.35 * progress ** 2 + 0.65 * progress ** 2.4) *
		(rect.width + options.size * 8);
	const curveStart = direction > 0 ? rect.right : rect.left;
	const radius = options.size * 1.3;
	for (const glyph of exitHoldGlyphs(options)) {
		const along = glyph.x + direction * travel;
		const beyond = direction * (along - curveStart);
		let x = along;
		let y = glyph.y;
		let rotation = 0;
		if (beyond > 0) {
			const arc = Math.min(Math.PI / 2, beyond / radius);
			x = curveStart + direction * Math.sin(arc) * radius;
			y = glyph.y + (1 - Math.cos(arc)) * radius;
			rotation = direction * arc;
			if (beyond > radius * Math.PI * 0.5) {
				y += beyond - radius * Math.PI * 0.5;
			}
		}
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - smooth((progress - 0.9) / 0.1),
				rotation,
				translateX: x - glyph.x,
				translateY: y - glyph.y,
			},
		});
	}
}

function drawFlutterOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({
			order: randomUnit(seed, glyph.index, 241),
			progress,
			spread: 0.5,
		});
		if (phase >= 0.999) continue;
		const cycle =
			phase * (7 + 4 * randomUnit(seed, glyph.index, 243)) +
			randomUnit(seed, glyph.index, 242) * Math.PI * 2;
		const flip = Math.cos(
			phase * (9 + 5 * randomUnit(seed, glyph.index, 244)) + cycle * 0.5,
		);
		const sway = Math.sin(cycle) * options.size * 0.55 * Math.min(1, phase * 4);
		const fall = options.size * 7 * (0.25 * phase + 0.75 * phase ** 1.6);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				color:
					flip < 0
						? mixHex({
								from: options.frame.palette.foreground,
								to: options.frame.palette.background,
								progress: 0.45,
							})
						: undefined,
				rotation: degrees(Math.cos(cycle) * 28 * Math.min(1, phase * 4)),
				scaleX: 1 - Math.min(1, phase * 4) + flip * Math.min(1, phase * 4),
				translateX: sway,
				translateY: fall,
			},
		});
	}
}

function drawRollOff(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 251);
	const rect = exitBRect(options);
	drawGlyphSet(options, (glyph) => {
		const order = direction > 0 ? 1 - glyph.order : glyph.order;
		const phase = exitBPhase({ order, progress, spread: 0.45 });
		if (phase >= 0.999) return null;
		const distance =
			(direction > 0 ? rect.right - glyph.x : glyph.x - rect.left) +
			options.size * 1.3;
		const along = distance * phase ** 1.7;
		const radius = Math.max(glyph.width, glyph.height * 0.8) * 0.5;
		const angle = along / Math.max(1, radius);
		const cornerPhase = angle % (Math.PI / 2);
		const rise =
			radius * (Math.SQRT2 * Math.cos(cornerPhase - Math.PI / 4) - 1);
		return {
			rotation: direction * angle,
			translateX: direction * along,
			translateY: -rise,
		};
	});
}

function drawFanClose(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const reverse = exitBSeedDirection(options.frame.cut?.seed ?? 0, 261) > 0;
	const bend = inOutSine(clamp01(progress / 0.3));
	const close = inOutCubic(clamp01((progress - 0.24) / 0.5));
	const finish = clamp01((progress - 0.72) / 0.28);
	const glyphs = exitHoldGlyphs(options);
	const leadOrder = reverse ? 1 : 0;
	for (const glyph of glyphs) {
		const relative = glyph.x - options.x;
		const radius = Math.max(options.size * 2, options.maxWidth * 0.58);
		const targetAngle = (leadOrder - 0.5) * 1.35;
		const angle =
			((relative / radius) * (1 - close) + targetAngle * close) * bend +
			(reverse ? 1 : -1) * 0.5 * finish ** 2;
		const targetX = options.x + Math.sin(angle) * radius;
		const targetY = options.y + radius - Math.cos(angle) * radius;
		const lead = Math.abs(glyph.order - leadOrder) < 0.01;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha:
					(1 - smooth((progress - 0.8) / 0.19)) *
					(lead ? 1 : 1 - smooth((close - 0.55) / 0.4)),
				rotation: angle,
				scaleX: 1 - 0.75 * inQuad(finish),
				scaleY: 1 - 0.75 * inQuad(finish),
				translateX: (targetX - glyph.x) * bend,
				translateY: (targetY - glyph.y) * bend,
			},
		});
	}
}

function drawShockOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const rect = exitBRect(options);
	const pre = progress < 0.16 ? Math.sin((progress / 0.16) * Math.PI) : 0;
	const radius =
		Math.hypot(rect.width, rect.height) *
		0.62 *
		outCubic(clamp01((progress - 0.12) / 0.88));
	for (const glyph of exitHoldGlyphs(options)) {
		const dx = glyph.x - rect.x;
		const dy = glyph.y - rect.y;
		const distance = Math.max(1, Math.hypot(dx, dy));
		const passed = radius - distance;
		if (passed <= 0) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					scaleX: 1 - 0.05 * pre,
					scaleY: 1 - 0.05 * pre,
					translateX: (-dx / distance) * pre * options.size * 0.08,
					translateY: (-dy / distance) * pre * options.size * 0.08,
				},
			});
			continue;
		}
		const force = 1 - Math.exp(-passed / (options.size * 0.7));
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - smooth(passed / (options.size * 1.5)),
				rotation: degrees(randomSigned(seed, glyph.index, 281) * 50 * force),
				scaleX:
					1 +
					0.2 * Math.exp(-passed / (options.size * 0.25)) -
					0.45 * smooth(passed / (options.size * 2)),
				scaleY:
					1 +
					0.2 * Math.exp(-passed / (options.size * 0.25)) -
					0.45 * smooth(passed / (options.size * 2)),
				translateX: (dx / distance) * options.size * 1.6 * force,
				translateY: (dy / distance) * options.size * 1.6 * force,
			},
		});
	}
	const alpha = 1 - smooth((progress - 0.3) / 0.7);
	if (radius > 0.5 && alpha > 0.01) {
		drawExitBRing({
			alpha,
			color: options.frame.palette.accent,
			options,
			radius,
			width: Math.max(1.5, options.size * 0.09 * alpha),
			x: rect.x,
			y: rect.y,
		});
		drawExitBRing({
			alpha: alpha * 0.6,
			color: options.frame.palette.accent,
			options,
			radius: radius * 0.82,
			width: Math.max(1, options.size * 0.025 * alpha),
			x: rect.x,
			y: rect.y,
		});
	}
}

function smoothNoisePath({
	seed,
	salt,
	value,
}: {
	readonly seed: number;
	readonly salt: number;
	readonly value: number;
}): number {
	const lower = Math.floor(value);
	const fraction = value - lower;
	const eased = fraction * fraction * (3 - 2 * fraction);
	const start = randomSigned(seed, salt, lower, 900);
	const end = randomSigned(seed, salt, lower + 1, 900);
	return start + (end - start) * eased;
}
