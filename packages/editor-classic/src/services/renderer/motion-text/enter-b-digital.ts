import {
	clamp01,
	drawEnterBGlyph,
	drawEnterBLine,
	drawEnterBWhole,
	enterBBounds,
	enterBDirection,
	enterBGlyphs,
	enterBOutBack,
	enterBOutQuart,
	enterBPhase,
	enterBRandom,
	enterBSeconds,
	lerp,
	outCubic,
	type EnterBDraw,
} from "./enter-b-drawing";

const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SIGNS = Array.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&+<>[]");

export function drawEnterBDigital(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "crtOn":
			drawCrtOn(options);
			return true;
		case "interlace":
			drawInterlace(options);
			return true;
		case "loadingBar":
			drawLoadingBar(options);
			return true;
		case "dither":
			drawDither(options);
			return true;
		case "odometer":
			drawOdometer(options);
			return true;
		case "matrixRain":
			drawMatrixRain(options);
			return true;
		default:
			return false;
	}
}

function drawCrtOn(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterBBounds(options, options.size * 0.3);
	const lineOpen = enterBOutQuart(progress / 0.3);
	const vertical = enterBOutBack((progress - 0.24) / 0.5, 1.6);
	const scaleY = Math.max(0.012, vertical);
	if (progress >= 0.24) {
		drawEnterBWhole({
			alpha: 1,
			color: progress < 0.62 ? "#ffffff" : options.frame.palette.foreground,
			options,
			scaleX: lerp({
				start: 1.18,
				end: 1,
				progress: outCubic((progress - 0.24) / 0.5),
			}),
			scaleY,
		});
	}
	const lineAlpha =
		(1 - clamp01((progress - 0.3) / 0.25)) * clamp01(progress * 12);
	const width = (bounds.width + options.size * 0.6) * lineOpen;
	drawEnterBLine({
		alpha: lineAlpha * 0.25,
		color: "#ffffff",
		from: [bounds.centerX - width / 2, bounds.centerY],
		options,
		to: [bounds.centerX + width / 2, bounds.centerY],
		width: Math.max(4, options.size * 0.18),
	});
	drawEnterBLine({
		alpha: lineAlpha,
		color: "#ffffff",
		from: [bounds.centerX - width / 2, bounds.centerY],
		options,
		to: [bounds.centerX + width / 2, bounds.centerY],
		width: Math.max(2, options.size * 0.045),
	});
}

function drawInterlace(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.25);
	const progress = options.frame.enterProgress;
	const rowHeight = Math.max(2.5, options.size * 0.065);
	const rows = Math.ceil(bounds.height / rowHeight);
	const firstField = clamp01(progress / 0.52);
	const secondField = clamp01((progress - 0.48) / 0.52);
	let any = false;
	options.ctx.save();
	options.ctx.beginPath();
	for (let row = 0; row < rows; row += 1) {
		const field = row % 2 === 0 ? firstField : secondField;
		if (row / Math.max(1, rows - 1) >= field) continue;
		options.ctx.rect(
			bounds.left,
			bounds.top + row * rowHeight,
			bounds.width,
			rowHeight + 0.8,
		);
		any = true;
	}
	if (any) {
		options.ctx.clip();
		drawEnterBWhole({ options });
	}
	options.ctx.restore();
	const field = progress < 0.5 ? firstField : secondField;
	if (field > 0 && field < 1) {
		const y = lerp({ start: bounds.top, end: bounds.bottom, progress: field });
		drawEnterBLine({
			alpha: progress < 0.5 ? 0.9 : 0.9 * (1 - field),
			color: "#ffffff",
			from: [bounds.left - options.size * 0.3, y],
			options,
			to: [bounds.right + options.size * 0.3, y],
			width: Math.max(1.5, options.size * 0.02),
		});
	}
}

function loadingProgress(options: EnterBDraw): number {
	const progress = options.frame.enterProgress;
	const keys = [
		[0.06, 0],
		[0.2, 0.16 + 0.08 * enterBRandom(options, 1, 301)],
		[0.3, 0.24 + 0.08 * enterBRandom(options, 2, 302)],
		[0.42, 0.52 + 0.1 * enterBRandom(options, 3, 303)],
		[0.52, 0.6 + 0.08 * enterBRandom(options, 4, 304)],
		[0.7, 1],
	] as const;
	let value = 0;
	for (let index = 1; index < keys.length; index += 1) {
		const previous = keys[index - 1]!;
		const current = keys[index]!;
		if (progress < previous[0]) break;
		value = lerp({
			start: previous[1],
			end: current[1],
			progress: outCubic(
				clamp01((progress - previous[0]) / (current[0] - previous[0])),
			),
		});
	}
	return clamp01(value);
}

function drawLoadingBar(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const loaded = loadingProgress(options);
	const glyphs = enterBGlyphs(options);
	const bounds = enterBBounds(options);
	for (const glyph of glyphs) {
		const phase = clamp01((loaded - glyph.order) / 0.12 + 0.35);
		if (phase <= 0) continue;
		const eased = enterBOutBack(phase, 2);
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(phase * 3),
				translateY: (1 - eased) * options.size * 0.25,
			},
		});
	}
	const out = clamp01((progress - 0.74) / 0.22);
	const alpha =
		clamp01(progress / 0.08) * (1 - clamp01((progress - 0.88) / 0.12));
	const lineWidth = Math.max(3, options.size * 0.07);
	const y = bounds.bottom + options.size * 0.24;
	const left = lerp({ start: bounds.left, end: bounds.right, progress: out });
	drawEnterBLine({
		alpha: alpha * 0.3,
		color: options.frame.palette.secondary,
		from: [left, y],
		options,
		to: [bounds.right, y],
		width: lineWidth,
	});
	drawEnterBLine({
		alpha,
		color: options.frame.palette.accent,
		from: [left, y],
		options,
		to: [
			Math.max(
				left,
				lerp({ start: bounds.left, end: bounds.right, progress: loaded }),
			),
			y,
		],
		width: lineWidth,
	});
	if (alpha > 0.01) {
		const baseAlpha = options.ctx.globalAlpha;
		const baseFill = options.ctx.fillStyle;
		options.ctx.globalAlpha = baseAlpha * alpha * (1 - out);
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.textAlign = "left";
		options.ctx.fillText(
			`${Math.round(loaded * 100)}%`,
			bounds.right + options.size * 0.22,
			y,
			options.size * 1.1,
		);
		options.ctx.globalAlpha = baseAlpha;
		options.ctx.fillStyle = baseFill;
	}
}

function drawDither(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.2);
	const direction = enterBDirection(options, 101);
	let cell = Math.max(3, options.size * 0.075);
	while ((bounds.width / cell) * (bounds.height / cell) > 1400) cell *= 1.2;
	const columns = Math.ceil(bounds.width / cell);
	const rows = Math.ceil(bounds.height / cell);
	const originX = bounds.centerX - (columns * cell) / 2;
	const originY = bounds.centerY - (rows * cell) / 2;
	let any = false;
	options.ctx.save();
	options.ctx.beginPath();
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const threshold =
				((BAYER_4X4[(row & 3) * 4 + (column & 3)] ?? 0) + 0.5) / 16;
			const order = columns > 1 ? column / (columns - 1) : 0;
			const active =
				options.frame.enterProgress * 1.35 -
				0.3 * (direction > 0 ? order : 1 - order);
			if (active <= threshold) continue;
			options.ctx.rect(
				originX + column * cell - 0.4,
				originY + row * cell - 0.4,
				cell + 0.8,
				cell + 0.8,
			);
			any = true;
		}
	}
	if (any) {
		options.ctx.clip();
		drawEnterBWhole({ options });
	}
	options.ctx.restore();
}

function drawOdometer(options: EnterBDraw): void {
	const digitsOnly = /^[\d\s]+$/u.test(options.text);
	const pool = digitsOnly ? Array.from("0123456789") : SIGNS;
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.45,
		});
		if (progress <= 0) continue;
		const turns = 3 + Math.floor(enterBRandom(options, glyph.index, 111) * 3);
		const position = turns * (1 - enterBOutBack(progress, 1.15));
		const lower = Math.floor(position);
		const upper = Math.ceil(position);
		for (const reelIndex of new Set([0, lower, upper])) {
			if (reelIndex < 0 || reelIndex > turns) continue;
			const offset = (position - reelIndex) * 1.02;
			if (Math.abs(offset) >= 1) continue;
			const character =
				reelIndex === 0
					? glyph.character
					: pool[
							Math.floor(
								enterBRandom(options, glyph.index + reelIndex * 19, 112) *
									pool.length,
							) % pool.length
						];
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					alpha: 1 - 0.35 * Math.abs(offset),
					character,
					clipX: [-1.2, 1.2],
					clipY: [-0.58 - offset, 0.58 - offset],
					translateY: offset * options.size,
				},
			});
		}
	}
}

function drawMatrixRain(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	const frameStep = Math.floor(enterBSeconds(options) * 24);
	for (const glyph of glyphs) {
		const order =
			0.35 * enterBRandom(options, glyph.index, 121) + 0.65 * (1 - glyph.order);
		const progress = enterBPhase({ options, order, spread: 0.45 });
		if (progress <= 0) continue;
		const landing = 0.62;
		const distance =
			options.size * (2.2 + enterBRandom(options, glyph.index, 122));
		const offset = -distance * (1 - outCubic(clamp01(progress / landing)));
		const randomCharacter = (trail: number) =>
			SIGNS[
				Math.floor(
					enterBRandom(
						options,
						glyph.index + trail * 31 + frameStep * 17,
						123,
					) * SIGNS.length,
				) % SIGNS.length
			];
		for (let trail = 4; trail >= 1; trail -= 1) {
			const alpha =
				(1 - trail / 5) *
				0.75 *
				(1 - clamp01((progress - landing * 0.9) / (1 - landing * 0.9))) *
				clamp01(progress * 6);
			if (alpha <= 0) continue;
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					alpha,
					character: randomCharacter(trail),
					color: options.frame.palette.accent,
					scaleX: 0.9,
					scaleY: 0.9,
					translateY: offset - trail * options.size * 0.92,
				},
			});
		}
		drawEnterBGlyph({
			glyph,
			options,
			transform:
				progress < landing
					? {
							character: randomCharacter(0),
							color: "#ffffff",
							translateY: offset,
						}
					: {
							color:
								progress < 0.86
									? options.frame.palette.accent
									: options.frame.palette.foreground,
						},
		});
	}
}
