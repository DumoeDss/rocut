import {
	fillFxBSource,
	fxBPhase,
	fxBPulse,
	fxBSigned,
	fxBStep,
	fxBUnit,
	replaceFxBFrame,
	type FxBPixelEffectDraw,
} from "./fx-b-screen-effect-types";

const SIGNAL_EFFECTS = new Set([
	"pixelSort",
	"interlace",
	"macroBlock",
	"ditherBit",
	"tvStatic",
	"edgeDetect",
	"scanBar",
]);

export function drawFxBSignalEffect(options: FxBPixelEffectDraw): boolean {
	if (!SIGNAL_EFFECTS.has(options.effect)) return false;
	switch (options.effect) {
		case "pixelSort":
			drawPixelSort(options);
			break;
		case "interlace":
			drawInterlace(options);
			break;
		case "macroBlock":
			drawMacroBlock(options);
			break;
		case "ditherBit":
			drawDitherBit(options);
			break;
		case "tvStatic":
			drawTvStatic(options);
			break;
		case "edgeDetect":
			drawEdgeDetect(options);
			break;
		case "scanBar":
			drawScanBar(options);
			break;
	}
	return true;
}

function drawPixelSort(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const step = fxBStep(options);
	const startX =
		options.width * (0.05 + fxBUnit(options, step + 43_101) * 0.25);
	const endX = Math.min(
		options.width,
		startX + options.width * (0.46 + fxBUnit(options, step + 43_102) * 0.32),
	);
	let x = startX;
	let column = 0;
	while (x < endX && column < 80) {
		const width = Math.max(
			1,
			options.width *
				(0.003 + fxBUnit(options, step * 97 + column + 43_200) * 0.009),
		);
		const sourceY =
			options.height * (0.28 + fxBUnit(options, column + 43_300) * 0.3);
		const sourceHeight =
			options.height * (0.07 + fxBUnit(options, column + 43_400) * 0.1);
		const destinationHeight =
			sourceHeight *
			(1.2 + fxBUnit(options, column + 43_500) * 2.2) *
			(0.4 + phase);
		options.ctx.globalAlpha = 0.45 + phase * 0.45;
		options.ctx.drawImage(
			options.source,
			x,
			sourceY,
			width,
			sourceHeight,
			x,
			sourceY,
			width,
			destinationHeight,
		);
		x += width;
		column += 1;
	}
}

function drawInterlace(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const rowHeight = Math.max(2, Math.round(options.height / 90));
	const offset = options.width * (0.008 + phase * 0.025);
	replaceFxBFrame(options, () => {
		for (let y = 0, row = 0; y < options.height; y += rowHeight, row += 1) {
			const direction = row % 2 === 0 ? 1 : -1;
			options.ctx.drawImage(
				options.source,
				0,
				y,
				options.width,
				rowHeight,
				direction * offset,
				y,
				options.width,
				rowHeight,
			);
		}
	});
	options.ctx.globalAlpha = 0.18 + phase * 0.2;
	options.ctx.fillStyle = options.frame.palette.background;
	for (let y = rowHeight; y < options.height; y += rowHeight * 2) {
		options.ctx.fillRect(0, y, options.width, Math.max(1, rowHeight * 0.38));
	}
}

function drawMacroBlock(options: FxBPixelEffectDraw): void {
	const step = fxBStep(options, 18);
	const size = Math.max(
		8,
		Math.round(Math.min(options.width, options.height) / 18),
	);
	for (let block = 0; block < 14; block += 1) {
		const salt = step * 149 + block * 17 + 43_600;
		const width = size * (1 + Math.floor(fxBUnit(options, salt) * 4));
		const height = size * (1 + Math.floor(fxBUnit(options, salt + 1) * 2));
		const x =
			Math.floor(
				(fxBUnit(options, salt + 2) * (options.width - width)) / size,
			) * size;
		const y =
			Math.floor(
				(fxBUnit(options, salt + 3) * (options.height - height)) / size,
			) * size;
		const dx = fxBSigned(options, salt + 4) * size * 2;
		options.ctx.globalAlpha = 0.45 + fxBUnit(options, salt + 5) * 0.45;
		options.ctx.imageSmoothingEnabled = block % 3 !== 0;
		options.ctx.drawImage(
			options.source,
			x,
			y,
			width,
			height,
			x + dx,
			y,
			width,
			height,
		);
	}
	options.ctx.imageSmoothingEnabled = true;
}

function drawDitherBit(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const cell = Math.max(
		3,
		Math.round(Math.min(options.width, options.height) / 76),
	);
	options.ctx.save();
	if (options.compositionMode === "overlay") {
		options.ctx.globalCompositeOperation = "source-atop";
	}
	options.ctx.fillStyle = options.frame.palette.foreground;
	for (let y = 0, row = 0; y < options.height; y += cell, row += 1) {
		for (let x = 0, column = 0; x < options.width; x += cell, column += 1) {
			const threshold = ((column & 3) * 4 + (row & 3)) / 16;
			if ((threshold + phase) % 1 < 0.48) continue;
			options.ctx.globalAlpha = 0.34 + threshold * 0.38;
			const dot = cell * (0.25 + threshold * 0.55);
			options.ctx.fillRect(
				x + (cell - dot) / 2,
				y + (cell - dot) / 2,
				dot,
				dot,
			);
		}
	}
	options.ctx.restore();
}

function drawTvStatic(options: FxBPixelEffectDraw): void {
	const step = fxBStep(options, 30);
	const pulse = fxBPulse(options);
	options.ctx.save();
	if (options.compositionMode === "overlay") {
		options.ctx.globalCompositeOperation = "source-atop";
	}
	for (let grain = 0; grain < 72; grain += 1) {
		const salt = step * 211 + grain * 7 + 44_000;
		const light = fxBUnit(options, salt) > 0.5;
		options.ctx.fillStyle = light ? "#ffffff" : "#080808";
		options.ctx.globalAlpha = (0.12 + fxBUnit(options, salt + 1) * 0.5) * pulse;
		const width = options.width * (0.003 + fxBUnit(options, salt + 2) * 0.018);
		const height = Math.max(
			1,
			options.height * (0.002 + fxBUnit(options, salt + 3) * 0.008),
		);
		options.ctx.fillRect(
			fxBUnit(options, salt + 4) * options.width,
			fxBUnit(options, salt + 5) * options.height,
			width,
			height,
		);
	}
	options.ctx.restore();
}

function drawEdgeDetect(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const offset = Math.max(
		1,
		Math.min(options.width, options.height) * (0.003 + phase * 0.006),
	);
	options.ctx.globalCompositeOperation = "difference";
	options.ctx.globalAlpha = 0.7;
	options.ctx.drawImage(
		options.source,
		offset,
		offset,
		options.width,
		options.height,
	);
	options.ctx.globalCompositeOperation = "screen";
	options.ctx.globalAlpha = 0.26 + phase * 0.24;
	options.ctx.drawImage(
		options.source,
		-offset,
		offset * 0.5,
		options.width,
		options.height,
	);
	fillFxBSource({
		alpha: 0.2 + phase * 0.16,
		color: options.frame.palette.accent,
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
}

function drawScanBar(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const down = fxBUnit(options, 44_101) < 0.7;
	const barHeight = options.height * 0.045;
	const y = down
		? -barHeight + phase * (options.height + barHeight * 2)
		: options.height + barHeight - phase * (options.height + barHeight * 2);
	const dimY = down ? Math.max(0, y) : 0;
	const dimHeight = down ? options.height - dimY : Math.min(options.height, y);
	if (dimHeight > 0) {
		fillFxBSource({
			alpha: 0.36,
			color: options.frame.palette.background,
			height: dimHeight,
			options,
			width: options.width,
			x: 0,
			y: dimY,
		});
	}
	const sourceY = Math.min(options.height - 1, Math.max(0, y - barHeight));
	const sourceHeight = Math.min(barHeight, options.height - sourceY);
	if (sourceHeight > 1) {
		for (let slice = 0; slice < 3; slice += 1) {
			const height = sourceHeight / 3;
			options.ctx.drawImage(
				options.source,
				0,
				sourceY + slice * height,
				options.width,
				height,
				fxBSigned(options, fxBStep(options) * 13 + slice + 44_200) *
					options.width *
					0.012,
				sourceY + slice * height,
				options.width,
				height,
			);
		}
	}
	fillFxBSource({
		alpha: 0.72,
		color: options.frame.palette.accent,
		height: Math.max(2, options.height * 0.006),
		options,
		width: options.width,
		x: 0,
		y: y - options.height * 0.003,
	});
}
