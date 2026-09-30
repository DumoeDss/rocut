import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	exitHoldGlyphs,
	inCubic,
	lerp,
	randomSigned,
	randomUnit,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const CORE_EXIT_IDS = new Set([
	"explode",
	"fall",
	"glitch",
	"scatter",
	"slice",
	"stretch",
]);

export function drawCoreExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (
		!exit ||
		!CORE_EXIT_IDS.has(exit) ||
		options.frame.exitProgress <= 0.001
	) {
		return false;
	}
	switch (exit) {
		case "explode":
			drawExplode(options);
			break;
		case "fall":
			drawFall(options);
			break;
		case "glitch":
			drawGlitch(options);
			break;
		case "scatter":
			drawScatter(options);
			break;
		case "slice":
			drawSlice(options);
			break;
		case "stretch":
			drawStretch(options);
			break;
	}
	return true;
}

function drawExplode(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const progress = options.frame.exitProgress;
	for (const glyph of exitHoldGlyphs(options)) {
		for (let piece = 0; piece < 4; piece += 1) {
			const delay = randomUnit(seed, glyph.index, piece, 301) * 0.18;
			const q = clamp01((progress - delay) / (1 - delay));
			const eased = inCubic(q);
			const localX = piece % 2 === 0 ? -0.24 : 0.24;
			const localY = piece < 2 ? -0.32 : 0.32;
			const angle =
				Math.atan2(localY, localX) +
				randomSigned(seed, glyph.index, piece, 302) * 0.85;
			const distance =
				options.maxWidth *
				(0.32 + randomUnit(seed, glyph.index, piece, 303) * 0.38);
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: 1 - q ** 2.4,
					clipX: piece % 2 === 0 ? [-0.72, 0] : [0, 0.72],
					clipY: piece < 2 ? [-0.92, 0] : [0, 0.92],
					rotation:
						degrees(randomSigned(seed, glyph.index, piece, 304) * 260) * eased,
					scaleX:
						1 + randomSigned(seed, glyph.index, piece, 305) * 0.42 * eased,
					scaleY: 1 + eased * 0.3,
					translateX: Math.cos(angle) * distance * eased,
					translateY: Math.sin(angle) * distance * eased,
				},
			});
		}
	}
}

function drawFall(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const progress = options.frame.exitProgress;
	for (const glyph of exitHoldGlyphs(options)) {
		for (let piece = 0; piece < 2; piece += 1) {
			const delay = randomUnit(seed, glyph.index, piece, 311) * 0.32;
			const q = clamp01((progress - delay) / (1 - delay));
			const gravity = q * q;
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: 1 - clamp01((q - 0.78) / 0.22),
					clipX: piece === 0 ? [-0.72, 0] : [0, 0.72],
					rotation:
						degrees(randomSigned(seed, glyph.index, piece, 312) * 170) * q,
					scaleY: 1 + Math.min(1.25, q * 0.72),
					translateX:
						randomSigned(seed, glyph.index, piece, 313) *
						options.size *
						0.65 *
						q,
					translateY: options.size * 2.3 * gravity,
				},
			});
		}
	}
}

function drawSlice(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const eased = inCubic(options.frame.exitProgress);
	const top = options.y - options.size * 0.86;
	const bandHeight = (options.size * 1.72) / 7;
	for (let band = 0; band < 7; band += 1) {
		const direction = band % 2 === 0 ? 1 : -1;
		const offset =
			direction *
			options.maxWidth *
			(0.62 + randomUnit(seed, band, 321) * 0.42) *
			eased;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			options.x - options.maxWidth * 0.56,
			top + band * bandHeight,
			options.maxWidth * 1.12,
			bandHeight + 0.75,
		);
		options.ctx.clip();
		options.ctx.translate(offset, 0);
		options.drawGlyph(options);
		options.ctx.restore();
	}
}

function drawStretch(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const eased = inExpo(progress);
	const scaleX = lerp({ start: 1, end: 6, progress: eased });
	const scaleY = lerp({ start: 1, end: 0.6, progress: eased });
	const alpha = 1 - clamp01((progress - 0.7) / 0.3);
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	for (let copy = 3; copy >= 1; copy -= 1) {
		options.ctx.save();
		options.ctx.globalAlpha = baseAlpha * alpha * 0.1 * copy;
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.translate(
			options.x - options.size * 0.22 * copy * eased,
			options.y,
		);
		options.ctx.scale(scaleX, scaleY);
		options.ctx.translate(-options.x, -options.y);
		options.drawGlyph(options);
		options.ctx.restore();
	}
	options.ctx.save();
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = baseFill;
	options.ctx.translate(options.x, options.y);
	options.ctx.scale(scaleX, scaleY);
	options.ctx.translate(-options.x, -options.y);
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawScatter(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const delay = randomUnit(seed, glyph.index, 331) * 0.3;
		const q = clamp01((options.frame.exitProgress - delay) / (1 - delay));
		const eased = inCubic(q);
		const angle = randomUnit(seed, glyph.index, 332) * Math.PI * 2;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 1 - q * q,
				rotation: degrees(randomSigned(seed, glyph.index, 333) * 540) * eased,
				scaleX: 1 + eased * 0.8,
				scaleY: 1 + eased * 0.8,
				translateX: Math.cos(angle) * options.maxWidth * 0.58 * eased,
				translateY: Math.sin(angle) * options.maxWidth * 0.36 * eased,
			},
		});
	}
}

function drawGlitch(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const progress = options.frame.exitProgress;
	const step = Math.floor(options.frame.localTime / 5_000);
	const top = options.y - options.size * 0.86;
	const bandHeight = (options.size * 1.72) / 9;
	const amplitude = options.size * (0.3 + progress * 2.2);
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	for (let band = 0; band < 9; band += 1) {
		const offset =
			randomUnit(seed, step, band, 341) < 0.75
				? randomSigned(seed, step, band, 342) * amplitude
				: 0;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			options.x - options.maxWidth * 0.56,
			top + band * bandHeight,
			options.maxWidth * 1.12,
			bandHeight + 0.75,
		);
		options.ctx.clip();
		options.ctx.translate(offset, 0);
		options.ctx.globalAlpha =
			baseAlpha *
			(progress > 0.55 && randomUnit(seed, step, band, 343) < 0.38
				? 0.18
				: 1 - clamp01((progress - 0.82) / 0.18));
		if (band % 4 === 2) options.ctx.fillStyle = options.frame.palette.accent;
		options.drawGlyph(options);
		options.ctx.restore();
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function inExpo(value: number): number {
	const progress = clamp01(value);
	return progress <= 0 ? 0 : 2 ** (10 * progress - 10);
}
