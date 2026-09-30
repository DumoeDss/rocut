import {
	clamp01,
	clipEnterAPolygon,
	drawEnterAClipped,
	drawEnterAGlyphs,
	drawEnterALine,
	drawEnterARing,
	drawEnterAWhole,
	enterABounds,
	enterADirection,
	enterAInCubic,
	enterAInOutQuart,
	enterAOutQuart,
	enterAOutQuint,
	enterAPhase,
	enterARandom,
	enterASmooth,
	lerp,
	type EnterADraw,
} from "./enter-a-drawing";

export function drawEnterAMaskFamily(options: EnterADraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "vSlice":
			drawVerticalSlice(options);
			return true;
		case "shutter":
			drawShutter(options);
			return true;
		case "iris":
			drawIris(options);
			return true;
		case "diagWipe":
			drawDiagonalWipe(options);
			return true;
		case "blinds":
			drawBlinds(options);
			return true;
		case "checker":
			drawChecker(options);
			return true;
		case "randomOrder":
			drawRandomOrder(options);
			return true;
		default:
			return false;
	}
}

function drawVerticalSlice(options: EnterADraw): void {
	const bounds = enterABounds(options, options.size * 0.3);
	const columns = Math.max(
		4,
		Math.min(8, Math.round(bounds.width / (options.size * 0.55))),
	);
	const width = bounds.width / columns;
	const distance = bounds.height * 0.9 + options.size * 1.4;
	for (let index = 0; index < columns; index += 1) {
		const centerOrder =
			columns > 1
				? Math.abs(index - (columns - 1) / 2) / ((columns - 1) / 2)
				: 0;
		const progress = enterAPhase({
			options,
			order: centerOrder,
			spread: 0.5,
		});
		if (progress <= 0) continue;
		drawEnterAClipped({
			alpha: clamp01(options.frame.enterProgress * 3),
			height: bounds.height,
			left: bounds.left + index * width,
			options,
			top: bounds.top,
			translateY:
				(index % 2 === 0 ? -1 : 1) * distance * (1 - enterAOutQuint(progress)),
			width: width + 0.8,
		});
	}
}

function drawShutter(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterABounds(options, options.size * 0.2);
	const grow = enterAOutQuint(progress / 0.32);
	const open = enterAInOutQuart((progress - 0.18) / 0.82);
	const halfHeight = (bounds.height / 2) * open;
	drawEnterAClipped({
		height: halfHeight * 2,
		left: bounds.left,
		options,
		top: bounds.centerY - halfHeight,
		width: bounds.width,
	});
	const alpha = 1 - enterASmooth({ start: 0.6, end: 0.9, value: progress });
	if (alpha <= 0) return;
	const lineWidth = Math.max(2, options.size * 0.03);
	const length = bounds.width * grow;
	for (const y of [bounds.centerY - halfHeight, bounds.centerY + halfHeight]) {
		drawEnterALine({
			alpha,
			color: options.frame.palette.accent,
			from: [bounds.centerX - length / 2, y],
			options,
			to: [bounds.centerX + length / 2, y],
			width: lineWidth,
		});
	}
}

function drawIris(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const eased = enterAOutQuart(progress);
	const bounds = enterABounds(options, options.size * 0.25);
	const radius = Math.hypot(bounds.width, bounds.height) * 0.52 * eased;
	options.ctx.save();
	options.ctx.beginPath();
	if (options.ctx.arc) {
		options.ctx.arc(
			bounds.centerX,
			bounds.centerY,
			Math.max(0.01, radius),
			0,
			Math.PI * 2,
		);
	} else {
		options.ctx.rect(
			bounds.centerX - radius,
			bounds.centerY - radius,
			radius * 2,
			radius * 2,
		);
	}
	options.ctx.clip();
	drawEnterAWhole({
		options,
		scaleX: lerp({ start: 1.14, end: 1, progress: eased }),
		scaleY: lerp({ start: 1.14, end: 1, progress: eased }),
	});
	options.ctx.restore();
	drawEnterARing({
		alpha: 1 - enterASmooth({ start: 0.3, end: 0.8, value: progress }),
		color: options.frame.palette.accent,
		options,
		radius,
		width: Math.max(2, options.size * 0.03),
		x: bounds.centerX,
		y: bounds.centerY,
	});
}

function drawDiagonalWipe(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterABounds(options, options.size * 0.2);
	const direction = enterADirection(options, 17);
	const lead = lerp({
		start: bounds.left - bounds.height,
		end: bounds.right + bounds.height,
		progress: enterAOutQuart(progress / 0.5),
	});
	const trail = lerp({
		start: bounds.left - bounds.height,
		end: bounds.right + bounds.height,
		progress: enterAInOutQuart((progress - 0.18) / 0.74),
	});
	const slant = direction * bounds.height * 0.5;
	clipEnterAPolygon({
		draw: () => drawEnterAWhole({ options }),
		options,
		points: [
			[bounds.left - options.size, bounds.top],
			[trail - slant, bounds.top],
			[trail + slant, bounds.bottom],
			[bounds.left - options.size, bounds.bottom],
		],
	});
	if (lead - trail <= 0.5) return;
	clipEnterAPolygon({
		draw: () => {
			const baseAlpha = options.ctx.globalAlpha;
			const baseFill = options.ctx.fillStyle;
			options.ctx.globalAlpha = baseAlpha * 0.9;
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillRect(
				bounds.left - bounds.height,
				bounds.top,
				bounds.width + bounds.height * 2,
				bounds.height,
			);
			options.ctx.globalAlpha = baseAlpha;
			options.ctx.fillStyle = baseFill;
		},
		options,
		points: [
			[trail - slant, bounds.top],
			[lead - slant, bounds.top],
			[lead + slant, bounds.bottom],
			[trail + slant, bounds.bottom],
		],
	});
}

function drawBlinds(options: EnterADraw): void {
	const bounds = enterABounds(options, options.size * 0.2);
	const pitch = Math.max(options.size * 0.2, bounds.height / 32);
	const rows = Math.max(1, Math.ceil(bounds.height / pitch));
	let any = false;
	options.ctx.save();
	options.ctx.beginPath();
	for (let row = 0; row < rows; row += 1) {
		const order = rows > 1 ? row / (rows - 1) : 0;
		const progress = enterAPhase({ options, order, spread: 0.55 });
		if (progress <= 0) continue;
		const center = bounds.top + (row + 0.5) * pitch;
		const halfHeight = pitch * 0.5 * enterAOutQuart(progress) + 0.4;
		options.ctx.rect(
			bounds.left,
			center - halfHeight,
			bounds.width,
			halfHeight * 2,
		);
		any = true;
	}
	if (any) {
		options.ctx.clip();
		drawEnterAWhole({ options });
	}
	options.ctx.restore();
}

function drawChecker(options: EnterADraw): void {
	const bounds = enterABounds(options, options.size * 0.15);
	let cell = options.size * 0.34;
	while ((bounds.width / cell) * (bounds.height / cell) > 320) cell *= 1.25;
	const columns = Math.ceil(bounds.width / cell);
	const rows = Math.ceil(bounds.height / cell);
	const originX = bounds.centerX - (columns * cell) / 2;
	const originY = bounds.centerY - (rows * cell) / 2;
	let any = false;
	options.ctx.save();
	options.ctx.beginPath();
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const order = columns > 1 ? column / (columns - 1) : 0;
			const delay =
				((column + row) & 1) * 0.25 +
				order * 0.3 +
				enterARandom(options, column + row * columns, 7) * 0.08;
			const progress = clamp01((options.frame.enterProgress - delay) / 0.22);
			if (progress <= 0) continue;
			const halfSize = cell * 0.5 * enterAOutQuart(progress) + 0.5;
			const centerX = originX + (column + 0.5) * cell;
			const centerY = originY + (row + 0.5) * cell;
			options.ctx.rect(
				centerX - halfSize,
				centerY - halfSize,
				halfSize * 2,
				halfSize * 2,
			);
			any = true;
		}
	}
	if (any) {
		options.ctx.clip();
		drawEnterAWhole({ options });
	}
	options.ctx.restore();
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.fillStyle = options.frame.palette.accent;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const order = columns > 1 ? column / (columns - 1) : 0;
			const delay =
				((column + row) & 1) * 0.25 +
				order * 0.3 +
				enterARandom(options, column + row * columns, 7) * 0.08;
			const progress = clamp01((options.frame.enterProgress - delay) / 0.22);
			if (progress <= 0 || progress >= 0.75) continue;
			const halfSize =
				cell *
				0.5 *
				(1 - enterAInCubic(progress / 0.75)) *
				Math.min(1, progress * 6);
			if (halfSize <= 0.5) continue;
			options.ctx.globalAlpha = baseAlpha * 0.9;
			options.ctx.fillRect(
				originX + (column + 0.5) * cell - halfSize,
				originY + (row + 0.5) * cell - halfSize,
				halfSize * 2,
				halfSize * 2,
			);
		}
	}
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

function drawRandomOrder(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const delay = enterARandom(options, glyph.index, 61) * 0.62;
			const progress = clamp01((options.frame.enterProgress - delay) / 0.38);
			if (progress <= 0) return null;
			return {
				alpha: clamp01(progress * 6),
				color: progress < 0.42 ? options.frame.palette.accent : undefined,
				scaleX: lerp({
					start: 1.45,
					end: 1,
					progress: enterAOutQuint(progress),
				}),
				scaleY: lerp({
					start: 1.45,
					end: 1,
					progress: enterAOutQuint(progress),
				}),
			};
		},
	});
}
