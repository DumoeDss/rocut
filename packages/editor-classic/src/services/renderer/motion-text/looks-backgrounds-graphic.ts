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

export function drawLooksGraphicBackground(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "sunburst":
			drawSunburst(options);
			return true;
		case "concentric":
			drawConcentric(options);
			return true;
		case "halftoneFade":
			drawHalftoneFade(options);
			return true;
		case "bigStripes":
			drawBigStripes(options);
			return true;
		case "splitV":
			drawSplit({ mode: "vertical", options });
			return true;
		case "splitH":
			drawSplit({ mode: "horizontal", options });
			return true;
		case "splitDiag":
			drawSplit({ mode: "diagonal", options });
			return true;
		case "checker":
			drawChecker(options);
			return true;
		case "speedLines":
			drawSpeedLines(options);
			return true;
		case "dotGrid":
			drawDotGrid(options);
			return true;
		case "polka":
			drawPolka(options);
			return true;
		case "borderFrame":
			drawBorderFrame(options);
			return true;
		default:
			return false;
	}
}

function drawSunburst(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const phase = phaseOffset({ frame: options.frame, salt: 21_001 });
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	for (let index = 0; index < 18; index += 1) {
		const angle = phase + seconds * 0.18 + (index / 18) * Math.PI * 2;
		const radius = unit * 0.42;
		fillRotatedRect({
			alpha: fade * (index % 2 === 0 ? 0.13 : 0.07),
			color:
				index % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			height: Math.max(2, unit * 0.018),
			options,
			rotation: angle,
			width: unit * 0.72,
			x: centerX + Math.cos(angle) * radius,
			y: centerY + Math.sin(angle) * radius,
		});
	}
}

function drawConcentric(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const pulse = 0.5 + Math.sin(seconds * 2.1) * 0.5;
	for (let ring = 0; ring < 9; ring += 1) {
		drawBackgroundRing({
			alpha: fade * (0.08 + (ring % 2) * 0.045),
			centerX: options.width / 2,
			centerY: options.height * 0.5,
			color:
				ring % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			options,
			radiusX: unit * (0.08 + ring * 0.07 + pulse * 0.012),
			radiusY: unit * (0.055 + ring * 0.052 + pulse * 0.008),
			rotation: seconds * 0.05,
			segments: 28,
			thickness: Math.max(1, unit * 0.0025),
		});
	}
}

function drawHalftoneFade(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const fade = backgroundFade(options.frame);
	const seconds = backgroundSeconds(options.frame);
	const cell = Math.max(11, unit * 0.045);
	const columns = Math.ceil(options.width / cell) + 1;
	const rows = Math.ceil(options.height / cell) + 1;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const ratio = column / Math.max(1, columns - 1);
			const size = Math.max(1.5, cell * (0.04 + ratio * 0.28));
			fillBackgroundRect({
				alpha: fade * (0.08 + ratio * 0.22),
				color: options.frame.palette.foreground,
				height: size,
				options,
				width: size,
				x: column * cell + Math.sin(seconds * 0.8 + row) * cell * 0.12,
				y: row * cell,
			});
		}
	}
}

function drawBigStripes(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const phase = phaseOffset({ frame: options.frame, salt: 22_001 });
	const spacing = unit * 0.2;
	const offset = wrap({ modulus: spacing, value: seconds * unit * 0.045 });
	for (let stripe = -4; stripe < 10; stripe += 1) {
		fillRotatedRect({
			alpha: 0.12 + (stripe % 3 === 0 ? 0.07 : 0),
			color:
				stripe % 3 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			height: unit * 0.065,
			options,
			rotation: -0.58 + Math.sin(phase) * 0.03,
			width: Math.hypot(options.width, options.height) * 1.2,
			x: options.width / 2,
			y: stripe * spacing + offset,
		});
	}
}

function drawSplit({
	mode,
	options,
}: {
	readonly mode: "diagonal" | "horizontal" | "vertical";
	readonly options: BgcamBackgroundDraw;
}): void {
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const drift = Math.sin(seconds * (mode === "horizontal" ? 0.7 : 0.9)) * 0.035;
	if (mode === "vertical") {
		fillBackgroundRect({
			alpha: fade * 0.28,
			color: options.frame.palette.accent,
			height: options.height,
			options,
			width: options.width * (0.5 + drift),
			x: 0,
			y: 0,
		});
		return;
	}
	if (mode === "horizontal") {
		fillBackgroundRect({
			alpha: fade * 0.24,
			color: options.frame.palette.secondary,
			height: options.height * (0.5 + drift),
			options,
			width: options.width,
			x: 0,
			y: 0,
		});
		return;
	}
	fillRotatedRect({
		alpha: fade * 0.25,
		color: options.frame.palette.accent,
		height: options.height * 1.5,
		options,
		rotation: 0.35 + drift,
		width: options.width * 0.58,
		x: options.width * (0.22 + drift),
		y: options.height / 2,
	});
}

function drawChecker(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const cell = unit * 0.105;
	const seconds = backgroundSeconds(options.frame);
	const offset = wrap({ modulus: cell * 2, value: seconds * cell * 0.23 });
	const columns = Math.ceil(options.width / cell) + 3;
	const rows = Math.ceil(options.height / cell) + 3;
	for (let row = -2; row < rows; row += 1) {
		for (let column = -2; column < columns; column += 1) {
			if ((row + column) % 2 === 0) continue;
			fillBackgroundRect({
				alpha: 0.11,
				color: options.frame.palette.foreground,
				height: cell - 1,
				options,
				width: cell - 1,
				x: column * cell + offset,
				y: row * cell + offset,
			});
		}
	}
}

function drawSpeedLines(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	const phase = phaseOffset({ frame: options.frame, salt: 23_001 });
	for (let index = 0; index < 56; index += 1) {
		const angle =
			phase + (index / 56) * Math.PI * 2 + Math.sin(seconds + index) * 0.004;
		const start =
			unit *
			(0.3 + randomUnit({ frame: options.frame, salt: 23_100 + index }) * 0.12);
		const end =
			unit *
			(0.66 +
				randomUnit({ frame: options.frame, salt: 23_200 + index }) * 0.22);
		drawBackgroundSegment({
			alpha: 0.13 + (index % 5 === 0 ? 0.12 : 0),
			color:
				index % 5 === 0
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			options,
			thickness: Math.max(1, unit * (0.0015 + (index % 3) * 0.0006)),
			x0: centerX + Math.cos(angle) * start,
			x1: centerX + Math.cos(angle) * end,
			y0: centerY + Math.sin(angle) * start,
			y1: centerY + Math.sin(angle) * end,
		});
	}
}

function drawDotGrid(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const spacing = unit * 0.065;
	const seconds = backgroundSeconds(options.frame);
	const offsetX = wrap({ modulus: spacing, value: seconds * spacing * 0.15 });
	const offsetY = wrap({ modulus: spacing, value: seconds * spacing * 0.08 });
	for (let y = offsetY - spacing; y < options.height + spacing; y += spacing) {
		for (let x = offsetX - spacing; x < options.width + spacing; x += spacing) {
			const accent = Math.round(x / spacing + y / spacing) % 11 === 0;
			const size = accent ? unit * 0.009 : unit * 0.0045;
			fillBackgroundRect({
				alpha: accent ? 0.3 : 0.14,
				color: accent
					? options.frame.palette.accent
					: options.frame.palette.foreground,
				height: size,
				options,
				width: size,
				x: x - size / 2,
				y: y - size / 2,
			});
		}
	}
}

function drawPolka(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const spacing = unit * 0.14;
	const seconds = backgroundSeconds(options.frame);
	const scale = 0.8 + backgroundFade(options.frame) * 0.2;
	const offset = wrap({ modulus: spacing, value: seconds * spacing * 0.18 });
	let row = 0;
	for (let y = -spacing; y < options.height + spacing; y += spacing * 0.86) {
		for (
			let x = -spacing + (row % 2) * spacing * 0.5;
			x < options.width + spacing;
			x += spacing
		) {
			const size = spacing * 0.24 * scale;
			fillRotatedRect({
				alpha: 0.13,
				color:
					row % 3 === 0
						? options.frame.palette.accent
						: options.frame.palette.foreground,
				height: size,
				options,
				rotation: Math.PI / 4 + seconds * 0.04,
				width: size,
				x: x + offset,
				y,
			});
		}
		row += 1;
	}
}

function drawBorderFrame(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const margin = unit * (0.04 + Math.sin(seconds * 0.5) * 0.006);
	const thickness = Math.max(3, unit * 0.017);
	const color = options.frame.palette.accent;
	fillBackgroundRect({
		alpha: 0.72,
		color,
		height: thickness,
		options,
		width: options.width - margin * 2,
		x: margin,
		y: margin,
	});
	fillBackgroundRect({
		alpha: 0.72,
		color,
		height: thickness,
		options,
		width: options.width - margin * 2,
		x: margin,
		y: options.height - margin - thickness,
	});
	fillBackgroundRect({
		alpha: 0.72,
		color,
		height: options.height - margin * 2,
		options,
		width: thickness,
		x: margin,
		y: margin,
	});
	fillBackgroundRect({
		alpha: 0.72,
		color,
		height: options.height - margin * 2,
		options,
		width: thickness,
		x: options.width - margin - thickness,
		y: margin,
	});
	const marker =
		randomSigned({ frame: options.frame, salt: 24_001 }) * unit * 0.025;
	fillBackgroundRect({
		alpha: 0.9,
		color: options.frame.palette.secondary,
		height: thickness * 0.45,
		options,
		width: unit * 0.16,
		x: options.width / 2 - unit * 0.08 + marker,
		y: margin - thickness * 0.18,
	});
}
