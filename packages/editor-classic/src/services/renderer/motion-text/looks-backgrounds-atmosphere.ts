import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	drawBackgroundRing,
	drawBackgroundSegment,
	fillBackgroundRect,
	fillRotatedRect,
	phaseOffset,
	randomSigned,
	randomUnit,
	wrap,
	type BgcamBackgroundDraw,
} from "./bgcam-background-utils";

export function drawLooksAtmosphereBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "gradientSweep":
			drawGradientSweep(options);
			return true;
		case "spotlight":
			drawSpotlight(options);
			return true;
		case "tvBars":
			drawTvBars(options);
			return true;
		case "bigChar":
			drawBigChar(options);
			return true;
		case "scanBars":
			drawScanBars(options);
			return true;
		case "retroGrid":
			drawRetroGrid(options);
			return true;
		case "bokehBg":
			drawBokeh(options);
			return true;
		case "particlesBg":
			drawParticles(options);
			return true;
		case "ripples":
			drawRipples(options);
			return true;
		case "eqBars":
			drawEqualizer(options);
			return true;
		case "letterbox":
			drawLetterbox(options);
			return true;
		case "noiseField":
			drawNoiseField(options);
			return true;
		default:
			return false;
	}
}

function drawGradientSweep(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const phase = phaseOffset({ frame: options.frame, salt: 25_001 });
	const position = 0.5 + Math.sin(seconds * 0.45 + phase) * 0.32;
	for (let band = 0; band < 3; band += 1) {
		fillRotatedRect({
			alpha: 0.08 + band * 0.035,
			color:
				band === 1
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			height: unit * (0.08 + band * 0.06),
			options,
			rotation: 0.35 + band * 0.08,
			width: Math.hypot(options.width, options.height) * 0.82,
			x: options.width * position + (band - 1) * unit * 0.07,
			y: options.height / 2,
		});
	}
}

function drawSpotlight(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const centerX = options.width * (0.5 + Math.sin(seconds * 0.31) * 0.2);
	const centerY = options.height * (0.52 + Math.sin(seconds * 0.23) * 0.08);
	for (let ring = 5; ring >= 1; ring -= 1) {
		drawBackgroundRing({
			alpha: 0.035 + (6 - ring) * 0.018,
			centerX,
			centerY,
			color: options.frame.palette.foreground,
			options,
			radiusX: unit * ring * 0.105,
			radiusY: unit * ring * 0.075,
			segments: 24,
			thickness: unit * 0.025,
		});
	}
	fillRotatedRect({
		alpha: 0.09,
		color: options.frame.palette.accent,
		height: unit * 0.16,
		options,
		rotation: Math.atan2(centerY, centerX - options.width / 2),
		width: Math.hypot(centerX - options.width / 2, centerY) * 1.2,
		x: (centerX + options.width / 2) / 2,
		y: centerY / 2,
	});
}

function drawTvBars(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	for (let index = 0; index < 6; index += 1) {
		const height =
			options.height *
			(0.025 +
				randomUnit({ frame: options.frame, salt: 25_100 + index }) * 0.1);
		const speed =
			options.height *
			(0.06 +
				randomUnit({ frame: options.frame, salt: 25_200 + index }) * 0.08);
		const y =
			wrap({
				modulus: options.height * 1.3,
				value:
					seconds * speed +
					randomUnit({ frame: options.frame, salt: 25_300 + index }) *
						options.height *
						1.3,
			}) -
			options.height * 0.15;
		fillBackgroundRect({
			alpha: 0.05 + (index % 3) * 0.035,
			color:
				index % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			height,
			options,
			width: options.width,
			x: 0,
			y,
		});
	}
}

function drawBigChar(options: BgcamBackgroundDraw): void {
	const text = Array.from(options.frame.cut?.text ?? "").find(
		(character) => character.trim().length > 0,
	);
	if (!text) return;
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const direction =
		randomUnit({ frame: options.frame, salt: 26_001 }) > 0.5 ? 1 : -1;
	options.ctx.save();
	options.ctx.globalAlpha *= 0.09 + backgroundFade(options.frame) * 0.05;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.font = `${options.frame.font.style} ${options.frame.font.weight} ${Math.max(options.width, options.height) * 0.62}px "${options.frame.font.family.replaceAll('"', '\\"')}"`;
	options.ctx.textAlign = "center";
	options.ctx.textBaseline = "middle";
	options.ctx.translate(
		options.width / 2 + direction * options.width * 0.2,
		options.height * 0.53,
	);
	options.ctx.rotate(direction * 0.07 + Math.sin(seconds * 0.25) * 0.01);
	options.ctx.fillText(text, 0, 0, unit * 1.4);
	options.ctx.restore();
}

function drawScanBars(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	for (let index = 0; index < 3; index += 1) {
		const height = options.height * (0.08 + index * 0.035);
		const y =
			wrap({
				modulus: options.height * 1.4,
				value:
					seconds * options.height * (0.08 + index * 0.02) +
					index * options.height * 0.42,
			}) - height;
		for (let band = 0; band < 5; band += 1) {
			fillBackgroundRect({
				alpha: 0.025 + band * 0.012,
				color: options.frame.palette.foreground,
				height: height / 5,
				options,
				width: options.width,
				x: 0,
				y: y + (height * band) / 5,
			});
		}
	}
}

function drawRetroGrid(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const horizon = options.height * 0.6;
	const color = options.frame.palette.accent;
	for (let line = -12; line <= 12; line += 1) {
		drawBackgroundSegment({
			alpha: 0.3,
			color,
			options,
			thickness: 1.5,
			x0: options.width / 2 + line * options.width * 0.012,
			x1: options.width / 2 + line * options.width * 0.12,
			y0: horizon,
			y1: options.height,
		});
	}
	const phase = wrap({ modulus: 1, value: seconds * 0.55 });
	for (let row = 1; row < 22; row += 1) {
		const depth = row - phase;
		if (depth <= 0.15) continue;
		const y = horizon + ((options.height - horizon) * 0.92) / depth;
		if (y >= options.height) continue;
		drawBackgroundSegment({
			alpha: 0.28,
			color,
			options,
			thickness: 1.4,
			x0: 0,
			x1: options.width,
			y0: y,
			y1: y,
		});
	}
}

function drawBokeh(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	for (let index = 0; index < 18; index += 1) {
		const radius =
			unit *
			(0.025 +
				randomUnit({ frame: options.frame, salt: 27_100 + index }) * 0.08);
		const x =
			wrap({
				modulus: options.width + radius * 2,
				value:
					randomUnit({ frame: options.frame, salt: 27_200 + index }) *
						options.width +
					seconds *
						randomSigned({ frame: options.frame, salt: 27_300 + index }) *
						unit *
						0.02,
			}) - radius;
		const y =
			wrap({
				modulus: options.height + radius * 2,
				value:
					randomUnit({ frame: options.frame, salt: 27_400 + index }) *
						options.height -
					seconds * unit * (0.012 + index * 0.0007),
			}) - radius;
		drawBackgroundRing({
			alpha:
				0.08 +
				randomUnit({ frame: options.frame, salt: 27_500 + index }) * 0.12,
			centerX: x,
			centerY: y,
			color:
				index % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			options,
			radiusX: radius,
			segments: 16,
			thickness: Math.max(2, radius * 0.22),
		});
	}
}

function drawParticles(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	for (let index = 0; index < 72; index += 1) {
		const size =
			unit *
			(0.0025 +
				randomUnit({ frame: options.frame, salt: 28_100 + index }) * 0.006);
		const x =
			randomUnit({ frame: options.frame, salt: 28_200 + index }) *
				options.width +
			Math.sin(seconds * 0.7 + index) * unit * 0.016;
		const speed =
			options.height *
			(0.04 + randomUnit({ frame: options.frame, salt: 28_300 + index }) * 0.1);
		const y =
			options.height -
			wrap({
				modulus: options.height * 1.2,
				value:
					seconds * speed +
					randomUnit({ frame: options.frame, salt: 28_400 + index }) *
						options.height *
						1.2,
			});
		fillBackgroundRect({
			alpha:
				0.18 +
				randomUnit({ frame: options.frame, salt: 28_500 + index }) * 0.35,
			color:
				index % 5 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			height: size,
			options,
			width: size,
			x,
			y,
		});
	}
}

function drawRipples(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	for (let ripple = 0; ripple < 6; ripple += 1) {
		const age = wrap({ modulus: 1.9, value: seconds + ripple * 0.34 }) / 1.9;
		const centerX =
			options.width *
			(0.18 +
				randomUnit({ frame: options.frame, salt: 29_100 + ripple }) * 0.64);
		const centerY =
			options.height *
			(0.25 +
				randomUnit({ frame: options.frame, salt: 29_200 + ripple }) * 0.5);
		drawBackgroundRing({
			alpha: (1 - age) * 0.32,
			centerX,
			centerY,
			color: options.frame.palette.foreground,
			options,
			radiusX: unit * (0.04 + age * 0.72),
			radiusY: unit * (0.025 + age * 0.42),
			segments: 30,
			thickness: Math.max(1, unit * (0.006 * (1 - age) + 0.0015)),
		});
	}
}

function drawEqualizer(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const columns = 32;
	const width = options.width / columns;
	for (let column = 0; column < columns; column += 1) {
		const wave =
			0.5 +
			Math.sin(seconds * 4 + column * 0.58) * 0.25 +
			Math.sin(seconds * 1.7 + column) * 0.15;
		const height = options.height * 0.3 * Math.max(0.08, wave);
		const segments = Math.max(
			1,
			Math.floor(height / Math.max(4, width * 0.46)),
		);
		for (let segment = 0; segment < segments; segment += 1) {
			fillBackgroundRect({
				alpha: 0.11 + segment * 0.006,
				color:
					segment === segments - 1
						? options.frame.palette.accent
						: options.frame.palette.foreground,
				height: Math.max(2, width * 0.32),
				options,
				width: width * 0.62,
				x: column * width + width * 0.19,
				y: options.height - (segment + 1) * width * 0.46,
			});
		}
	}
}

function drawLetterbox(options: BgcamBackgroundDraw): void {
	const height = options.height * (0.06 + backgroundFade(options.frame) * 0.04);
	fillBackgroundRect({
		alpha: 0.72,
		color: options.frame.palette.foreground,
		height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
	fillBackgroundRect({
		alpha: 0.72,
		color: options.frame.palette.foreground,
		height,
		options,
		width: options.width,
		x: 0,
		y: options.height - height,
	});
	fillBackgroundRect({
		alpha: 0.75,
		color: options.frame.palette.accent,
		height: Math.max(1, height * 0.04),
		options,
		width: options.width,
		x: 0,
		y: height,
	});
}

function drawNoiseField(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const cell = unit / 18;
	const seconds = backgroundSeconds(options.frame);
	const step = Math.floor(seconds * 10);
	const columns = Math.ceil(options.width / cell);
	const rows = Math.ceil(options.height / cell);
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const value = randomUnit({
				frame: options.frame,
				salt: 30_000 + row * 101 + column * 7 + step,
			});
			if (value < 0.68) continue;
			fillBackgroundRect({
				alpha: 0.035 + value * 0.09,
				color:
					value > 0.94
						? options.frame.palette.accent
						: options.frame.palette.foreground,
				height: cell - 1,
				options,
				width: cell - 1,
				x: column * cell,
				y: row * cell,
			});
		}
	}
}
