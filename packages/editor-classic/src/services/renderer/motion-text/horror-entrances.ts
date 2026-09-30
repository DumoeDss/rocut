import {
	clampHorror,
	drawHorrorGlyph,
	drawHorrorText,
	horrorEffectRandom,
	horrorEffectSignedRandom,
	horrorInOutCubic,
	horrorOutBack,
	horrorOutCubic,
	horrorOutExpo,
	lerpHorror,
	positionedHorrorGlyphs,
	type HorrorTextEffectOptions,
} from "./horror-text-effect-utils";

export function drawHorrorEntrance(options: HorrorTextEffectOptions): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "hrBlinkCreep":
			drawBlinkCreep(options);
			return true;
		case "hrJumpScare":
			drawJumpScare(options);
			return true;
		case "hrUneasy":
			drawUneasy(options);
			return true;
		case "hrVhold":
			drawVerticalHold(options);
			return true;
		case "hrMirrorSnap":
			drawMirrorSnap(options);
			return true;
		case "hrManifest":
			drawManifest(options);
			return true;
		case "hrClawReveal":
			drawClawReveal(options);
			return true;
		default:
			return false;
	}
}

function drawBlinkCreep(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	const blinks = [0.26, 0.52, 0.78] as const;
	if (blinks.some((blink) => progress >= blink && progress < blink + 0.05)) {
		return;
	}
	const stage = blinks.filter((blink) => progress >= blink + 0.05).length;
	const distance = 1 - stage / blinks.length;
	for (const glyph of positionedHorrorGlyphs(options)) {
		const angle =
			horrorEffectRandom({ options, salt: 101 + glyph.globalIndex * 3 }) *
			Math.PI *
			2;
		const radius =
			options.size *
			(0.9 +
				horrorEffectRandom({ options, salt: 102 + glyph.globalIndex * 3 }) *
					1.1) *
			distance;
		drawHorrorGlyph({
			options,
			glyph,
			deltaX: Math.cos(angle) * radius,
			deltaY: Math.sin(angle) * radius * 0.6,
			rotation:
				horrorEffectSignedRandom({
					options,
					salt: 103 + glyph.globalIndex * 3,
				}) *
				0.44 *
				distance,
			scaleX: 1 - 0.45 * distance,
			scaleY: 1 - 0.45 * distance,
			alpha: 0.3 + 0.7 * (1 - distance),
		});
	}
}

function drawJumpScare(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	const step = Math.floor(options.frame.localTime / 4_000);
	if (progress < 0.62) {
		const phase = progress / 0.62;
		drawHorrorText({
			options,
			scaleX: 0.42 + phase * 0.08,
			scaleY: 0.42 + phase * 0.08,
			alpha:
				(0.1 + phase * 0.12) *
				(horrorEffectRandom({ options, salt: 201 + step }) < 0.15 ? 0.3 : 1),
			deltaX:
				horrorEffectSignedRandom({ options, salt: 301 + step * 2 }) *
				options.size *
				0.02,
			deltaY:
				horrorEffectSignedRandom({ options, salt: 302 + step * 2 }) *
				options.size *
				0.02,
		});
		return;
	}
	const phase = (progress - 0.62) / 0.38;
	const settle = horrorOutExpo(phase);
	const remaining = 1 - settle;
	drawHorrorText({
		options,
		scaleX: 1 + 0.95 * remaining,
		scaleY: 1 + 0.95 * remaining,
		deltaX:
			horrorEffectSignedRandom({ options, salt: 401 + step * 3 }) *
			options.size *
			0.12 *
			remaining,
		deltaY:
			horrorEffectSignedRandom({ options, salt: 402 + step * 3 }) *
			options.size *
			0.12 *
			remaining,
		rotation:
			horrorEffectSignedRandom({ options, salt: 403 + step * 3 }) *
			0.12 *
			remaining,
	});
}

function drawUneasy(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	for (const glyph of positionedHorrorGlyphs(options)) {
		const irregular = horrorEffectRandom({
			options,
			salt: 501 + glyph.globalIndex,
		});
		const start = glyph.order * 0.75 + irregular * 0.11;
		const phase = (progress - start) / 0.12;
		if (phase < 0) continue;
		const settle = clampHorror(phase);
		drawHorrorGlyph({
			options,
			glyph,
			deltaX:
				horrorEffectSignedRandom({
					options,
					salt: 551 + glyph.globalIndex * 3,
				}) *
				options.size *
				0.18 *
				(1 - settle),
			deltaY:
				horrorEffectSignedRandom({
					options,
					salt: 552 + glyph.globalIndex * 3,
				}) *
				options.size *
				0.1 *
				(1 - settle),
			rotation:
				horrorEffectSignedRandom({
					options,
					salt: 553 + glyph.globalIndex * 3,
				}) *
				0.31 *
				(1 - settle),
			color: settle < 0.5 ? options.frame.palette.accent : undefined,
		});
	}
}

function drawVerticalHold(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	const top = options.y - options.size * 0.78;
	const height = options.size * 1.56;
	const eased = horrorOutCubic(progress);
	const offset = ((1 - eased) * 2.6 * height) % height;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		options.x - options.maxWidth / 2,
		top,
		options.maxWidth,
		height,
	);
	options.ctx.clip();
	drawHorrorText({
		options,
		deltaY: offset,
		alpha: Math.min(1, 0.4 + progress * 2),
		deltaX:
			horrorEffectSignedRandom({
				options,
				salt: 601 + Math.floor(options.frame.localTime / 4_000),
			}) *
			options.size *
			0.05 *
			(1 - eased),
	});
	drawHorrorText({
		options,
		deltaY: offset - height,
		alpha: Math.min(1, 0.4 + progress * 2),
	});
	options.ctx.restore();
	if (offset < 1 || progress > 0.82) return;
	const baseFill = options.ctx.fillStyle;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.background;
	options.ctx.globalAlpha = baseAlpha * (1 - progress) * 0.85;
	options.ctx.fillRect(
		options.x - options.maxWidth / 2,
		top + offset - height * 0.05,
		options.maxWidth,
		height * 0.07,
	);
	options.ctx.fillStyle = baseFill;
	options.ctx.globalAlpha = baseAlpha;
}

function drawMirrorSnap(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	const step = Math.floor(options.frame.localTime / 4_000);
	let scaleX = -1;
	if (progress >= 0.55 && progress < 0.72) {
		scaleX =
			horrorEffectRandom({ options, salt: 701 + step }) < 0.5 ? -1 : 0.25;
	} else if (progress >= 0.72) {
		scaleX = lerpHorror({
			start: -0.2,
			end: 1,
			progress: horrorOutBack((progress - 0.72) / 0.28),
		});
	}
	drawHorrorText({
		options,
		scaleX: Math.abs(scaleX) < 0.04 ? 0.04 : scaleX,
		alpha: Math.min(1, progress / 0.18),
		rotation: progress < 0.55 ? Math.sin(progress * 30) * 0.026 : 0,
	});
}

function drawManifest(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	const finish = horrorInOutCubic((progress - 0.72) / 0.28);
	for (const glyph of positionedHorrorGlyphs(options)) {
		const phase =
			horrorEffectRandom({ options, salt: 801 + glyph.globalIndex * 2 }) *
			Math.PI *
			2;
		const frequency =
			7 +
			horrorEffectRandom({ options, salt: 802 + glyph.globalIndex * 2 }) * 6;
		const wave =
			clampHorror(progress * 1.3) *
			(0.45 + 0.55 * Math.max(0, Math.sin(progress * frequency + phase)));
		const alpha = lerpHorror({ start: wave, end: 1, progress: finish });
		drawHorrorGlyph({
			options,
			glyph,
			alpha,
			deltaX:
				Math.sin(progress * 13 + phase) * options.size * 0.12 * (1 - finish),
			deltaY:
				Math.cos(progress * 9 + phase) * options.size * 0.08 * (1 - finish),
		});
	}
}

function drawClawReveal(options: HorrorTextEffectOptions): void {
	const progress = options.frame.enterProgress;
	if (progress > 0.97) {
		drawHorrorText({ options });
		return;
	}
	const bandWidth = options.maxWidth / 4;
	const top = options.y - options.size * 0.82;
	const height = options.size * 1.64;
	options.ctx.save();
	options.ctx.beginPath();
	for (let index = 0; index < 4; index += 1) {
		const phase = clampHorror((progress - index * 0.08) / 0.7);
		if (phase <= 0) continue;
		const width = bandWidth * (0.08 + horrorInOutCubic(phase) * 1.12);
		const center = options.x - options.maxWidth / 2 + (index + 0.5) * bandWidth;
		options.ctx.rect(center - width / 2, top, width, height);
	}
	options.ctx.clip();
	drawHorrorText({ options });
	options.ctx.restore();

	const baseFill = options.ctx.fillStyle;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	for (let index = 0; index < 4; index += 1) {
		const phase = clampHorror((progress - index * 0.08) / 0.7);
		if (phase <= 0 || phase >= 0.92) continue;
		const center = options.x - options.maxWidth / 2 + (index + 0.5) * bandWidth;
		options.ctx.save();
		options.ctx.translate(center, options.y);
		options.ctx.rotate(index % 2 === 0 ? 0.22 : -0.22);
		options.ctx.globalAlpha = baseAlpha * (1 - phase) * 0.72;
		options.ctx.fillRect(
			-Math.max(1.5, options.size * 0.025),
			-height / 2,
			Math.max(3, options.size * 0.05),
			height,
		);
		options.ctx.restore();
	}
	options.ctx.fillStyle = baseFill;
	options.ctx.globalAlpha = baseAlpha;
}
