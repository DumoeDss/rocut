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
	outExpo,
	stableIndex,
} from "./kinetic-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawKineticStageLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "knSlamStack":
			drawSlamStack(options);
			return true;
		case "knQuarterTurn":
			drawQuarterTurn(options);
			return true;
		case "knSwapCenter":
			drawSwapCenter(options);
			return true;
		case "knZoomDive":
			drawZoomDive(options);
			return true;
		case "knFlowSnap":
			drawFlowSnap(options);
			return true;
		case "knSeesaw":
			drawSeesaw(options);
			return true;
		case "knTypeSlam":
			drawTypeSlam(options);
			return true;
		default:
			return false;
	}
}

function drawSlamStack(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 5,
	});
	if (units.length === 0) return;
	const visible = Math.max(
		1,
		Math.min(
			units.length,
			Math.ceil((options.frame.progress / 0.56) * units.length),
		),
	);
	const rawSizes = units.slice(0, visible).map((text) =>
		fitKineticText({
			text,
			width: options.width * 0.78,
			height: options.height * 0.28,
			maxSize: options.height * 0.25,
		}),
	);
	const rawHeight = rawSizes.reduce((sum, size) => sum + size * 1.08, 0);
	const fit = Math.min(1, (options.height * 0.72) / Math.max(1, rawHeight));
	const sizes = rawSizes.map((size) => size * fit);
	const total = sizes.reduce((sum, size) => sum + size * 1.08, 0);
	const accent = stableIndex({ count: units.length, options, salt: 401 });
	let cursor = options.height / 2 - total / 2;
	for (let index = 0; index < visible; index += 1) {
		const size = sizes[index];
		const y = cursor + size / 2;
		cursor += size * 1.08;
		const arrival = clamp01(
			(options.frame.progress * units.length - index * 0.56) / 0.24,
		);
		const settled = outExpo(arrival);
		drawKineticLayoutText({
			options,
			text: {
				text: units[index],
				x: options.width / 2,
				y,
				size,
				alpha: clamp01(arrival * 5),
				color:
					index === accent
						? options.frame.palette.accent
						: options.frame.palette.foreground,
				rotation: degrees((1 - settled) * (index % 2 === 0 ? -8 : 8)),
				scaleX: 1 + (1 - settled) * 1.6,
				scaleY: 1 + (1 - settled) * 1.6,
			},
		});
		if (index < visible - 1) {
			drawKineticRule({
				options,
				x: options.width * 0.12,
				y: cursor - size * 0.02,
				width: options.width * 0.76 * settled,
				height: Math.max(2, size * 0.035),
				color: options.frame.palette.secondary,
				alpha: 0.7,
			});
		}
	}
}

function drawQuarterTurn(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 4,
	});
	if (units.length === 0) return;
	const visible = Math.max(
		1,
		Math.min(
			units.length,
			Math.ceil((options.frame.progress / 0.52) * units.length),
		),
	);
	const size = fitKineticText({
		text: units.reduce((longest, value) =>
			value.length > longest.length ? value : longest,
		),
		width: options.width * 0.34,
		height: options.height * 0.18,
		maxSize: options.height * 0.16,
	});
	const step = Math.min(options.width * 0.21, size * 2.1);
	const startX = options.width / 2 - ((visible - 1) * step) / 2;
	for (let index = 0; index < visible; index += 1) {
		const angle = index % 2 === 0 ? 0 : index % 4 === 1 ? 90 : -90;
		const x = startX + index * step;
		const y =
			options.height / 2 + (index % 2 === 0 ? -size * 0.42 : size * 0.42);
		const arrival = clamp01(
			(options.frame.progress * units.length - index * 0.52) / 0.28,
		);
		drawKineticLayoutText({
			options,
			text: {
				text: units[index],
				x,
				y,
				size,
				rotation: degrees(angle),
				scaleX: outBack({ value: arrival, overshoot: 2.1 }),
				scaleY: outBack({ value: arrival, overshoot: 2.1 }),
				alpha: clamp01(arrival * 4),
				color:
					index === 1
						? options.frame.palette.accent
						: options.frame.palette.foreground,
			},
		});
		if (index > 0) {
			drawKineticRule({
				options,
				x: x - step / 2 - size * 0.08,
				y: options.height / 2 - size * 0.08,
				width: size * 0.16,
				height: size * 0.16,
				color: options.frame.palette.accent,
			});
		}
	}
}

function drawSwapCenter(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 6,
	});
	if (units.length === 0) return;
	const progress = options.frame.progress;
	if (progress < 0.56) {
		const position = (progress / 0.56) * units.length;
		const current = Math.min(units.length - 1, Math.floor(position));
		const local = position - current;
		const size = fitKineticText({
			text: units[current],
			width: options.width * 0.78,
			height: options.height * 0.34,
			maxSize: options.height * 0.31,
		});
		if (current > 0 && local < 0.8) {
			drawKineticLayoutText({
				options,
				text: {
					text: units[current - 1],
					x: options.width / 2,
					y: options.height / 2 - size * local,
					size,
					alpha: 1 - local,
					scaleY: Math.max(0.05, 1 - local),
				},
			});
		}
		drawKineticLayoutText({
			options,
			text: {
				text: units[current],
				x: options.width / 2,
				y: options.height / 2 + size * (1 - local),
				size,
				scaleY: Math.max(0.08, local),
				color:
					current % 2 === 1
						? options.frame.palette.accent
						: options.frame.palette.foreground,
			},
		});
		for (let index = 0; index < units.length; index += 1) {
			drawKineticRule({
				options,
				x: options.width / 2 + (index - (units.length - 1) / 2) * size * 0.32,
				y: options.height * 0.76,
				width: size * 0.2,
				height: Math.max(3, size * 0.045),
				color:
					index <= current
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				alpha: index <= current ? 1 : 0.4,
			});
		}
		return;
	}
	const settle = outExpo((progress - 0.56) / 0.32);
	const size = fitKineticText({
		text: units.join(" "),
		width: options.width * 0.82,
		height: options.height * 0.16,
		maxSize: options.height * 0.14,
	});
	for (const [index, item] of kineticRow({
		centerX: options.width / 2,
		gap: size * 0.34,
		size,
		units,
	}).entries()) {
		drawKineticLayoutText({
			options,
			text: {
				text: item.text,
				x: lerp({ start: options.width / 2, end: item.x, progress: settle }),
				y: options.height / 2,
				size,
				alpha: index === units.length - 1 ? 1 : settle,
				scaleX:
					index === units.length - 1
						? lerp({ start: 2, end: 1, progress: settle })
						: settle,
				scaleY:
					index === units.length - 1
						? lerp({ start: 2, end: 1, progress: settle })
						: settle,
			},
		});
	}
}

function drawZoomDive(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 5,
	});
	if (units.length === 0) return;
	const position = clamp01(options.frame.progress / 0.62) * units.length;
	const current = Math.min(units.length - 1, Math.floor(position));
	const local = position - current;
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	if (current > 0 && local < 0.82) {
		const scale = Math.exp(local ** 1.6 * Math.log(16));
		const previous = units[current - 1];
		drawKineticLayoutText({
			options,
			text: {
				text: previous,
				x: centerX,
				y: centerY,
				size: fitKineticText({
					text: previous,
					width: options.width * 0.72,
					height: options.height * 0.3,
				}),
				scaleX: scale,
				scaleY: scale,
				alpha: 1 - clamp01((local - 0.5) / 0.32),
			},
		});
	}
	const text = units[current];
	const arrival =
		current === 0 ? outExpo(local + 0.3) : outExpo((local - 0.22) / 0.6);
	drawKineticLayoutText({
		options,
		text: {
			text,
			x: centerX,
			y: centerY,
			size: fitKineticText({
				text,
				width: options.width * 0.72,
				height: options.height * 0.3,
			}),
			scaleX: Math.max(0.03, arrival),
			scaleY: Math.max(0.03, arrival),
			alpha: clamp01(arrival * 3),
			color:
				current % 2 === 1
					? options.frame.palette.accent
					: options.frame.palette.foreground,
		},
	});
	if (current === units.length - 1 && local > 0.65) {
		drawKineticRule({
			options,
			x: options.width * 0.2,
			y: options.height * 0.72,
			width: options.width * 0.6 * outCubic((local - 0.65) / 0.35),
			height: Math.max(2, options.height * 0.009),
			color: options.frame.palette.secondary,
		});
	}
}

function drawFlowSnap(options: TypographyLayoutOptions): void {
	const glyphs = compactGlyphs(options.frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const columns = Math.max(2, Math.ceil(Math.sqrt(glyphs.length * 1.5)));
	const rows = Math.ceil(glyphs.length / columns);
	const size = Math.min(
		options.height * 0.14,
		(options.width * 0.72) / Math.max(1, columns * 0.72),
		(options.height * 0.58) / Math.max(1, rows * 1.25),
	);
	const snap = inOutCubic((options.frame.progress - 0.36) / 0.28);
	for (const [index, glyph] of glyphs.entries()) {
		const row = Math.floor(index / columns);
		const column = index % columns;
		const targetX =
			options.width / 2 + (column - (columns - 1) / 2) * size * 0.95;
		const targetY = options.height / 2 + (row - (rows - 1) / 2) * size * 1.22;
		const pathX =
			options.width * 1.12 -
			outCubic(options.frame.progress / 0.48) * options.width * 0.95 +
			index * size * 0.48;
		const pathY =
			options.height / 2 +
			Math.sin(index * 0.85 + options.frame.progress * 8) *
				options.height *
				0.13;
		drawKineticLayoutText({
			options,
			text: {
				text: glyph,
				x: lerp({ start: pathX, end: targetX, progress: snap }),
				y: lerp({ start: pathY, end: targetY, progress: snap }),
				size,
				rotation:
					Math.atan(Math.cos(index * 0.85 + options.frame.progress * 8) * 0.5) *
					(1 - snap),
				color:
					index === glyphs.length - 1
						? options.frame.palette.accent
						: options.frame.palette.foreground,
			},
		});
	}
	if (snap > 0.05) {
		for (let row = 0; row <= rows; row += 1) {
			drawKineticRule({
				options,
				x: options.width / 2 - (columns * size * 0.95) / 2,
				y: options.height / 2 + (row - rows / 2) * size * 1.22 - size * 0.02,
				width: columns * size * 0.95 * snap,
				height: Math.max(1, size * 0.025),
				color: options.frame.palette.secondary,
				alpha: 0.55,
			});
		}
	}
}

function drawSeesaw(options: TypographyLayoutOptions): void {
	const units = kineticUnits({
		text: options.frame.cut?.text ?? "",
		maximum: 6,
	});
	if (units.length === 0) return;
	const size = fitKineticText({
		text: units.join(" "),
		width: options.width * 0.7,
		height: options.height * 0.14,
		maxSize: options.height * 0.13,
	});
	const row = kineticRow({
		centerX: options.width / 2,
		gap: size * 0.34,
		size,
		units,
	});
	const visible = Math.max(
		1,
		Math.min(
			units.length,
			Math.ceil((options.frame.progress / 0.55) * units.length),
		),
	);
	const angle =
		degrees(10) *
		Math.sin(visible * 1.7 + options.frame.progress * 7) *
		(1 - clamp01((options.frame.progress - 0.48) / 0.3));
	const plankY = options.height * 0.62;
	options.ctx.save();
	options.ctx.translate(options.width / 2, plankY);
	options.ctx.rotate(angle);
	drawKineticRule({
		options,
		x: -options.width * 0.39,
		y: -Math.max(3, size * 0.06),
		width: options.width * 0.78,
		height: Math.max(6, size * 0.12),
		color: options.frame.palette.secondary,
		alpha: 0.9,
	});
	options.ctx.restore();
	drawKineticRule({
		options,
		x: options.width / 2 - size * 0.25,
		y: plankY + size * 0.08,
		width: size * 0.5,
		height: size * 0.46,
		color: options.frame.palette.accent,
	});
	for (let index = 0; index < visible; index += 1) {
		const arrival = clamp01(
			(options.frame.progress * units.length - index * 0.55) / 0.3,
		);
		const offset = row[index].x - options.width / 2;
		const x = options.width / 2 + Math.cos(angle) * offset;
		const landedY = plankY + Math.sin(angle) * offset - size * 0.62;
		drawKineticLayoutText({
			options,
			text: {
				text: units[index],
				x,
				y: landedY - (1 - outCubic(arrival)) * options.height * 0.5,
				size,
				rotation: angle,
				scaleX: 1 + bell(arrival) * 0.12,
				scaleY: 1 - bell(arrival) * 0.18,
			},
		});
	}
}

function drawTypeSlam(options: TypographyLayoutOptions): void {
	const fullText = options.frame.cut?.text.trim() ?? "";
	if (!fullText) return;
	const characters = Array.from(fullText);
	const units = kineticUnits({ text: fullText, maximum: 6 });
	const key = units.reduce((longest, value) =>
		Array.from(value).length > Array.from(longest).length ? value : longest,
	);
	const typeProgress = clamp01(options.frame.progress / 0.42);
	const count = Math.max(1, Math.ceil(typeProgress * characters.length));
	const typed = characters.slice(0, count).join("");
	const typedSize = fitKineticText({
		text: fullText,
		width: options.width * 0.82,
		height: options.height * 0.08,
		maxSize: options.height * 0.07,
	});
	const typedY = options.height * 0.72;
	drawKineticLayoutText({
		options,
		text: {
			text: typed,
			x: options.width * 0.09,
			y: typedY,
			size: typedSize,
			align: "left",
			color: options.frame.palette.secondary,
		},
	});
	const typedWidth = fitApproximateWidth({ text: typed, size: typedSize });
	drawKineticRule({
		options,
		x: options.width * 0.09 + typedWidth + typedSize * 0.12,
		y: typedY - typedSize * 0.52,
		width: Math.max(3, typedSize * 0.11),
		height: typedSize,
		color: options.frame.palette.accent,
	});
	if (options.frame.progress < 0.36) return;
	const slam = clamp01((options.frame.progress - 0.36) / 0.18);
	const eased = outExpo(slam);
	const keySize = fitKineticText({
		text: key,
		width: options.width * 0.76,
		height: options.height * 0.3,
		maxSize: options.height * 0.28,
	});
	drawKineticLayoutText({
		options,
		text: {
			text: key,
			x: options.width / 2,
			y: options.height * 0.42,
			size: keySize,
			alpha: clamp01(slam * 5),
			scaleX: 1 + (1 - eased) * 2.4,
			scaleY: 1 + (1 - eased) * 2.4,
		},
	});
	if (slam > 0.65) drawBurst({ options, size: keySize, progress: slam });
}

function drawBurst({
	options,
	size,
	progress,
}: {
	readonly options: TypographyLayoutOptions;
	readonly progress: number;
	readonly size: number;
}): void {
	const alpha = 1 - clamp01((progress - 0.65) / 0.35);
	for (let index = 0; index < 10; index += 1) {
		const angle = (index / 10) * Math.PI * 2;
		options.ctx.save();
		options.ctx.translate(
			options.width / 2 + Math.cos(angle) * size * 0.78,
			options.height * 0.42 + Math.sin(angle) * size * 0.55,
		);
		options.ctx.rotate(angle);
		drawKineticRule({
			options,
			x: 0,
			y: -Math.max(1, size * 0.018),
			width: size * 0.32,
			height: Math.max(2, size * 0.036),
			color: options.frame.palette.accent,
			alpha,
		});
		options.ctx.restore();
	}
}

function fitApproximateWidth({
	text,
	size,
}: {
	readonly size: number;
	readonly text: string;
}): number {
	return Array.from(text).reduce(
		(total, character) => total + size * (/\s/u.test(character) ? 0.34 : 0.62),
		0,
	);
}
