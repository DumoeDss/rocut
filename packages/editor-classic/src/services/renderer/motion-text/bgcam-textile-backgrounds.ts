import {
	backgroundFade,
	backgroundSeconds,
	backgroundUnit,
	type BgcamBackgroundDraw,
	drawBackgroundPolygon,
	drawBackgroundRing,
	drawBackgroundSegment,
	fillBackgroundRect,
	wrap,
} from "./bgcam-background-utils";

export function drawBgcamTextilePattern(options: BgcamBackgroundDraw): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "seigaiha":
			drawSeigaiha(options);
			return true;
		case "asanoha":
			drawAsanoha(options);
			return true;
		case "houndstooth":
			drawHoundstooth(options);
			return true;
		case "herringbone":
			drawHerringbone(options);
			return true;
		case "argyle":
			drawArgyle(options);
			return true;
		case "tartan":
			drawTartan(options);
			return true;
		case "chevron":
			drawChevron(options);
			return true;
		case "isoCubes":
			drawIsoCubes(options);
			return true;
		default:
			return false;
	}
}

function drawSeigaiha(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const radius = unit * 0.125;
	const offset = wrap({ value: seconds * radius * 0.24, modulus: radius * 2 });
	for (
		let row = -1;
		row < Math.ceil(options.height / (radius * 0.62)) + 1;
		row += 1
	) {
		for (
			let column = -1;
			column < Math.ceil(options.width / (radius * 2)) + 1;
			column += 1
		) {
			const centerX =
				column * radius * 2 + (row % 2 === 0 ? 0 : radius) + offset;
			const centerY = row * radius * 0.62;
			for (let ring = 1; ring <= 3; ring += 1) {
				drawBackgroundRing({
					alpha: fade * (0.08 - ring * 0.012),
					centerX,
					centerY,
					color: options.frame.palette.secondary,
					options,
					radiusX: (radius * ring) / 3,
					radiusY: (radius * ring) / 3,
					segments: 8,
					thickness: Math.max(0.8, unit * 0.0018),
				});
			}
		}
	}
}

function drawAsanoha(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const spacing = unit * 0.13;
	const vertical = spacing * 0.86;
	const offset = wrap({ value: seconds * spacing * 0.08, modulus: spacing });
	for (
		let row = -1;
		row <= Math.ceil(options.height / vertical) + 1;
		row += 1
	) {
		for (
			let column = -1;
			column <= Math.ceil(options.width / spacing) + 1;
			column += 1
		) {
			const centerX =
				column * spacing + (row % 2 === 0 ? 0 : spacing / 2) + offset;
			const centerY = row * vertical + offset * 0.35;
			for (let spoke = 0; spoke < 6; spoke += 1) {
				const angle = (spoke / 6) * Math.PI * 2;
				const tipX = centerX + Math.cos(angle) * spacing * 0.48;
				const tipY = centerY + Math.sin(angle) * spacing * 0.48;
				drawBackgroundSegment({
					alpha: fade * 0.095,
					color: options.frame.palette.secondary,
					options,
					thickness: Math.max(0.8, unit * 0.0017),
					x0: centerX,
					y0: centerY,
					x1: tipX,
					y1: tipY,
				});
			}
		}
	}
}

function drawHoundstooth(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const cell = unit * 0.055;
	const drift = wrap({ value: seconds * cell * 0.28, modulus: cell * 2 });
	for (let row = -1; row <= Math.ceil(options.height / cell) + 1; row += 1) {
		for (
			let column = -1;
			column <= Math.ceil(options.width / cell) + 1;
			column += 1
		) {
			if ((row + column) % 2 !== 0) continue;
			const x = column * cell + drift;
			const y = row * cell + drift * 0.6;
			fillBackgroundRect({
				alpha: fade * 0.065,
				color: options.frame.palette.foreground,
				height: cell * 0.58,
				options,
				width: cell * 0.58,
				x,
				y,
			});
			drawBackgroundSegment({
				alpha: fade * 0.08,
				color: options.frame.palette.foreground,
				options,
				thickness: cell * 0.16,
				x0: x + cell * 0.4,
				y0: y + cell * 0.45,
				x1: x + cell,
				y1: y + cell,
			});
		}
	}
}

function drawHerringbone(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const cell = unit * 0.085;
	const drift = wrap({ value: seconds * cell * 0.22, modulus: cell * 2 });
	for (let row = -2; row <= Math.ceil(options.height / cell) + 2; row += 1) {
		for (
			let column = -2;
			column <= Math.ceil(options.width / cell) + 2;
			column += 1
		) {
			const x = column * cell + drift;
			const y = row * cell - drift;
			const direction = (row + column) % 2 === 0 ? 1 : -1;
			drawBackgroundSegment({
				alpha: fade * 0.09,
				color:
					direction > 0
						? options.frame.palette.secondary
						: options.frame.palette.accent,
				options,
				thickness: Math.max(1, unit * 0.004),
				x0: x - cell * 0.55,
				y0: y,
				x1: x,
				y1: y + cell * 0.55 * direction,
			});
			drawBackgroundSegment({
				alpha: fade * 0.09,
				color:
					direction > 0
						? options.frame.palette.secondary
						: options.frame.palette.accent,
				options,
				thickness: Math.max(1, unit * 0.004),
				x0: x,
				y0: y + cell * 0.55 * direction,
				x1: x + cell * 0.55,
				y1: y,
			});
		}
	}
}

function drawArgyle(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const diamondWidth = unit * 0.2;
	const diamondHeight = diamondWidth * 1.35;
	const drift = wrap({
		value: seconds * diamondHeight * 0.08,
		modulus: diamondHeight,
	});
	for (
		let row = -1;
		row <= Math.ceil(options.height / diamondHeight) + 1;
		row += 1
	) {
		for (
			let column = -1;
			column <= Math.ceil(options.width / diamondWidth) + 1;
			column += 1
		) {
			const centerX =
				column * diamondWidth + (row % 2 === 0 ? 0 : diamondWidth / 2);
			const centerY = row * diamondHeight + drift;
			drawBackgroundPolygon({
				alpha: fade * 0.09,
				color:
					(row + column) % 2 === 0
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				options,
				points: [
					[centerX, centerY - diamondHeight * 0.45],
					[centerX + diamondWidth * 0.45, centerY],
					[centerX, centerY + diamondHeight * 0.45],
					[centerX - diamondWidth * 0.45, centerY],
				],
				thickness: Math.max(1, unit * 0.0025),
			});
		}
	}
}

function drawTartan(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const period = unit * 0.42;
	const xOffset = wrap({ value: -seconds * period * 0.04, modulus: period });
	const yOffset = wrap({ value: seconds * period * 0.03, modulus: period });
	const widths = [0.035, 0.11, 0.018] as const;
	for (
		let index = -1;
		index <= Math.ceil(options.width / period) + 1;
		index += 1
	) {
		for (let stripe = 0; stripe < widths.length; stripe += 1) {
			fillBackgroundRect({
				alpha: fade * (0.035 + stripe * 0.015),
				color:
					stripe === 1
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				height: options.height,
				options,
				width: period * widths[stripe],
				x: index * period + xOffset + stripe * period * 0.16,
				y: 0,
			});
		}
	}
	for (
		let index = -1;
		index <= Math.ceil(options.height / period) + 1;
		index += 1
	) {
		for (let stripe = 0; stripe < widths.length; stripe += 1) {
			fillBackgroundRect({
				alpha: fade * (0.035 + stripe * 0.015),
				color:
					stripe === 1
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				height: period * widths[stripe],
				options,
				width: options.width,
				x: 0,
				y: index * period + yOffset + stripe * period * 0.16,
			});
		}
	}
}

function drawChevron(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const period = unit * 0.16;
	const vertical = period * 0.48;
	const drift = wrap({ value: -seconds * vertical * 0.42, modulus: vertical });
	for (
		let row = -2;
		row <= Math.ceil(options.height / vertical) + 2;
		row += 1
	) {
		for (
			let column = -1;
			column <= Math.ceil(options.width / period) + 1;
			column += 1
		) {
			const x = column * period;
			const y = row * vertical + drift;
			drawBackgroundSegment({
				alpha: fade * 0.075,
				color: options.frame.palette.accent,
				options,
				thickness: vertical * 0.22,
				x0: x,
				y0: y + vertical * 0.45,
				x1: x + period / 2,
				y1: y,
			});
			drawBackgroundSegment({
				alpha: fade * 0.075,
				color: options.frame.palette.accent,
				options,
				thickness: vertical * 0.22,
				x0: x + period / 2,
				y0: y,
				x1: x + period,
				y1: y + vertical * 0.45,
			});
		}
	}
}

function drawIsoCubes(options: BgcamBackgroundDraw): void {
	const unit = backgroundUnit(options);
	const seconds = backgroundSeconds(options.frame);
	const fade = backgroundFade(options.frame);
	const side = unit * 0.07;
	const horizontal = side * 1.72;
	const vertical = side * 1.5;
	const drift = wrap({ value: seconds * side * 0.18, modulus: vertical });
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
			const x = column * horizontal + (row % 2 === 0 ? 0 : horizontal / 2);
			const y = row * vertical + drift;
			const top = [x, y - side] as const;
			const right = [x + horizontal / 2, y - side / 2] as const;
			const bottom = [x, y + side] as const;
			const left = [x - horizontal / 2, y - side / 2] as const;
			for (const [end, color] of [
				[right, options.frame.palette.accent],
				[bottom, options.frame.palette.secondary],
				[left, options.frame.palette.foreground],
			] as const) {
				drawBackgroundSegment({
					alpha: fade * 0.07,
					color,
					options,
					thickness: Math.max(1, unit * 0.0025),
					x0: top[0],
					y0: top[1],
					x1: end[0],
					y1: end[1],
				});
			}
		}
	}
}
