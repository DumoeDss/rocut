import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundRing,
	drawBackgroundSegment,
	fillBackgroundRect,
	fillRotatedRect,
	phaseOffset,
	randomUnit,
} from "./bgcam-background-utils";

export function drawBgcamGradientBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "auroraRibbons":
			drawAuroraRibbons(options);
			return true;
		case "meshBlobs":
			drawMeshBlobs(options);
			return true;
		case "duotoneSweep":
			drawDuotoneSweep(options);
			return true;
		case "horizonGlow":
			drawHorizonGlow(options);
			return true;
		default:
			return false;
	}
}

function drawAuroraRibbons(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const unit = backgroundUnit(options);
	for (let ribbon = 0; ribbon < 3; ribbon += 1) {
		const color =
			ribbon % 2 === 0
				? options.frame.palette.accent
				: options.frame.palette.secondary;
		const phase = phaseOffset({ frame: options.frame, salt: 40_100 + ribbon });
		for (let column = 0; column < 34; column += 1) {
			const progress = column / 33;
			const x = progress * options.width;
			const wave =
				Math.sin(
					progress * Math.PI * 1.6 + seconds * (0.36 + ribbon * 0.05) + phase,
				) *
				unit *
				0.09;
			const top = options.height * (0.2 + ribbon * 0.11) + wave;
			const height =
				unit *
				(0.25 +
					randomUnit({
						frame: options.frame,
						salt: 40_200 + ribbon * 50 + column,
					}) *
						0.22);
			fillBackgroundRect({
				alpha: fade * (0.018 + 0.035 * Math.sin(Math.PI * progress)),
				color,
				height,
				options,
				width: options.width / 31,
				x: x - options.width / 62,
				y: top - height,
			});
		}
	}
}

function drawMeshBlobs(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const unit = backgroundUnit(options);
	for (let blob = 0; blob < 4; blob += 1) {
		const phase = phaseOffset({ frame: options.frame, salt: 41_000 + blob });
		const x =
			options.width *
			(0.5 + 0.38 * Math.sin(seconds * (0.13 + blob * 0.025) + phase));
		const y =
			options.height *
			(0.5 + 0.34 * Math.cos(seconds * (0.11 + blob * 0.02) + phase));
		const color =
			blob % 2 === 0
				? options.frame.palette.accent
				: options.frame.palette.secondary;
		for (let layer = 5; layer >= 1; layer -= 1) {
			const radius = unit * (0.08 + layer * 0.055);
			fillBackgroundRect({
				alpha: fade * (0.012 + (6 - layer) * 0.007),
				color,
				height: radius * 1.35,
				options,
				width: radius * 1.8,
				x: x - radius * 0.9,
				y: y - radius * 0.675,
			});
		}
	}
}

function drawDuotoneSweep(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const diagonal = Math.hypot(options.width, options.height);
	const phase = phaseOffset({ frame: options.frame, salt: 42_001 });
	for (let band = -3; band <= 3; band += 1) {
		const color =
			band % 2 === 0
				? options.frame.palette.accent
				: options.frame.palette.secondary;
		const center =
			options.width * 0.5 +
			Math.sin(seconds * 0.18 + phase + band * 0.45) * options.width * 0.22;
		fillRotatedRect({
			alpha: fade * (0.035 + (3 - Math.abs(band)) * 0.008),
			color,
			height: diagonal * 1.4,
			options,
			rotation: 0.48 + seconds * 0.035,
			width: diagonal * 0.18,
			x: center + band * diagonal * 0.13,
			y: options.height / 2,
		});
	}
}

function drawHorizonGlow(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const unit = backgroundUnit(options);
	const centerX =
		options.width *
			(0.42 + randomUnit({ frame: options.frame, salt: 43_001 }) * 0.16) +
		Math.sin(seconds * 0.08) * unit * 0.03;
	const radius = Math.max(options.width, options.height) * 0.86;
	const centerY = options.height * 0.82 + radius;
	for (let layer = 0; layer < 5; layer += 1) {
		drawBackgroundRing({
			alpha: fade * (0.16 - layer * 0.024),
			centerX,
			centerY,
			color:
				layer % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			options,
			radiusX: radius + layer * unit * 0.025,
			radiusY: radius * 0.72 + layer * unit * 0.02,
			segments: 32,
			thickness: Math.max(1, unit * (0.008 - layer * 0.0008)),
		});
	}
	const flareX = centerX + Math.sin(seconds * 0.12) * unit * 0.18;
	for (let ray = 0; ray < 7; ray += 1) {
		const angle = (ray / 7) * Math.PI * 2;
		drawBackgroundSegment({
			alpha: fade * 0.12,
			color: options.frame.palette.foreground,
			options,
			thickness: Math.max(1, unit * 0.004),
			x0: flareX,
			y0: options.height * 0.12,
			x1: flareX + Math.cos(angle) * unit * 0.16,
			y1: options.height * 0.12 + Math.sin(angle) * unit * 0.16,
		});
	}
}
