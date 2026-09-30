import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundPolygon,
	drawBackgroundRing,
	drawBackgroundSegment,
	phaseOffset,
	randomSigned,
	randomUnit,
	wrap,
} from "./bgcam-background-utils";

export function drawBgcamGeometricPattern(
	options: BgcamBackgroundDraw,
): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "hexGrid":
			drawHexGrid(options);
			return true;
		case "triTess":
			drawTriangleTessellation(options);
			return true;
		case "moire":
			drawMoire(options);
			return true;
		case "squareTunnel":
			drawSquareTunnel(options);
			return true;
		case "spiralArms":
			drawSpiralArms(options);
			return true;
		case "topoLines":
			drawTopoLines(options);
			return true;
		case "ridgePlot":
			drawRidgePlot(options);
			return true;
		default:
			return false;
	}
}

function drawHexGrid(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const radius = unit * 0.055;
	const horizontal = radius * 1.75;
	const vertical = radius * 1.5;
	const drift = wrap({ value: seconds * radius * 0.16, modulus: horizontal });
	for (
		let row = -1;
		row <= Math.ceil(options.height / vertical) + 1;
		row += 1
	) {
		for (
			let column = -1;
			column <= Math.ceil(options.width / horizontal) + 1;
			column += 1
		) {
			const centerX =
				column * horizontal + (row % 2 === 0 ? 0 : horizontal / 2) + drift;
			const centerY = row * vertical;
			const points = Array.from({ length: 6 }, (_, index) => {
				const angle = (index / 6) * Math.PI * 2;
				return [
					centerX + Math.cos(angle) * radius,
					centerY + Math.sin(angle) * radius,
				] as const;
			});
			drawBackgroundPolygon({
				alpha: fade * 0.08,
				color: options.frame.palette.secondary,
				options,
				points,
				thickness: Math.max(0.8, unit * 0.0018),
			});
		}
	}
}

function drawTriangleTessellation(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const side = unit * 0.105;
	const vertical = side * 0.86;
	const drift = wrap({ value: seconds * side * 0.11, modulus: side });
	for (
		let row = -1;
		row <= Math.ceil(options.height / vertical) + 1;
		row += 1
	) {
		for (
			let column = -1;
			column <= Math.ceil(options.width / side) + 1;
			column += 1
		) {
			const x = column * side + drift;
			const y = row * vertical;
			const inverted = (row + column) % 2 !== 0;
			drawBackgroundPolygon({
				alpha: fade * (inverted ? 0.065 : 0.1),
				color: inverted
					? options.frame.palette.accent
					: options.frame.palette.secondary,
				options,
				points: inverted
					? [
							[x, y - vertical / 2],
							[x + side, y - vertical / 2],
							[x + side / 2, y + vertical / 2],
						]
					: [
							[x, y + vertical / 2],
							[x + side, y + vertical / 2],
							[x + side / 2, y - vertical / 2],
						],
				thickness: Math.max(0.8, unit * 0.002),
			});
		}
	}
}

function drawMoire(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	for (let field = 0; field < 2; field += 1) {
		const phase = phaseOffset({ frame: options.frame, salt: 50_100 + field });
		const centerX =
			options.width * (field === 0 ? 0.36 : 0.64) +
			Math.sin(seconds * 0.23 + phase) * unit * 0.1;
		const centerY =
			options.height * 0.5 + Math.cos(seconds * 0.17 + phase) * unit * 0.08;
		for (let ring = 1; ring <= 11; ring += 1) {
			drawBackgroundRing({
				alpha: fade * 0.06,
				centerX,
				centerY,
				color:
					field === 0
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				options,
				radiusX: ring * unit * 0.042,
				segments: 18,
				thickness: Math.max(0.7, unit * 0.0015),
			});
		}
	}
}

function drawSquareTunnel(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const centerX = options.width * 0.5;
	const centerY = options.height * 0.5;
	for (let level = 0; level < 13; level += 1) {
		const cycle = wrap({ value: level / 13 + seconds * 0.08, modulus: 1 });
		const size = unit * (0.08 + cycle * 1.15);
		const rotation = seconds * 0.09 + cycle * 0.6;
		const corners = [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		].map(([x, y]) => {
			const px = x * size;
			const py = y * size * 0.7;
			return [
				centerX + px * Math.cos(rotation) - py * Math.sin(rotation),
				centerY + px * Math.sin(rotation) + py * Math.cos(rotation),
			] as const;
		});
		drawBackgroundPolygon({
			alpha: fade * (0.03 + cycle * 0.08),
			color:
				level % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			options,
			points: corners,
			thickness: Math.max(0.8, unit * 0.0022),
		});
	}
}

function drawSpiralArms(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	for (let arm = 0; arm < 4; arm += 1) {
		let previousX = centerX;
		let previousY = centerY;
		for (let point = 1; point <= 24; point += 1) {
			const progress = point / 24;
			const angle =
				arm * (Math.PI / 2) + progress * Math.PI * 3.5 + seconds * 0.22;
			const radius = unit * progress * 0.62;
			const x = centerX + Math.cos(angle) * radius;
			const y = centerY + Math.sin(angle) * radius * 0.72;
			drawBackgroundSegment({
				alpha: fade * (0.035 + progress * 0.075),
				color:
					arm % 2 === 0
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				options,
				thickness: Math.max(0.8, unit * 0.0023),
				x0: previousX,
				y0: previousY,
				x1: x,
				y1: y,
			});
			previousX = x;
			previousY = y;
		}
	}
}

function drawTopoLines(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	for (let cluster = 0; cluster < 3; cluster += 1) {
		const centerX =
			options.width *
			(0.2 +
				randomUnit({ frame: options.frame, salt: 51_100 + cluster }) * 0.6);
		const centerY =
			options.height *
			(0.2 +
				randomUnit({ frame: options.frame, salt: 51_200 + cluster }) * 0.6);
		const phase = phaseOffset({ frame: options.frame, salt: 51_300 + cluster });
		for (let ring = 1; ring <= 7; ring += 1) {
			const points = Array.from({ length: 22 }, (_, index) => {
				const angle = (index / 22) * Math.PI * 2;
				const wobble =
					1 +
					Math.sin(angle * (3 + cluster) + phase + seconds * 0.12) * 0.12 +
					randomSigned({
						frame: options.frame,
						salt: 51_400 + cluster * 200 + ring * 23 + index,
					}) *
						0.04;
				const radius = ring * unit * 0.035 * wobble;
				return [
					centerX + Math.cos(angle) * radius,
					centerY + Math.sin(angle) * radius * 0.72,
				] as const;
			});
			drawBackgroundPolygon({
				alpha: fade * 0.07,
				color:
					cluster % 2 === 0
						? options.frame.palette.secondary
						: options.frame.palette.accent,
				options,
				points,
				thickness: Math.max(0.7, unit * 0.0015),
			});
		}
	}
}

function drawRidgePlot(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const rows = 13;
	const columns = 28;
	for (let row = 0; row < rows; row += 1) {
		let previousX = 0;
		let previousY = (options.height * (row + 2)) / (rows + 3);
		for (let column = 1; column <= columns; column += 1) {
			const x = (options.width * column) / columns;
			const envelope = Math.sin((column / columns) * Math.PI) ** 2;
			const wave =
				Math.sin(column * 0.62 + row * 1.3 + seconds * 0.55) *
				unit *
				0.025 *
				envelope;
			const noise =
				randomSigned({
					frame: options.frame,
					salt: 52_000 + row * 40 + column,
				}) *
				unit *
				0.012 *
				envelope;
			const y = (options.height * (row + 2)) / (rows + 3) - wave - noise;
			drawBackgroundSegment({
				alpha: fade * (0.045 + row * 0.003),
				color:
					row % 3 === 0
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				options,
				thickness: Math.max(0.7, unit * 0.0017),
				x0: previousX,
				y0: previousY,
				x1: x,
				y1: y,
			});
			previousX = x;
			previousY = y;
		}
	}
}
