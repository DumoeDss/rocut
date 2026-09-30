import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundRing,
	drawBackgroundSegment,
	fillBackgroundRect,
	phaseOffset,
	randomSigned,
	randomUnit,
	wrap,
} from "./bgcam-background-utils";

export function drawBgcamAtmosphereBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "starfield":
			drawStarfield(options);
			return true;
		case "nightMoon":
			drawNightMoon(options);
			return true;
		case "sunsetSun":
			drawSunsetSun(options);
			return true;
		case "snowLayers":
			drawSnowLayers(options);
			return true;
		case "fireworks":
			drawFireworks(options);
			return true;
		case "cloudLayers":
			drawCloudLayers(options);
			return true;
		default:
			return false;
	}
}

function drawStarfield(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const direction = phaseOffset({ frame: options.frame, salt: 60_001 });
	const velocityX = Math.cos(direction) * unit * 0.012;
	const velocityY = Math.sin(direction) * unit * 0.012;
	const layers = [
		{ count: 56, radius: 0.0016, speed: 0.45, alpha: 0.34 },
		{ count: 32, radius: 0.0024, speed: 0.9, alpha: 0.48 },
		{ count: 14, radius: 0.0038, speed: 1.55, alpha: 0.68 },
	] as const;
	for (let layer = 0; layer < layers.length; layer += 1) {
		const settings = layers[layer]!;
		for (let star = 0; star < settings.count; star += 1) {
			const x =
				wrap({
					value:
						randomUnit({
							frame: options.frame,
							salt: 60_100 + layer * 200 + star,
						}) *
							options.width +
						seconds * velocityX * settings.speed,
					modulus: options.width,
				}) -
				unit * 0.01;
			const y =
				wrap({
					value:
						randomUnit({
							frame: options.frame,
							salt: 61_100 + layer * 200 + star,
						}) *
							options.height +
						seconds * velocityY * settings.speed,
					modulus: options.height,
				}) -
				unit * 0.01;
			const twinkle =
				0.45 +
				Math.sin(
					seconds *
						(3 +
							randomUnit({ frame: options.frame, salt: 62_100 + star }) * 5) +
						star,
				) *
					0.35;
			const radius =
				unit *
				settings.radius *
				(0.65 +
					randomUnit({
						frame: options.frame,
						salt: 63_100 + layer * 100 + star,
					}));
			fillBackgroundRect({
				alpha: fade * settings.alpha * twinkle,
				color: options.frame.palette.foreground,
				height: radius * 2,
				options,
				width: radius * 2,
				x,
				y,
			});
			if (layer !== 2 || star % 3 !== 0) continue;
			drawBackgroundSegment({
				alpha: fade * settings.alpha * twinkle * 0.35,
				color: options.frame.palette.foreground,
				options,
				thickness: Math.max(0.6, radius * 0.35),
				x0: x - radius * 3,
				x1: x + radius * 3,
				y0: y,
				y1: y,
			});
		}
	}
	const cycle = Math.floor(seconds / 2.8);
	const age = wrap({ value: seconds, modulus: 2.8 }) / 2.8;
	if (age > 0.68) return;
	const startX =
		options.width *
		(0.18 + randomUnit({ frame: options.frame, salt: 64_100 + cycle }) * 0.55);
	const startY =
		options.height *
		(0.06 + randomUnit({ frame: options.frame, salt: 64_300 + cycle }) * 0.28);
	const travel = unit * age * 0.9;
	const headX = startX + travel;
	const headY = startY + travel * 0.42;
	drawBackgroundSegment({
		alpha: fade * (1 - age) * 0.7,
		color: options.frame.palette.accent,
		options,
		thickness: Math.max(1, unit * 0.0025),
		x0: headX - unit * 0.16 * (1 - age),
		x1: headX,
		y0: headY - unit * 0.067 * (1 - age),
		y1: headY,
	});
}

function drawNightMoon(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const side =
		randomUnit({ frame: options.frame, salt: 65_001 }) > 0.5 ? 1 : -1;
	const radius =
		unit * (0.11 + randomUnit({ frame: options.frame, salt: 65_002 }) * 0.04);
	const centerX =
		options.width * (0.5 + side * (options.height > options.width ? 0.2 : 0.3));
	const centerY =
		options.height * (options.height > options.width ? 0.2 : 0.27);
	for (let star = 0; star < 22; star += 1) {
		const x =
			randomUnit({ frame: options.frame, salt: 65_100 + star }) * options.width;
		const y =
			randomUnit({ frame: options.frame, salt: 65_200 + star }) *
			options.height *
			0.62;
		if (Math.hypot(x - centerX, y - centerY) < radius * 2) continue;
		const size =
			unit *
			(0.0012 +
				randomUnit({ frame: options.frame, salt: 65_300 + star }) * 0.0015);
		fillBackgroundRect({
			alpha: fade * (0.16 + 0.3 * (0.5 + Math.sin(seconds * 2 + star) * 0.5)),
			color: options.frame.palette.foreground,
			height: size,
			options,
			width: size,
			x,
			y,
		});
	}
	for (let halo = 5; halo >= 1; halo -= 1) {
		drawBackgroundRing({
			alpha: fade * (0.018 + halo * 0.006),
			centerX,
			centerY,
			color: options.frame.palette.foreground,
			options,
			radiusX: radius * (1 + halo * 0.34 + Math.sin(seconds * 0.7) * 0.025),
			segments: 24,
			thickness: Math.max(1, unit * 0.003),
		});
	}
	drawBackgroundRing({
		alpha: fade * 0.65,
		centerX,
		centerY,
		color: options.frame.palette.foreground,
		options,
		radiusX: radius,
		segments: 30,
		thickness: Math.max(2, radius * 0.2),
	});
	const crescent = randomUnit({ frame: options.frame, salt: 65_003 }) < 0.66;
	if (crescent) {
		drawBackgroundRing({
			alpha: fade * 0.9,
			centerX: centerX + side * radius * 0.38,
			centerY: centerY - radius * 0.12,
			color: options.frame.palette.background,
			options,
			radiusX: radius * 0.78,
			segments: 30,
			thickness: Math.max(2, radius * 0.22),
		});
	}
	for (let cloud = 0; cloud < 3; cloud += 1) {
		const cloudWidth = unit * (0.34 + cloud * 0.08);
		const x =
			wrap({
				value:
					cloud * options.width * 0.43 +
					seconds * unit * (0.025 + cloud * 0.006),
				modulus: options.width + cloudWidth,
			}) - cloudWidth;
		const y = centerY + radius * (cloud - 1) * 0.75;
		drawBackgroundSegment({
			alpha: fade * 0.12,
			color: options.frame.palette.secondary,
			options,
			thickness: Math.max(2, unit * 0.018),
			x0: x,
			x1: x + cloudWidth,
			y0: y,
			y1: y + Math.sin(seconds + cloud) * unit * 0.004,
		});
	}
}

function drawSunsetSun(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const horizon =
		options.height *
		(0.7 + randomUnit({ frame: options.frame, salt: 66_001 }) * 0.06);
	const radius =
		unit * (0.12 + randomUnit({ frame: options.frame, salt: 66_002 }) * 0.04);
	const left = randomUnit({ frame: options.frame, salt: 66_003 }) > 0.5;
	const centerX = options.width * (left ? 0.28 : 0.72);
	const centerY = horizon - radius * 0.48 + unit * seconds * 0.004;
	for (let halo = 4; halo >= 1; halo -= 1) {
		drawBackgroundRing({
			alpha: fade * (0.018 + halo * 0.012),
			centerX,
			centerY,
			color: options.frame.palette.accent,
			options,
			radiusX: radius * (1 + halo * 0.42),
			segments: 24,
			thickness: Math.max(1, unit * 0.004),
		});
	}
	drawBackgroundRing({
		alpha: fade * 0.72,
		centerX,
		centerY,
		color: options.frame.palette.accent,
		options,
		radiusX: radius,
		segments: 30,
		thickness: Math.max(2, radius * 0.22),
	});
	drawBackgroundSegment({
		alpha: fade * 0.38,
		color: options.frame.palette.secondary,
		options,
		thickness: Math.max(1, unit * 0.002),
		x0: 0,
		x1: options.width,
		y0: horizon,
		y1: horizon,
	});
	for (let reflection = 0; reflection < 16; reflection += 1) {
		const progress = reflection / 16;
		const y = horizon + unit * 0.012 * (reflection + 1) ** 1.28;
		if (y > options.height) break;
		const wave =
			0.65 +
			Math.sin(
				seconds * 5 +
					reflection * 1.7 +
					phaseOffset({ frame: options.frame, salt: 66_100 + reflection }),
			) *
				0.3;
		const halfWidth = radius * (1.05 - progress * 0.55) * wave;
		drawBackgroundSegment({
			alpha: fade * (1 - progress) * 0.38,
			color: options.frame.palette.accent,
			options,
			thickness: Math.max(1, unit * 0.003),
			x0: centerX - halfWidth,
			x1: centerX + halfWidth,
			y0: y,
			y1: y,
		});
	}
}

function drawSnowLayers(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const wind = randomSigned({ frame: options.frame, salt: 67_001 }) * 0.34;
	const layers = [
		{ count: 48, size: 0.003, speed: 0.06, sway: 0.012, alpha: 0.32 },
		{ count: 26, size: 0.006, speed: 0.11, sway: 0.02, alpha: 0.45 },
		{ count: 10, size: 0.013, speed: 0.19, sway: 0.035, alpha: 0.26 },
	] as const;
	for (let layer = 0; layer < layers.length; layer += 1) {
		const settings = layers[layer]!;
		for (let flake = 0; flake < settings.count; flake += 1) {
			const speed =
				0.7 +
				randomUnit({
					frame: options.frame,
					salt: 67_100 + layer * 100 + flake,
				}) *
					0.6;
			const y =
				wrap({
					value:
						randomUnit({
							frame: options.frame,
							salt: 67_500 + layer * 100 + flake,
						}) *
							options.height +
						seconds * options.height * settings.speed * speed,
					modulus: options.height + unit * 0.08,
				}) -
				unit * 0.04;
			const x = wrap({
				value:
					randomUnit({
						frame: options.frame,
						salt: 67_900 + layer * 100 + flake,
					}) *
						options.width +
					seconds * options.height * settings.speed * wind +
					Math.sin(seconds * speed + flake) * unit * settings.sway,
				modulus: options.width + unit * 0.06,
			});
			const size = unit * settings.size * speed;
			fillBackgroundRect({
				alpha: fade * settings.alpha,
				color: options.frame.palette.foreground,
				height: size * 1.4,
				options,
				width: size * 1.4,
				x,
				y,
			});
		}
	}
}

function drawFireworks(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const period = 0.72;
	const latest = Math.floor(seconds / period);
	for (let burst = latest - 3; burst <= latest; burst += 1) {
		const age = seconds - burst * period;
		if (age < 0 || age > 1.8) continue;
		const centerX =
			options.width *
			(0.12 +
				randomUnit({ frame: options.frame, salt: 68_100 + burst }) * 0.76);
		const centerY =
			options.height *
			(0.12 +
				randomUnit({ frame: options.frame, salt: 68_500 + burst }) * 0.34);
		const rayCount =
			18 +
			Math.floor(
				randomUnit({ frame: options.frame, salt: 68_900 + burst }) * 9,
			);
		const radius = unit * (1 - Math.exp(-age * 2.7)) * 0.42;
		const alpha = fade * (1 - age / 1.8) ** 1.4 * 0.52;
		const color =
			burst % 2 === 0
				? options.frame.palette.accent
				: options.frame.palette.secondary;
		for (let ray = 0; ray < rayCount; ray += 1) {
			const angle =
				(ray / rayCount) * Math.PI * 2 +
				randomSigned({
					frame: options.frame,
					salt: 69_100 + burst * 50 + ray,
				}) *
					0.08;
			const rayRadius =
				radius *
				(0.82 +
					randomUnit({
						frame: options.frame,
						salt: 69_500 + burst * 50 + ray,
					}) *
						0.25);
			const headX = centerX + Math.cos(angle) * rayRadius;
			const headY =
				centerY + Math.sin(angle) * rayRadius + unit * age * age * 0.035;
			const tail = unit * (0.02 + age * 0.035);
			drawBackgroundSegment({
				alpha,
				color,
				options,
				thickness: Math.max(0.8, unit * 0.002),
				x0: headX - Math.cos(angle) * tail,
				x1: headX,
				y0: headY - Math.sin(angle) * tail,
				y1: headY,
			});
		}
	}
}

function drawCloudLayers(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const direction =
		randomUnit({ frame: options.frame, salt: 70_001 }) > 0.5 ? 1 : -1;
	const layers = [
		{ y: 0.2, scale: 0.55, speed: 0.015, alpha: 0.055 },
		{ y: 0.46, scale: 0.8, speed: 0.032, alpha: 0.08 },
		{ y: 0.82, scale: 1.12, speed: 0.058, alpha: 0.12 },
	] as const;
	for (let layer = 0; layer < layers.length; layer += 1) {
		const settings = layers[layer]!;
		const cloudWidth = unit * 0.5 * settings.scale;
		const loop = options.width + cloudWidth * 2;
		for (let cloud = 0; cloud < 4; cloud += 1) {
			const x =
				wrap({
					value:
						((cloud +
							randomUnit({
								frame: options.frame,
								salt: 70_100 + layer * 20 + cloud,
							})) /
							4) *
							loop +
						seconds * unit * settings.speed * direction,
					modulus: loop,
				}) - cloudWidth;
			const y =
				options.height * settings.y +
				randomSigned({
					frame: options.frame,
					salt: 70_300 + layer * 20 + cloud,
				}) *
					options.height *
					0.08;
			for (let lobe = 0; lobe < 5; lobe += 1) {
				const lobeRadius =
					(cloudWidth / 7) *
					(0.7 + Math.sin(((lobe + 1) / 6) * Math.PI) * 0.8) *
					(1 + Math.sin(seconds * 0.5 + lobe + cloud) * 0.04);
				drawBackgroundRing({
					alpha: fade * settings.alpha,
					centerX: x + ((lobe + 0.5) / 5) * cloudWidth,
					centerY: y - lobeRadius * 0.42,
					color:
						layer % 2 === 0
							? options.frame.palette.secondary
							: options.frame.palette.foreground,
					options,
					radiusX: lobeRadius,
					radiusY: lobeRadius * 0.72,
					segments: 12,
					thickness: Math.max(2, lobeRadius * 0.65),
				});
			}
		}
	}
}
