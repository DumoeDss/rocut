import { unitRandom } from "./deterministic-random";
import {
	fillLooksEffectRect,
	looksEffectProgress,
	looksEffectPulse,
	type LooksScreenEffectDraw,
} from "./looks-screen-effect-types";

export function drawLooksOverlayEffect(
	options: LooksScreenEffectDraw,
): boolean {
	switch (options.effect) {
		case "panelWipe":
			drawPanelWipe(options);
			return true;
		case "irisTrans":
			drawIris(options);
			return true;
		case "doors":
			drawDoors(options);
			return true;
		case "blindsTrans":
			drawBlinds(options);
			return true;
		case "strobe":
			drawStrobe(options);
			return true;
		case "filmBurn":
			drawFilmBurn(options);
			return true;
		case "blackFrame":
			drawFrame({ color: "#000000", options });
			return true;
		case "whiteFrame":
			drawFrame({ color: "#ffffff", options });
			return true;
		case "lightSweep":
			drawLightSweep(options);
			return true;
		default:
			return false;
	}
}

function drawPanelWipe(options: LooksScreenEffectDraw): void {
	const progress = looksEffectProgress(options);
	const direction =
		unitRandom({ seed: options.frame.cut?.seed ?? 0, salt: 31_001 }) > 0.5
			? 1
			: -1;
	const center =
		direction > 0 ? progress * options.width : (1 - progress) * options.width;
	options.ctx.save();
	options.ctx.translate(center, options.height / 2);
	options.ctx.rotate(direction * -0.18);
	fillLooksEffectRect({
		alpha: 0.82,
		color: options.frame.palette.accent,
		height: options.height * 1.5,
		options,
		width: options.width * 0.22,
		x: -options.width * 0.11,
		y: -options.height * 0.75,
	});
	fillLooksEffectRect({
		alpha: 0.55,
		color: options.frame.palette.secondary,
		height: options.height * 1.5,
		options,
		width: options.width * 0.045,
		x: direction * options.width * 0.12,
		y: -options.height * 0.75,
	});
	options.ctx.restore();
}

function drawIris(options: LooksScreenEffectDraw): void {
	const cover = looksEffectPulse(options);
	const insetX = options.width * (1 - cover) * 0.46;
	const insetY = options.height * (1 - cover) * 0.42;
	const color = options.frame.palette.foreground;
	fillLooksEffectRect({
		alpha: 0.9,
		color,
		height: insetY,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
	fillLooksEffectRect({
		alpha: 0.9,
		color,
		height: insetY,
		options,
		width: options.width,
		x: 0,
		y: options.height - insetY,
	});
	fillLooksEffectRect({
		alpha: 0.9,
		color,
		height: options.height - insetY * 2,
		options,
		width: insetX,
		x: 0,
		y: insetY,
	});
	fillLooksEffectRect({
		alpha: 0.9,
		color,
		height: options.height - insetY * 2,
		options,
		width: insetX,
		x: options.width - insetX,
		y: insetY,
	});
}

function drawDoors(options: LooksScreenEffectDraw): void {
	const cover = looksEffectPulse(options);
	const width = options.width * 0.5 * cover;
	const color = options.frame.palette.foreground;
	fillLooksEffectRect({
		alpha: 0.88,
		color,
		height: options.height,
		options,
		width,
		x: 0,
		y: 0,
	});
	fillLooksEffectRect({
		alpha: 0.88,
		color,
		height: options.height,
		options,
		width,
		x: options.width - width,
		y: 0,
	});
	fillLooksEffectRect({
		alpha: 0.95,
		color: options.frame.palette.accent,
		height: options.height,
		options,
		width: Math.max(2, options.width * 0.008),
		x: width,
		y: 0,
	});
	fillLooksEffectRect({
		alpha: 0.95,
		color: options.frame.palette.accent,
		height: options.height,
		options,
		width: Math.max(2, options.width * 0.008),
		x: options.width - width,
		y: 0,
	});
}

function drawBlinds(options: LooksScreenEffectDraw): void {
	const cover = looksEffectPulse(options);
	const slats = 10;
	const height = options.height / slats;
	for (let index = 0; index < slats; index += 1) {
		const local = Math.min(1, Math.max(0, cover * 1.3 - index * 0.03));
		fillLooksEffectRect({
			alpha: 0.82,
			color:
				index % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			height: height * local,
			options,
			width: options.width,
			x: 0,
			y: index * height,
		});
	}
}

function drawStrobe(options: LooksScreenEffectDraw): void {
	const progress = looksEffectProgress(options);
	const beat = (progress * 8) % 1;
	fillLooksEffectRect({
		alpha: 0.18 + (1 - beat) * 0.55,
		color: "#ffffff",
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
}

function drawFilmBurn(options: LooksScreenEffectDraw): void {
	const pulse = looksEffectPulse(options);
	const seed = options.frame.cut?.seed ?? 0;
	const direction = unitRandom({ seed, salt: 32_001 }) > 0.5 ? 1 : -1;
	options.ctx.save();
	options.ctx.translate(
		direction > 0 ? 0 : options.width,
		options.height * 0.42,
	);
	options.ctx.rotate(direction * 0.32);
	for (let band = 0; band < 7; band += 1) {
		fillLooksEffectRect({
			alpha: pulse * (0.08 + band * 0.055),
			color: band < 2 ? "#fff1c2" : band < 5 ? "#ff8a28" : "#ef3518",
			height: options.height * 1.6,
			options,
			width: options.width * (0.035 + band * 0.035),
			x: direction * options.width * band * 0.038,
			y: -options.height * 0.8,
		});
	}
	options.ctx.restore();
}

function drawFrame({
	color,
	options,
}: {
	readonly color: string;
	readonly options: LooksScreenEffectDraw;
}): void {
	const progress = looksEffectProgress(options);
	if (progress > 0.52) return;
	fillLooksEffectRect({
		alpha: 0.94 * (1 - progress / 0.52),
		color,
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
}

function drawLightSweep(options: LooksScreenEffectDraw): void {
	const progress = looksEffectProgress(options);
	const center = -options.width * 0.2 + progress * options.width * 1.4;
	options.ctx.save();
	options.ctx.translate(center, options.height / 2);
	options.ctx.rotate(0.38);
	for (let band = 0; band < 3; band += 1) {
		fillLooksEffectRect({
			alpha: looksEffectPulse(options) * (0.15 + band * 0.12),
			color: band === 1 ? "#ffffff" : options.frame.palette.accent,
			height: options.height * 1.8,
			options,
			width: options.width * (0.018 + band * 0.035),
			x: (band - 1) * options.width * 0.07,
			y: -options.height * 0.9,
		});
	}
	options.ctx.restore();
}
