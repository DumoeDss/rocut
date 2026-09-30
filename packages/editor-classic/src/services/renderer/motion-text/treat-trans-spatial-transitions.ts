import {
	bell,
	drawScaled,
	drawTransitionLine,
	eased,
	easedOut,
	transitionBoundary,
	transitionProgress,
	transitionRandom,
	transitionRandomSigned,
	type TreatTransTransitionDraw,
	withTransitionClip,
} from "./treat-trans-transition-drawing";

const SPATIAL_TRANSITIONS = new Set([
	"pushSlide",
	"cover",
	"uncover",
	"zoomThrough",
	"whipPan",
	"spinOut",
	"shatterTiles",
	"sliceShift",
	"cubeTurn",
	"flashCross",
]);

export function drawTreatTransSpatialTransition(
	options: TreatTransTransitionDraw,
): boolean {
	const transition = options.frame.cut?.preset.trans;
	if (!transition || !SPATIAL_TRANSITIONS.has(transition)) return false;
	if (transitionBoundary(options)) return true;
	switch (transition) {
		case "pushSlide":
			drawPushSlide(options);
			break;
		case "cover":
			drawCover(options);
			break;
		case "uncover":
			drawUncover(options);
			break;
		case "zoomThrough":
			drawZoomThrough(options);
			break;
		case "whipPan":
			drawWhipPan(options);
			break;
		case "spinOut":
			drawSpinOut(options);
			break;
		case "shatterTiles":
			drawShatterTiles(options);
			break;
		case "sliceShift":
			drawSliceShift(options);
			break;
		case "cubeTurn":
			drawCubeTurn(options);
			break;
		case "flashCross":
			drawFlashCross(options);
			break;
	}
	return true;
}

function drawPushSlide(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const vertical = transitionRandom(options, 1101) > 0.72;
	const direction = transitionRandom(options, 1102) > 0.62 ? 1 : -1;
	const distance = vertical ? options.height : options.width;
	const offset = progress * distance * direction;
	drawTranslated(options, {
		draw: options.drawPrevious,
		x: vertical ? 0 : offset,
		y: vertical ? offset : 0,
	});
	drawTranslated(options, {
		draw: options.drawCurrent,
		x: vertical ? 0 : offset - distance * direction,
		y: vertical ? offset - distance * direction : 0,
	});
	const edge = direction < 0 ? distance + offset : offset;
	drawTransitionLine(options, {
		alpha: bell(transitionProgress(options)),
		from: vertical ? [0, edge] : [edge, 0],
		to: vertical ? [options.width, edge] : [edge, options.height],
		width: Math.max(2, Math.min(options.width, options.height) * 0.006),
	});
}

function drawCover(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const direction = transitionRandom(options, 1111) > 0.5 ? 1 : -1;
	drawTranslated(options, {
		draw: options.drawPrevious,
		x: options.width * progress * 0.14 * direction,
		y: 0,
	});
	options.ctx.save();
	options.ctx.globalAlpha *= progress * 0.42;
	options.ctx.fillStyle = "#000000";
	options.ctx.fillRect(0, 0, options.width, options.height);
	options.ctx.restore();
	const x = (1 - progress) * options.width * -direction;
	drawTranslated(options, { draw: options.drawCurrent, x, y: 0 });
	const edge = direction > 0 ? x + options.width : x;
	drawSoftEdge(options, {
		alpha: bell(transitionProgress(options)),
		edge,
		vertical: true,
	});
}

function drawUncover(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const direction = transitionRandom(options, 1121) > 0.5 ? 1 : -1;
	drawScaled(options, {
		draw: options.drawCurrent,
		scaleX: 1.05 - 0.05 * easedOut(options),
	});
	options.ctx.save();
	options.ctx.globalAlpha *= (1 - progress) * 0.35;
	options.ctx.fillStyle = "#000000";
	options.ctx.fillRect(0, 0, options.width, options.height);
	options.ctx.restore();
	const x = options.width * progress * direction;
	drawTranslated(options, { draw: options.drawPrevious, x, y: 0 });
	const edge = direction > 0 ? x : options.width + x;
	drawSoftEdge(options, {
		alpha: bell(transitionProgress(options)),
		edge,
		vertical: true,
	});
}

function drawZoomThrough(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	drawScaled(options, {
		draw: options.drawCurrent,
		scaleX: 0.84 + 0.16 * easedOut(options),
	});
	const oldAlpha = Math.max(0, 1 - progress * 1.12) ** 3;
	if (oldAlpha <= 0.003) return;
	drawScaled(options, {
		alpha: oldAlpha,
		draw: options.drawPrevious,
		scaleX: 1 + 1.05 * progress ** 1.4,
	});
	drawScaled(options, {
		alpha: oldAlpha * 0.28,
		draw: options.drawPrevious,
		scaleX: 1.03 + 1.14 * progress ** 1.4,
	});
}

function drawWhipPan(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const easedProgress =
		progress < 0.5 ? 8 * progress ** 4 : 1 - 8 * (1 - progress) ** 4;
	const direction = transitionRandom(options, 1131) > 0.65 ? 1 : -1;
	const offset = options.width * easedProgress * direction;
	const blur = Math.sin(Math.PI * progress) ** 2;
	const taps = 5;
	for (let index = 0; index < taps; index += 1) {
		const smear = (index / (taps - 1) - 0.5) * options.width * 0.13 * blur;
		drawTranslated(options, {
			alpha: 1 / (index + 1),
			draw: options.drawPrevious,
			x: offset + smear,
			y: 0,
		});
		drawTranslated(options, {
			alpha: 1 / (index + 1),
			draw: options.drawCurrent,
			x: offset - options.width * direction + smear,
			y: 0,
		});
	}
}

function drawSpinOut(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const easedProgress = progress ** 3;
	const direction = transitionRandom(options, 1141) > 0.5 ? 1 : -1;
	drawScaled(options, {
		draw: options.drawCurrent,
		scaleX: 1.08 - 0.08 * easedOut(options),
	});
	if (1 - easedProgress <= 0.004) return;
	drawScaled(options, {
		draw: options.drawPrevious,
		rotation: direction * Math.PI * easedProgress,
		scaleX: 1 - easedProgress,
	});
	options.ctx.save();
	options.ctx.globalAlpha *= Math.min(1, progress * 5) * bell(progress);
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		options.width * 0.48,
		options.height * 0.48,
		options.width * 0.04,
		options.height * 0.04,
	);
	options.ctx.restore();
}

function drawShatterTiles(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const columns = 7;
	const rows = 4;
	const tileWidth = options.width / columns;
	const tileHeight = options.height / rows;
	options.drawCurrent();
	options.ctx.save();
	options.ctx.globalAlpha *= 0.25 * (1 - easedOut(options));
	options.ctx.fillStyle = "#000000";
	options.ctx.fillRect(0, 0, options.width, options.height);
	options.ctx.restore();
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const delay = Math.min(
				0.55,
				Math.hypot(column - columns / 2, row - rows / 2) * 0.035 +
					transitionRandom(options, row, column, 1151) * 0.08,
			);
			const phase = Math.min(1, Math.max(0, (progress - delay) / 0.45));
			const x = column * tileWidth;
			const y = row * tileHeight;
			const centerX = x + tileWidth / 2;
			const centerY = y + tileHeight / 2;
			const dx =
				transitionRandomSigned(options, row, column, 1152) *
				options.width *
				0.12 *
				phase;
			const dy = phase ** 2 * options.height * 1.18;
			const rotation =
				transitionRandomSigned(options, row, column, 1153) * 1.1 * phase;
			const scale = 1 - phase * 0.24;
			const alpha = Math.max(0, 1 - Math.max(0, phase - 0.68) / 0.32);
			if (alpha <= 0.003) continue;
			options.ctx.save();
			options.ctx.translate(centerX + dx, centerY + dy);
			options.ctx.rotate(rotation);
			options.ctx.scale(scale, scale);
			options.ctx.translate(-centerX, -centerY);
			options.ctx.beginPath();
			options.ctx.rect(x, y, tileWidth + 1, tileHeight + 1);
			options.ctx.clip();
			options.ctx.globalAlpha *= alpha;
			options.drawPrevious();
			options.ctx.restore();
		}
	}
}

function drawSliceShift(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	const count = 7;
	const stripHeight = options.height / count;
	for (let index = 0; index < count; index += 1) {
		const direction = index % 2 === 0 ? -1 : 1;
		const delay = (index / (count - 1)) * 0.28;
		const phase = Math.min(1, Math.max(0, (progress - delay) / 0.72));
		const shift =
			options.width *
			direction *
			(phase < 0.5 ? 4 * phase ** 3 : 1 - (-2 * phase + 2) ** 3 / 2);
		withTransitionClip(
			options,
			[0, index * stripHeight, options.width, stripHeight + 1],
			() => {
				drawTranslated(options, { draw: options.drawPrevious, x: shift, y: 0 });
				drawTranslated(options, {
					draw: options.drawCurrent,
					x: shift - options.width * direction,
					y: 0,
				});
			},
		);
	}
	options.ctx.save();
	options.ctx.globalAlpha *= bell(progress) * 0.7;
	options.ctx.fillStyle = options.frame.palette.accent;
	for (let index = 1; index < count; index += 1) {
		options.ctx.fillRect(0, index * stripHeight - 1, options.width, 2);
	}
	options.ctx.restore();
}

function drawCubeTurn(options: TreatTransTransitionDraw): void {
	const progress = eased(options);
	const direction = transitionRandom(options, 1161) > 0.5 ? 1 : -1;
	const previousScale = Math.max(0.03, Math.cos((progress * Math.PI) / 2));
	const currentScale = Math.max(0.03, Math.sin((progress * Math.PI) / 2));
	drawScaled(options, {
		draw: options.drawPrevious,
		scaleX: previousScale,
		scaleY: 1 - (1 - previousScale) * 0.16,
		translateX: -direction * options.width * (1 - previousScale) * 0.48,
	});
	drawScaled(options, {
		draw: options.drawCurrent,
		scaleX: currentScale,
		scaleY: 1 - (1 - currentScale) * 0.16,
		translateX: direction * options.width * (1 - currentScale) * 0.48,
	});
	options.ctx.save();
	options.ctx.globalAlpha *= bell(progress) * 0.28;
	options.ctx.fillStyle = "#000000";
	options.ctx.fillRect(
		options.width * 0.48,
		0,
		options.width * 0.04,
		options.height,
	);
	options.ctx.restore();
}

function drawFlashCross(options: TreatTransTransitionDraw): void {
	const progress = transitionProgress(options);
	options.ctx.save();
	options.ctx.globalAlpha *= Math.max(0, 1 - progress * 1.7);
	options.drawPrevious();
	options.ctx.restore();
	options.ctx.save();
	options.ctx.globalAlpha *= Math.max(0, (progress - 0.3) / 0.45);
	options.drawCurrent();
	options.ctx.restore();
	const flash =
		progress < 0.45
			? (progress / 0.45) ** 2
			: (1 - (progress - 0.45) / 0.55) ** 3;
	options.ctx.save();
	options.ctx.globalAlpha *= flash * 0.92;
	options.ctx.fillStyle =
		transitionRandom(options, 1171) > 0.7
			? options.frame.palette.accent
			: "#ffffff";
	options.ctx.fillRect(0, 0, options.width, options.height);
	options.ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- Translation geometry is separate from the transition drawing callbacks.
function drawTranslated(
	options: TreatTransTransitionDraw,
	input: {
		readonly alpha?: number;
		readonly draw: () => void;
		readonly x: number;
		readonly y: number;
	},
): void {
	options.ctx.save();
	options.ctx.translate(input.x, input.y);
	options.ctx.globalAlpha *= input.alpha ?? 1;
	input.draw();
	options.ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- Edge geometry is separate from the transition drawing callbacks.
function drawSoftEdge(
	options: TreatTransTransitionDraw,
	input: {
		readonly alpha: number;
		readonly edge: number;
		readonly vertical: boolean;
	},
): void {
	const width = Math.min(options.width, options.height) * 0.05;
	const strips = 5;
	for (let index = 0; index < strips; index += 1) {
		options.ctx.save();
		options.ctx.globalAlpha *= input.alpha * (1 - index / strips) * 0.22;
		options.ctx.fillStyle = "#000000";
		if (input.vertical) {
			options.ctx.fillRect(
				input.edge - width / 2 + (index * width) / strips,
				0,
				width / strips + 1,
				options.height,
			);
		} else {
			options.ctx.fillRect(
				0,
				input.edge - width / 2 + (index * width) / strips,
				options.width,
				width / strips + 1,
			);
		}
		options.ctx.restore();
	}
}
