import {
	drawDecorDot,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw } from "./core-decor-types";
import {
	drawDecorDiamond,
	drawDecorSoftDot,
	drawDecorStar,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorState,
} from "./extended-decor-utils";

const PARTICLE_DECORS = new Set([
	"bokeh",
	"confetti",
	"lightLeak",
	"petals",
	"rainStreaks",
	"risingParticles",
	"snow",
	"speedCorner",
	"twinkle",
]);

export function drawExtendedParticleDecor(draw: CoreDecorDraw): boolean {
	if (!PARTICLE_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "bokeh":
			drawBokeh(draw);
			break;
		case "confetti":
			drawConfetti(draw);
			break;
		case "lightLeak":
			drawLightLeak(draw);
			break;
		case "petals":
			drawPetals(draw);
			break;
		case "rainStreaks":
			drawRainStreaks(draw);
			break;
		case "risingParticles":
			drawRisingParticles(draw);
			break;
		case "snow":
			drawSnow(draw);
			break;
		case "speedCorner":
			drawSpeedCorner(draw);
			break;
		case "twinkle":
			drawTwinkle(draw);
			break;
	}
	return true;
}

function drawConfetti(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 32; index += 1) {
		const baseX =
			extendedDecorRandom({ seed, salt: index + 1_000 }) * draw.width;
		const speed = 24 + extendedDecorRandom({ seed, salt: index + 1_040 }) * 52;
		const y =
			((extendedDecorRandom({ seed, salt: index + 1_080 }) * draw.height +
				phase * speed) %
				(draw.height + 40 * unit)) -
			20 * unit;
		const x = baseX + Math.sin(phase * 1.5 + index) * 18 * unit;
		const width = (3 + (index % 4)) * unit;
		const height = (7 + (index % 5)) * unit;
		draw.ctx.save();
		draw.ctx.translate(x, y);
		draw.ctx.rotate(phase * (0.4 + (index % 5) * 0.12) + index);
		fillDecorRect({
			alpha: alpha * (0.45 + (index % 4) * 0.14),
			color: extendedDecorColor({ draw, index }),
			draw,
			height,
			width,
			x: -width / 2,
			y: -height / 2,
		});
		draw.ctx.restore();
	}
}

function drawPetals(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 24; index += 1) {
		const fall =
			((extendedDecorRandom({ seed, salt: index + 1_200 }) +
				phase * (0.035 + (index % 5) * 0.006)) %
				1.15) -
			0.08;
		const x =
			draw.width * extendedDecorRandom({ seed, salt: index + 1_240 }) +
			Math.sin(phase * 0.8 + index * 1.7) * 34 * unit;
		const y = draw.height * fall;
		const radius =
			(3 + extendedDecorRandom({ seed, salt: index + 1_280 }) * 5) * unit;
		draw.ctx.save();
		draw.ctx.translate(x, y);
		draw.ctx.rotate(phase * 0.4 + index * 0.75);
		drawDecorDiamond({
			alpha: alpha * (0.38 + (index % 5) * 0.1),
			color:
				index % 4 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			radius,
			thickness: Math.max(1, unit * 1.4),
			x: 0,
			y: 0,
		});
		draw.ctx.restore();
	}
}

function drawRainStreaks(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 34; index += 1) {
		const x = extendedDecorRandom({ seed, salt: index + 1_400 }) * draw.width;
		const cycle =
			(extendedDecorRandom({ seed, salt: index + 1_440 }) +
				phase * (0.32 + (index % 4) * 0.03)) %
			1.15;
		const y = cycle * draw.height - draw.height * 0.08;
		const length =
			(15 + extendedDecorRandom({ seed, salt: index + 1_480 }) * 38) * unit;
		drawDecorSegment({
			alpha: alpha * (0.1 + (index % 5) * 0.055),
			color:
				index % 9 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x - length * 0.18,
			y0: y,
			y1: y + length,
		});
	}
}

function drawSnow(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 42; index += 1) {
		const drift =
			Math.sin(phase * (0.35 + (index % 3) * 0.08) + index) * 18 * unit;
		const x =
			extendedDecorRandom({ seed, salt: index + 1_600 }) * draw.width + drift;
		const y =
			((extendedDecorRandom({ seed, salt: index + 1_640 }) +
				phase * (0.025 + (index % 5) * 0.004)) %
				1.08) *
			draw.height;
		drawDecorDot({
			alpha: alpha * (0.18 + (index % 6) * 0.09),
			color:
				index % 11 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius: Math.max(1, unit * (1.2 + (index % 4) * 0.65)),
			x,
			y,
		});
	}
}

function drawLightLeak(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const anchor = right ? draw.width * 0.86 : draw.width * 0.14;
	for (let band = 0; band < 6; band += 1) {
		const width = draw.width * (0.05 + band * 0.035);
		const x =
			anchor +
			(right ? 1 : -1) *
				(Math.sin(phase * 0.32 + band * 0.8) * draw.width * 0.04 +
					band * width * 0.16);
		draw.ctx.save();
		draw.ctx.translate(x, draw.height / 2);
		draw.ctx.rotate((right ? -1 : 1) * (0.12 + band * 0.012));
		fillDecorRect({
			alpha: alpha * (0.025 + (6 - band) * 0.018),
			color:
				band % 2 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			height: draw.height * 1.35,
			width,
			x: -width / 2,
			y: -draw.height * 0.675,
		});
		draw.ctx.restore();
	}
	drawDecorSoftDot({
		alpha: alpha * 0.18,
		color: draw.frame.palette.accent,
		draw,
		radius: 34 * unit,
		x: anchor + Math.sin(phase * 0.6) * 22 * unit,
		y: draw.height * 0.22,
	});
}

function drawBokeh(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 14; index += 1) {
		const x =
			draw.width * extendedDecorRandom({ seed, salt: index + 1_800 }) +
			Math.sin(phase * 0.18 + index) * 12 * unit;
		const y =
			draw.height * extendedDecorRandom({ seed, salt: index + 1_840 }) +
			Math.cos(phase * 0.22 + index) * 9 * unit;
		const radius =
			(8 + extendedDecorRandom({ seed, salt: index + 1_880 }) * 24) * unit;
		drawDecorSoftDot({
			alpha: alpha * (0.04 + (index % 5) * 0.018),
			color: extendedDecorColor({ draw, index }),
			draw,
			radius,
			x,
			y,
		});
	}
}

function drawSpeedCorner(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const fromRight = seed % 2 === 0;
	const fromBottom = Math.abs(seed) % 3 === 0;
	const cornerX = fromRight ? draw.width : 0;
	const cornerY = fromBottom ? draw.height : 0;
	const reach =
		Math.hypot(draw.width, draw.height) * (0.42 + 0.03 * Math.sin(phase * 2.4));
	for (let ray = 0; ray < 24; ray += 1) {
		const spread = (ray / 23 - 0.5) * 1.15;
		const base = Math.atan2(
			draw.height / 2 - cornerY,
			draw.width / 2 - cornerX,
		);
		const angle = base + spread;
		const inner =
			reach * (0.12 + extendedDecorRandom({ seed, salt: ray + 2_000 }) * 0.12);
		const outer =
			reach * (0.65 + extendedDecorRandom({ seed, salt: ray + 2_040 }) * 0.35);
		drawDecorSegment({
			alpha: alpha * (0.12 + (ray % 5) * 0.07),
			color:
				ray % 8 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit * (0.8 + (ray % 3) * 0.45)),
			x0: cornerX + Math.cos(angle) * inner,
			x1: cornerX + Math.cos(angle) * outer,
			y0: cornerY + Math.sin(angle) * inner,
			y1: cornerY + Math.sin(angle) * outer,
		});
	}
}

function drawRisingParticles(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 36; index += 1) {
		const progress =
			(extendedDecorRandom({ seed, salt: index + 2_200 }) +
				phase * (0.018 + (index % 6) * 0.005)) %
			1;
		const x =
			draw.width *
				(0.08 + extendedDecorRandom({ seed, salt: index + 2_240 }) * 0.84) +
			Math.sin(phase * 0.8 + index) * 9 * unit;
		const y = draw.height * (1.02 - progress * 0.94);
		drawDecorDot({
			alpha: alpha * progress * (0.16 + (index % 5) * 0.07),
			color:
				index % 7 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			radius: Math.max(1, unit * (1 + (index % 4) * 0.75)),
			x,
			y,
		});
	}
}

function drawTwinkle(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 16; index += 1) {
		const x =
			draw.width *
			(0.06 + extendedDecorRandom({ seed, salt: index + 2_400 }) * 0.88);
		const y =
			draw.height *
			(0.08 + extendedDecorRandom({ seed, salt: index + 2_440 }) * 0.84);
		const pulse = Math.max(
			0.08,
			0.5 + 0.5 * Math.sin(phase * (1.8 + (index % 4) * 0.4) + index),
		);
		const radius = (3 + (index % 4) * 2) * unit * pulse;
		if (index % 3 === 0) {
			drawDecorStar({
				alpha: alpha * pulse,
				color: draw.frame.palette.accent,
				draw,
				innerRadius: radius * 0.28,
				outerRadius: radius,
				rotation: phase * 0.35 + index,
				thickness: Math.max(1, unit),
				x,
				y,
			});
		} else {
			drawDecorSegment({
				alpha: alpha * pulse,
				color: draw.frame.palette.foreground,
				draw,
				thickness: Math.max(1, unit),
				x0: x - radius,
				x1: x + radius,
				y0: y,
				y1: y,
			});
			drawDecorSegment({
				alpha: alpha * pulse,
				color: draw.frame.palette.foreground,
				draw,
				thickness: Math.max(1, unit),
				x0: x,
				x1: x,
				y0: y - radius,
				y1: y + radius,
			});
		}
	}
}
