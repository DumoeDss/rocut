import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundSegment,
	fillBackgroundRect,
	phaseOffset,
	randomSigned,
	randomUnit,
	smoothPulse,
	wrap,
} from "./bgcam-background-utils";

export function drawBgcamFilmLightBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "filmStrip":
			drawFilmStrip(options);
			return true;
		case "vhsBand":
			drawVhsBand(options);
			return true;
		case "godRays":
			drawGodRays(options);
			return true;
		case "vignettePulse":
			drawVignettePulse(options);
			return true;
		default:
			return false;
	}
}

function drawFilmStrip(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const vertical = options.height > options.width;
	const band = unit * 0.085;
	const length = vertical ? options.height : options.width;
	const period = band * 0.62;
	const direction =
		randomUnit({ frame: options.frame, salt: 80_001 }) > 0.5 ? 1 : -1;
	const offset = wrap({
		value: seconds * period * 0.9 * direction,
		modulus: period,
	});
	for (let side = 0; side < 2; side += 1) {
		const cross =
			side === 0 ? 0 : (vertical ? options.width : options.height) - band;
		fillBackgroundRect({
			alpha: fade * 0.075,
			color: options.frame.palette.foreground,
			height: vertical ? length : band,
			options,
			width: vertical ? band : length,
			x: vertical ? cross : 0,
			y: vertical ? 0 : cross,
		});
		for (
			let position = offset - period;
			position < length + period;
			position += period
		) {
			fillBackgroundRect({
				alpha: fade * 0.22,
				color: options.frame.palette.secondary,
				height: vertical ? period * 0.46 : band * 0.38,
				options,
				width: vertical ? band * 0.38 : period * 0.46,
				x: vertical ? cross + band * 0.3 : position + period * 0.27,
				y: vertical ? position + period * 0.27 : cross + band * 0.3,
			});
		}
	}
	const step = Math.floor(seconds * 24);
	for (let scratch = 0; scratch < 4; scratch += 1) {
		if (
			randomUnit({ frame: options.frame, salt: 80_100 + step * 9 + scratch }) >
			0.62
		)
			continue;
		const position =
			randomUnit({
				frame: options.frame,
				salt: 80_300 + Math.floor(step / 4) * 7 + scratch,
			}) * (vertical ? options.height : options.width);
		fillBackgroundRect({
			alpha:
				fade *
				(0.08 +
					randomUnit({ frame: options.frame, salt: 80_500 + step + scratch }) *
						0.12),
			color: options.frame.palette.foreground,
			height: vertical ? Math.max(1, unit * 0.0012) : options.height,
			options,
			width: vertical ? options.width : Math.max(1, unit * 0.0012),
			x: vertical ? 0 : position,
			y: vertical ? position : 0,
		});
	}
}

function drawVhsBand(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const step = Math.floor(seconds * 24);
	const bandHeight = options.height * 0.1;
	const bandY =
		wrap({
			value:
				seconds * options.height * 0.13 +
				randomUnit({ frame: options.frame, salt: 81_001 }) * options.height,
			modulus: options.height * 1.3,
		}) -
		options.height * 0.15;
	for (let row = 0; row < 28; row += 1) {
		const y = bandY + (bandHeight * row) / 28;
		const noise = randomUnit({
			frame: options.frame,
			salt: 81_100 + (step % 3) * 100 + row,
		});
		const x =
			randomSigned({ frame: options.frame, salt: 81_500 + step * 37 + row }) *
			unit *
			0.015;
		fillBackgroundRect({
			alpha: fade * (0.02 + noise ** 3 * 0.16),
			color:
				row % 4 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			height: Math.max(1, bandHeight / 28 + 0.4),
			options,
			width: options.width * (0.65 + noise * 0.35),
			x,
			y,
		});
	}
	for (let line = 0; line < 3; line += 1) {
		const y =
			bandY +
			bandHeight *
				randomUnit({
					frame: options.frame,
					salt: 82_100 + Math.floor(step / 2) * 5 + line,
				});
		const x =
			randomUnit({ frame: options.frame, salt: 82_300 + step * 7 + line }) *
			options.width *
			0.55;
		fillBackgroundRect({
			alpha: fade * 0.24,
			color: options.frame.palette.secondary,
			height: Math.max(1, unit * 0.0017),
			options,
			width:
				options.width *
				(0.22 +
					randomUnit({ frame: options.frame, salt: 82_500 + line }) * 0.45),
			x,
			y,
		});
	}
	const headBand = options.height * 0.028;
	for (let row = 0; row < 4; row += 1) {
		fillBackgroundRect({
			alpha: fade * (0.08 + row * 0.018),
			color:
				row % 2 === 0
					? options.frame.palette.foreground
					: options.frame.palette.accent,
			height: headBand / 4 + 0.5,
			options,
			width: options.width,
			x:
				randomSigned({ frame: options.frame, salt: 82_700 + step * 11 + row }) *
				unit *
				0.03,
			y: options.height - headBand + (headBand * row) / 4,
		});
	}
}

function drawGodRays(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const sourceX =
		options.width *
			(0.15 + randomUnit({ frame: options.frame, salt: 83_001 }) * 0.7) +
		Math.sin(seconds * 0.1) * options.width * 0.03;
	const sourceY = -options.height * 0.1;
	const targetAngle = Math.atan2(
		options.height * 0.58 - sourceY,
		options.width * 0.5 - sourceX,
	);
	for (let ray = 0; ray < 9; ray += 1) {
		const spread = ((ray / 8 - 0.5) * 62 * Math.PI) / 180;
		const jitter =
			randomSigned({ frame: options.frame, salt: 83_100 + ray }) * 0.06 +
			Math.sin(seconds * 0.22 + ray * 1.3) * 0.03;
		const angle = targetAngle + spread + jitter;
		const length = Math.hypot(options.width, options.height) * 1.2;
		const flicker =
			0.55 +
			Math.sin(
				seconds * 1.7 +
					phaseOffset({ frame: options.frame, salt: 83_300 + ray }),
			) *
				0.35;
		drawBackgroundSegment({
			alpha: fade * (0.025 + flicker * 0.035),
			color:
				ray % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			options,
			thickness:
				unit *
				(0.015 +
					randomUnit({ frame: options.frame, salt: 83_500 + ray }) * 0.025),
			x0: sourceX,
			x1: sourceX + Math.cos(angle) * length,
			y0: sourceY,
			y1: sourceY + Math.sin(angle) * length,
		});
	}
	for (let mote = 0; mote < 24; mote += 1) {
		const x = wrap({
			value:
				randomUnit({ frame: options.frame, salt: 84_100 + mote }) *
					options.width +
				seconds *
					unit *
					randomSigned({ frame: options.frame, salt: 84_300 + mote }) *
					0.02,
			modulus: options.width,
		});
		const y = wrap({
			value:
				randomUnit({ frame: options.frame, salt: 84_500 + mote }) *
					options.height -
				seconds *
					unit *
					(0.005 +
						randomUnit({ frame: options.frame, salt: 84_700 + mote }) * 0.015),
			modulus: options.height,
		});
		const size =
			unit *
			(0.0012 +
				randomUnit({ frame: options.frame, salt: 84_900 + mote }) * 0.0018);
		fillBackgroundRect({
			alpha:
				fade * (0.05 + 0.12 * (0.5 + Math.sin(seconds * 1.4 + mote) * 0.5)),
			color: options.frame.palette.foreground,
			height: size * 2,
			options,
			width: size * 2,
			x,
			y,
		});
	}
}

function drawVignettePulse(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const pulse = smoothPulse({ frame: options.frame, rate: 0.45, salt: 85_001 });
	const strength = fade * (0.035 + pulse * 0.06);
	const layers = 7;
	for (let layer = 0; layer < layers; layer += 1) {
		const inset = unit * layer * 0.018;
		const thickness = unit * (0.04 - layer * 0.0035);
		const alpha = strength * (1 - layer / (layers + 1));
		const color =
			layer % 2 === 0
				? options.frame.palette.accent
				: options.frame.palette.secondary;
		fillBackgroundRect({
			alpha,
			color,
			height: thickness,
			options,
			width: options.width - inset * 2,
			x: inset,
			y: inset,
		});
		fillBackgroundRect({
			alpha,
			color,
			height: thickness,
			options,
			width: options.width - inset * 2,
			x: inset,
			y: options.height - inset - thickness,
		});
		fillBackgroundRect({
			alpha,
			color,
			height: options.height - inset * 2,
			options,
			width: thickness,
			x: inset,
			y: inset,
		});
		fillBackgroundRect({
			alpha,
			color,
			height: options.height - inset * 2,
			options,
			width: thickness,
			x: options.width - inset - thickness,
			y: inset,
		});
	}
}
