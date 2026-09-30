import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundPolygon,
	drawBackgroundRing,
	drawBackgroundSegment,
	fillBackgroundRect,
	phaseOffset,
	randomSigned,
	randomUnit,
	wrap,
} from "./bgcam-background-utils";

export function drawBgcamLandscapeBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "skyline":
			drawSkyline(options);
			return true;
		case "oceanWaves":
			drawOceanWaves(options);
			return true;
		case "rainWindow":
			drawRainWindow(options);
			return true;
		case "mountains":
			drawMountains(options);
			return true;
		default:
			return false;
	}
}

function drawSkyline(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const direction =
		randomUnit({ frame: options.frame, salt: 71_001 }) > 0.5 ? 1 : -1;
	for (let layer = 0; layer < 2; layer += 1) {
		const buildingCount = 15 + layer * 6;
		const slotWidth = options.width / (buildingCount - 2);
		const drift = wrap({
			value: seconds * unit * (0.015 + layer * 0.022) * direction,
			modulus: slotWidth,
		});
		for (let building = -1; building <= buildingCount; building += 1) {
			const salt =
				71_100 + layer * 500 + ((building + buildingCount) % buildingCount);
			const width =
				slotWidth * (0.72 + randomUnit({ frame: options.frame, salt }) * 0.75);
			const height =
				options.height *
				((layer === 0 ? 0.1 : 0.07) +
					randomUnit({ frame: options.frame, salt: salt + 100 }) *
						(layer === 0 ? 0.24 : 0.14));
			const x = building * slotWidth - drift;
			const y = options.height - height;
			fillBackgroundRect({
				alpha: fade * (layer === 0 ? 0.13 : 0.2),
				color:
					layer === 0
						? options.frame.palette.secondary
						: options.frame.palette.foreground,
				height,
				options,
				width,
				x,
				y,
			});
			if (randomUnit({ frame: options.frame, salt: salt + 200 }) > 0.72) {
				fillBackgroundRect({
					alpha: fade * 0.18,
					color: options.frame.palette.secondary,
					height: height * 0.15,
					options,
					width: width * 0.45,
					x: x + width * 0.28,
					y: y - height * 0.15,
				});
			}
			const windowWidth = Math.max(1.4, unit * 0.004);
			const rowStep = Math.max(windowWidth * 2.8, unit * 0.025);
			for (
				let row = 0;
				row < Math.min(8, Math.floor(height / rowStep));
				row += 1
			) {
				for (
					let column = 0;
					column < Math.min(5, Math.floor(width / rowStep));
					column += 1
				) {
					const flicker = Math.floor(seconds * 2.4);
					if (
						randomUnit({
							frame: options.frame,
							salt: salt + 300 + flicker * 17 + row * 7 + column,
						}) > 0.32
					)
						continue;
					fillBackgroundRect({
						alpha: fade * (layer === 0 ? 0.16 : 0.26),
						color: options.frame.palette.accent,
						height: windowWidth * 1.4,
						options,
						width: windowWidth,
						x: x + rowStep * (column + 0.7),
						y: y + rowStep * (row + 0.8),
					});
				}
			}
		}
	}
}

function drawOceanWaves(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const direction =
		randomUnit({ frame: options.frame, salt: 72_001 }) > 0.5 ? 1 : -1;
	const rows = 11;
	const columns = 48;
	for (let row = 0; row < rows; row += 1) {
		const depth = (row + 1) / rows;
		const baseY = options.height * (0.5 + 0.47 * depth ** 1.5);
		const amplitude = unit * (0.005 + 0.027 * depth ** 1.35);
		const wavelength = options.width * (0.08 + 0.24 * depth);
		const phase = phaseOffset({ frame: options.frame, salt: 72_100 + row });
		let previousX = 0;
		let previousY = baseY;
		for (let column = 1; column <= columns; column += 1) {
			const x = (options.width * column) / columns;
			const wave =
				Math.sin(
					(x / wavelength) * Math.PI * 2 -
						seconds * (1 + depth) * direction +
						phase,
				) +
				Math.sin(
					(x / wavelength) * Math.PI * 4.6 +
						seconds * 1.4 * direction +
						phase * 1.7,
				) *
					0.28;
			const y = baseY + amplitude * wave;
			drawBackgroundSegment({
				alpha: fade * (0.055 + depth * 0.095),
				color:
					row % 3 === 0
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				options,
				thickness: Math.max(0.8, unit * (0.0014 + depth * 0.0028)),
				x0: previousX,
				x1: x,
				y0: previousY,
				y1: y,
			});
			previousX = x;
			previousY = y;
		}
	}
}

function drawRainWindow(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const slant = randomSigned({ frame: options.frame, salt: 73_001 }) * 0.2;
	for (let streak = 0; streak < 82; streak += 1) {
		const speed =
			options.height *
			(1.3 + randomUnit({ frame: options.frame, salt: 73_100 + streak }) * 0.8);
		const length =
			options.height *
			(0.025 +
				randomUnit({ frame: options.frame, salt: 73_300 + streak }) * 0.07);
		const y =
			wrap({
				value:
					randomUnit({ frame: options.frame, salt: 73_500 + streak }) *
						options.height +
					seconds * speed,
				modulus: options.height + length,
			}) - length;
		const x =
			randomUnit({ frame: options.frame, salt: 73_700 + streak }) *
				options.width +
			y * slant;
		drawBackgroundSegment({
			alpha: fade * 0.12,
			color: options.frame.palette.secondary,
			options,
			thickness: Math.max(0.7, unit * 0.0015),
			x0: x,
			x1: x + length * slant,
			y0: y,
			y1: y + length,
		});
	}
	for (let drop = 0; drop < 18; drop += 1) {
		const period =
			3.5 + randomUnit({ frame: options.frame, salt: 74_100 + drop }) * 3;
		const progress =
			wrap({
				value:
					seconds +
					randomUnit({ frame: options.frame, salt: 74_300 + drop }) * period,
				modulus: period,
			}) / period;
		const startX =
			randomUnit({ frame: options.frame, salt: 74_500 + drop }) * options.width;
		const startY =
			randomUnit({ frame: options.frame, salt: 74_700 + drop }) *
			options.height *
			0.7;
		const slide = progress < 0.58 ? 0 : ((progress - 0.58) / 0.42) ** 2;
		const y = startY + slide * options.height * 1.05;
		const radius =
			unit *
			(0.006 +
				randomUnit({ frame: options.frame, salt: 74_900 + drop }) * 0.012);
		if (y - radius > options.height) continue;
		if (slide > 0) {
			drawBackgroundSegment({
				alpha: fade * (1 - slide * 0.5) * 0.13,
				color: options.frame.palette.secondary,
				options,
				thickness: Math.max(0.8, radius * 0.35),
				x0: startX,
				x1: startX + Math.sin(slide * 18 + drop) * unit * 0.006,
				y0: startY,
				y1: y,
			});
		}
		drawBackgroundRing({
			alpha: fade * 0.2,
			centerX: startX,
			centerY: y,
			color: options.frame.palette.foreground,
			options,
			radiusX: radius * 0.78,
			radiusY: radius,
			segments: 10,
			thickness: Math.max(0.8, radius * 0.22),
		});
	}
}

function drawMountains(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const direction =
		randomUnit({ frame: options.frame, salt: 75_001 }) > 0.5 ? 1 : -1;
	const layers = 4;
	for (let layer = 0; layer < layers; layer += 1) {
		const depth = layer / (layers - 1);
		const baseY = options.height * (0.63 + depth * 0.1);
		const amplitude = options.height * (0.24 - depth * 0.075);
		const points: Array<readonly [number, number]> = [];
		const columns = 16;
		const offset = seconds * (0.012 + layer * 0.008) * direction;
		for (let column = 0; column <= columns; column += 1) {
			const progress = column / columns;
			const ridge =
				Math.abs(
					Math.sin(
						progress * Math.PI * (3.2 + layer * 0.7) +
							phaseOffset({ frame: options.frame, salt: 75_100 + layer }) +
							offset,
					),
				) ** 1.7;
			const detail =
				Math.abs(
					Math.sin(
						progress * Math.PI * 11 +
							phaseOffset({ frame: options.frame, salt: 75_200 + layer }),
					),
				) * 0.18;
			points.push([
				progress * options.width,
				baseY - amplitude * Math.min(1, ridge + detail),
			]);
		}
		drawBackgroundPolygon({
			alpha: fade * (0.06 + depth * 0.05),
			color:
				layer % 2 === 0
					? options.frame.palette.secondary
					: options.frame.palette.accent,
			options,
			points: [...points, [options.width, options.height], [0, options.height]],
			thickness: Math.max(2, unit * (0.009 + depth * 0.005)),
		});
		if (layer >= layers - 1) continue;
		drawBackgroundSegment({
			alpha: fade * 0.04,
			color: options.frame.palette.background,
			options,
			thickness: Math.max(2, unit * 0.032),
			x0: 0,
			x1: options.width,
			y0: baseY + unit * 0.02,
			y1: baseY + unit * 0.02,
		});
	}
}
