import { signedRandom, unitRandom } from "./deterministic-random";
import {
	drawHorrorSegment,
	lerp,
	localSeconds,
	outCubic,
} from "./horror-frame-utils";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface HorrorBackgroundDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawHorrorBackground(options: HorrorBackgroundDraw): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "hrFailingLamp":
			drawFailingLamp(options);
			return true;
		case "hrCorridor":
			drawCorridor(options);
			return true;
		case "hrMold":
			drawMold(options);
			return true;
		case "hrDeadTrees":
			drawDeadTrees(options);
			return true;
		default:
			return false;
	}
}

function drawFailingLamp(options: HorrorBackgroundDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const seconds = localSeconds(options.frame);
	const step = Math.floor(seconds * 24);
	const run = step >> 2;
	const fails = unitRandom({ seed: cut.seed, salt: 1010 + run }) < 0.13;
	const level = fails
		? unitRandom({ seed: cut.seed, salt: 2010 + step }) < 0.5
			? 0.15
			: 0.55
		: 0.88 + unitRandom({ seed: cut.seed, salt: 3010 + step }) * 0.12;
	const fade = outCubic(options.frame.localTime / 72_000);
	const centerX =
		options.width * (0.35 + unitRandom({ seed: cut.seed, salt: 4010 }) * 0.3);
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.globalAlpha = baseAlpha * fade * (0.22 + 0.48 * level);
	options.ctx.fillRect(
		centerX - unit * 0.12,
		unit * 0.012,
		unit * 0.24,
		Math.max(2, unit * 0.006),
	);
	for (let ray = 0; ray < 9; ray += 1) {
		const fraction = ray / 8;
		const bottomX = lerp({
			start: centerX - options.width * 0.42,
			end: centerX + options.width * 0.42,
			progress: fraction,
		});
		drawHorrorSegment({
			ctx: options.ctx,
			x0: centerX + (fraction - 0.5) * unit * 0.18,
			y0: unit * 0.03,
			x1: bottomX,
			y1: options.height,
			thickness: unit * 0.025,
			color: options.frame.palette.foreground,
			alpha: fade * level * (0.008 + Math.sin(Math.PI * fraction) * 0.012),
		});
	}
	options.ctx.fillStyle = options.frame.palette.background;
	options.ctx.globalAlpha = baseAlpha * fade * (0.24 + (1 - level) * 0.35);
	const edge = unit * 0.045;
	options.ctx.fillRect(0, 0, edge, options.height);
	options.ctx.fillRect(options.width - edge, 0, edge, options.height);
	options.ctx.fillRect(0, options.height - edge, options.width, edge);
	options.ctx.globalAlpha = baseAlpha;
}

function drawCorridor(options: HorrorBackgroundDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const seconds = localSeconds(options.frame);
	const fade = outCubic(options.frame.localTime / 72_000);
	const vanishingX =
		options.width * (0.44 + unitRandom({ seed: cut.seed, salt: 1101 }) * 0.12);
	const vanishingY =
		options.height * (0.44 + unitRandom({ seed: cut.seed, salt: 1102 }) * 0.1);
	const backWidth = options.width * 0.08;
	const backHeight = options.height * 0.1;
	const color = options.frame.palette.secondary;
	const thickness = Math.max(1.2, unit * 0.0026);
	const back = [
		[vanishingX - backWidth, vanishingY - backHeight],
		[vanishingX + backWidth, vanishingY - backHeight],
		[vanishingX + backWidth, vanishingY + backHeight],
		[vanishingX - backWidth, vanishingY + backHeight],
	] as const;
	const corners = [
		[0, 0],
		[options.width, 0],
		[options.width, options.height],
		[0, options.height],
	] as const;
	for (let index = 0; index < 4; index += 1) {
		drawHorrorSegment({
			ctx: options.ctx,
			x0: corners[index]![0],
			y0: corners[index]![1],
			x1: back[index]![0],
			y1: back[index]![1],
			thickness,
			color,
			alpha: fade * 0.72,
		});
	}
	drawRectOutline({
		...options,
		x0: vanishingX - backWidth,
		y0: vanishingY - backHeight,
		x1: vanishingX + backWidth,
		y1: vanishingY + backHeight,
		color,
		thickness,
		alpha: fade,
	});
	const speed = 0.25 + unitRandom({ seed: cut.seed, salt: 1103 }) * 0.2;
	for (let index = 0; index < 7; index += 1) {
		const wrapped = (index / 7 + seconds * speed * 0.12) % 1;
		const depth = wrapped ** 2.2;
		const x0 = lerp({ start: vanishingX - backWidth, end: 0, progress: depth });
		const x1 = lerp({
			start: vanishingX + backWidth,
			end: options.width,
			progress: depth,
		});
		const y0 = lerp({
			start: vanishingY - backHeight,
			end: 0,
			progress: depth,
		});
		const y1 = lerp({
			start: vanishingY + backHeight,
			end: options.height,
			progress: depth,
		});
		drawRectOutline({
			...options,
			x0,
			y0,
			x1,
			y1,
			color,
			thickness,
			alpha: fade * (0.34 + depth * 0.5),
		});
		if (index % 2 !== 0) continue;
		const doorHeight = (y1 - y0) * 0.42;
		const doorWidth = Math.max(unit * 0.015, (x1 - x0) * 0.08);
		drawRectOutline({
			...options,
			x0,
			y0: y1 - doorHeight,
			x1: x0 + doorWidth,
			y1,
			color,
			thickness,
			alpha: fade * 0.55,
		});
		drawRectOutline({
			...options,
			x0: x1 - doorWidth,
			y0: y1 - doorHeight,
			x1,
			y1,
			color,
			thickness,
			alpha: fade * 0.55,
		});
	}
	const lampStep = Math.floor(seconds * 24);
	const lampLevel =
		unitRandom({ seed: cut.seed, salt: 1200 + lampStep }) < 0.12 ? 0.2 : 0.85;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.globalAlpha = baseAlpha * fade * lampLevel * 0.34;
	options.ctx.fillRect(
		vanishingX - backWidth * 0.45,
		vanishingY - backHeight * 0.55,
		backWidth * 0.9,
		Math.max(2, backHeight * 0.08),
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawMold(options: HorrorBackgroundDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const seconds = localSeconds(options.frame);
	const fade = outCubic(options.frame.localTime / 96_000);
	const baseAlpha = options.ctx.globalAlpha;
	for (let cluster = 0; cluster < 4; cluster += 1) {
		const edge = Math.floor(
			unitRandom({ seed: cut.seed, salt: 1300 + cluster }) * 4,
		);
		const along = unitRandom({ seed: cut.seed, salt: 1310 + cluster });
		const centerX =
			edge === 1 ? options.width : edge === 3 ? 0 : along * options.width;
		const centerY =
			edge === 0 ? 0 : edge === 2 ? options.height : along * options.height;
		const duration =
			8 + unitRandom({ seed: cut.seed, salt: 1320 + cluster }) * 6;
		const radius =
			unit *
			(0.25 + unitRandom({ seed: cut.seed, salt: 1330 + cluster }) * 0.25) *
			(0.35 + 0.65 * outCubic(seconds / duration)) *
			fade;
		for (let speck = 0; speck < 34; speck += 1) {
			const angle =
				unitRandom({ seed: cut.seed, salt: 1400 + cluster * 100 + speck }) *
				Math.PI *
				2;
			const distance =
				radius *
				Math.sqrt(
					unitRandom({ seed: cut.seed, salt: 1500 + cluster * 100 + speck }),
				);
			const wobble = 0.92 + Math.sin(seconds * 0.3 + speck) * 0.08;
			const x = centerX + Math.cos(angle) * distance * wobble;
			const y = centerY + Math.sin(angle) * distance * wobble;
			const size =
				unit *
				(0.006 +
					unitRandom({ seed: cut.seed, salt: 1600 + cluster * 100 + speck }) *
						0.022) *
				(1 - (distance / Math.max(1, radius)) * 0.5);
			options.ctx.fillStyle =
				speck % 5 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary;
			options.ctx.globalAlpha =
				baseAlpha * fade * (speck % 5 === 0 ? 0.1 : 0.16);
			options.ctx.fillRect(x - size / 2, y - size / 2, size, size);
		}
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawDeadTrees(options: HorrorBackgroundDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const seconds = localSeconds(options.frame);
	const fade = outCubic(options.frame.localTime / 96_000);
	for (let layer = 0; layer < 2; layer += 1) {
		const count = 6 + layer * 2;
		const color =
			layer === 0
				? options.frame.palette.secondary
				: options.frame.palette.foreground;
		const layerAlpha = fade * (layer === 0 ? 0.2 : 0.34);
		for (let tree = 0; tree < count; tree += 1) {
			const x =
				(options.width *
					(tree +
						0.5 +
						signedRandom({ seed: cut.seed, salt: 1700 + layer * 50 + tree }) *
							0.35)) /
				count;
			const height =
				options.height *
				(0.7 +
					unitRandom({ seed: cut.seed, salt: 1800 + layer * 50 + tree }) *
						0.3) *
				(layer === 0 ? 0.8 : 1.05);
			const sway = Math.sin(seconds * 0.4 + tree + layer) * 0.012;
			drawTreeBranch({
				...options,
				x,
				y: options.height + 2,
				angle:
					-Math.PI / 2 +
					signedRandom({ seed: cut.seed, salt: 1900 + layer * 50 + tree }) *
						0.08,
				length: height * 0.42,
				depth: 0,
				id: layer * 100 + tree + 1,
				sway,
				color,
				alpha: layerAlpha,
				unit,
			});
		}
	}
}

function drawTreeBranch({
	alpha,
	angle,
	color,
	ctx,
	depth,
	frame,
	height,
	id,
	length,
	sway,
	unit,
	width,
	x,
	y,
}: HorrorBackgroundDraw & {
	readonly alpha: number;
	readonly angle: number;
	readonly color: string;
	readonly depth: number;
	readonly id: number;
	readonly length: number;
	readonly sway: number;
	readonly unit: number;
	readonly x: number;
	readonly y: number;
}): void {
	const cut = frame.cut;
	if (!cut) return;
	const endX = x + Math.cos(angle) * length;
	const endY = y + Math.sin(angle) * length;
	drawHorrorSegment({
		ctx,
		x0: x,
		y0: y,
		x1: endX,
		y1: endY,
		thickness: Math.max(1, unit * 0.02 * 0.55 ** depth),
		color,
		alpha,
	});
	if (depth >= 4) return;
	for (let side = 0; side < 2; side += 1) {
		const direction = side === 0 ? -1 : 1;
		const split =
			0.25 + unitRandom({ seed: cut.seed, salt: 2000 + id * 3 + side }) * 0.45;
		const ratio =
			0.55 + unitRandom({ seed: cut.seed, salt: 2100 + id * 3 + side }) * 0.23;
		drawTreeBranch({
			ctx,
			frame,
			height,
			width,
			x: endX,
			y: endY,
			angle: angle + direction * split + sway * (depth + 1),
			length: length * ratio,
			depth: depth + 1,
			id: id * 2 + side + 1,
			sway,
			color,
			alpha,
			unit,
		});
	}
}

function drawRectOutline({
	alpha,
	color,
	ctx,
	thickness,
	x0,
	x1,
	y0,
	y1,
}: HorrorBackgroundDraw & {
	readonly alpha: number;
	readonly color: string;
	readonly thickness: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}): void {
	drawHorrorSegment({ ctx, x0, y0, x1, y1: y0, thickness, color, alpha });
	drawHorrorSegment({ ctx, x0: x1, y0, x1, y1, thickness, color, alpha });
	drawHorrorSegment({
		ctx,
		x0: x1,
		y0: y1,
		x1: x0,
		y1,
		thickness,
		color,
		alpha,
	});
	drawHorrorSegment({
		ctx,
		x0,
		y0: y1,
		x1: x0,
		y1: y0,
		thickness,
		color,
		alpha,
	});
}
