import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	drawExitHoldOutline,
	exitHoldGlyphs,
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

const SHAPE_EXITS = new Set([
	"undraw",
	"outlineOut",
	"irisClose",
	"diagWipeOut",
	"blindsClose",
	"checkerOut",
	"splitApart",
	"vSliceDrop",
	"melt",
]);

export function drawExitHoldShapeExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !SHAPE_EXITS.has(exit)) return false;
	switch (exit) {
		case "undraw":
			drawUndraw(options);
			break;
		case "outlineOut":
			drawOutlineOut(options);
			break;
		case "irisClose":
			drawIrisClose(options);
			break;
		case "diagWipeOut":
			drawDiagonalWipe(options);
			break;
		case "blindsClose":
			drawBlindsClose(options);
			break;
		case "checkerOut":
			drawCheckerOut(options);
			break;
		case "splitApart":
			drawSplitApart(options);
			break;
		case "vSliceDrop":
			drawVerticalSliceDrop(options);
			break;
		case "melt":
			drawMelt(options);
			break;
	}
	return true;
}

function drawUndraw(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const glyphs = exitHoldGlyphs(options);
	const fillAlpha = 1 - inOutSine(clamp01(progress / 0.3));
	for (const glyph of glyphs) {
		if (fillAlpha > 0.003) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: { alpha: fillAlpha },
			});
		}
		const outlinePhase = clamp01((progress - 0.24) / 0.76);
		drawExitHoldOutline({
			alpha:
				(1 - smooth((progress - 0.9) / 0.1)) *
				(1 - inOutSine(outlinePhase) * 0.82),
			color: options.frame.palette.foreground,
			glyph,
			lineWidth: Math.max(1, options.size * 0.022),
			options,
			scale: 1 - outlinePhase * 0.06,
		});
	}
}

function drawOutlineOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	for (const glyph of exitHoldGlyphs(options)) {
		const phase = clamp01(
			(progress - glyph.order * 0.35) / Math.max(0.001, 1 - 0.35),
		);
		const drain = inOutSine(clamp01(phase / 0.7));
		if (drain < 0.999) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: { clipY: [-0.72 + 1.44 * drain, 1.2] },
			});
		}
		const outlinePhase = clamp01((phase - 0.68) / 0.32);
		if (phase > 0 && outlinePhase < 1) {
			drawExitHoldOutline({
				alpha: Math.min(1, phase * 8) * (1 - outlinePhase),
				color: options.frame.palette.accent,
				glyph,
				lineWidth: Math.max(1, options.size * 0.024),
				options,
				scale: 1 + 0.3 * outCubic(outlinePhase),
			});
		}
	}
}

function drawIrisClose(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const radiusX = options.maxWidth * 0.55 * (1 - inOutCubic(progress));
	const radiusY = options.size * 1.2 * (1 - inOutCubic(progress));
	if (radiusX <= 0.5 || radiusY <= 0.5) return;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - radiusX,
		options.y - radiusY,
		radiusX * 2,
		radiusY * 2,
	);
	options.ctx.clip();
	options.drawGlyph(options);
	options.ctx.restore();
	const alpha =
		Math.min(1, progress * 6) * (1 - smooth((progress - 0.9) / 0.1));
	if (alpha <= 0.003) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	const line = Math.max(1.5, options.size * 0.035);
	options.ctx.fillRect(
		options.x - radiusX,
		options.y - radiusY,
		radiusX * 2,
		line,
	);
	options.ctx.fillRect(
		options.x - radiusX,
		options.y + radiusY - line,
		radiusX * 2,
		line,
	);
	options.ctx.fillRect(
		options.x - radiusX,
		options.y - radiusY,
		line,
		radiusY * 2,
	);
	options.ctx.fillRect(
		options.x + radiusX - line,
		options.y - radiusY,
		line,
		radiusY * 2,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawDiagonalWipe(options: ExitHoldDraw): void {
	const progress = inOutCubic(options.frame.exitProgress);
	const seed = options.frame.cut?.seed ?? 0;
	const angles = [22, -22, 158, 202] as const;
	const angle = degrees(angles[(seed >>> 3) & 3] ?? 22);
	const diagonal = options.maxWidth + options.size * 5;
	const edge = -diagonal / 2 + diagonal * progress;
	options.ctx.save();
	options.ctx.translate(options.x, options.y);
	options.ctx.rotate(angle);
	options.ctx.beginPath();
	options.ctx.rect(edge, -diagonal, diagonal * 2, diagonal * 2);
	options.ctx.clip();
	options.ctx.rotate(-angle);
	options.ctx.translate(-options.x, -options.y);
	options.drawGlyph(options);
	options.ctx.restore();
	if (options.frame.exitProgress >= 0.999) return;
	options.ctx.save();
	options.ctx.translate(options.x, options.y);
	options.ctx.rotate(angle);
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		edge - Math.max(2, options.size * 0.08),
		-diagonal,
		Math.max(2, options.size * 0.08),
		diagonal * 2,
	);
	options.ctx.restore();
}

function drawBlindsClose(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const count = Math.max(
		3,
		Math.min(12, Math.ceil(options.maxWidth / (options.size * 0.6))),
	);
	const pitch = options.maxWidth / count;
	for (let index = 0; index < count; index += 1) {
		const order = count > 1 ? index / (count - 1) : 0;
		const phase = clamp01((progress - order * 0.4) / 0.6);
		const width = pitch * (1 - phase ** 0.85);
		if (width <= 0.05) continue;
		const center = options.x - options.maxWidth / 2 + (index + 0.5) * pitch;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			center - width / 2,
			options.y - options.size,
			width,
			options.size * 2,
		);
		options.ctx.clip();
		options.drawGlyph(options);
		options.ctx.restore();
	}
}

function drawCheckerOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const columns = Math.max(
		4,
		Math.min(14, Math.ceil(options.maxWidth / (options.size * 0.55))),
	);
	const rows = 4;
	const cellWidth = options.maxWidth / columns;
	const cellHeight = (options.size * 1.8) / rows;
	options.ctx.save();
	options.ctx.beginPath();
	let any = false;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const diagonal = (column + row) / Math.max(1, columns + rows - 2);
			const start = ((column + row) & 1) * 0.42 + diagonal * 0.3;
			const scale = 1 - inQuad(clamp01((progress - start) / 0.28));
			if (scale <= 0.02) continue;
			any = true;
			const centerX =
				options.x - options.maxWidth / 2 + (column + 0.5) * cellWidth;
			const centerY = options.y - options.size * 0.9 + (row + 0.5) * cellHeight;
			options.ctx.rect(
				centerX - (cellWidth * scale) / 2,
				centerY - (cellHeight * scale) / 2,
				cellWidth * scale,
				cellHeight * scale,
			);
		}
	}
	if (any) {
		options.ctx.clip();
		options.drawGlyph(options);
	}
	options.ctx.restore();
}

function drawSplitApart(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const crack = clamp01(progress / 0.2);
	const phase = clamp01((progress - 0.16) / 0.84);
	const eased = outCubic(phase);
	const offset = crack * options.size * 0.03 + options.size * 0.75 * eased;
	const alpha = 1 - smooth((phase - 0.35) / 0.65);
	const squash = 1 - 0.35 * eased;
	for (const glyph of exitHoldGlyphs(options)) {
		for (const direction of [-1, 1] as const) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha,
					clipY: direction < 0 ? [-1.6, 0.01] : [0, 1.6],
					scaleY: squash,
					translateX: direction * offset * 0.3,
					translateY: direction * offset,
				},
			});
		}
	}
	const lineAlpha =
		clamp01(progress / 0.2) * (1 - smooth((progress - 0.55) / 0.45));
	if (lineAlpha <= 0.02) return;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * lineAlpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	const line = Math.max(1.5, options.size * (0.02 + 0.05 * eased));
	options.ctx.fillRect(
		options.x - options.maxWidth / 2 - options.size * 0.15,
		options.y - line / 2,
		options.maxWidth + options.size * 0.3,
		line,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawVerticalSliceDrop(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const count = Math.max(
		4,
		Math.min(14, Math.round(options.maxWidth / (options.size * 0.6))),
	);
	const width = options.maxWidth / count;
	for (let index = 0; index < count; index += 1) {
		const delay = randomUnit(seed, index, 301) * 0.45;
		const phase = clamp01((progress - delay) / 0.55);
		const distance =
			(phase * phase * 1.05 -
				Math.sin(Math.PI * clamp01(phase / 0.25)) * 0.012) *
			options.size *
			6;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			options.x - options.maxWidth / 2 + index * width,
			options.y - options.size,
			width + 0.6,
			options.size * 2,
		);
		options.ctx.clip();
		options.ctx.translate(0, distance);
		options.drawGlyph(options);
		options.ctx.restore();
	}
}

function drawMelt(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const count = Math.max(
		5,
		Math.min(16, Math.round(options.maxWidth / (options.size * 0.45))),
	);
	const width = options.maxWidth / count;
	const stretch = 1 + 0.8 * inQuad(progress);
	const alpha = 1 - smooth((progress - 0.55) / 0.45);
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = mixHex({
		from: options.frame.palette.foreground,
		to: options.frame.palette.accent,
		progress: smooth((progress - 0.3) / 0.6) * 0.45,
	});
	for (let index = 0; index < count; index += 1) {
		const drip = 0.5 + 0.5 * randomSigned(seed, index, 311);
		const spike =
			randomUnit(seed, index, 312) < 0.3 ? randomUnit(seed, index, 313) : 0;
		const distance =
			inQuad(progress) * options.size * (0.1 + 1.3 * drip + 1.1 * spike);
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			options.x - options.maxWidth / 2 + index * width,
			options.y - options.size,
			width + 0.6,
			options.size * 2 + distance,
		);
		options.ctx.clip();
		options.ctx.translate(0, distance * 0.45);
		options.ctx.translate(options.x, options.y - options.size * 0.5);
		options.ctx.scale(1 - 0.05 * progress, stretch);
		options.ctx.translate(-options.x, -options.y + options.size * 0.5);
		options.ctx.globalAlpha = baseAlpha * alpha;
		options.drawGlyph(options);
		options.ctx.restore();
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}
