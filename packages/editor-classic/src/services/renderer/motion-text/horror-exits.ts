import {
	clampHorror,
	drawHorrorGlyph,
	drawHorrorText,
	horrorEffectRandom,
	horrorEffectSignedRandom,
	horrorInCubic,
	horrorInOutCubic,
	positionedHorrorGlyphs,
	type HorrorTextEffectOptions,
} from "./horror-text-effect-utils";

export function drawHorrorExit(options: HorrorTextEffectOptions): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "hrPulledDown":
			drawPulledDown(options);
			return true;
		case "hrLookBack":
			drawLookBack(options);
			return true;
		case "hrTurnAway":
			drawTurnAway(options);
			return true;
		case "hrShiver":
			drawShiver(options);
			return true;
		case "hrSwallow":
			drawSwallow(options);
			return true;
		case "hrFlickerDie":
			drawFlickerDie(options);
			return true;
		case "hrDrain":
			drawDrain(options);
			return true;
		default:
			return false;
	}
}

function drawPulledDown(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) return;
	const last = Math.floor(
		horrorEffectRandom({ options, salt: 901 }) * glyphs.length,
	);
	const step = Math.floor(options.frame.localTime / 4_000);
	for (const [index, glyph] of glyphs.entries()) {
		const start =
			index === last
				? 0.7
				: horrorEffectRandom({ options, salt: 910 + index }) * 0.5;
		const phase = (progress - start) / 0.28;
		if (phase >= 1) continue;
		if (phase < 0) {
			const tension =
				clampHorror(1 + phase * 1.5) * (index === last ? 1.6 : 0.6);
			drawHorrorGlyph({
				options,
				glyph,
				deltaX:
					horrorEffectSignedRandom({
						options,
						salt: 930 + index * 5 + step,
					}) *
					options.size *
					0.03 *
					tension,
				deltaY:
					horrorEffectSignedRandom({
						options,
						salt: 940 + index * 5 + step,
					}) *
					options.size *
					0.02 *
					tension,
				rotation:
					horrorEffectSignedRandom({
						options,
						salt: 950 + index * 5 + step,
					}) *
					0.1 *
					tension,
			});
			continue;
		}
		const fall = clampHorror(phase);
		drawHorrorGlyph({
			options,
			glyph,
			deltaY: fall ** 2 * options.size * 8,
			scaleX: 1 - fall * 0.3,
			scaleY: 1 + fall * 1.8,
			rotation:
				horrorEffectSignedRandom({ options, salt: 960 + index }) * 0.21 * fall,
			alpha: 1 - horrorInCubic(fall),
		});
	}
}

function drawLookBack(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) return;
	const selected = selectLookBackGlyph({ glyphs, options });
	const step = Math.floor(options.frame.localTime / 4_000);
	for (const [index, glyph] of glyphs.entries()) {
		if (index !== selected) {
			if (progress < 0.06) {
				drawHorrorGlyph({ options, glyph, alpha: 0.4 });
			}
			continue;
		}
		if (progress >= 0.86) continue;
		const turn = horrorInOutCubic((progress - 0.12) / 0.55);
		const direction =
			horrorEffectRandom({ options, salt: 971 }) >= 0.5 ? 1 : -1;
		const twitch =
			horrorEffectRandom({ options, salt: 972 + step }) < 0.12
				? horrorEffectSignedRandom({ options, salt: 973 + step }) * 0.1
				: 0;
		drawHorrorGlyph({
			options,
			glyph,
			rotation: direction * 0.42 * turn + twitch,
			scaleX: 1 + 0.16 * turn,
			scaleY: 1 + 0.16 * turn,
			deltaX:
				horrorEffectSignedRandom({ options, salt: 974 + step }) *
				options.size *
				0.01 *
				turn,
			color: turn > 0.3 ? options.frame.palette.accent : undefined,
		});
	}
}

function drawTurnAway(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	for (const glyph of positionedHorrorGlyphs(options)) {
		const phase = clampHorror((progress - glyph.order * 0.4) / 0.6);
		if (phase >= 1) continue;
		if (phase <= 0) {
			drawHorrorGlyph({ options, glyph });
			continue;
		}
		const scaleX = Math.cos(phase * Math.PI * 0.95);
		drawHorrorGlyph({
			options,
			glyph,
			scaleX: Math.abs(scaleX) < 0.04 ? 0.04 : scaleX,
			deltaY: phase * options.size * 0.08,
			alpha: 1 - clampHorror((phase - 0.6) / 0.4),
			color: phase > 0.5 ? options.frame.palette.background : undefined,
		});
	}
}

function drawShiver(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	const step = Math.floor(options.frame.localTime / 4_000);
	for (const glyph of positionedHorrorGlyphs(options)) {
		const drop =
			0.3 +
			horrorEffectRandom({ options, salt: 1001 + glyph.globalIndex }) * 0.62;
		if (progress >= drop) continue;
		const amplitude = options.size * (0.025 + 0.13 * progress);
		drawHorrorGlyph({
			options,
			glyph,
			deltaX:
				horrorEffectSignedRandom({
					options,
					salt: 1020 + glyph.globalIndex * 5 + step,
				}) * amplitude,
			deltaY:
				horrorEffectSignedRandom({
					options,
					salt: 1040 + glyph.globalIndex * 5 + step,
				}) * amplitude,
			rotation:
				horrorEffectSignedRandom({
					options,
					salt: 1060 + glyph.globalIndex * 5 + step,
				}) *
				0.24 *
				progress,
		});
	}
}

function drawSwallow(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	const glyphs = positionedHorrorGlyphs(options);
	if (glyphs.length === 0) return;
	const centerX =
		options.x -
		options.maxWidth * 0.35 +
		horrorEffectRandom({ options, salt: 1101 }) * options.maxWidth * 0.7;
	const centerY =
		options.y +
		horrorEffectSignedRandom({ options, salt: 1102 }) * options.size * 0.22;
	const radius = horrorInCubic(progress / 0.75) * options.maxWidth * 0.72;
	for (const glyph of glyphs) {
		const distance = Math.hypot(glyph.x - centerX, (glyph.y - centerY) * 1.8);
		if (distance > radius) drawHorrorGlyph({ options, glyph });
	}
	if (radius <= 0) return;
	const baseFill = options.ctx.fillStyle;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.background;
	options.ctx.globalAlpha =
		baseAlpha * 0.85 * (1 - clampHorror((progress - 0.82) / 0.18));
	options.ctx.fillRect(
		centerX - radius,
		centerY - radius * 0.34,
		radius * 2,
		radius * 0.68,
	);
	options.ctx.fillStyle = baseFill;
	options.ctx.globalAlpha = baseAlpha;
}

function drawFlickerDie(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	const step = Math.floor(options.frame.localTime / 4_000);
	const visibleThreshold = Math.max(0.16, (1 - progress) ** 1.3 * 0.95);
	if (
		progress > 0.92 ||
		horrorEffectRandom({ options, salt: 1201 + step }) > visibleThreshold
	) {
		return;
	}
	if (
		progress > 0.15 &&
		horrorEffectRandom({ options, salt: 1301 + step }) < 0.22
	) {
		drawHorrorText({
			options,
			scaleX: -1,
			color: options.frame.palette.accent,
			deltaY:
				horrorEffectSignedRandom({ options, salt: 1401 + step }) *
				options.size *
				0.1,
		});
		return;
	}
	drawHorrorText({
		options,
		alpha: 0.55 + 0.45 * horrorEffectRandom({ options, salt: 1501 + step }),
	});
}

function drawDrain(options: HorrorTextEffectOptions): void {
	const progress = options.frame.exitProgress;
	const glyphs = positionedHorrorGlyphs(options);
	const baseFill = options.ctx.fillStyle;
	const baseAlpha = options.ctx.globalAlpha;
	for (const glyph of glyphs) {
		const phase = horrorInOutCubic((progress - glyph.order * 0.25) / 0.72);
		if (phase >= 0.995) continue;
		if (phase <= 0) {
			drawHorrorGlyph({ options, glyph });
			continue;
		}
		const top = glyph.y - options.size * 0.72 + phase * options.size * 1.44;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			glyph.x - options.size * 0.42,
			top,
			options.size * 0.84,
			options.size * 1.44 * (1 - phase),
		);
		options.ctx.clip();
		drawHorrorGlyph({ options, glyph });
		options.ctx.restore();
		const dripCount =
			1 +
			Math.floor(
				horrorEffectRandom({
					options,
					salt: 1601 + glyph.globalIndex,
				}) * 2,
			);
		for (let drip = 0; drip < dripCount; drip += 1) {
			const length =
				options.size *
				(0.3 +
					horrorEffectRandom({
						options,
						salt: 1651 + glyph.globalIndex * 3 + drip,
					}) *
						1.1) *
				phase;
			const width = Math.max(1.5, options.size * 0.025);
			options.ctx.fillStyle = options.frame.palette.foreground;
			options.ctx.globalAlpha =
				baseAlpha * (1 - clampHorror((phase - 0.75) / 0.25));
			options.ctx.fillRect(
				glyph.x +
					horrorEffectSignedRandom({
						options,
						salt: 1701 + glyph.globalIndex * 3 + drip,
					}) *
						options.size *
						0.22,
				glyph.y + options.size * 0.36,
				width,
				length,
			);
		}
	}
	options.ctx.fillStyle = baseFill;
	options.ctx.globalAlpha = baseAlpha;
}

function selectLookBackGlyph({
	glyphs,
	options,
}: {
	readonly glyphs: ReturnType<typeof positionedHorrorGlyphs>;
	readonly options: HorrorTextEffectOptions;
}): number {
	let selected = Math.floor(
		horrorEffectRandom({ options, salt: 970 }) * glyphs.length,
	);
	for (let offset = 0; offset < glyphs.length; offset += 1) {
		const index = (selected + offset) % glyphs.length;
		if (/[\p{L}\p{N}]/u.test(glyphs[index]?.character ?? "")) {
			selected = index;
			break;
		}
	}
	return selected;
}
