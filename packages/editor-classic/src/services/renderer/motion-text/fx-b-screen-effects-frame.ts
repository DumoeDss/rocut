import {
	drawFxBScaled,
	fxBPhase,
	fxBPulse,
	fxBSigned,
	fxBUnit,
	replaceFxBFrame,
	type FxBPixelEffectDraw,
} from "./fx-b-screen-effect-types";

const FRAME_EFFECTS = new Set([
	"rotateSnap",
	"echoFrames",
	"filmAdvance",
	"perspectiveTilt",
	"zoomStutter",
	"shatter",
	"snapshot",
	"squash",
	"loopScroll",
]);

export function drawFxBFrameEffect(options: FxBPixelEffectDraw): boolean {
	if (!FRAME_EFFECTS.has(options.effect)) return false;
	switch (options.effect) {
		case "rotateSnap":
			drawRotateSnap(options);
			break;
		case "echoFrames":
			drawEchoFrames(options);
			break;
		case "filmAdvance":
			drawFilmAdvance(options);
			break;
		case "perspectiveTilt":
			drawPerspectiveTilt(options);
			break;
		case "zoomStutter":
			drawZoomStutter(options);
			break;
		case "shatter":
			drawShatter(options);
			break;
		case "snapshot":
			drawSnapshot(options);
			break;
		case "squash":
			drawSquash(options);
			break;
		case "loopScroll":
			drawLoopScroll(options);
			break;
	}
	return true;
}

function drawRotateSnap(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const direction = fxBUnit(options, 42_001) < 0.5 ? -1 : 1;
	const angle =
		direction *
		(0.035 + fxBUnit(options, 42_002) * 0.045) *
		Math.cos(phase * Math.PI * 3) *
		(1 - phase * 0.78);
	replaceFxBFrame(options, () => {
		options.ctx.translate(options.width / 2, options.height / 2);
		options.ctx.rotate(angle);
		options.ctx.scale(
			1.04 + Math.abs(angle) * 0.35,
			1.04 + Math.abs(angle) * 0.35,
		);
		options.ctx.drawImage(
			options.source,
			-options.width / 2,
			-options.height / 2,
		);
	});
}

function drawEchoFrames(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const angle = fxBUnit(options, 42_101) * Math.PI * 2;
	const distance =
		Math.min(options.width, options.height) * (0.02 + phase * 0.04);
	options.ctx.globalCompositeOperation = "screen";
	for (let echo = 5; echo >= 1; echo -= 1) {
		options.ctx.globalAlpha = (1 - phase * 0.72) * (0.09 + echo * 0.025);
		options.ctx.drawImage(
			options.source,
			Math.cos(angle) * distance * echo,
			Math.sin(angle) * distance * echo,
			options.width,
			options.height,
		);
	}
}

function drawFilmAdvance(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const direction = fxBUnit(options, 42_201) < 0.7 ? 1 : -1;
	const scale = 0.8 + Math.sin(Math.PI * phase) * 0.06;
	const frameWidth = options.width * scale;
	const frameHeight = options.height * scale;
	const x = (options.width - frameWidth) / 2;
	const pitch = frameHeight + options.height * 0.055;
	const offset = direction * phase * pitch;
	replaceFxBFrame(options, () => {
		if (options.compositionMode === "scene") {
			options.ctx.fillStyle = "#100d0b";
			options.ctx.fillRect(0, 0, options.width, options.height);
		}
		for (let frame = -1; frame <= 1; frame += 1) {
			options.ctx.globalAlpha = 0.72 + (frame === 0 ? 0.28 : 0);
			options.ctx.drawImage(
				options.source,
				x,
				(options.height - frameHeight) / 2 + frame * pitch - offset,
				frameWidth,
				frameHeight,
			);
		}
		options.ctx.globalAlpha = 0.82;
		options.ctx.fillStyle = options.frame.palette.foreground;
		const holeWidth = Math.max(3, x * 0.18);
		const holeHeight = Math.max(3, options.height * 0.022);
		for (let y = -holeHeight; y < options.height; y += holeHeight * 2.4) {
			const shiftedY =
				y +
				(((offset % (holeHeight * 2.4)) + holeHeight * 2.4) %
					(holeHeight * 2.4));
			options.ctx.fillRect(x * 0.28, shiftedY, holeWidth, holeHeight);
			options.ctx.fillRect(
				options.width - x * 0.28 - holeWidth,
				shiftedY,
				holeWidth,
				holeHeight,
			);
		}
	});
}

function drawPerspectiveTilt(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const vertical = fxBUnit(options, 42_301) < 0.65;
	const direction = fxBUnit(options, 42_302) < 0.5 ? -1 : 1;
	const tilt = direction * Math.sin(Math.PI * phase) * 0.34;
	const strips = 28;
	replaceFxBFrame(options, () => {
		for (let strip = 0; strip < strips; strip += 1) {
			const normalized = (strip + 0.5) / strips - 0.5;
			const perspective = 1 + normalized * tilt;
			if (vertical) {
				const sourceX = (strip / strips) * options.width;
				const stripWidth = options.width / strips + 1;
				const height = options.height * perspective;
				options.ctx.drawImage(
					options.source,
					sourceX,
					0,
					stripWidth,
					options.height,
					sourceX,
					(options.height - height) / 2,
					stripWidth + 1,
					height,
				);
			} else {
				const sourceY = (strip / strips) * options.height;
				const stripHeight = options.height / strips + 1;
				const width = options.width * perspective;
				options.ctx.drawImage(
					options.source,
					0,
					sourceY,
					options.width,
					stripHeight,
					(options.width - width) / 2,
					sourceY,
					width,
					stripHeight + 1,
				);
			}
		}
	});
}

function drawZoomStutter(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const step = Math.min(2, Math.floor(phase * 3));
	const scale = 1.045 + step * 0.052;
	const cx = options.width * (0.5 + fxBSigned(options, 42_401 + step) * 0.04);
	const cy = options.height * (0.5 + fxBSigned(options, 42_411 + step) * 0.04);
	replaceFxBFrame(options, () => {
		drawFxBScaled({ centerX: cx, centerY: cy, options, scaleX: scale });
	});
}

function drawShatter(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const separation = Math.sin(Math.PI * phase);
	const columns = 4;
	const rows = 3;
	replaceFxBFrame(options, () => {
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const index = row * columns + column;
				const sourceX = (column / columns) * options.width;
				const sourceY = (row / rows) * options.height;
				const width = options.width / columns + 1;
				const height = options.height / rows + 1;
				const centerX = sourceX + width / 2;
				const centerY = sourceY + height / 2;
				const dx = centerX - options.width / 2;
				const dy = centerY - options.height / 2;
				const length = Math.hypot(dx, dy) || 1;
				const travel =
					Math.min(options.width, options.height) *
					separation *
					(0.025 + fxBUnit(options, 42_500 + index) * 0.035);
				options.ctx.save();
				options.ctx.translate(
					centerX + (dx / length) * travel,
					centerY + (dy / length) * travel,
				);
				options.ctx.rotate(
					fxBSigned(options, 42_600 + index) * separation * 0.06,
				);
				options.ctx.drawImage(
					options.source,
					sourceX,
					sourceY,
					width,
					height,
					-width / 2,
					-height / 2,
					width,
					height,
				);
				options.ctx.restore();
			}
		}
	});
	options.ctx.globalAlpha = 0.45 * (1 - separation);
	options.ctx.strokeStyle = options.frame.palette.foreground;
	options.ctx.lineWidth = Math.max(
		1,
		Math.min(options.width, options.height) * 0.002,
	);
	options.ctx.beginPath();
	for (let ray = 0; ray < 9; ray += 1) {
		const angle =
			(ray / 9) * Math.PI * 2 + fxBUnit(options, 42_700 + ray) * 0.24;
		options.ctx.moveTo?.(options.width / 2, options.height / 2);
		options.ctx.lineTo?.(
			options.width / 2 + Math.cos(angle) * options.width,
			options.height / 2 + Math.sin(angle) * options.height,
		);
	}
	options.ctx.stroke?.();
}

function drawSnapshot(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const envelope = Math.sin(Math.PI * phase);
	const scale = 1 - envelope * 0.18;
	const angle = (fxBUnit(options, 42_801) < 0.5 ? -1 : 1) * envelope * 0.055;
	const frameWidth = options.width * scale;
	const frameHeight = options.height * scale;
	const border = Math.min(options.width, options.height) * 0.027 * envelope;
	replaceFxBFrame(options, () => {
		options.ctx.translate(options.width / 2, options.height / 2);
		options.ctx.rotate(angle);
		options.ctx.fillStyle = "#f7f4ec";
		options.ctx.fillRect(
			-frameWidth / 2 - border,
			-frameHeight / 2 - border,
			frameWidth + border * 2,
			frameHeight + border * 3.5,
		);
		options.ctx.drawImage(
			options.source,
			-frameWidth / 2,
			-frameHeight / 2,
			frameWidth,
			frameHeight,
		);
	});
	if (phase < 0.18) {
		options.ctx.globalAlpha = 1 - phase / 0.18;
		options.ctx.fillStyle = "#ffffff";
		options.ctx.fillRect(0, 0, options.width, options.height);
	}
}

function drawSquash(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const horizontal = fxBUnit(options, 42_901) < 0.6;
	const spring = Math.cos(phase * Math.PI * 5) * Math.exp(-1.9 * phase) * 0.18;
	const scaleX = horizontal ? 1 + spring : 1 - spring * 0.58;
	const scaleY = horizontal ? 1 - spring * 0.58 : 1 + spring;
	replaceFxBFrame(options, () => {
		drawFxBScaled({ options, scaleX, scaleY });
	});
}

function drawLoopScroll(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const vertical =
		fxBUnit(options, 43_001) < (options.width < options.height ? 0.6 : 0.2);
	const direction = fxBUnit(options, 43_002) < 0.5 ? -1 : 1;
	const eased = phase * phase * (3 - 2 * phase);
	replaceFxBFrame(options, () => {
		if (vertical) {
			const offset =
				(((eased * options.height * direction) % options.height) +
					options.height) %
				options.height;
			options.ctx.drawImage(
				options.source,
				0,
				offset - options.height,
				options.width,
				options.height,
			);
			options.ctx.drawImage(
				options.source,
				0,
				offset,
				options.width,
				options.height,
			);
		} else {
			const offset =
				(((eased * options.width * direction) % options.width) +
					options.width) %
				options.width;
			options.ctx.drawImage(
				options.source,
				offset - options.width,
				0,
				options.width,
				options.height,
			);
			options.ctx.drawImage(
				options.source,
				offset,
				0,
				options.width,
				options.height,
			);
		}
	});
	options.ctx.globalAlpha = fxBPulse(options) * 0.08;
	drawFxBScaled({ options, scaleX: 1.015 });
}
