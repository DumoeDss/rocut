import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorRing,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import {
	clamp01,
	coreDecorPlan,
	decorInOut,
	delayedEntrance,
	lerp,
	localSeconds,
	randomRange,
	randomSigned,
	randomUnit,
	TICKS_PER_SECOND,
} from "./core-decor-timing";
import type { CoreDecorDraw } from "./core-decor-types";

export function drawCoreBackDecor(options: CoreDecorDraw): boolean {
	switch (options.decor) {
		case "grid":
			drawGrid(options);
			return true;
		case "stripes":
			drawStripes(options);
			return true;
		case "blobs":
			drawBlobs(options);
			return true;
		case "bars":
			drawBars(options);
			return true;
		case "shapes":
			drawShapes(options);
			return true;
		case "counter":
			drawCounter(options);
			return true;
		default:
			return false;
	}
}

function drawGrid(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	const alpha = decorInOut(draw.frame) * 0.14;
	const gap = draw.height / (plan.count + 5);
	const offsetX = (draw.width / 2) % gap;
	const offsetY = (draw.height / 2) % gap;
	for (let x = offsetX; x < draw.width; x += gap) {
		drawDecorSegment({
			alpha,
			color: draw.frame.palette.secondary,
			draw,
			thickness: 1,
			x0: x,
			x1: x,
			y0: 0,
			y1: draw.height,
		});
	}
	for (let y = offsetY; y < draw.height; y += gap) {
		drawDecorSegment({
			alpha,
			color: draw.frame.palette.secondary,
			draw,
			thickness: 1,
			x0: 0,
			x1: draw.width,
			y0: y,
			y1: y,
		});
	}
}

function drawStripes(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	const entrance = decorInOut(draw.frame);
	if (entrance <= 0.001) return;
	const barWidth = draw.height * 0.04;
	const drift = (localSeconds(draw.frame) * 40) % (barWidth * 2);
	draw.ctx.save();
	draw.ctx.translate(
		plan.corner ? draw.width * 0.85 : draw.width * 0.15,
		plan.corner ? draw.height * 0.15 : draw.height * 0.85,
	);
	draw.ctx.rotate((-35 * Math.PI) / 180);
	for (let index = -6; index <= 6; index += 1) {
		fillDecorRect({
			alpha: entrance * 0.9,
			color: plan.accent
				? draw.frame.palette.accent
				: draw.frame.palette.secondary,
			draw,
			height: draw.height * 0.36 * entrance,
			width: barWidth,
			x: index * barWidth * 2 - barWidth / 2 + drift,
			y: -draw.height * 0.18 * entrance,
		});
	}
	draw.ctx.restore();
}

function drawBlobs(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	const entrance = delayedEntrance({
		frame: draw.frame,
		delay: 0,
		duration: 0.35,
		overshoot: 1.2,
	});
	for (let index = 0; index < plan.count; index += 1) {
		const radius =
			randomRange({
				seed: plan.seed,
				salt: index * 11 + 3,
				minimum: draw.height * 0.06,
				maximum: draw.height * 0.16,
			}) * entrance;
		const x = randomRange({
			seed: plan.seed,
			salt: index * 11 + 1,
			minimum: draw.width * 0.12,
			maximum: draw.width * 0.88,
		});
		const y = randomRange({
			seed: plan.seed,
			salt: index * 11 + 2,
			minimum: draw.height * 0.15,
			maximum: draw.height * 0.85,
		});
		drawIrregularDisc({
			alpha: 0.92,
			color:
				index % 2 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			index,
			radius,
			seed: plan.seed,
			x,
			y,
		});
	}
}

function drawBars(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	for (let index = 0; index < plan.count; index += 1) {
		const entrance = delayedEntrance({
			frame: draw.frame,
			delay: index * 0.05,
			duration: 0.3,
		});
		if (entrance <= 0.001) continue;
		const upper = randomUnit({ seed: plan.seed, salt: index * 7 + 11 }) < 0.5;
		const y =
			draw.height *
			randomRange({
				seed: plan.seed,
				salt: index * 7 + 1,
				minimum: upper ? 0.1 : 0.73,
				maximum: upper ? 0.27 : 0.9,
			});
		const height =
			draw.height *
			randomRange({
				seed: plan.seed,
				salt: index * 7 + 2,
				minimum: 0.03,
				maximum: 0.08,
			});
		const fromLeft = randomUnit({ seed: plan.seed, salt: index * 7 + 3 }) < 0.5;
		const width =
			draw.width *
			randomRange({
				seed: plan.seed,
				salt: index * 7 + 4,
				minimum: 0.35,
				maximum: 0.75,
			}) *
			entrance;
		const x = fromLeft ? -10 : draw.width + 10 - width;
		fillDecorRect({
			alpha: 0.92,
			color:
				index === 0 ? draw.frame.palette.accent : draw.frame.palette.foreground,
			draw,
			height,
			width,
			x,
			y: y - height / 2,
		});
		for (let tooth = 0; tooth < 4; tooth += 1) {
			const toothWidth = height * (0.08 + tooth * 0.035);
			fillDecorRect({
				alpha: 0.68,
				color: draw.frame.palette.secondary,
				draw,
				height: height * 0.12,
				width: toothWidth,
				x:
					x +
					width * ((tooth + 0.6) / 4) +
					randomSigned({ seed: plan.seed, salt: index * 31 + tooth }) *
						height *
						0.2,
				y: y + (tooth % 2 === 0 ? -height * 0.58 : height * 0.46),
			});
		}
	}
}

function drawShapes(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	for (let index = 0; index < plan.count; index += 1) {
		const delay = randomUnit({ seed: plan.seed, salt: index * 13 + 9 }) * 0.22;
		const entrance = delayedEntrance({
			frame: draw.frame,
			delay,
			duration: 0.25,
			overshoot: 1.8,
		});
		if (entrance <= 0.001) continue;
		const top = randomUnit({ seed: plan.seed, salt: index * 13 + 4 }) < 0.5;
		const seconds = localSeconds(draw.frame);
		const x =
			randomRange({
				seed: plan.seed,
				salt: index * 13 + 2,
				minimum: draw.width * 0.05,
				maximum: draw.width * 0.95,
			}) +
			seconds * randomSigned({ seed: plan.seed, salt: index * 13 + 3 }) * 30;
		const y =
			randomRange({
				seed: plan.seed,
				salt: index * 13 + 10,
				minimum: draw.height * (top ? 0.06 : 0.76),
				maximum: draw.height * (top ? 0.24 : 0.94),
			}) +
			seconds * randomSigned({ seed: plan.seed, salt: index * 13 + 5 }) * 20;
		const radius =
			randomRange({
				seed: plan.seed,
				salt: index * 13 + 6,
				minimum: draw.height * 0.018,
				maximum: draw.height * 0.06,
			}) * entrance;
		const color = [
			draw.frame.palette.accent,
			draw.frame.palette.secondary,
			draw.frame.palette.foreground,
		][index % 3]!;
		drawShape({
			color,
			draw,
			index,
			planSeed: plan.seed,
			radius,
			rotation:
				randomUnit({ seed: plan.seed, salt: index * 13 + 7 }) * Math.PI * 2 +
				seconds * randomSigned({ seed: plan.seed, salt: index * 13 + 8 }),
			x,
			y,
		});
	}
}

function drawCounter(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	const alpha = decorInOut(draw.frame);
	const duration = Math.max(1, draw.frame.cut?.duration ?? TICKS_PER_SECOND);
	const amount = clamp01(draw.frame.localTime / (duration * 0.8));
	const value =
		plan.mode === "count"
			? String(
					Math.floor(
						lerp({
							first: plan.from,
							second: plan.to,
							amount: 1 - (1 - amount) ** 3,
						}),
					),
				)
			: String(Math.abs(plan.seed) % 100).padStart(2, "0");
	drawDecorLabel({
		align: "center",
		alpha: alpha * (plan.accent ? 0.9 : 0.34),
		color: plan.accent
			? draw.frame.palette.accent
			: draw.frame.palette.secondary,
		draw,
		size: draw.height * 0.5,
		text: value,
		x: plan.right ? draw.width * 0.86 : draw.width * 0.14,
		y: draw.height * (plan.low ? 0.72 : 0.3),
	});
}

function drawIrregularDisc({
	alpha,
	color,
	draw,
	index,
	radius,
	seed,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly index: number;
	readonly radius: number;
	readonly seed: number;
	readonly x: number;
	readonly y: number;
}): void {
	const slices = 11;
	for (let slice = 0; slice < slices; slice += 1) {
		const vertical = (slice / (slices - 1)) * 2 - 1;
		const bulge = Math.sqrt(Math.max(0, 1 - vertical ** 2));
		const wobble =
			0.8 +
			randomUnit({ seed, salt: index * 97 + slice }) * 0.28 +
			Math.sin(localSeconds(draw.frame) * 3 + slice) * 0.04;
		const halfWidth = radius * bulge * wobble;
		fillDecorRect({
			alpha,
			color,
			draw,
			height: (radius * 2) / slices + 1,
			width: halfWidth * 2,
			x: x - halfWidth,
			y: y - radius + (slice * radius * 2) / slices,
		});
	}
}

function drawShape({
	color,
	draw,
	index,
	planSeed,
	radius,
	rotation,
	x,
	y,
}: {
	readonly color: string;
	readonly draw: CoreDecorDraw;
	readonly index: number;
	readonly planSeed: number;
	readonly radius: number;
	readonly rotation: number;
	readonly x: number;
	readonly y: number;
}): void {
	const type = Math.floor(
		randomUnit({ seed: planSeed, salt: index * 13 + 1 }) * 5,
	);
	if (type === 0) {
		drawDecorDot({ alpha: 0.92, color, draw, radius, x, y });
		return;
	}
	if (type === 1) {
		drawDecorRing({
			alpha: 0.9,
			color,
			draw,
			radius,
			thickness: Math.max(1.5, radius * 0.12),
			x,
			y,
		});
		return;
	}
	draw.ctx.save();
	draw.ctx.translate(x, y);
	draw.ctx.rotate(rotation);
	if (type === 2) {
		fillDecorRect({
			alpha: 0.94,
			color,
			draw,
			height: radius * 2,
			width: radius * 2,
			x: -radius,
			y: -radius,
		});
	} else if (type === 3) {
		const points = [
			[0, -radius, radius * 0.9, radius * 0.6],
			[radius * 0.9, radius * 0.6, -radius * 0.9, radius * 0.6],
			[-radius * 0.9, radius * 0.6, 0, -radius],
		] as const;
		for (const [x0, y0, x1, y1] of points) {
			drawDecorSegment({
				alpha: 0.95,
				color,
				draw,
				thickness: Math.max(1.5, radius * 0.16),
				x0,
				x1,
				y0,
				y1,
			});
		}
	} else {
		for (let row = -2; row <= 2; row += 1) {
			for (let column = -2; column <= 2; column += 1) {
				if (Math.abs(row) + Math.abs(column) > 3) continue;
				drawDecorDot({
					alpha: 0.86,
					color,
					draw,
					radius: Math.max(1, radius * 0.09),
					x: column * radius * 0.3,
					y: row * radius * 0.3,
				});
			}
		}
	}
	draw.ctx.restore();
}
