import {
	drawFxBScaled,
	fillFxBSource,
	fxBPhase,
	fxBPulse,
	fxBSigned,
	fxBUnit,
	replaceFxBFrame,
	type FxBPixelEffectDraw,
} from "./fx-b-screen-effect-types";

const OPTICAL_EFFECTS = new Set([
	"radialChroma",
	"bloomFlash",
	"bulge",
	"kaleido",
	"heartbeat",
	"ripple",
	"defocus",
]);

export function drawFxBOpticalEffect(options: FxBPixelEffectDraw): boolean {
	if (!OPTICAL_EFFECTS.has(options.effect)) return false;
	switch (options.effect) {
		case "radialChroma":
			drawRadialChroma(options);
			break;
		case "bloomFlash":
			drawBloomFlash(options);
			break;
		case "bulge":
			drawBulge(options);
			break;
		case "kaleido":
			drawKaleido(options);
			break;
		case "heartbeat":
			drawHeartbeat(options);
			break;
		case "ripple":
			drawRipple(options);
			break;
		case "defocus":
			drawDefocus(options);
			break;
	}
	return true;
}

function drawRadialChroma(options: FxBPixelEffectDraw): void {
	const pulse = fxBPulse(options);
	const amount = 0.012 + pulse * 0.025;
	options.ctx.globalCompositeOperation = "screen";
	options.ctx.globalAlpha *= 0.28 + pulse * 0.22;
	drawFxBScaled({ options, scaleX: 1 + amount, scaleY: 1 + amount * 0.6 });
	options.ctx.globalAlpha *= 0.82;
	drawFxBScaled({ options, scaleX: 1 - amount * 0.65 });
	fillFxBSource({
		alpha: 0.12 + pulse * 0.1,
		color: options.frame.palette.accent,
		height: options.height,
		options,
		width: options.width / 2,
		x: 0,
		y: 0,
	});
	fillFxBSource({
		alpha: 0.1 + pulse * 0.08,
		color: options.frame.palette.secondary,
		height: options.height,
		options,
		width: options.width / 2,
		x: options.width / 2,
		y: 0,
	});
}

function drawBloomFlash(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const bloom = Math.sin(Math.PI * phase);
	options.ctx.globalCompositeOperation = "screen";
	for (let layer = 1; layer <= 4; layer += 1) {
		options.ctx.globalAlpha = bloom * (0.12 - layer * 0.018);
		drawFxBScaled({ options, scaleX: 1 + layer * 0.012 * bloom });
	}
	fillFxBSource({
		alpha: bloom * 0.32,
		color: options.frame.palette.foreground,
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
}

function drawBulge(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const direction = fxBUnit(options, 41_001) < 0.28 ? -1 : 1;
	const amount = direction * Math.sin(Math.PI * phase) * 0.3;
	const strips = 22;
	replaceFxBFrame(options, () => {
		for (let strip = 0; strip < strips; strip += 1) {
			const sourceX = (strip / strips) * options.width;
			const sourceWidth = options.width / strips + 1;
			const normalized = (strip + 0.5) / strips - 0.5;
			const envelope = 1 - Math.min(1, Math.abs(normalized) * 2);
			const stretch = 1 + amount * envelope;
			const destinationWidth = sourceWidth * stretch;
			const destinationX =
				options.width / 2 +
				normalized * options.width * (1 + amount * 0.16) -
				destinationWidth / 2;
			options.ctx.drawImage(
				options.source,
				sourceX,
				0,
				sourceWidth,
				options.height,
				destinationX,
				-options.height * amount * envelope * 0.025,
				destinationWidth,
				options.height * (1 + amount * envelope * 0.05),
			);
		}
	});
}

function drawKaleido(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const cx = options.width / 2;
	const cy = options.height / 2;
	const sectors = fxBUnit(options, 41_101) < 0.5 ? 6 : 8;
	replaceFxBFrame(options, () => {
		for (let sector = 0; sector < sectors; sector += 1) {
			options.ctx.save();
			options.ctx.translate(cx, cy);
			options.ctx.rotate((sector / sectors) * Math.PI * 2 + phase * 0.35);
			if (sector % 2 === 1) options.ctx.scale(-1, 1);
			options.ctx.beginPath();
			options.ctx.rect(
				0,
				-options.height * 0.12,
				options.width,
				options.height * 0.24,
			);
			options.ctx.clip();
			options.ctx.scale(1.05 + phase * 0.08, 1.05 + phase * 0.08);
			options.ctx.drawImage(options.source, -cx, -cy);
			options.ctx.restore();
		}
	});
}

function drawHeartbeat(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const first = Math.max(0, 1 - Math.abs(phase - 0.2) / 0.16);
	const second = Math.max(0, 1 - Math.abs(phase - 0.58) / 0.2) * 0.78;
	const pulse = Math.max(first, second);
	if (pulse <= 0) return;
	options.ctx.globalAlpha = 0.62;
	drawFxBScaled({ options, scaleX: 1 + pulse * 0.035 });
	const edge = Math.min(options.width, options.height) * (0.025 + pulse * 0.05);
	const color = options.frame.palette.accent;
	fillFxBSource({
		alpha: pulse * 0.4,
		color,
		height: edge,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
	fillFxBSource({
		alpha: pulse * 0.4,
		color,
		height: edge,
		options,
		width: options.width,
		x: 0,
		y: options.height - edge,
	});
	fillFxBSource({
		alpha: pulse * 0.32,
		color,
		height: options.height,
		options,
		width: edge,
		x: 0,
		y: 0,
	});
	fillFxBSource({
		alpha: pulse * 0.32,
		color,
		height: options.height,
		options,
		width: edge,
		x: options.width - edge,
		y: 0,
	});
}

function drawRipple(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const unit = Math.min(options.width, options.height);
	const cx = options.width * (0.5 + fxBSigned(options, 41_201) * 0.08);
	const cy = options.height * (0.5 + fxBSigned(options, 41_202) * 0.06);
	for (let ring = 0; ring < 5; ring += 1) {
		const progress = (phase + ring * 0.16) % 1;
		const radius = unit * (0.08 + progress * 0.62);
		const thickness = unit * 0.04;
		options.ctx.save();
		options.ctx.beginPath();
		if (options.ctx.arc) {
			options.ctx.arc(cx, cy, radius + thickness, 0, Math.PI * 2);
			options.ctx.arc(
				cx,
				cy,
				Math.max(1, radius - thickness),
				0,
				Math.PI * 2,
				true,
			);
			options.ctx.clip();
		}
		options.ctx.globalAlpha = (1 - progress) * 0.5;
		drawFxBScaled({
			centerX: cx,
			centerY: cy,
			options,
			scaleX: 1 + (1 - progress) * 0.045,
		});
		options.ctx.restore();
	}
}

function drawDefocus(options: FxBPixelEffectDraw): void {
	const amount = Math.sin(Math.PI * fxBPhase(options));
	if (amount < 0.02) return;
	options.ctx.globalCompositeOperation = "source-over";
	for (let ghost = 0; ghost < 7; ghost += 1) {
		const angle = (ghost / 7) * Math.PI * 2;
		const distance = Math.min(options.width, options.height) * amount * 0.012;
		options.ctx.globalAlpha = 0.08 + amount * 0.025;
		options.ctx.drawImage(
			options.source,
			Math.cos(angle) * distance,
			Math.sin(angle) * distance,
			options.width,
			options.height,
		);
	}
	options.ctx.globalAlpha = 0.2 + (1 - amount) * 0.45;
	drawFxBScaled({ options, scaleX: 1 + amount * 0.025 });
}
