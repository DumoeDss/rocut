import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	drawGlyphSet,
	exitHoldGlyphs,
	frameStep,
	inCubic,
	inOutCubic,
	inOutSine,
	inQuad,
	mixHex,
	outCubic,
	randomSigned,
	randomUnit,
	secondsOf,
	smooth,
	type ExitHoldDraw,
} from "./exit-hold-geometry";
import {
	drawExitBClipped,
	drawExitBLine,
	drawExitBRing,
	drawExitBWhole,
	exitBClockPoint,
	exitBPhase,
	exitBRect,
	exitBSeedDirection,
} from "./exit-b-drawing";

const GRAPHIC_EXITS = new Set([
	"glassBreak",
	"zipOut",
	"clapShut",
	"lampOff",
	"slotOut",
	"clockOut",
	"matrixOut",
	"rollUpOut",
	"rgbSplitOut",
	"floodOut",
	"slashOut",
	"mosaicOut",
	"scribbleOut",
	"candleOut",
]);

const MATRIX_GLYPHS = Array.from("01アイウエオカキクケコサシスセソ＃＊＋×");

export function drawExitBGraphicExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !GRAPHIC_EXITS.has(exit)) return false;
	if (options.frame.exitProgress >= 0.998) return true;
	switch (exit) {
		case "glassBreak":
			drawGlassBreak(options);
			break;
		case "zipOut":
			drawZipOut(options);
			break;
		case "clapShut":
			drawClapShut(options);
			break;
		case "lampOff":
			drawLampOff(options);
			break;
		case "slotOut":
			drawSlotOut(options);
			break;
		case "clockOut":
			drawClockOut(options);
			break;
		case "matrixOut":
			drawMatrixOut(options);
			break;
		case "rollUpOut":
			drawRollUpOut(options);
			break;
		case "rgbSplitOut":
			drawRgbSplitOut(options);
			break;
		case "floodOut":
			drawFloodOut(options);
			break;
		case "slashOut":
			drawSlashOut(options);
			break;
		case "mosaicOut":
			drawMosaicOut(options);
			break;
		case "scribbleOut":
			drawScribbleOut(options);
			break;
		case "candleOut":
			drawCandleOut(options);
			break;
	}
	return true;
}

function drawGlassBreak(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const crack = clamp01(progress / 0.2);
	const fall = clamp01((progress - 0.18) / 0.82);
	const rect = exitBRect(options, options.size * 0.1);
	const impactX = rect.x + randomSigned(seed, 151) * rect.width * 0.18;
	const impactY = rect.y + randomSigned(seed, 152) * rect.height * 0.16;
	if (fall <= 0) {
		options.drawGlyph(options);
		for (let ray = 0; ray < 8; ray += 1) {
			const angle =
				((ray + 0.35 * randomSigned(seed, ray, 153)) / 8) * Math.PI * 2;
			const length =
				Math.max(rect.width, rect.height) *
				(0.28 + 0.42 * randomUnit(seed, ray, 154)) *
				crack;
			drawExitBLine({
				alpha: 0.9,
				color: options.frame.palette.background,
				from: [impactX, impactY],
				options,
				to: [
					impactX + Math.cos(angle) * length,
					impactY + Math.sin(angle) * length,
				],
				width: Math.max(1, options.size * 0.025),
			});
		}
		return;
	}
	for (const glyph of exitHoldGlyphs(options)) {
		for (const [piece, xSide, ySide] of [
			[0, -1, -1],
			[1, 1, -1],
			[2, -1, 1],
			[3, 1, 1],
		] as const) {
			const delay = randomUnit(seed, glyph.index, piece, 155) * 0.28;
			const phase = clamp01((fall - delay) / Math.max(0.01, 1 - delay));
			const eased = outCubic(phase);
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: 1 - smooth((phase - 0.72) / 0.28),
					clipX: xSide < 0 ? [-1.5, 0.02] : [-0.02, 1.5],
					clipY: ySide < 0 ? [-1.5, 0.02] : [-0.02, 1.5],
					rotation: degrees(
						randomSigned(seed, glyph.index, piece, 156) * 120 * phase ** 2,
					),
					translateX:
						(xSide + randomSigned(seed, glyph.index, piece, 157) * 0.45) *
						options.size *
						1.3 *
						eased,
					translateY:
						ySide * options.size * 0.35 * eased + options.size * 5 * phase ** 2,
				},
			});
		}
	}
}

function drawZipOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const reverse = exitBSeedDirection(seed, 161) < 0;
	const zipper = -0.12 + 1.24 * inOutSine(clamp01(progress / 0.8));
	for (const glyph of exitHoldGlyphs(options)) {
		const order = reverse ? 1 - glyph.order : glyph.order;
		const closed = inOutSine(clamp01((zipper - order) / 0.22 + 0.15));
		if (closed >= 0.99) continue;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: { scaleX: 1 - closed },
		});
	}
	const rect = exitBRect(options);
	const sliderX = reverse
		? rect.right - rect.width * zipper
		: rect.left + rect.width * zipper;
	const fade = 1 - smooth((progress - 0.76) / 0.2);
	if (fade <= 0.01) return;
	const toothPitch = Math.max(4, options.size * 0.1);
	const toothStart = reverse ? sliderX : rect.left;
	const toothEnd = reverse ? rect.right : sliderX;
	for (
		let x = toothStart, index = 0;
		x < toothEnd;
		x += toothPitch, index += 1
	) {
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.globalAlpha *= fade;
		options.ctx.fillRect(
			x,
			rect.y -
				options.size * 0.035 +
				(index % 2 === 0 ? -1 : 1) * options.size * 0.02,
			toothPitch * 0.58,
			Math.max(2, options.size * 0.07),
		);
		options.ctx.globalAlpha /= fade;
	}
	if (
		sliderX > rect.left - options.size &&
		sliderX < rect.right + options.size
	) {
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(
			sliderX - options.size * 0.14,
			rect.y - options.size * 0.22,
			options.size * 0.28,
			options.size * 0.44,
		);
		options.ctx.fillRect(
			sliderX - options.size * 0.05,
			rect.y + options.size * 0.18,
			options.size * 0.3,
			options.size * 0.08,
		);
	}
}

function drawClapShut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.04);
	const close = inCubic(clamp01(progress / 0.62));
	const half = rect.width / 2;
	for (const side of [-1, 1] as const) {
		const left = side < 0 ? rect.left : rect.x;
		drawExitBClipped({
			height: rect.height,
			left,
			options,
			top: rect.top,
			translateX: side < 0 ? half * close : -half * close,
			width: half,
		});
	}
	const seamAlpha =
		smooth(progress / 0.15) * (1 - smooth((progress - 0.6) / 0.1));
	if (seamAlpha > 0.01) {
		drawExitBLine({
			alpha: seamAlpha,
			color: options.frame.palette.accent,
			from: [rect.x, rect.top],
			options,
			to: [rect.x, rect.bottom],
			width: Math.max(1.5, options.size * 0.025),
		});
	}
	const hit = clamp01((progress - 0.6) / 0.4);
	if (hit <= 0 || hit >= 1) return;
	const flash = 1 - hit;
	drawExitBLine({
		alpha: flash,
		color: options.frame.palette.accent,
		from: [rect.x, rect.y - rect.height * (0.3 + 0.45 * outCubic(hit))],
		options,
		to: [rect.x, rect.y + rect.height * (0.3 + 0.45 * outCubic(hit))],
		width: Math.max(1, options.size * 0.13 * flash),
	});
	for (let spark = 0; spark < 4; spark += 1) {
		const angle = ((spark + 0.5) / 4) * Math.PI * 2 + 0.3;
		const start = options.size * (0.2 + 0.6 * hit);
		drawExitBLine({
			alpha: flash,
			color: options.frame.palette.accent,
			from: [
				rect.x + Math.cos(angle) * start,
				rect.y + Math.sin(angle) * start,
			],
			options,
			to: [
				rect.x + Math.cos(angle) * (start + options.size * 0.25 * flash),
				rect.y + Math.sin(angle) * (start + options.size * 0.25 * flash),
			],
			width: Math.max(1, options.size * 0.025),
		});
	}
}

function drawLampOff(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	drawGlyphSet(options, (glyph) => {
		const start = randomUnit(seed, glyph.index, 171) * 0.46;
		const phase = (progress - start) / 0.36;
		if (phase >= 1) return null;
		if (phase <= 0) return {};
		const dim = mixHex({
			from: options.frame.palette.foreground,
			to: options.frame.palette.background,
			progress: 0.78,
		});
		if (phase > 0.55) {
			return { alpha: 1 - (phase - 0.55) / 0.45, color: dim };
		}
		const off =
			randomUnit(seed, glyph.index, step, 172) < 0.3 + 0.7 * (phase / 0.55);
		return {
			color: off
				? dim
				: mixHex({
						from: options.frame.palette.foreground,
						to: "#ffffff",
						progress: 0.48,
					}),
		};
	});
}

function drawSlotOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({ order: glyph.order, progress, spread: 0.35 });
		const turns = 4 + Math.floor(randomUnit(seed, glyph.index, 182) * 3);
		const position = (turns + 1) * inOutCubic(phase);
		const current = Math.floor(position);
		const fraction = position - current;
		const pitch = glyph.height * 1.08;
		for (const next of [0, 1] as const) {
			const reelIndex = current + next;
			if (reelIndex > turns) continue;
			const character =
				reelIndex === 0
					? glyph.character
					: (MATRIX_GLYPHS[
							Math.floor(
								randomUnit(seed, glyph.index, reelIndex, 181) *
									MATRIX_GLYPHS.length,
							)
						] ?? glyph.character);
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					character,
					clipY: [-0.58, 0.58],
					color:
						reelIndex > 0 && randomUnit(seed, glyph.index, reelIndex, 183) < 0.3
							? options.frame.palette.accent
							: undefined,
					scaleY: 1 + 0.45 * Math.sin(Math.PI * phase),
					translateY: next ? (1 - fraction) * pitch : -fraction * pitch,
				},
			});
		}
	}
}

function drawClockOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 191);
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({ order: glyph.order, progress, spread: 0.55 });
		if (phase >= 0.999) continue;
		const wedge = 1 - inOutSine(phase);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: wedge,
				rotation: degrees(direction * phase * 18),
				scaleX: Math.max(0.03, Math.cos((phase * Math.PI) / 2)),
				scaleY: 1 - 0.22 * phase,
			},
		});
		if (phase <= 0.001) continue;
		const angle = -Math.PI / 2 + direction * phase * Math.PI * 2;
		const end = exitBClockPoint({
			angle,
			height: glyph.height * 0.55,
			width: glyph.width * 0.56,
			x: glyph.x,
			y: glyph.y,
		});
		drawExitBLine({
			alpha: Math.min(1, (1 - phase) * 6),
			color: options.frame.palette.accent,
			from: [glyph.x, glyph.y],
			options,
			to: end,
			width: Math.max(1.2, options.size * 0.026),
		});
	}
}

function drawMatrixOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = exitBPhase({
			order: randomUnit(seed, glyph.index, 201),
			progress,
			spread: 0.5,
		});
		if (phase >= 0.999) continue;
		const fall = clamp01((phase - 0.22) / 0.78);
		const distance = options.size * 6 * fall ** 1.7;
		const character =
			phase <= 0
				? glyph.character
				: (MATRIX_GLYPHS[
						Math.floor(
							randomUnit(seed, glyph.index, Math.floor(step / 2), 202) *
								MATRIX_GLYPHS.length,
						)
					] ?? glyph.character);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				character,
				color: phase > 0 ? options.frame.palette.foreground : undefined,
				translateY: distance,
			},
		});
		for (let trail = 1; trail <= 5; trail += 1) {
			if (distance < trail * glyph.height * 0.56) continue;
			const trailCharacter =
				MATRIX_GLYPHS[
					Math.floor(
						randomUnit(seed, glyph.index, trail, Math.floor(step / 2), 203) *
							MATRIX_GLYPHS.length,
					)
				] ?? "0";
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: (1 - trail / 6) * (1 - fall * 0.5),
					character: trailCharacter,
					color: options.frame.palette.accent,
					translateY: distance - trail * glyph.height * 0.82,
				},
			});
		}
	}
}

function drawRollUpOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const reverse = exitBSeedDirection(options.frame.cut?.seed ?? 0, 221) < 0;
	const rect = exitBRect(options, options.size * 0.08);
	const phase = inOutSine(clamp01(progress / 0.86));
	const rollX = reverse
		? rect.right +
			options.size * 0.25 -
			(rect.width + options.size * 0.9) * phase
		: rect.left -
			options.size * 0.25 +
			(rect.width + options.size * 0.9) * phase;
	const remainingLeft = reverse ? rect.left : rollX;
	const remainingWidth = reverse
		? Math.max(0, rollX - rect.left)
		: Math.max(0, rect.right - rollX);
	drawExitBClipped({
		color: mixHex({
			from: options.frame.palette.foreground,
			to: options.frame.palette.background,
			progress: 0.18 + phase * 0.24,
		}),
		height: rect.height,
		left: remainingLeft,
		options,
		top: rect.top,
		width: remainingWidth,
	});
	const rolled = reverse ? rect.right - rollX : rollX - rect.left;
	const radius =
		options.size *
		0.26 *
		Math.sqrt(1 + Math.max(0, rolled) / (options.size * 2));
	const finish = inCubic(clamp01((progress - 0.8) / 0.18));
	const height = rect.height * (1 - finish);
	if (height <= 0.2) return;
	options.ctx.fillStyle = mixHex({
		from: options.frame.palette.foreground,
		to: options.frame.palette.background,
		progress: 0.55,
	});
	options.ctx.globalAlpha *= 1 - smooth((progress - 0.82) / 0.16);
	options.ctx.fillRect(rollX - radius, rect.y - height / 2, radius * 2, height);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.fillRect(
		rollX - radius * 0.65,
		rect.y - height / 2,
		radius * 0.4,
		height,
	);
	options.ctx.globalAlpha /= Math.max(
		0.001,
		1 - smooth((progress - 0.82) / 0.16),
	);
}

function drawRgbSplitOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	const spread = options.size * (0.05 + 1.5 * inCubic(progress));
	const ghostAlpha =
		smooth(progress / 0.1) * (1 - smooth((progress - 0.55) / 0.41));
	drawExitBWhole({
		alpha: 1 - smooth((progress - 0.05) / 0.3),
		options,
	});
	const channels = [
		[-1, -0.3, options.frame.palette.accent],
		[1, 0.25, options.frame.palette.secondary],
		[0.15, 0.9, options.frame.palette.foreground],
	] as const;
	for (const [index, [dx, dy, color]] of channels.entries()) {
		drawExitBWhole({
			alpha: ghostAlpha * (index === 2 ? 0.75 : 0.52),
			color,
			options,
			scaleX: 1 + index * 0.08 * inCubic(progress),
			scaleY: 1 + index * 0.08 * inCubic(progress),
			translateX:
				dx * spread +
				randomSigned(seed, step, index, 271) * options.size * 0.06,
			translateY:
				dy * spread * 0.5 +
				randomSigned(seed, step, index, 272) * options.size * 0.015,
		});
	}
}

function drawFloodOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.12);
	const time = secondsOf(options.frame);
	const surfaceY =
		rect.bottom -
		(rect.height + options.size * 0.25) * inOutSine(clamp01(progress / 0.9));
	const slices = 7;
	const height = rect.height / slices;
	for (let index = 0; index < slices; index += 1) {
		const top = rect.top + index * height;
		const center = top + height / 2;
		if (center < surfaceY) {
			drawExitBClipped({
				height: height + 0.5,
				left: rect.left,
				options,
				top,
				width: rect.width,
			});
			continue;
		}
		const underwater = clamp01((center - surfaceY) / Math.max(1, rect.height));
		drawExitBClipped({
			alpha: (1 - smooth((progress - 0.82) / 0.16)) * (0.5 - underwater * 0.22),
			color: mixHex({
				from: options.frame.palette.foreground,
				to: options.frame.palette.accent,
				progress: 0.55,
			}),
			height: height + 0.5,
			left: rect.left,
			options,
			top,
			translateX: Math.sin(index * 1.8 + time * 6) * options.size * 0.04,
			translateY: options.size * 0.05,
			width: rect.width,
		});
	}
	let previous: readonly [number, number] = [rect.left, surfaceY];
	for (let index = 1; index <= 20; index += 1) {
		const x = rect.left + (rect.width * index) / 20;
		const y =
			surfaceY +
			options.size *
				(0.045 * Math.sin((x / options.size) * 4.2 + time * 5) +
					0.022 * Math.sin((x / options.size) * 9.5 - time * 7.3));
		const next: readonly [number, number] = [x, y];
		drawExitBLine({
			alpha: 1 - smooth((progress - 0.84) / 0.14),
			color: options.frame.palette.accent,
			from: previous,
			options,
			to: next,
			width: Math.max(1.5, options.size * 0.028),
		});
		previous = next;
	}
	for (let bubble = 0; bubble < 5; bubble += 1) {
		const phase =
			(progress * 2.2 + randomUnit(options.frame.cut?.seed ?? 0, bubble, 291)) %
			1;
		const x =
			rect.left +
			rect.width * randomUnit(options.frame.cut?.seed ?? 0, bubble, 292);
		const y = surfaceY + options.size * (0.2 + (1 - phase) * 0.8);
		drawExitBRing({
			alpha: 0.6 * (1 - phase),
			color: options.frame.palette.accent,
			options,
			radius: Math.max(1.5, options.size * 0.025 * (0.5 + phase)),
			segments: 8,
			width: Math.max(0.8, options.size * 0.009),
			x,
			y,
		});
	}
}

function drawSlashOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const direction = exitBSeedDirection(options.frame.cut?.seed ?? 0, 301);
	const flash = clamp01(progress / 0.12);
	const gap = smooth((progress - 0.12) / 0.18);
	const slide = clamp01((progress - 0.3) / 0.7);
	const fadeLower = 1 - smooth((progress - 0.5) / 0.45);
	const fadeUpper = 1 - smooth((progress - 0.62) / 0.36);
	for (const glyph of exitHoldGlyphs(options)) {
		for (const side of [-1, 1] as const) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: side < 0 ? fadeUpper : fadeLower,
					clipY: side < 0 ? [-1.5, 0.04] : [-0.04, 1.5],
					rotation: degrees(direction * side * slide * 5),
					translateX:
						direction *
						(side < 0
							? options.size * 2.2 * inQuad(slide)
							: -options.size * 0.35 * inQuad(slide)),
					translateY:
						side * options.size * 0.05 * gap +
						(side < 0 ? -options.size * 0.15 : options.size * 0.5) *
							inQuad(slide),
				},
			});
		}
	}
	const rect = exitBRect(options, options.size * 0.22);
	const lineAlpha = 1 - smooth((progress - 0.12) / 0.22);
	if (lineAlpha <= 0.01) return;
	const angle = degrees(direction * 10);
	const dx = Math.cos(angle) * rect.width * 0.65;
	const dy = Math.sin(angle) * rect.width * 0.65;
	drawExitBLine({
		alpha: lineAlpha,
		color: options.frame.palette.accent,
		from: [
			rect.x - dx * (1 - smooth(progress / 0.3)),
			rect.y - dy * (1 - smooth(progress / 0.3)),
		],
		options,
		to: [rect.x + dx * flash, rect.y + dy * flash],
		width: Math.max(2, options.size * 0.07 * lineAlpha),
	});
}

function drawMosaicOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const rect = exitBRect(options, options.size * 0.06);
	const columns = Math.max(4, Math.min(12, Math.round(10 - progress * 5)));
	const rows = 4;
	const cellWidth = rect.width / columns;
	const cellHeight = rect.height / rows;
	const block = inCubic(progress);
	const alpha = 1 - smooth((progress - 0.55) / 0.42);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const centerX = rect.left + (column + 0.5) * cellWidth;
			const centerY = rect.top + (row + 0.5) * cellHeight;
			const quantizedX =
				Math.round((centerX - rect.x) / Math.max(1, cellWidth)) * cellWidth;
			const quantizedY =
				Math.round((centerY - rect.y) / Math.max(1, cellHeight)) * cellHeight;
			drawExitBClipped({
				alpha,
				height: cellHeight + 0.5,
				left: rect.left + column * cellWidth,
				options,
				top: rect.top + row * cellHeight,
				translateX: quantizedX * block * 0.16,
				translateY: quantizedY * block * 0.16,
				width: cellWidth + 0.5,
			});
		}
	}
	if (progress > 0.32) {
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.globalAlpha *= 0.08 * alpha;
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				if ((row + column) % 3 !== 0) continue;
				options.ctx.fillRect(
					rect.left + column * cellWidth,
					rect.top + row * cellHeight,
					cellWidth,
					cellHeight,
				);
			}
		}
		options.ctx.globalAlpha /= Math.max(0.001, 0.08 * alpha);
	}
}

function drawScribbleOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	drawExitBWhole({
		alpha: 1 - smooth((progress - 0.45) / 0.3),
		options,
	});
	const rect = exitBRect(options, options.size * 0.12);
	const reveal = inOutSine(clamp01(progress / 0.58));
	const fade = 1 - smooth((progress - 0.66) / 0.31);
	const strokes = 13;
	const visible = Math.max(1, Math.ceil(strokes * reveal));
	for (let stroke = 0; stroke < visible; stroke += 1) {
		const row = stroke / Math.max(1, strokes - 1);
		const reverse = stroke % 2 === 1;
		const fromX = reverse ? rect.right : rect.left;
		const toX = reverse ? rect.left : rect.right;
		const y = rect.top + rect.height * row;
		drawExitBLine({
			alpha: fade,
			color: options.frame.palette.accent,
			from: [fromX, y + randomSigned(seed, stroke, 311) * options.size * 0.16],
			options,
			to: [toX, y + randomSigned(seed, stroke, 312) * options.size * 0.16],
			width: Math.max(
				2,
				options.size * 0.11 * (1 - 0.65 * smooth((progress - 0.62) / 0.33)),
			),
		});
	}
}

function drawCandleOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const direction = exitBSeedDirection(seed, 321);
	const step = frameStep(options.frame);
	for (const glyph of exitHoldGlyphs(options)) {
		const order = direction > 0 ? glyph.order : 1 - glyph.order;
		const phase = (progress - order * 0.42) / 0.5;
		if (phase < 0.45) {
			const lean = Math.sin(Math.PI * clamp01(phase / 0.45));
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha:
						phase > 0.3
							? (1 - (phase - 0.3) / 0.15) *
								(0.6 + 0.4 * randomUnit(seed, glyph.index, step, 322))
							: 0.65 + 0.35 * randomUnit(seed, glyph.index, step, 323),
					color: mixHex({
						from: options.frame.palette.foreground,
						to: options.frame.palette.accent,
						progress: 0.5,
					}),
					skewX: degrees(-direction * 22 * lean),
					translateX: direction * options.size * 0.06 * lean,
				},
			});
		}
		if (phase < 0.36 || phase >= 1) continue;
		const age = (phase - 0.36) / 0.64;
		let previous: readonly [number, number] = [
			glyph.x,
			glyph.y - glyph.height * 0.42,
		];
		for (let segment = 1; segment <= 9; segment += 1) {
			const fraction = segment / 9;
			const next: readonly [number, number] = [
				glyph.x +
					Math.sin(fraction * 5 + age * 7 + glyph.index) *
						options.size *
						0.09 *
						fraction +
					direction * options.size * 0.4 * age * fraction,
				glyph.y -
					glyph.height * 0.42 -
					options.size * (0.25 + 1.3 * age) * fraction,
			];
			drawExitBLine({
				alpha: 0.9 * (1 - age),
				color: options.frame.palette.secondary,
				from: previous,
				options,
				to: next,
				width: Math.max(1, options.size * 0.028 * (1 - age * 0.5)),
			});
			previous = next;
		}
	}
}
