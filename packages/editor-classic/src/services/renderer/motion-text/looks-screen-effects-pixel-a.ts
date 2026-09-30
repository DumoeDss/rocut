import { signedRandom, unitRandom } from "./deterministic-random";
import {
	looksEffectProgress,
	looksEffectPulse,
	restoreLooksSource,
	type LooksPixelEffectDraw,
} from "./looks-screen-effect-types";

export function drawLooksPixelEffectA(options: LooksPixelEffectDraw): boolean {
	switch (options.effect) {
		case "rgbSplit":
			drawRgbSplit(options);
			return true;
		case "smear":
			drawSmear(options);
			return true;
		case "vhsRoll":
			drawVhsRoll(options);
			return true;
		case "trackingNoise":
			drawTrackingNoise(options);
			return true;
		case "mirrorFlash":
			drawMirrorFlash(options);
			return true;
		case "posterize":
			drawFiltered({ mode: "posterize", options });
			return true;
		case "hueShift":
			drawFiltered({ mode: "hue", options });
			return true;
		case "tileShift":
			drawTileShift(options);
			return true;
		default:
			return false;
	}
}

function drawRgbSplit(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const distance =
		options.width * (0.004 + unitRandom({ seed, salt: 33_001 }) * 0.01) * pulse;
	restoreLooksSource(options);
	options.ctx.save();
	options.ctx.globalCompositeOperation = "screen";
	options.ctx.globalAlpha = 0.38 + pulse * 0.22;
	options.ctx.filter = "sepia(1) saturate(7) hue-rotate(-35deg)";
	options.ctx.drawImage(
		options.source,
		-distance,
		-distance * 0.18,
		options.width,
		options.height,
	);
	options.ctx.filter = "sepia(1) saturate(7) hue-rotate(145deg)";
	options.ctx.drawImage(
		options.source,
		distance,
		distance * 0.18,
		options.width,
		options.height,
	);
	options.ctx.restore();
}

function drawSmear(options: LooksPixelEffectDraw): void {
	restoreLooksSource(options);
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 5_000);
	options.ctx.save();
	options.ctx.globalAlpha = 0.84;
	for (let band = 0; band < 10; band += 1) {
		const height = Math.max(
			2,
			options.height *
				(0.008 + unitRandom({ seed, salt: 33_100 + band }) * 0.05),
		);
		const y = Math.min(
			options.height - height,
			options.height *
				(0.12 + unitRandom({ seed, salt: 33_200 + band + step }) * 0.76),
		);
		const sourceX =
			options.width * (0.2 + unitRandom({ seed, salt: 33_300 + band }) * 0.6);
		const direction = signedRandom({ seed, salt: 33_400 + band + step });
		const length =
			options.width *
			(0.08 + unitRandom({ seed, salt: 33_500 + band }) * 0.32) *
			pulse;
		options.ctx.drawImage(
			options.source,
			sourceX,
			y,
			2,
			height,
			sourceX + direction * length,
			y,
			Math.max(2, length),
			height,
		);
	}
	options.ctx.restore();
}

function drawVhsRoll(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const offset = Math.round(options.height * 0.2 * pulse);
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	options.ctx.drawImage(
		options.source,
		0,
		offset,
		options.width,
		options.height,
	);
	options.ctx.drawImage(
		options.source,
		0,
		offset - options.height,
		options.width,
		options.height,
	);
	options.ctx.fillStyle = "rgba(255,255,255,0.55)";
	options.ctx.fillRect(
		0,
		offset - Math.max(2, options.height * 0.006),
		options.width,
		Math.max(1, options.height * 0.0025),
	);
	options.ctx.restore();
}

function drawTrackingNoise(options: LooksPixelEffectDraw): void {
	restoreLooksSource(options);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 4_000);
	const pulse = looksEffectPulse(options);
	options.ctx.save();
	for (let band = 0; band < 8; band += 1) {
		const height = Math.max(
			2,
			options.height *
				(0.004 + unitRandom({ seed, salt: 34_100 + band }) * 0.022),
		);
		const y = Math.min(
			options.height - height,
			unitRandom({ seed, salt: 34_200 + band + step }) * options.height,
		);
		const offset =
			signedRandom({ seed, salt: 34_300 + band + step }) *
			options.width *
			0.045 *
			pulse;
		options.ctx.drawImage(
			options.source,
			0,
			y,
			options.width,
			height,
			offset,
			y,
			options.width,
			height,
		);
		options.ctx.fillStyle =
			band % 3 === 0 ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
		options.ctx.fillRect(
			Math.abs(offset),
			y,
			options.width * (0.08 + band * 0.025),
			Math.max(1, height * 0.14),
		);
	}
	options.ctx.restore();
}

function drawMirrorFlash(options: LooksPixelEffectDraw): void {
	const seed = options.frame.cut?.seed ?? 0;
	const seedMode = Math.floor(unitRandom({ seed, salt: 34_901 }) * 4);
	const phaseMode = Math.floor(looksEffectProgress(options) * 4);
	const mode = (seedMode + phaseMode) % 4;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	if (mode === 0) {
		options.ctx.drawImage(
			options.source,
			0,
			0,
			options.width / 2,
			options.height,
			0,
			0,
			options.width / 2,
			options.height,
		);
		options.ctx.setTransform(-1, 0, 0, 1, options.width, 0);
		options.ctx.drawImage(
			options.source,
			0,
			0,
			options.width / 2,
			options.height,
			0,
			0,
			options.width / 2,
			options.height,
		);
	} else if (mode === 1) {
		options.ctx.drawImage(
			options.source,
			0,
			0,
			options.width,
			options.height / 2,
			0,
			0,
			options.width,
			options.height / 2,
		);
		options.ctx.setTransform(1, 0, 0, -1, 0, options.height);
		options.ctx.drawImage(
			options.source,
			0,
			0,
			options.width,
			options.height / 2,
			0,
			0,
			options.width,
			options.height / 2,
		);
	} else if (mode === 2) {
		options.ctx.translate(options.width, 0);
		options.ctx.scale(-1, 1);
		options.ctx.drawImage(options.source, 0, 0, options.width, options.height);
	} else {
		options.ctx.translate(0, options.height);
		options.ctx.scale(1, -1);
		options.ctx.drawImage(options.source, 0, 0, options.width, options.height);
	}
	options.ctx.restore();
}

function drawFiltered({
	mode,
	options,
}: {
	readonly mode: "hue" | "posterize";
	readonly options: LooksPixelEffectDraw;
}): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	options.ctx.filter =
		mode === "posterize"
			? `contrast(${(1 + pulse * 1.8).toFixed(2)}) saturate(${(1 + pulse * 2.5).toFixed(2)})`
			: `hue-rotate(${Math.round(80 + unitRandom({ seed, salt: 35_001 }) * 220 * pulse)}deg) saturate(${(1.1 + pulse * 0.8).toFixed(2)})`;
	options.ctx.drawImage(options.source, 0, 0, options.width, options.height);
	if (mode === "posterize") {
		options.ctx.filter = "none";
		options.ctx.globalCompositeOperation = "source-atop";
		options.ctx.globalAlpha = 0.08 + pulse * 0.18;
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(0, 0, options.width, options.height);
	}
	options.ctx.restore();
}

function drawTileShift(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 6_000);
	const columns = 4;
	const rows = 3;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x = Math.round((column * options.width) / columns);
			const y = Math.round((row * options.height) / rows);
			const nextX = Math.round(((column + 1) * options.width) / columns);
			const nextY = Math.round(((row + 1) * options.height) / rows);
			const width = nextX - x;
			const height = nextY - y;
			const deltaX =
				signedRandom({ seed, salt: 35_100 + row * 17 + column + step }) *
				width *
				0.18 *
				pulse;
			const deltaY =
				signedRandom({ seed, salt: 35_300 + row * 17 + column + step }) *
				height *
				0.14 *
				pulse;
			options.ctx.drawImage(
				options.source,
				x,
				y,
				width,
				height,
				x + deltaX,
				y + deltaY,
				width,
				height,
			);
		}
	}
	options.ctx.restore();
}
