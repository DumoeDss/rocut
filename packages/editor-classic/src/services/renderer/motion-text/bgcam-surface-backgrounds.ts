import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundPolygon,
	drawBackgroundRing,
	drawBackgroundSegment,
	fillBackgroundRect,
	fillRotatedRect,
	phaseOffset,
	randomSigned,
	randomUnit,
} from "./bgcam-background-utils";

export function drawBgcamSurfaceBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "tornPaper":
			drawTornPaper(options);
			return true;
		case "kaleidoscope":
			drawKaleidoscope(options);
			return true;
		case "marble":
			drawMarble(options);
			return true;
		case "paperCut":
			drawPaperCut(options);
			return true;
		default:
			return false;
	}
}

function drawTornPaper(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const diagonal = randomUnit({ frame: options.frame, salt: 86_001 }) > 0.55;
	for (let edge = 0; edge < 2; edge += 1) {
		const progress = fade;
		const points: Array<readonly [number, number]> = [];
		const count = 38;
		for (let index = 0; index <= count; index += 1) {
			const along = index / count;
			const noise =
				randomSigned({
					frame: options.frame,
					salt: 86_100 + edge * 100 + index,
				}) *
					unit *
					0.012 +
				Math.sin(
					along * Math.PI * 18 +
						phaseOffset({ frame: options.frame, salt: 86_300 + edge }),
				) *
					unit *
					0.005;
			if (diagonal) {
				const fromY =
					edge === 0 ? options.height * 0.58 : -options.height * 0.05;
				const toY = edge === 0 ? options.height * 1.04 : options.height * 0.48;
				points.push([
					options.width * (-0.05 + along * 1.1) + noise * 0.6,
					fromY +
						(toY - fromY) * along +
						noise +
						(1 - progress) * unit * (edge ? -0.3 : 0.3),
				]);
			} else {
				const baseY = options.height * (edge === 0 ? 0.82 : 0.16);
				points.push([
					options.width * (-0.05 + along * 1.1),
					baseY + noise + (1 - progress) * unit * (edge === 0 ? 0.3 : -0.3),
				]);
			}
		}
		const color =
			edge === 0
				? options.frame.palette.secondary
				: options.frame.palette.accent;
		for (let index = 1; index < points.length; index += 1) {
			const previous = points[index - 1]!;
			const current = points[index]!;
			drawBackgroundSegment({
				alpha: fade * 0.11,
				color: options.frame.palette.background,
				options,
				thickness: Math.max(2, unit * 0.014),
				x0: previous[0] + unit * 0.004,
				x1: current[0] + unit * 0.004,
				y0: previous[1] + unit * 0.009,
				y1: current[1] + unit * 0.009,
			});
			drawBackgroundSegment({
				alpha: fade * 0.28,
				color,
				options,
				thickness: Math.max(1, unit * 0.004),
				x0: previous[0],
				x1: current[0],
				y0: previous[1],
				y1: current[1],
			});
		}
	}
	const shift = Math.sin(seconds * 0.5) * unit * 0.005;
	fillRotatedRect({
		alpha: fade * 0.025,
		color: options.frame.palette.foreground,
		height: options.height * 0.18,
		options,
		rotation: diagonal ? 0.5 : -0.02,
		width: options.width * 1.3,
		x: options.width / 2 + shift,
		y: options.height / 2,
	});
}

function drawKaleidoscope(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	const symmetry = 8;
	const rotation = seconds * 0.09;
	for (let motif = 0; motif < 8; motif += 1) {
		const progress =
			(randomUnit({ frame: options.frame, salt: 87_100 + motif }) +
				seconds * (0.035 + motif * 0.002)) %
			1;
		const radius = unit * (0.13 + progress * 0.58);
		const motifSize =
			radius *
			(0.07 +
				randomUnit({ frame: options.frame, salt: 87_300 + motif }) * 0.08);
		const mirror = Math.PI / symmetry;
		const phi = mirror * (0.2 + Math.sin(seconds * 0.35 + motif * 1.7) * 0.35);
		for (let segment = 0; segment < symmetry; segment += 1) {
			for (const sign of [-1, 1] as const) {
				const angle =
					rotation + (segment / symmetry) * Math.PI * 2 + phi * sign;
				const x = centerX + Math.cos(angle) * radius;
				const y = centerY + Math.sin(angle) * radius;
				const points = [
					[x + Math.cos(angle) * motifSize, y + Math.sin(angle) * motifSize],
					[
						x + Math.cos(angle + 2.25) * motifSize,
						y + Math.sin(angle + 2.25) * motifSize,
					],
					[
						x + Math.cos(angle - 2.25) * motifSize,
						y + Math.sin(angle - 2.25) * motifSize,
					],
				] as const;
				drawBackgroundPolygon({
					alpha: fade * (0.045 + (1 - progress) * 0.045),
					color:
						motif % 2 === 0
							? options.frame.palette.accent
							: options.frame.palette.secondary,
					options,
					points,
					thickness: Math.max(0.8, unit * 0.0022),
				});
			}
		}
	}
	for (const radius of [unit * 0.45, unit * 0.76]) {
		drawBackgroundRing({
			alpha: fade * 0.045,
			centerX,
			centerY,
			color: options.frame.palette.foreground,
			options,
			radiusX: radius,
			rotation: -rotation * 1.4,
			segments: symmetry * 2,
			thickness: Math.max(0.8, unit * 0.0018),
		});
	}
}

function drawMarble(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const direction =
		randomUnit({ frame: options.frame, salt: 88_001 }) > 0.5 ? 1 : -1;
	const angle = phaseOffset({ frame: options.frame, salt: 88_002 }) * 0.5;
	const diagonal = Math.hypot(options.width, options.height);
	for (let vein = 0; vein < 13; vein += 1) {
		const base = (vein / 12 - 0.5) * diagonal;
		const phase = phaseOffset({ frame: options.frame, salt: 88_100 + vein });
		let previousX = 0;
		let previousY = 0;
		for (let point = 0; point <= 34; point += 1) {
			const progress = point / 34;
			const along = (progress - 0.5) * diagonal * 1.45;
			const turbulence =
				Math.sin(
					progress * Math.PI * (4 + (vein % 3)) +
						phase +
						seconds * 0.08 * direction,
				) *
					unit *
					0.035 +
				Math.sin(progress * Math.PI * 17 - phase * 1.7) * unit * 0.012;
			const cross = base * 0.22 + turbulence;
			const x =
				options.width / 2 +
				along * Math.cos(angle) -
				cross * Math.sin(angle) +
				Math.sin(seconds * 0.06 + vein) * unit * 0.02;
			const y =
				options.height / 2 + along * Math.sin(angle) + cross * Math.cos(angle);
			if (point > 0) {
				drawBackgroundSegment({
					alpha: fade * (vein % 4 === 0 ? 0.12 : 0.065),
					color:
						vein % 4 === 0
							? options.frame.palette.accent
							: options.frame.palette.foreground,
					options,
					thickness: Math.max(0.7, unit * (vein % 4 === 0 ? 0.003 : 0.0015)),
					x0: previousX,
					x1: x,
					y0: previousY,
					y1: y,
				});
			}
			previousX = x;
			previousY = y;
		}
	}
}

function drawPaperCut(options: BgcamBackgroundDraw): void {
	const seconds = backgroundSeconds(options.frame);
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	const layers = 4;
	const lobes =
		5 + Math.floor(randomUnit({ frame: options.frame, salt: 89_001 }) * 5);
	for (let layer = 0; layer < layers; layer += 1) {
		const depth = (layers - 1 - layer) / (layers - 1);
		const rx = options.width * (0.37 + layer * 0.065) * (1 + (1 - fade) * 0.6);
		const ry = options.height * (0.34 + layer * 0.065) * (1 + (1 - fade) * 0.6);
		const points = Array.from({ length: 64 }, (_, index) => {
			const angle = (index / 64) * Math.PI * 2;
			const wave =
				1 +
				Math.sin(
					angle * (lobes + layer) +
						phaseOffset({ frame: options.frame, salt: 89_100 + layer }) +
						seconds * 0.22 * (layer % 2 ? 1 : -1),
				) *
					0.038 +
				Math.sin(angle * (lobes * 2 + 3) - seconds * 0.14) * 0.014;
			return [
				centerX +
					Math.cos(angle) * rx * wave +
					Math.sin(seconds * 0.35 + layer) * unit * 0.006 * (layer + 1),
				centerY +
					Math.sin(angle) * ry * wave +
					Math.cos(seconds * 0.3 + layer) * unit * 0.004 * (layer + 1),
			] as const;
		});
		drawBackgroundPolygon({
			alpha: fade * (0.05 + depth * 0.02),
			color: options.frame.palette.background,
			options,
			points: points.map(
				([x, y]) => [x + unit * 0.004, y + unit * 0.009] as const,
			),
			thickness: Math.max(2, unit * 0.016),
		});
		drawBackgroundPolygon({
			alpha: fade * (0.16 - layer * 0.018),
			color:
				layer % 2 === 0
					? options.frame.palette.foreground
					: options.frame.palette.accent,
			options,
			points,
			thickness: Math.max(2, unit * (0.012 - layer * 0.0015)),
		});
	}
	fillBackgroundRect({
		alpha: fade * 0.035,
		color: options.frame.palette.secondary,
		height: unit * 0.01,
		options,
		width: unit * 0.01,
		x: centerX - unit * 0.005,
		y: centerY - unit * 0.005,
	});
}
