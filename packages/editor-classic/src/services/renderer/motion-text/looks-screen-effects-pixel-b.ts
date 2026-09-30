import { signedRandom, unitRandom } from "./deterministic-random";
import {
	looksEffectProgress,
	looksEffectPulse,
	restoreLooksSource,
	type LooksPixelEffectDraw,
} from "./looks-screen-effect-types";

export function drawLooksPixelEffectB(options: LooksPixelEffectDraw): boolean {
	switch (options.effect) {
		case "whipBlur":
			drawWhipBlur(options);
			return true;
		case "gridRepeat":
			drawGridRepeat(options);
			return true;
		case "waveWarp":
			drawWaveWarp(options);
			return true;
		case "pixelDrift":
			drawPixelDrift(options);
			return true;
		case "zoomPunch":
			drawZoomPunch(options);
			return true;
		case "crtOff":
			drawCrtOff(options);
			return true;
		case "splitSlide":
			drawSplitSlide(options);
			return true;
		default:
			return false;
	}
}

function drawWhipBlur(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const vertical = unitRandom({ seed, salt: 36_001 }) < 0.25;
	const distance = options.width * 0.05 * pulse;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	for (let copy = 0; copy < 9; copy += 1) {
		const offset = (copy / 8 - 0.5) * distance;
		options.ctx.globalAlpha = 0.16 + copy * 0.015;
		options.ctx.drawImage(
			options.source,
			vertical ? 0 : offset,
			vertical ? offset : 0,
			options.width,
			options.height,
		);
	}
	options.ctx.restore();
}

function drawGridRepeat(options: LooksPixelEffectDraw): void {
	const count = looksEffectProgress(options) < 0.35 ? 2 : 3;
	const tileWidth = options.width / count;
	const tileHeight = options.height / count;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	for (let row = 0; row < count; row += 1) {
		for (let column = 0; column < count; column += 1) {
			options.ctx.drawImage(
				options.source,
				0,
				0,
				options.width,
				options.height,
				column * tileWidth,
				row * tileHeight,
				tileWidth,
				tileHeight,
			);
		}
	}
	options.ctx.restore();
}

function drawWaveWarp(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const amplitude = options.width * 0.034 * pulse;
	const bands = 48;
	const height = options.height / bands;
	const frequency = 2 + unitRandom({ seed, salt: 36_101 }) * 2;
	const phase = looksEffectProgress(options) * 8;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	for (let band = 0; band < bands; band += 1) {
		const y = Math.floor(band * height);
		const bandHeight = Math.min(options.height - y, Math.ceil(height) + 1);
		const offset =
			Math.sin((band / bands) * Math.PI * 2 * frequency + phase) * amplitude;
		options.ctx.drawImage(
			options.source,
			0,
			y,
			options.width,
			bandHeight,
			offset,
			y,
			options.width,
			bandHeight,
		);
	}
	options.ctx.restore();
}

function drawPixelDrift(options: LooksPixelEffectDraw): void {
	restoreLooksSource(options);
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(options.frame.localTime / 4_000);
	options.ctx.save();
	for (let index = 0; index < 22; index += 1) {
		const height = Math.max(
			1,
			options.height *
				(0.003 + unitRandom({ seed, salt: 36_500 + index }) * 0.018),
		);
		const y = Math.min(
			options.height - height,
			options.height *
				(0.16 + unitRandom({ seed, salt: 36_600 + index + step }) * 0.68),
		);
		const width =
			options.width *
			(0.05 + unitRandom({ seed, salt: 36_700 + index }) * 0.25);
		const x =
			unitRandom({ seed, salt: 36_800 + index }) * (options.width - width);
		const delta =
			signedRandom({ seed, salt: 36_900 + index + step }) *
			options.width *
			0.075 *
			pulse;
		options.ctx.drawImage(
			options.source,
			x,
			y,
			width,
			height,
			x + delta,
			y,
			width,
			height,
		);
	}
	options.ctx.restore();
}

function drawZoomPunch(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const zoom = 1 + (0.06 + unitRandom({ seed, salt: 37_001 }) * 0.04) * pulse;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	options.ctx.drawImage(
		options.source,
		options.width / 2 - (options.width * zoom) / 2,
		options.height / 2 - (options.height * zoom) / 2,
		options.width * zoom,
		options.height * zoom,
	);
	options.ctx.restore();
}

function drawCrtOff(options: LooksPixelEffectDraw): void {
	const progress = looksEffectProgress(options);
	const close = progress < 0.5 ? progress / 0.5 : 1 - (progress - 0.5) / 0.5;
	const scaleY = Math.max(0.012, 1 - close ** 2.4);
	const scaleX =
		close > 0.82 ? Math.max(0.04, 1 - ((close - 0.82) / 0.18) ** 2 * 0.96) : 1;
	const width = options.width * scaleX;
	const height = Math.max(1, options.height * scaleY);
	const x = options.width / 2 - width / 2;
	const y = options.height / 2 - height / 2;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	if (options.compositionMode === "scene") {
		options.ctx.fillStyle = "#000000";
		options.ctx.fillRect(0, 0, options.width, options.height);
	}
	options.ctx.drawImage(options.source, x, y, width, height);
	options.ctx.globalCompositeOperation = "screen";
	options.ctx.globalAlpha = close * 0.75;
	options.ctx.fillStyle = "#ffffff";
	options.ctx.fillRect(x, y, width, height);
	options.ctx.restore();
}

function drawSplitSlide(options: LooksPixelEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const vertical = unitRandom({ seed, salt: 37_501 }) < 0.3;
	const split = 0.5 + signedRandom({ seed, salt: 37_502 }) * 0.08;
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	if (!vertical) {
		const y = Math.round(options.height * split);
		const distance = options.width * 0.09 * pulse;
		options.ctx.drawImage(
			options.source,
			0,
			0,
			options.width,
			y,
			-distance,
			0,
			options.width,
			y,
		);
		options.ctx.drawImage(
			options.source,
			0,
			y,
			options.width,
			options.height - y,
			distance,
			y,
			options.width,
			options.height - y,
		);
	} else {
		const x = Math.round(options.width * split);
		const distance = options.height * 0.1 * pulse;
		options.ctx.drawImage(
			options.source,
			0,
			0,
			x,
			options.height,
			0,
			-distance,
			x,
			options.height,
		);
		options.ctx.drawImage(
			options.source,
			x,
			0,
			options.width - x,
			options.height,
			x,
			distance,
			options.width - x,
			options.height,
		);
	}
	options.ctx.restore();
}
