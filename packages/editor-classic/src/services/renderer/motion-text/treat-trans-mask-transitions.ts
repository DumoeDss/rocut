import {
	bell,
	drawTransitionLine,
	eased,
	transitionBoundary,
	transitionGrid,
	transitionProgress,
	transitionRandom,
	type TreatTransTransitionDraw,
	withCircleClip,
	withTransitionClip,
} from "./treat-trans-transition-drawing";

const MASK_TRANSITIONS = new Set([
	"wipe",
	"diagonalWipe",
	"clockWipe",
	"irisOpen",
	"doorsOpen",
	"blinds",
	"checker",
	"blockDissolve",
	"inkBlob",
	"pixelate",
]);

export function drawTreatTransMaskTransition(
	options: TreatTransTransitionDraw,
): boolean {
	const transition = options.frame.cut?.preset.trans;
	if (!transition || !MASK_TRANSITIONS.has(transition)) return false;
	if (transitionBoundary(options)) return true;
	switch (transition) {
		case "wipe":
			drawWipe(options);
			break;
		case "diagonalWipe":
			drawDiagonalWipe(options);
			break;
		case "clockWipe":
			drawClockWipe(options);
			break;
		case "irisOpen":
			drawIrisOpen(options);
			break;
		case "doorsOpen":
			drawDoorsOpen(options);
			break;
		case "blinds":
			drawBlinds(options);
			break;
		case "checker":
			drawChecker(options);
			break;
		case "blockDissolve":
			drawBlockDissolve(options);
			break;
		case "inkBlob":
			drawInkBlob(options);
			break;
		case "pixelate":
			drawPixelate(options);
			break;
	}
	return true;
}

function drawWipe(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const direction = Math.floor(transitionRandom(options, 1001) * 4);
	options.drawPrevious();
	const rect = wipeRect(options, progress, direction);
	withTransitionClip(options, rect, options.drawCurrent);
	const edge = Math.max(3, Math.min(options.width, options.height) * 0.008);
	const alpha = bell(transitionProgress(options));
	if (direction < 2) {
		const x = direction === 0 ? rect[2] : rect[0];
		drawTransitionLine(options, {
			alpha,
			from: [x, 0],
			to: [x, options.height],
			width: edge,
		});
	} else {
		const y = direction === 2 ? rect[3] : rect[1];
		drawTransitionLine(options, {
			alpha,
			from: [0, y],
			to: [options.width, y],
			width: edge,
		});
	}
}

function drawDiagonalWipe(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const bands = 18;
	const bandHeight = options.height / bands;
	const slope =
		(transitionRandom(options, 1011) > 0.5 ? 1 : -1) * options.width * 0.22;
	options.drawPrevious();
	for (let index = 0; index < bands; index += 1) {
		const across = index / Math.max(1, bands - 1) - 0.5;
		const width = Math.max(
			0,
			Math.min(options.width, options.width * progress - slope * across),
		);
		withTransitionClip(
			options,
			[0, index * bandHeight, width, bandHeight + 1],
			options.drawCurrent,
		);
	}
	const x = options.width * progress;
	drawTransitionLine(options, {
		alpha: bell(transitionProgress(options)),
		from: [x - slope / 2, 0],
		to: [x + slope / 2, options.height],
		width: Math.max(4, options.height * 0.035),
	});
}

function drawClockWipe(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	const radius = Math.hypot(options.width, options.height);
	const start = -Math.PI / 2;
	const end = start + Math.PI * 2 * progress;
	options.drawPrevious();
	if (options.ctx.arc && options.ctx.moveTo && options.ctx.lineTo) {
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.moveTo(centerX, centerY);
		options.ctx.arc(centerX, centerY, radius, start, end);
		options.ctx.lineTo(centerX, centerY);
		options.ctx.clip();
		options.drawCurrent();
		options.ctx.restore();
	} else {
		const wedges = 48;
		for (let index = 0; index < Math.ceil(wedges * progress); index += 1) {
			const x = (index / wedges) * options.width;
			withTransitionClip(
				options,
				[x, 0, options.width / wedges + 1, options.height],
				options.drawCurrent,
			);
		}
	}
	drawTransitionLine(options, {
		alpha: bell(transitionProgress(options)),
		from: [centerX, centerY],
		to: [centerX + Math.cos(end) * radius, centerY + Math.sin(end) * radius],
		width: Math.max(3, options.height * 0.008),
	});
}

function drawIrisOpen(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const x = options.width * (0.44 + transitionRandom(options, 1021) * 0.12);
	const y = options.height * (0.44 + transitionRandom(options, 1022) * 0.12);
	const radius =
		Math.hypot(
			Math.max(x, options.width - x),
			Math.max(y, options.height - y),
		) * progress;
	options.drawPrevious();
	withCircleClip(options, { radius, x, y }, options.drawCurrent);
	drawIrisRim(options, {
		alpha: bell(transitionProgress(options)),
		radius,
		x,
		y,
	});
}

function drawDoorsOpen(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const half = options.width / 2;
	options.drawCurrent();
	withTransitionClip(options, [0, 0, half, options.height], () => {
		options.ctx.save();
		options.ctx.translate(-half * progress, 0);
		options.drawPrevious();
		options.ctx.restore();
	});
	withTransitionClip(options, [half, 0, half, options.height], () => {
		options.ctx.save();
		options.ctx.translate(half * progress, 0);
		options.drawPrevious();
		options.ctx.restore();
	});
	const edge = half * progress;
	drawTransitionLine(options, {
		alpha: bell(transitionProgress(options)),
		from: [half - edge, 0],
		to: [half - edge, options.height],
		width: Math.max(2, options.height * 0.006),
	});
	drawTransitionLine(options, {
		alpha: bell(transitionProgress(options)),
		from: [half + edge, 0],
		to: [half + edge, options.height],
		width: Math.max(2, options.height * 0.006),
	});
}

function drawBlinds(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const count = 9;
	const height = options.height / count;
	options.drawPrevious();
	for (let index = 0; index < count; index += 1) {
		const phase = Math.min(
			1,
			Math.max(0, progress * 1.55 - (index / count) * 0.55),
		);
		const revealed = height * phase;
		withTransitionClip(
			options,
			[0, index * height, options.width, revealed],
			options.drawCurrent,
		);
		if (phase > 0 && phase < 1) {
			options.ctx.globalAlpha *= 1 - phase;
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillRect(0, index * height + revealed, options.width, 2);
			options.ctx.globalAlpha /= 1 - phase;
		}
	}
}

function drawChecker(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const grid = transitionGrid(options, 5);
	options.drawPrevious();
	for (let row = 0; row < grid.rows; row += 1) {
		for (let column = 0; column < grid.columns; column += 1) {
			const delay =
				((row + column) % 2) * 0.28 +
				((row + column) / (grid.rows + grid.columns)) * 0.18;
			const phase = Math.min(1, Math.max(0, (progress - delay) / 0.54));
			if (phase <= 0) continue;
			const size = grid.cell * (1 - (1 - phase) ** 3);
			const x = column * grid.cell + (grid.cell - size) / 2;
			const y = row * grid.cell + (grid.cell - size) / 2;
			withTransitionClip(
				options,
				[x, y, size + 1, size + 1],
				options.drawCurrent,
			);
		}
	}
}

function drawBlockDissolve(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const grid = transitionGrid(options, 8);
	options.drawPrevious();
	for (let row = 0; row < grid.rows; row += 1) {
		for (let column = 0; column < grid.columns; column += 1) {
			const trigger =
				0.03 + transitionRandom(options, row, column, 1031) * 0.82;
			if (progress < trigger) continue;
			const x = column * grid.cell;
			const y = row * grid.cell;
			withTransitionClip(
				options,
				[x, y, grid.cell + 1, grid.cell + 1],
				options.drawCurrent,
			);
			const flash = 1 - (progress - trigger) / 0.11;
			if (flash <= 0) continue;
			options.ctx.save();
			options.ctx.globalAlpha *= flash * 0.72;
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillRect(x, y, grid.cell + 1, grid.cell + 1);
			options.ctx.restore();
		}
	}
}

function drawInkBlob(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const centerX =
		options.width * (0.46 + transitionRandom(options, 1041) * 0.12);
	const centerY =
		options.height * (0.42 + transitionRandom(options, 1042) * 0.18);
	const radius = Math.hypot(options.width, options.height) * 0.66 * progress;
	options.drawPrevious();
	withCircleClip(
		options,
		{ radius, x: centerX, y: centerY },
		options.drawCurrent,
	);
	for (let index = 0; index < 7; index += 1) {
		const angle =
			(index / 7) * Math.PI * 2 + transitionRandom(options, index, 1043);
		const lobeRadius =
			radius * (0.18 + transitionRandom(options, index, 1044) * 0.12);
		const distance =
			radius * (0.78 + transitionRandom(options, index, 1045) * 0.18);
		withCircleClip(
			options,
			{
				radius: lobeRadius,
				x: centerX + Math.cos(angle) * distance,
				y: centerY + Math.sin(angle) * distance,
			},
			options.drawCurrent,
		);
	}
	drawIrisRim(options, {
		alpha: bell(transitionProgress(options)) * 0.72,
		radius: radius * 1.02,
		x: centerX,
		y: centerY,
	});
}

function drawPixelate(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const grid = transitionGrid(options, 12);
	options.drawPrevious();
	for (let row = 0; row < grid.rows; row += 1) {
		for (let column = 0; column < grid.columns; column += 1) {
			const order = transitionRandom(options, row, column, 1051);
			const current = progress > 0.08 + order * 0.72;
			const x = column * grid.cell;
			const y = row * grid.cell;
			if (current) {
				withTransitionClip(
					options,
					[x, y, grid.cell + 1, grid.cell + 1],
					options.drawCurrent,
				);
			}
			const mosaic = Math.max(0, 1 - Math.abs(progress - 0.5) * 2);
			if (mosaic <= 0.05 || (row + column) % 3 !== 0) continue;
			options.ctx.save();
			options.ctx.globalAlpha *= mosaic * 0.28;
			options.ctx.fillStyle =
				(row + column) % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary;
			options.ctx.fillRect(x, y, grid.cell + 1, grid.cell + 1);
			options.ctx.restore();
		}
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- Progress and direction are the wipe's compact scalar inputs.
function wipeRect(
	options: TreatTransTransitionDraw,
	progress: number,
	direction: number,
): readonly [number, number, number, number] {
	if (direction === 0) return [0, 0, options.width * progress, options.height];
	if (direction === 1) {
		return [
			options.width * (1 - progress),
			0,
			options.width * progress,
			options.height,
		];
	}
	if (direction === 2) return [0, 0, options.width, options.height * progress];
	return [
		0,
		options.height * (1 - progress),
		options.width,
		options.height * progress,
	];
}

// eslint-disable-next-line opencut/prefer-object-params -- Rim geometry is separate from the transition drawing callbacks.
function drawIrisRim(
	options: TreatTransTransitionDraw,
	input: {
		readonly alpha: number;
		readonly radius: number;
		readonly x: number;
		readonly y: number;
	},
): void {
	if (input.alpha <= 0.01 || input.radius <= 0.1) return;
	const segments = 32;
	const width = Math.max(2, Math.min(options.width, options.height) * 0.009);
	for (let index = 0; index < segments; index += 1) {
		const start = (index / segments) * Math.PI * 2;
		const end = ((index + 1) / segments) * Math.PI * 2;
		drawTransitionLine(options, {
			alpha: input.alpha,
			from: [
				input.x + Math.cos(start) * input.radius,
				input.y + Math.sin(start) * input.radius,
			],
			to: [
				input.x + Math.cos(end) * input.radius,
				input.y + Math.sin(end) * input.radius,
			],
			width,
		});
	}
}
