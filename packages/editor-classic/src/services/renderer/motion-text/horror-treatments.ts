import {
	horrorEffectRandom,
	horrorEffectSignedRandom,
	horrorInOutCubic,
	horrorOutCubic,
	positionedHorrorGlyphs,
	type HorrorTreatmentOptions,
} from "./horror-text-effect-utils";

export function drawHorrorTreatment(options: HorrorTreatmentOptions): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "hrInkBleed":
			drawInkBleed(options);
			return true;
		case "hrEroded":
			drawEroded(options);
			return true;
		case "hrRedact":
			drawRedact(options);
			return true;
		case "hrDoubleExp":
			drawDoubleExposure(options);
			return true;
		default:
			return false;
	}
}

function drawInkBleed(options: HorrorTreatmentOptions): void {
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	const red = horrorEffectRandom({ options, salt: 2501 }) < 0.4;
	const halo = red
		? options.frame.palette.accent
		: options.frame.palette.secondary;
	for (const [deltaX, deltaY, alpha] of [
		[-options.size * 0.035, options.size * 0.02, 0.12],
		[options.size * 0.035, options.size * 0.025, 0.12],
		[0, options.size * 0.045, 0.16],
	] as const) {
		options.ctx.fillStyle = halo;
		options.ctx.globalAlpha = baseAlpha * alpha;
		options.ctx.fillText(
			options.text,
			options.x + deltaX,
			options.y + deltaY,
			options.maxWidth,
		);
	}
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	const grow = horrorOutCubic((options.frame.progress - 0.18) / 0.62);
	for (const glyph of positionedHorrorGlyphs(options)) {
		if (
			horrorEffectRandom({
				options,
				salt: 2551 + glyph.globalIndex,
			}) > 0.35
		) {
			continue;
		}
		const length =
			options.size *
			(0.2 +
				horrorEffectRandom({
					options,
					salt: 2601 + glyph.globalIndex,
				}) *
					0.9) *
			grow;
		const width = Math.max(1.5, options.size * 0.025);
		options.ctx.fillStyle = red
			? options.frame.palette.accent
			: options.frame.palette.foreground;
		options.ctx.globalAlpha = baseAlpha * 0.78;
		options.ctx.fillRect(
			glyph.x +
				horrorEffectSignedRandom({
					options,
					salt: 2651 + glyph.globalIndex,
				}) *
					options.size *
					0.18,
			glyph.y + options.size * 0.36,
			width,
			length,
		);
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawEroded(options: HorrorTreatmentOptions): void {
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.fillStyle = options.frame.palette.background;
	options.ctx.globalAlpha = baseAlpha * 0.94;
	for (const glyph of positionedHorrorGlyphs(options)) {
		for (let pit = 0; pit < 3; pit += 1) {
			const size =
				options.size *
				(0.025 +
					horrorEffectRandom({
						options,
						salt: 2701 + glyph.globalIndex * 7 + pit,
					}) *
						0.055);
			options.ctx.fillRect(
				glyph.x +
					horrorEffectSignedRandom({
						options,
						salt: 2751 + glyph.globalIndex * 7 + pit,
					}) *
						options.size *
						0.28 -
					size / 2,
				glyph.y +
					horrorEffectSignedRandom({
						options,
						salt: 2801 + glyph.globalIndex * 7 + pit,
					}) *
						options.size *
						0.36 -
					size / 2,
				size,
				size,
			);
		}
		if (
			horrorEffectRandom({
				options,
				salt: 2851 + glyph.globalIndex,
			}) < 0.45
		) {
			options.ctx.save();
			options.ctx.translate(glyph.x, glyph.y);
			options.ctx.rotate(
				horrorEffectSignedRandom({
					options,
					salt: 2901 + glyph.globalIndex,
				}) * 0.7,
			);
			options.ctx.fillRect(
				-options.size * 0.24,
				-Math.max(1, options.size * 0.012),
				options.size * 0.48,
				Math.max(2, options.size * 0.024),
			);
			options.ctx.restore();
		}
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawRedact(options: HorrorTreatmentOptions): void {
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) {
		options.ctx.fillStyle = baseFill;
		return;
	}
	const fraction = 0.3 + horrorEffectRandom({ options, salt: 3001 }) * 0.3;
	const count = Math.max(1, Math.round(glyphs.length * fraction));
	const available = Math.max(0, glyphs.length - count);
	const start = Math.min(
		available,
		Math.floor(horrorEffectRandom({ options, salt: 3002 }) * (available + 1)),
	);
	const selected = glyphs.slice(start, start + count);
	const left = selected[0]!.x - options.size * 0.4;
	const right = selected[selected.length - 1]!.x + options.size * 0.4;
	const top = options.y - options.size * 0.52;
	const height = options.size * 1.04;
	const revealAt = 0.25 + horrorEffectRandom({ options, salt: 3003 }) * 0.25;
	const reveal = horrorInOutCubic((options.frame.progress - revealAt) / 0.28);
	const width = right - left;
	options.ctx.fillStyle = options.frame.palette.background;
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillRect(
		left + width * reveal,
		top,
		width * (1 - reveal),
		height,
	);
	if (reveal > 0) {
		const line = Math.max(1, options.size * 0.016);
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.globalAlpha = baseAlpha * 0.5 * reveal;
		options.ctx.fillRect(left, top, width, line);
		options.ctx.fillRect(left, top + height - line, width, line);
		options.ctx.fillRect(left, top, line, height);
		options.ctx.fillRect(right - line, top, line, height);
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawDoubleExposure(options: HorrorTreatmentOptions): void {
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	const seconds = options.frame.localTime / 120_000;
	const amplitude = 0.18 + horrorEffectRandom({ options, salt: 3101 }) * 0.1;
	const scale = 1.03 + horrorEffectRandom({ options, salt: 3102 }) * 0.05;
	options.ctx.save();
	options.ctx.translate(
		options.x + Math.sin(seconds * 3.8) * options.size * amplitude,
		options.y + Math.cos(seconds * 3.1 + 0.7) * options.size * amplitude * 0.7,
	);
	options.ctx.scale(scale, scale);
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.globalAlpha = baseAlpha * 0.4;
	options.ctx.textAlign = "center";
	options.ctx.fillText(options.text, 0, 0, options.maxWidth);
	options.ctx.restore();
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}
