import {
	degrees,
	drawGlyphSet,
	frameStep,
	randomSigned,
	randomUnit,
	secondsOf,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const CORE_HOLD_IDS = new Set(["glitchtick", "wave"]);

export function drawCoreHold(options: ExitHoldDraw): boolean {
	const hold = options.frame.cut?.preset.hold;
	if (!hold || !CORE_HOLD_IDS.has(hold)) return false;
	switch (hold) {
		case "glitchtick":
			drawGlitchTick(options);
			break;
		case "wave":
			drawWave(options);
			break;
	}
	return true;
}

function drawWave(options: ExitHoldDraw): void {
	const phase = secondsOf(options.frame) * 7;
	drawGlyphSet(options, (glyph) => {
		const angle = phase + glyph.index * 0.75;
		return {
			rotation: degrees(Math.cos(angle) * 5),
			translateY: Math.sin(angle) * options.size * 0.07,
		};
	});
}

function drawGlitchTick(options: ExitHoldDraw): void {
	options.drawGlyph(options);
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	const top = options.y - options.size * 0.82;
	const bandHeight = (options.size * 1.64) / 6;
	const burst = 0.45 + randomUnit(seed, Math.floor(step / 3), 201) * 0.55;
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	for (let band = 0; band < 6; band += 1) {
		if (randomUnit(seed, step, band, 202) > 0.72) continue;
		const offset =
			randomSigned(seed, step, band, 203) * options.size * 0.35 * burst;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(
			options.x - options.maxWidth * 0.55,
			top + band * bandHeight,
			options.maxWidth * 1.1,
			bandHeight + 0.75,
		);
		options.ctx.clip();
		options.ctx.translate(offset, 0);
		options.ctx.globalAlpha = baseAlpha * (0.45 + burst * 0.35);
		if (band % 3 === 1) options.ctx.fillStyle = options.frame.palette.accent;
		options.drawGlyph(options);
		options.ctx.restore();
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;

	const marker = Math.abs(randomSigned(seed, step, 204));
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.globalAlpha = baseAlpha * 0.45;
	options.ctx.fillRect(
		options.x - options.maxWidth * 0.5 + marker * options.maxWidth * 0.75,
		options.y + options.size * 0.62,
		options.maxWidth * (0.08 + marker * 0.12),
		Math.max(1, options.size * 0.025),
	);
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}
