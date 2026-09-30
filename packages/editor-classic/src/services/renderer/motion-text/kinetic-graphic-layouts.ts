import {
	bell,
	clamp01,
	compactGlyphs,
	degrees,
	drawKineticLayoutText,
	drawKineticRule,
	fitKineticText,
	inOutCubic,
	kineticRow,
	kineticUnits,
	lerp,
	outBack,
	outCubic,
	stableIndex,
} from "./kinetic-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawKineticGraphicLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "knRhythmCuts":
			drawRhythmCuts(options);
			return true;
		case "knPathRide":
			drawPathRide(options);
			return true;
		case "knGearWords":
			drawGearWords(options);
			return true;
		case "knCollide":
			drawCollide(options);
			return true;
		case "knTumble":
			drawTumble(options);
			return true;
		case "knReflow":
			drawReflow(options);
			return true;
		case "knPadGrid":
			drawPadGrid(options);
			return true;
		default:
			return false;
	}
}

function drawRhythmCuts(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 5,
	});
	if (units.length === 0) return;
	const progress = options.frame.progress;
	if (progress >= 0.62) {
		const settle = outCubic((progress - 0.62) / 0.25);
		const size = fitKineticText({
			text: units.join(" "),
			width: options.width * 0.8,
			height: options.height * 0.16,
			maxSize: options.height * 0.15,
		});
		const row = kineticRow({
			centerX: options.width / 2,
			gap: size * 0.3,
			size,
			units,
		});
		for (const item of row) {
			drawKineticLayoutText({
				options,
				text: {
					text: item.text,
					x: item.x,
					y: options.height / 2,
					size: size * (1 + 0.08 * (1 - settle)),
				},
			});
		}
		drawKineticRule({
			options,
			x: options.width * 0.1,
			y: options.height / 2 + size * 0.72,
			width: options.width * 0.8 * settle,
			height: Math.max(3, size * 0.06),
			color: options.frame.palette.accent,
		});
		return;
	}
	const position = (progress / 0.62) * units.length;
	const current = Math.min(units.length - 1, Math.floor(position));
	const local = position - current;
	const shot = current % 6;
	const text = units[current];
	const base = fitKineticText({
		text,
		width: options.width * 0.76,
		height: options.height * 0.48,
		maxSize: options.height * 0.44,
	});
	const punch = 1 + 0.12 * (1 - outCubic(local));
	if (shot === 4) {
		drawKineticRule({
			options,
			x: 0,
			y: options.height / 2 - base * 0.78,
			width: options.width,
			height: base * 1.56,
			color: options.frame.palette.accent,
			alpha: outCubic(local * 2),
		});
	}
	if (shot === 2) drawShotCorners({ options, size: base, progress: local });
	drawKineticLayoutText({
		options,
		text: {
			text,
			x:
				shot === 1
					? options.width * 0.72
					: shot === 3
						? options.width * 0.1
						: options.width / 2,
			y: options.height / 2,
			size: base * (shot === 2 ? 0.45 : shot === 3 ? 1.32 : 1) * punch,
			align: shot === 3 ? "left" : "center",
			rotation: shot === 1 ? degrees(90) : shot === 5 ? degrees(-8) : 0,
			color:
				shot === 4
					? options.frame.palette.background
					: shot === 5
						? options.frame.palette.accent
						: options.frame.palette.foreground,
		},
	});
}

function drawShotCorners({
	options,
	size,
	progress,
}: {
	readonly options: TypographyLayoutOptions;
	readonly progress: number;
	readonly size: number;
}): void {
	const extent = size * (1.2 - 0.2 * outCubic(progress));
	for (const [x, y] of [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	] as const) {
		drawKineticRule({
			options,
			x: options.width / 2 + x * extent - x * size * 0.25,
			y: options.height / 2 + y * extent,
			width: size * 0.5,
			height: Math.max(2, size * 0.035),
			color: options.frame.palette.accent,
		});
	}
}

function drawPathRide(options: TypographyLayoutOptions): void {
	const glyphs = compactGlyphs(options.frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const size = Math.min(
		options.height * 0.15,
		(options.width * 0.76) / Math.max(2, glyphs.length * 0.68),
	);
	const radius = Math.min(options.height * 0.25, options.width * 0.18);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	const side = stableIndex({ count: 2, options, salt: 501 }) === 0 ? -1 : 1;
	for (let index = 0; index < 28; index += 1) {
		const angle = (index / 28) * Math.PI * 2;
		drawKineticRule({
			options,
			x: centerX + Math.cos(angle) * radius - 2,
			y: centerY + Math.sin(angle) * radius * side - 2,
			width: 4,
			height: 4,
			color: options.frame.palette.secondary,
			alpha: 0.5,
		});
	}
	const head = outCubic(options.frame.progress) * 1.45;
	for (const [index, glyph] of glyphs.entries()) {
		const position = head - (glyphs.length - 1 - index) * 0.065;
		const angle = -Math.PI + position * Math.PI * 2;
		const drift = (position - 0.5) * options.width * 0.45;
		const x = centerX + Math.cos(angle) * radius + drift;
		const y = centerY + Math.sin(angle) * radius * side;
		drawKineticLayoutText({
			options,
			text: {
				text: glyph,
				x,
				y,
				size,
				rotation: angle + Math.PI / 2,
				color:
					index === glyphs.length - 1
						? options.frame.palette.accent
						: options.frame.palette.foreground,
			},
		});
	}
}

function drawGearWords(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 5,
	});
	if (units.length === 0) return;
	const size = Math.min(
		options.height * 0.13,
		(options.width * 0.72) / Math.max(2, units.length * 2.3),
	);
	const row = kineticRow({
		centerX: options.width / 2,
		gap: size * 0.78,
		size,
		units,
	});
	const visible = Math.max(
		1,
		Math.min(
			units.length,
			Math.ceil((options.frame.progress / 0.56) * units.length),
		),
	);
	for (let index = 0; index < visible; index += 1) {
		const arrival = outBack({
			value: clamp01(
				(options.frame.progress * units.length - index * 0.56) / 0.32,
			),
			overshoot: 1.8,
		});
		const radius = size * 0.88 * Math.max(0.05, arrival);
		const rotation =
			(options.frame.progress * Math.PI * 4 + index * 0.45) *
			(index % 2 === 0 ? 1 : -1);
		drawGear({
			options,
			x: row[index].x,
			y: options.height / 2 + (index % 2 === 0 ? -size * 0.1 : size * 0.1),
			radius,
			rotation,
			accent: index % 2 === 1,
		});
		drawKineticLayoutText({
			options,
			text: {
				text: row[index].text,
				x: row[index].x,
				y: options.height / 2 + (index % 2 === 0 ? -size * 0.1 : size * 0.1),
				size: size * 0.74,
				rotation,
				color:
					index % 2 === 1
						? options.frame.palette.background
						: options.frame.palette.foreground,
			},
		});
	}
}

function drawGear({
	accent,
	options,
	radius,
	rotation,
	x,
	y,
}: {
	readonly accent: boolean;
	readonly options: TypographyLayoutOptions;
	readonly radius: number;
	readonly rotation: number;
	readonly x: number;
	readonly y: number;
}): void {
	options.ctx.save();
	options.ctx.translate(x, y);
	options.ctx.rotate(rotation);
	const color = accent
		? options.frame.palette.accent
		: options.frame.palette.secondary;
	for (let index = 0; index < 10; index += 1) {
		const angle = (index / 10) * Math.PI * 2;
		options.ctx.save();
		options.ctx.rotate(angle);
		drawKineticRule({
			options,
			x: radius * 0.72,
			y: -radius * 0.11,
			width: radius * 0.42,
			height: radius * 0.22,
			color,
		});
		options.ctx.restore();
	}
	drawKineticRule({
		options,
		x: -radius * 0.72,
		y: -radius * 0.72,
		width: radius * 1.44,
		height: radius * 1.44,
		color,
		alpha: 0.9,
	});
	options.ctx.restore();
}

function drawCollide(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 8,
	});
	if (units.length === 0) return;
	const split = Math.max(1, Math.ceil(units.length / 2));
	const left = units.slice(0, split).join(" ");
	const right = units.slice(split).join(" ") || units[units.length - 1];
	const size = Math.min(
		fitKineticText({
			text: `${left} ${right}`,
			width: options.width * 0.84,
			height: options.height * 0.22,
		}),
		options.height * 0.2,
	);
	const collision = 0.36;
	const before = options.frame.progress < collision;
	const local = before
		? clamp01(options.frame.progress / collision)
		: options.frame.progress - collision;
	const offset = before
		? (1 - local ** 1.6) * options.width * 0.65
		: -size * 0.28 * Math.exp(-local * 9) * Math.sin(local * 32);
	const squeeze = before ? 1 : 1 - 0.22 * Math.exp(-local * 18);
	drawKineticLayoutText({
		options,
		text: {
			text: left,
			x: options.width * 0.36 - offset,
			y: options.height / 2,
			size,
			scaleX: squeeze,
			color: options.frame.palette.accent,
		},
	});
	drawKineticLayoutText({
		options,
		text: {
			text: right,
			x: options.width * 0.64 + offset,
			y: options.height / 2,
			size,
			scaleX: squeeze,
		},
	});
	if (before) {
		for (let index = -2; index <= 2; index += 1) {
			drawKineticRule({
				options,
				x: options.width * 0.03,
				y: options.height / 2 + index * size * 0.22,
				width: options.width * 0.15 * local,
				height: Math.max(2, size * 0.025),
				color: options.frame.palette.secondary,
				alpha: local * 0.7,
			});
			drawKineticRule({
				options,
				x: options.width * (0.82 + 0.15 * (1 - local)),
				y: options.height / 2 - index * size * 0.22,
				width: options.width * 0.15 * local,
				height: Math.max(2, size * 0.025),
				color: options.frame.palette.secondary,
				alpha: local * 0.7,
			});
		}
	} else if (local < 0.3) {
		for (let index = 0; index < 12; index += 1) {
			const angle = (index / 12) * Math.PI * 2;
			options.ctx.save();
			options.ctx.translate(options.width / 2, options.height / 2);
			options.ctx.rotate(angle);
			drawKineticRule({
				options,
				x: size * (0.45 + local * 2),
				y: -2,
				width: size * 0.45,
				height: 4,
				color: options.frame.palette.accent,
				alpha: 1 - local / 0.3,
			});
			options.ctx.restore();
		}
	}
}

function drawTumble(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 5,
	});
	if (units.length === 0) return;
	const size = fitKineticText({
		text: units.join(" "),
		width: options.width * 0.68,
		height: options.height * 0.13,
		maxSize: options.height * 0.12,
	});
	const row = kineticRow({
		centerX: options.width / 2,
		gap: size * 0.42,
		size,
		units,
	});
	const floorY = options.height * 0.68;
	drawKineticRule({
		options,
		x: options.width * 0.08,
		y: floorY,
		width: options.width * 0.84 * outCubic(options.frame.progress * 2.4),
		height: Math.max(2, size * 0.035),
		color: options.frame.palette.secondary,
	});
	for (const [index, item] of row.entries()) {
		const local = clamp01(
			(options.frame.progress - (index / Math.max(1, units.length)) * 0.34) /
				0.48,
		);
		if (local <= 0) continue;
		const eased = outCubic(local);
		const x = lerp({
			start: options.width + size * (index + 1),
			end: item.x,
			progress: eased,
		});
		const y = floorY - size * 0.72 - bell(local) * size * 0.7;
		const rotation = (1 - eased) * -Math.PI * (2 + index * 0.5);
		options.ctx.save();
		options.ctx.translate(x, y);
		options.ctx.rotate(rotation);
		drawKineticRule({
			options,
			x: -item.width * 0.62,
			y: -size * 0.64,
			width: item.width * 1.24,
			height: size * 1.28,
			color:
				index % 2 === 0
					? options.frame.palette.secondary
					: options.frame.palette.accent,
			alpha: 0.82,
		});
		options.ctx.restore();
		drawKineticLayoutText({
			options,
			text: {
				text: item.text,
				x,
				y,
				size,
				rotation,
				color: options.frame.palette.background,
			},
		});
	}
}

function drawReflow(options: TypographyLayoutOptions): void {
	const glyphs = compactGlyphs(options.frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const verticalSize = Math.min(
		options.width * 0.1,
		(options.height * 0.72) / Math.max(3, Math.ceil(glyphs.length / 2)),
	);
	const horizontalSize = Math.min(
		options.height * 0.15,
		(options.width * 0.78) / Math.max(2, glyphs.length * 0.68),
	);
	const columns = glyphs.length > 7 ? 2 : 1;
	const perColumn = Math.ceil(glyphs.length / columns);
	for (const [index, glyph] of glyphs.entries()) {
		const column = Math.floor(index / perColumn);
		const row = index % perColumn;
		const verticalX =
			options.width / 2 + (column - (columns - 1) / 2) * verticalSize * 1.4;
		const verticalY =
			options.height / 2 + (row - (perColumn - 1) / 2) * verticalSize * 1.1;
		const horizontalX =
			options.width / 2 +
			(index - (glyphs.length - 1) / 2) * horizontalSize * 0.72;
		const horizontalY = options.height / 2;
		const progress = inOutCubic(
			(options.frame.progress - 0.28 - index * 0.012) / 0.38,
		);
		const arc =
			bell(progress) * options.height * 0.18 * (index % 2 === 0 ? 1 : -1);
		drawKineticLayoutText({
			options,
			text: {
				text: glyph,
				x: lerp({ start: verticalX, end: horizontalX, progress }),
				y: lerp({ start: verticalY, end: horizontalY, progress }) + arc,
				size: lerp({ start: verticalSize, end: horizontalSize, progress }),
				rotation: degrees(90 * (1 - progress)) + bell(progress) * degrees(45),
			},
		});
	}
}

function drawPadGrid(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 6,
	});
	if (units.length === 0) return;
	const columns = units.length <= 3 ? units.length : 3;
	const rows = Math.ceil(units.length / columns);
	const gap = Math.min(options.width, options.height) * 0.025;
	const gridWidth = options.width * 0.82;
	const gridHeight = options.height * 0.62;
	const cellWidth = (gridWidth - gap * (columns - 1)) / columns;
	const cellHeight = (gridHeight - gap * (rows - 1)) / rows;
	const startX = options.width / 2 - gridWidth / 2;
	const startY = options.height / 2 - gridHeight / 2;
	for (let index = 0; index < columns * rows; index += 1) {
		const row = Math.floor(index / columns);
		const column = index % columns;
		const x = startX + column * (cellWidth + gap);
		const y = startY + row * (cellHeight + gap);
		const arrival = outBack({
			value: clamp01((options.frame.progress - index * 0.035) / 0.24),
			overshoot: 1.4,
		});
		if (arrival <= 0) continue;
		drawKineticRule({
			options,
			x: x + (cellWidth * (1 - arrival)) / 2,
			y: y + (cellHeight * (1 - arrival)) / 2,
			width: cellWidth * arrival,
			height: cellHeight * arrival,
			color: options.frame.palette.secondary,
			alpha: 0.7,
		});
		if (index >= units.length) continue;
		const hit = clamp01(
			(options.frame.progress * units.length - index * 0.48) / 0.32,
		);
		if (hit <= 0) continue;
		const flash = Math.exp(-hit * 4.5);
		drawKineticRule({
			options,
			x: x + gap * 0.32,
			y: y + gap * 0.32,
			width: cellWidth - gap * 0.64,
			height: cellHeight - gap * 0.64,
			color: options.frame.palette.accent,
			alpha: 0.12 + flash * 0.88,
		});
		const size = fitKineticText({
			text: units[index],
			width: cellWidth * 0.72,
			height: cellHeight * 0.42,
			maxSize: cellHeight * 0.38,
		});
		drawKineticLayoutText({
			options,
			text: {
				text: units[index],
				x: x + cellWidth / 2,
				y: y + cellHeight / 2,
				size: size * (1 + flash * 0.12),
				color:
					flash > 0.45
						? options.frame.palette.background
						: options.frame.palette.foreground,
			},
		});
	}
}
