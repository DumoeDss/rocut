import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	exitHoldGlyphs,
	lerp,
	randomSigned,
	randomUnit,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const CORE_ENTRANCE_IDS = new Set([
	"assemble",
	"drop",
	"flicker",
	"scramble",
	"slice",
	"spin",
	"stretch",
	"type",
	"zoom",
]);

const SCRAMBLE_POOL = Array.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&*+?@");

export function drawCoreEntrance(options: ExitHoldDraw): boolean {
	const enter = options.frame.cut?.preset.enter;
	if (
		!enter ||
		!CORE_ENTRANCE_IDS.has(enter) ||
		options.frame.enterProgress >= 0.999
	) {
		return false;
	}
	switch (enter) {
		case "assemble":
			drawAssemble(options);
			break;
		case "drop":
			drawDrop(options);
			break;
		case "flicker":
			drawFlicker(options);
			break;
		case "scramble":
			drawScramble(options);
			break;
		case "slice":
			drawSlice(options);
			break;
		case "spin":
			drawSpin(options);
			break;
		case "stretch":
			drawStretch(options);
			break;
		case "type":
			drawType(options);
			break;
		case "zoom":
			drawZoom(options);
			break;
	}
	return true;
}

function drawAssemble(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const progress = options.frame.enterProgress;
	for (const glyph of exitHoldGlyphs(options)) {
		for (let piece = 0; piece < 4; piece += 1) {
			const delay = randomUnit(seed, glyph.index, piece, 101) * 0.26;
			const q = clamp01((progress - delay) / 0.74);
			if (q <= 0) continue;
			const eased = outExpo(q);
			const angle = randomUnit(seed, glyph.index, piece, 102) * Math.PI * 2;
			const distance =
				options.size * (1.35 + randomUnit(seed, glyph.index, piece, 103) * 1.9);
			const leftPiece = piece % 2 === 0;
			const topPiece = piece < 2;
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: clamp01(q * 3.5),
					clipX: leftPiece ? [-0.72, 0] : [0, 0.72],
					clipY: topPiece ? [-0.92, 0] : [0, 0.92],
					rotation:
						degrees(randomSigned(seed, glyph.index, piece, 104) * 170) *
						(1 - eased),
					scaleX: lerp({
						start: 0.45 + randomUnit(seed, glyph.index, piece, 105),
						end: 1,
						progress: eased,
					}),
					scaleY: lerp({
						start: 0.45 + randomUnit(seed, glyph.index, piece, 106),
						end: 1,
						progress: eased,
					}),
					translateX: Math.cos(angle) * distance * (1 - eased),
					translateY: Math.sin(angle) * distance * (1 - eased),
				},
			});
		}
	}
}

function drawSlice(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const eased = outExpo(options.frame.enterProgress);
	const top = options.y - options.size * 0.86;
	const height = (options.size * 1.72) / 7;
	for (let band = 0; band < 7; band += 1) {
		const direction = band % 2 === 0 ? -1 : 1;
		const offset =
			direction *
			options.maxWidth *
			(0.55 + randomUnit(seed, band, 121) * 0.35) *
			(1 - eased);
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			options.x - options.maxWidth * 0.56,
			top + band * height,
			options.maxWidth * 1.12,
			height + 0.75,
		);
		options.ctx.clip();
		options.ctx.translate(offset, 0);
		options.drawGlyph(options);
		options.ctx.restore();
	}
}

function drawType(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	const visibleCount = Math.min(
		glyphs.length,
		Math.floor(options.frame.enterProgress * (glyphs.length + 0.999)),
	);
	for (const glyph of glyphs.slice(0, visibleCount)) {
		drawExitHoldGlyph({ glyph, options });
	}
	if (options.frame.enterProgress >= 0.96) return;
	const cursorGlyph =
		glyphs[Math.min(visibleCount, Math.max(0, glyphs.length - 1))];
	const cursorX = cursorGlyph
		? cursorGlyph.x - cursorGlyph.width * 0.42
		: options.x - options.maxWidth * 0.4;
	const blink =
		Math.floor(options.frame.localTime / 7_500) % 2 === 0 ? 1 : 0.35;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * blink;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		cursorX,
		options.y - options.size * 0.47,
		Math.max(2, options.size * 0.055),
		options.size * 0.94,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawDrop(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const delay = randomUnit(seed, glyph.index, 131) * 0.46;
		const q = clamp01((options.frame.enterProgress - delay) / 0.54);
		if (q <= 0) continue;
		const bounced = bounce(q);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(q * 4),
				scaleX: 0.8 + q * 0.2,
				scaleY: 1.5 - q * 0.5,
				translateY: -(1 - bounced) * options.size * 2.4,
			},
		});
	}
}

function drawStretch(options: ExitHoldDraw): void {
	const eased = outExpo(options.frame.enterProgress);
	const scaleX = lerp({ start: 4.2, end: 1, progress: eased });
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	for (let copy = 3; copy >= 1; copy -= 1) {
		options.ctx.save();
		options.ctx.globalAlpha = baseAlpha * 0.11 * (4 - copy) * (1 - eased);
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.translate(
			options.x - options.size * 0.24 * copy * (1 - eased),
			options.y,
		);
		options.ctx.scale(scaleX + copy * 0.08 * (1 - eased), 1);
		options.ctx.translate(-options.x, -options.y);
		options.drawGlyph(options);
		options.ctx.restore();
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
	options.ctx.save();
	options.ctx.translate(options.x, options.y);
	options.ctx.scale(scaleX, 1);
	options.ctx.translate(-options.x, -options.y);
	options.drawGlyph(options);
	options.ctx.restore();
}

function drawSpin(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const q = clamp01((options.frame.enterProgress - glyph.order * 0.4) / 0.6);
		if (q <= 0) continue;
		const eased = outExpo(q);
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(q * 3),
				rotation:
					degrees(randomUnit(seed, glyph.index, 141) > 0.5 ? 200 : -200) *
					(1 - eased),
				scaleX: lerp({ start: 0.15, end: 1, progress: eased }),
				scaleY: lerp({ start: 0.15, end: 1, progress: eased }),
			},
		});
	}
}

function drawFlicker(options: ExitHoldDraw): void {
	const glyphs = exitHoldGlyphs(options);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 5_000);
	const threshold = clamp01(0.16 + options.frame.enterProgress * 1.08);
	let visible = 0;
	for (const glyph of glyphs) {
		if (randomUnit(seed, step, glyph.index, 151) > threshold) continue;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 0.72 + randomUnit(seed, step, glyph.index, 152) * 0.28,
				color:
					randomUnit(seed, step, glyph.index, 153) < 0.14
						? options.frame.palette.accent
						: undefined,
			},
		});
		visible += 1;
	}
	if (visible === 0 && glyphs[0]) {
		drawExitHoldGlyph({
			glyph: glyphs[0],
			options,
			transform: { alpha: 0.55 },
		});
	}
}

function drawScramble(options: ExitHoldDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 5_000);
	for (const glyph of exitHoldGlyphs(options)) {
		const settle = 0.25 + glyph.order * 0.75;
		if (options.frame.enterProgress >= settle) {
			drawExitHoldGlyph({ glyph, options });
			continue;
		}
		if (
			options.frame.enterProgress < settle * 0.24 &&
			randomUnit(seed, glyph.index, step, 161) < 0.42
		) {
			continue;
		}
		const character =
			SCRAMBLE_POOL[
				Math.floor(
					randomUnit(seed, glyph.index, step, 162) * SCRAMBLE_POOL.length,
				)
			] ?? "?";
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: 0.84,
				character,
				color: options.frame.palette.accent,
			},
		});
	}
}

function drawZoom(options: ExitHoldDraw): void {
	const eased = outExpo(options.frame.enterProgress);
	const scale = lerp({ start: 1.7, end: 1, progress: eased });
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.save();
	options.ctx.globalAlpha =
		baseAlpha * clamp01(options.frame.enterProgress * 4);
	options.ctx.translate(options.x, options.y);
	options.ctx.scale(scale, scale);
	options.ctx.translate(-options.x, -options.y);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.translate(options.size * 0.12 * (1 - eased), 0);
	options.drawGlyph(options);
	options.ctx.fillStyle = baseFill;
	options.ctx.translate(-options.size * 0.12 * (1 - eased), 0);
	options.drawGlyph(options);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function bounce(value: number): number {
	let progress = clamp01(value);
	const coefficient = 7.5625;
	const divisor = 2.75;
	if (progress < 1 / divisor) return coefficient * progress * progress;
	if (progress < 2 / divisor) {
		progress -= 1.5 / divisor;
		return coefficient * progress * progress + 0.75;
	}
	if (progress < 2.5 / divisor) {
		progress -= 2.25 / divisor;
		return coefficient * progress * progress + 0.9375;
	}
	progress -= 2.625 / divisor;
	return coefficient * progress * progress + 0.984_375;
}
