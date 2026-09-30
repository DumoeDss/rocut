import {
	drawHorrorGlyph,
	drawHorrorText,
	horrorEffectRandom,
	horrorEffectSignedRandom,
	horrorInOutCubic,
	horrorOutExpo,
	positionedHorrorGlyphs,
	type HorrorTextEffectOptions,
} from "./horror-text-effect-utils";

export function drawHorrorHold(options: HorrorTextEffectOptions): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "hrTwitch":
			drawTwitch(options);
			return true;
		case "hrStare":
			drawStare(options);
			return true;
		case "hrLagOne":
			drawLagOne(options);
			return true;
		case "hrFlickerLight":
			drawFlickerLight(options);
			return true;
		default:
			return false;
	}
}

function drawTwitch(options: HorrorTextEffectOptions): void {
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) return;
	const period = 72_000;
	const cycle = Math.floor(options.frame.localTime / period);
	const phase = (options.frame.localTime % period) / period;
	const burst = phase < 0.18 ? (1 - phase / 0.18) ** 2 : 0;
	const target = Math.floor(
		horrorEffectRandom({ options, salt: 1801 + cycle }) * glyphs.length,
	);
	const whole = horrorEffectRandom({ options, salt: 1851 + cycle }) < 0.25;
	for (const [index, glyph] of glyphs.entries()) {
		if (burst <= 0 || (!whole && index !== target)) {
			drawHorrorGlyph({ options, glyph });
			continue;
		}
		drawHorrorGlyph({
			options,
			glyph,
			deltaX:
				horrorEffectSignedRandom({
					options,
					salt: 1901 + cycle * 13 + index,
				}) *
				options.size *
				0.22 *
				burst,
			deltaY:
				horrorEffectSignedRandom({
					options,
					salt: 1951 + cycle * 13 + index,
				}) *
				options.size *
				0.14 *
				burst,
			rotation:
				horrorEffectSignedRandom({
					options,
					salt: 2001 + cycle * 13 + index,
				}) *
				0.49 *
				burst,
			scaleX:
				1 +
				horrorEffectRandom({
					options,
					salt: 2051 + cycle * 13 + index,
				}) *
					0.12 *
					burst,
			scaleY: 1 + 0.06 * burst,
		});
	}
}

function drawStare(options: HorrorTextEffectOptions): void {
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) return;
	const period = 96_000;
	const cycle = Math.floor(options.frame.localTime / period);
	const phase = (options.frame.localTime % period) / period;
	const target = Math.floor(
		horrorEffectRandom({ options, salt: 2101 + cycle }) * glyphs.length,
	);
	const turn =
		phase < 0.6
			? horrorInOutCubic(phase / 0.6)
			: phase < 0.85
				? 1
				: 1 - horrorOutExpo((phase - 0.85) / 0.15);
	const direction =
		horrorEffectRandom({ options, salt: 2151 + cycle }) < 0.5 ? -1 : 1;
	for (const [index, glyph] of glyphs.entries()) {
		if (index !== target) {
			drawHorrorGlyph({ options, glyph });
			continue;
		}
		drawHorrorGlyph({
			options,
			glyph,
			rotation: direction * 0.38 * turn,
			scaleX: 1 + 0.12 * turn,
			scaleY: 1 + 0.12 * turn,
			deltaY: -options.size * 0.04 * turn,
			color: turn > 0.72 ? options.frame.palette.accent : undefined,
		});
	}
}

function drawLagOne(options: HorrorTextEffectOptions): void {
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) return;
	const seconds = options.frame.localTime / 120_000;
	const late = Math.floor(
		horrorEffectRandom({ options, salt: 2201 }) * glyphs.length,
	);
	for (const [index, glyph] of glyphs.entries()) {
		const time = index === late ? seconds - 0.28 : seconds;
		drawHorrorGlyph({
			options,
			glyph,
			deltaX: Math.sin(time * 5.3) * options.size * 0.1,
			deltaY: Math.cos(time * 4.1 + 0.7) * options.size * 0.06,
			rotation: Math.sin(time * 3.4 + 1.4) * 0.07,
			color: index === late ? options.frame.palette.secondary : undefined,
		});
	}
}

function drawFlickerLight(options: HorrorTextEffectOptions): void {
	const step = Math.floor(options.frame.localTime / 4_000);
	const run = Math.floor(step / 2);
	let level = 0.9 + 0.1 * horrorEffectRandom({ options, salt: 2301 + step });
	if (horrorEffectRandom({ options, salt: 2351 + run }) < 0.09) {
		level =
			horrorEffectRandom({ options, salt: 2401 + step }) < 0.5 ? 0.08 : 0.35;
	} else if (horrorEffectRandom({ options, salt: 2451 + step }) < 0.05) {
		level = 0.5;
	}
	drawHorrorText({
		options,
		alpha: level,
		color:
			level < 0.6
				? options.frame.palette.secondary
				: options.frame.palette.foreground,
	});
}
