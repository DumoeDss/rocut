import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	exitHoldGlyphs,
	inCubic,
	inOutCubic,
	inOutSine,
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
	drawExitBWhole,
	exitBPhase,
	exitBRect,
	exitBSeedDirection,
} from "./exit-b-drawing";

const PAPER_EXITS = new Set([
	"peelOff",
	"crumpleOut",
	"tearOut",
	"scorchOut",
	"overexposeOut",
	"scanOut",
	"stripesOut",
	"halftoneOut",
	"eraserOut",
	"sandOut",
	"shredOut",
]);

export function drawExitBPaperExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !PAPER_EXITS.has(exit)) return false;
	if (options.frame.exitProgress >= 0.998) return true;
	switch (exit) {
		case "peelOff":
			drawPeelOff(options);
			break;
		case "crumpleOut":
			drawCrumpleOut(options);
			break;
		case "tearOut":
			drawTearOut(options);
			break;
		case "scorchOut":
			drawScorchOut(options);
			break;
		case "overexposeOut":
			drawOverexposeOut(options);
			break;
		case "scanOut":
			drawScanOut(options);
			break;
		case "stripesOut":
			drawStripesOut(options);
			break;
		case "halftoneOut":
			drawHalftoneOut(options);
			break;
		case "eraserOut":
			drawEraserOut(options);
			break;
		case "sandOut":
			drawSandOut(options);
			break;
		case "shredOut":
			drawShredOut(options);
			break;
	}
	return true;
}

function drawPeelOff(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 311);
	const peel = clamp01(progress / 0.74);
	const fly = clamp01((progress - 0.74) / 0.26);
	for (const glyph of exitHoldGlyphs(options)) {
		const edge = -0.7 + peel * 1.4;
		if (edge < 0.7) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					clipX: direction > 0 ? [edge, 1.4] : [-1.4, -edge],
				},
			});
		}
		const flapScale = Math.max(0.04, Math.cos(peel * Math.PI));
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - inCubic(fly),
				clipX: direction > 0 ? [-1.4, edge] : [-edge, 1.4],
				color: mixHex({
					from: options.frame.palette.foreground,
					to: options.frame.palette.background,
					progress: 0.48,
				}),
				rotation: degrees(direction * (14 * peel + 110 * fly)),
				scaleX: flapScale,
				translateX:
					direction *
					(options.size * 0.18 * peel + options.size * 2.2 * fly ** 2),
				translateY:
					-options.size * 0.08 * peel -
					options.size * 1.2 * fly +
					options.size * 1.4 * fly ** 2,
			},
		});
	}
}

function drawCrumpleOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const squeezeA = outCubic(clamp01(progress / 0.15));
	const squeezeB = outCubic(clamp01((progress - 0.17) / 0.15));
	const squeezeC = outCubic(clamp01((progress - 0.34) / 0.15));
	const crumple = Math.min(
		1,
		squeezeA * 0.45 + squeezeB * 0.3 + squeezeC * 0.25,
	);
	const throwPhase = clamp01((progress - 0.5) / 0.5);
	const direction = exitBSeedDirection(seed, 21);
	const glyphs = exitHoldGlyphs(options);
	for (const glyph of glyphs) {
		const centerPullX = (options.x - glyph.x) * crumple * 0.92;
		const centerPullY = (options.y - glyph.y) * crumple * 0.92;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - smooth((progress - 0.88) / 0.12),
				color:
					randomUnit(seed, glyph.index, 320) < 0.45
						? mixHex({
								from: options.frame.palette.foreground,
								to: options.frame.palette.background,
								progress: crumple * 0.3,
							})
						: undefined,
				rotation: degrees(
					randomSigned(seed, glyph.index, 321) * 170 * crumple +
						direction * 620 * throwPhase ** 2,
				),
				scaleX: 1 - 0.6 * crumple,
				scaleY: 1 - 0.52 * crumple,
				skewX: degrees(randomSigned(seed, glyph.index, 322) * 22 * crumple),
				translateX:
					centerPullX +
					randomSigned(seed, glyph.index, 323) * options.size * 0.22 * crumple +
					direction * options.maxWidth * 0.44 * throwPhase,
				translateY:
					centerPullY +
					randomSigned(seed, glyph.index, 324) * options.size * 0.2 * crumple -
					options.size * 3.2 * throwPhase +
					options.size * 6 * throwPhase ** 2,
			},
		});
	}
}

function drawTearOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const open = outCubic(clamp01(progress / 0.32));
	const fall = clamp01((progress - 0.26) / 0.74);
	const fade = 1 - smooth((progress - 0.82) / 0.18);
	for (const glyph of exitHoldGlyphs(options)) {
		const jag = randomSigned(seed, glyph.index, 330) * 0.09;
		for (const side of [-1, 1] as const) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: fade,
					clipY: side < 0 ? [-1.5, jag] : [jag, 1.5],
					rotation: degrees(side * (7 * open + 40 * fall ** 2)),
					translateX: side * options.size * (0.08 * open + 1.6 * fall),
					translateY:
						side * options.size * 0.22 * open + options.size * 5.2 * fall ** 2,
				},
			});
		}
	}
}

function drawScorchOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const direction = exitBSeedDirection(seed, 31);
	for (const glyph of exitHoldGlyphs(options)) {
		const order = direction > 0 ? glyph.order : 1 - glyph.order;
		const phase = exitBPhase({ order, progress, spread: 0.52 });
		if (phase >= 0.999) continue;
		const heat = smooth(phase / 0.2);
		const char = smooth((phase - 0.32) / 0.62);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				clipX:
					direction > 0 ? [-0.7 + phase * 1.4, 1.4] : [-1.4, 0.7 - phase * 1.4],
				color: mixHex({
					from: options.frame.palette.foreground,
					to:
						char > 0.4
							? options.frame.palette.background
							: options.frame.palette.accent,
					progress: Math.max(heat * 0.75, char * 0.88),
				}),
				translateY: -phase * options.size * 0.08,
			},
		});
		for (let ember = 0; ember < 3; ember += 1) {
			const age =
				(phase - 0.12 - randomUnit(seed, glyph.index, ember, 331) * 0.5) / 0.38;
			if (age <= 0 || age >= 1) continue;
			const size = Math.max(1, options.size * 0.035 * (1 - age));
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.globalAlpha *= 1 - age;
			options.ctx.fillRect(
				glyph.x +
					randomSigned(seed, glyph.index, ember, 332) * glyph.width * 0.42 -
					size / 2,
				glyph.y + options.size * (0.42 - age * 0.75),
				size,
				size,
			);
			options.ctx.globalAlpha /= 1 - age;
		}
	}
	const rect = exitBRect(options);
	const edgeX =
		direction > 0
			? rect.left + rect.width * progress
			: rect.right - rect.width * progress;
	drawExitBLine({
		alpha: 1 - smooth((progress - 0.86) / 0.14),
		color: options.frame.palette.accent,
		from: [edgeX - options.size * 0.12, rect.top],
		options,
		to: [edgeX + options.size * 0.12, rect.bottom],
		width: Math.max(1.5, options.size * 0.034),
	});
}

function drawOverexposeOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const bloom = outCubic(clamp01(progress / 0.7));
	const fade = 1 - inOutSine(clamp01((progress - 0.38) / 0.62));
	const hot = mixHex({
		from: options.frame.palette.foreground,
		to: "#ffffff",
		progress: inCubic(clamp01(progress / 0.5)),
	});
	for (let copy = 3; copy >= 1; copy -= 1) {
		drawExitBWhole({
			alpha: fade * 0.16 * (1 - copy * 0.18),
			color: options.frame.palette.accent,
			options,
			scaleX: 1 + bloom * (0.08 + copy * 0.035),
			scaleY: 1 + bloom * (0.08 + copy * 0.035),
		});
	}
	drawExitBWhole({
		alpha: fade,
		color: hot,
		options,
		scaleX: 1 + 0.07 * bloom,
		scaleY: 1 + 0.07 * bloom,
	});
	const streak = Math.sin(Math.PI * clamp01((progress - 0.12) / 0.88));
	if (streak <= 0.02) return;
	const rect = exitBRect(options);
	options.ctx.fillStyle = hot;
	options.ctx.globalAlpha *= streak;
	options.ctx.fillRect(
		rect.left - rect.width * 0.25,
		rect.y - options.size * 0.025,
		rect.width * 1.5,
		Math.max(1, options.size * 0.05),
	);
	options.ctx.globalAlpha /= streak;
}

function drawScanOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.12);
	const slices = 12;
	const height = rect.height / slices;
	const scanY = rect.top + (rect.height + options.size) * progress;
	for (let index = 0; index < slices; index += 1) {
		const top = rect.top + index * height;
		const age = clamp01((scanY - top) / Math.max(1, options.size * 1.2));
		if (age <= 0) {
			drawExitBClipped({
				height: height + 0.4,
				left: rect.left,
				options,
				top,
				width: rect.width,
			});
			continue;
		}
		const retained = 1 - (index % 2 === 0 ? inCubic(age) : smooth(age / 0.45));
		if (retained <= 0.01) continue;
		drawExitBClipped({
			alpha: retained,
			height: Math.max(0.3, height * retained * 0.78),
			left: rect.left,
			options,
			top: top + (height * (1 - retained)) / 2,
			translateX: (index % 2 === 0 ? 1 : -1) * options.size * age ** 2 * 0.85,
			width: rect.width,
		});
	}
	if (scanY <= rect.bottom + options.size * 0.1) {
		drawExitBLine({
			alpha: 1 - smooth((progress - 0.82) / 0.18),
			color: options.frame.palette.accent,
			from: [rect.left, scanY],
			options,
			to: [rect.right, scanY],
			width: Math.max(1.5, options.size * 0.035),
		});
	}
}

function drawStripesOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.08);
	const count = Math.max(
		4,
		Math.min(18, Math.ceil(rect.width / (options.size * 0.42))),
	);
	const width = rect.width / count;
	for (let index = 0; index < count; index += 1) {
		const order = index / Math.max(1, count - 1);
		const phase = inOutCubic(
			clamp01((progress - order * 0.42) / Math.max(0.001, 0.58)),
		);
		if (phase >= 0.999) continue;
		const top = index % 2 === 0 ? rect.top + rect.height * phase : rect.top;
		const height = rect.height * (1 - phase);
		drawExitBClipped({
			height,
			left: rect.left + index * width,
			options,
			top,
			width: width + 0.5,
		});
		if (phase > 0.02 && phase < 0.96) {
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillRect(
				rect.left + index * width,
				index % 2 === 0 ? top : rect.bottom - height,
				width,
				Math.max(1, options.size * 0.025),
			);
		}
	}
}

function drawHalftoneOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.08);
	const pitch = Math.max(5, options.size * 0.16);
	const columns = Math.ceil(rect.width / pitch) + 1;
	const rows = Math.ceil(rect.height / (pitch * 0.86)) + 1;
	options.ctx.save();
	options.ctx.beginPath();
	let any = false;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const position =
				((column / Math.max(1, columns - 1)) * 0.8 +
					(row / Math.max(1, rows - 1)) * 0.2) *
				0.55;
			const phase = clamp01(progress * 1.55 - position);
			const radius = pitch * 0.32 * (1 - inOutSine(phase));
			if (radius <= 0.35) continue;
			any = true;
			const x = rect.left + (column + (row % 2) * 0.5) * pitch;
			const y = rect.top + row * pitch * 0.86;
			if (options.ctx.arc) {
				options.ctx.moveTo?.(x + radius, y);
				options.ctx.arc(x, y, radius, 0, Math.PI * 2);
			} else {
				options.ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
			}
		}
	}
	if (any) {
		options.ctx.clip();
		options.ctx.fillStyle = mixHex({
			from: options.frame.palette.foreground,
			to: options.frame.palette.accent,
			progress: smooth(progress / 0.55) * 0.4,
		});
		options.drawGlyph(options);
	}
	options.ctx.restore();
}

function drawEraserOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.08);
	const lanes = 3;
	const laneHeight = rect.height / lanes;
	const travel = clamp01(progress / 0.9) * lanes;
	const active = Math.min(lanes - 1, Math.floor(travel));
	const lanePhase = travel - active;
	for (let lane = active; lane < lanes; lane += 1) {
		const direction = lane % 2 === 0 ? 1 : -1;
		const consumed = lane === active ? lanePhase : 0;
		const left = direction > 0 ? rect.left + rect.width * consumed : rect.left;
		const width = rect.width * (1 - consumed);
		drawExitBClipped({
			height: laneHeight + 0.4,
			left,
			options,
			top: rect.top + lane * laneHeight,
			width,
		});
	}
	const smearAlpha = 0.22 * (1 - smooth((progress - 0.35) / 0.6));
	if (smearAlpha > 0.01) {
		drawExitBClipped({
			alpha: smearAlpha,
			color: mixHex({
				from: options.frame.palette.foreground,
				to: options.frame.palette.background,
				progress: 0.32,
			}),
			height: laneHeight * active + laneHeight * lanePhase,
			left: rect.left,
			options,
			top: rect.top,
			translateX: options.size * 0.08,
			width: rect.width,
		});
	}
	if (progress >= 0.98) return;
	const direction = active % 2 === 0 ? 1 : -1;
	const eraserWidth = options.size * 0.8;
	const centerX =
		direction > 0
			? rect.left + rect.width * lanePhase
			: rect.right - rect.width * lanePhase;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		centerX - eraserWidth / 2,
		rect.top + active * laneHeight + laneHeight * 0.12,
		eraserWidth,
		laneHeight * 0.76,
	);
}

function drawSandOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const direction = exitBSeedDirection(seed, 71);
	for (const glyph of exitHoldGlyphs(options)) {
		const order = direction > 0 ? 1 - glyph.order : glyph.order;
		const phase = clamp01((progress - order * 0.5) / 0.5);
		if (phase < 0.999) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: 1 - phase,
					rotation: degrees(randomSigned(seed, glyph.index, 710) * 22 * phase),
					scaleX: 1 + phase,
					scaleY: 1 - 0.42 * phase,
					translateX: direction * options.size * 2.6 * phase ** 2,
					translateY: -options.size * 0.65 * phase,
				},
			});
		}
		for (let grain = 0; grain < 5; grain += 1) {
			const age = phase - randomUnit(seed, glyph.index, grain, 711) * 0.45;
			if (age <= 0 || age >= 1) continue;
			const size = Math.max(0.7, options.size * 0.025 * (1 - age));
			options.ctx.fillStyle =
				grain % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground;
			options.ctx.globalAlpha *= 1 - age;
			options.ctx.fillRect(
				glyph.x +
					direction * options.size * (0.2 + grain * 0.13) * age ** 2 +
					randomSigned(seed, glyph.index, grain, 712) * glyph.width * 0.4,
				glyph.y - options.size * (0.12 + grain * 0.06) * age,
				size,
				size,
			);
			options.ctx.globalAlpha /= 1 - age;
		}
	}
}

function drawShredOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const rect = exitBRect(options, options.size * 0.05);
	const slotY = rect.bottom + options.size * 0.14;
	const feed = clamp01((progress - 0.08) / 0.72);
	const drop = clamp01((progress - 0.72) / 0.28);
	const translateY = rect.height * feed;
	drawExitBClipped({
		alpha: 1 - smooth((progress - 0.82) / 0.16),
		height: Math.max(0, slotY - rect.top),
		left: rect.left,
		options,
		top: rect.top,
		translateY,
		width: rect.width,
	});
	const strips = Math.max(
		6,
		Math.min(18, Math.round(rect.width / (options.size * 0.22))),
	);
	const width = rect.width / strips;
	for (let index = 0; index < strips; index += 1) {
		const stripDrop =
			options.size *
			(0.25 + randomUnit(seed, index, 720)) *
			(feed + drop * (2.5 + randomUnit(seed, index, 721)));
		drawExitBClipped({
			alpha: 1 - smooth((progress - 0.82) / 0.16),
			height: rect.height * 1.6,
			left: rect.left + index * width,
			options,
			top: slotY,
			translateX: randomSigned(seed, index, 722) * options.size * 0.12 * feed,
			translateY: translateY + stripDrop,
			width: width * 0.72,
		});
	}
	drawExitBLine({
		alpha: 1 - smooth((progress - 0.84) / 0.14),
		color: options.frame.palette.secondary,
		from: [rect.left - options.size * 0.12, slotY],
		options,
		to: [rect.right + options.size * 0.12, slotY],
		width: Math.max(2, options.size * 0.055),
	});
}
