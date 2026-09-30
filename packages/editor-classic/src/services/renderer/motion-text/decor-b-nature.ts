import {
	drawDecorDot,
	drawDecorPolyline,
	drawDecorRing,
	drawDecorSegment,
} from "./core-decor-geometry";
import type { CoreDecorDraw, CoreDecorPoint } from "./core-decor-types";
import {
	drawDecorPolygon,
	drawDecorSoftDot,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorSigned,
	extendedDecorState,
} from "./extended-decor-utils";

const NATURE_DECORS = new Set([
	"bubbles",
	"cloudPuffs",
	"dandelion",
	"fireflies",
	"moonPhases",
	"rainRipples",
	"smoke",
	"starField",
	"sunRays",
	"vines",
]);

export function drawDecorBNature(draw: CoreDecorDraw): boolean {
	if (!NATURE_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "vines":
			drawVines(draw);
			break;
		case "cloudPuffs":
			drawCloudPuffs(draw);
			break;
		case "starField":
			drawStarField(draw);
			break;
		case "moonPhases":
			drawMoonPhases(draw);
			break;
		case "sunRays":
			drawSunRays(draw);
			break;
		case "rainRipples":
			drawRainRipples(draw);
			break;
		case "bubbles":
			drawBubbles(draw);
			break;
		case "smoke":
			drawSmoke(draw);
			break;
		case "dandelion":
			drawDandelion(draw);
			break;
		case "fireflies":
			drawFireflies(draw);
			break;
	}
	return true;
}

function drawVines(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let side = 0; side < 2; side += 1) {
		const right = side === 1;
		const baseX = right ? draw.width * 0.96 : draw.width * 0.04;
		const points: CoreDecorPoint[] = Array.from({ length: 34 }, (_, index) => {
			const progress = index / 33;
			return {
				x:
					baseX +
					(right ? -1 : 1) *
						(18 + Math.sin(progress * Math.PI * 5 + phase * 0.4) * 13) *
						unit,
				y: draw.height * (0.06 + progress * 0.88),
			};
		});
		drawDecorPolyline({
			alpha: alpha * 0.72,
			color:
				side === 0 ? draw.frame.palette.secondary : draw.frame.palette.accent,
			draw,
			points,
			thickness: Math.max(1, unit * 1.4),
		});
		for (let leaf = 3; leaf < points.length; leaf += 5) {
			const point = points[leaf]!;
			const direction = leaf % 2 === 0 ? 1 : -1;
			const radius =
				(6 + extendedDecorRandom({ seed, salt: side * 100 + leaf }) * 4) * unit;
			drawDecorPolygon({
				alpha: alpha * 0.62,
				color: extendedDecorColor({ draw, index: leaf + side }),
				draw,
				points: [
					{ x: point.x, y: point.y },
					{ x: point.x + direction * radius * 1.7, y: point.y - radius * 0.45 },
					{ x: point.x + direction * radius, y: point.y + radius * 0.65 },
				],
				thickness: Math.max(1, unit),
			});
		}
	}
}

function drawCloudPuffs(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let cloud = 0; cloud < 4; cloud += 1) {
		const baseX =
			draw.width * (0.12 + cloud * 0.25) +
			Math.sin(phase * (0.2 + cloud * 0.04) + cloud) * 18 * unit;
		const baseY = draw.height * (0.15 + (cloud % 2) * 0.62);
		for (let puff = 0; puff < 5; puff += 1) {
			const radius =
				(11 +
					extendedDecorRandom({ seed, salt: 2_600 + cloud * 10 + puff }) * 13) *
				unit;
			const x = baseX + (puff - 2) * 14 * unit;
			const y = baseY - Math.sin((puff / 4) * Math.PI) * 12 * unit;
			drawDecorRing({
				alpha: alpha * (0.2 + puff * 0.09),
				color:
					cloud % 2 === 0
						? draw.frame.palette.foreground
						: draw.frame.palette.secondary,
				draw,
				radius,
				segments: 16,
				thickness: Math.max(1, unit),
				x,
				y,
			});
		}
	}
}

function drawStarField(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let star = 0; star < 48; star += 1) {
		const x = draw.width * extendedDecorRandom({ seed, salt: 2_800 + star });
		const y = draw.height * extendedDecorRandom({ seed, salt: 2_900 + star });
		const pulse = Math.max(
			0.08,
			0.5 + 0.5 * Math.sin(phase * (0.8 + (star % 7) * 0.12) + star),
		);
		const radius = (0.8 + (star % 4) * 0.55) * unit;
		drawDecorDot({
			alpha: alpha * pulse * (0.12 + (star % 5) * 0.045),
			color:
				star % 9 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius,
			x,
			y,
		});
	}
}

function drawMoonPhases(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(18 * unit, draw.height * 0.04);
	const spacing = radius * 2.8;
	const total = spacing * 6;
	const left =
		seed % 2 === 0 ? draw.width * 0.08 : draw.width - draw.width * 0.08 - total;
	const y = draw.height * 0.14;
	for (let moon = 0; moon < 7; moon += 1) {
		const x = left + moon * spacing;
		drawDecorRing({
			alpha: alpha * (0.45 + moon * 0.07),
			color:
				moon === Math.floor(phase * 4) % 7
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius,
			segments: 20,
			thickness: Math.max(1, unit),
			x,
			y,
		});
		const phaseAmount = Math.abs(3 - moon) / 3;
		drawDecorSegment({
			alpha: alpha * 0.5,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, radius * (0.25 + phaseAmount * 0.45)),
			x0: x + (moon < 3 ? -1 : 1) * radius * 0.25,
			x1: x + (moon < 3 ? -1 : 1) * radius * 0.25,
			y0: y - radius * 0.72,
			y1: y + radius * 0.72,
		});
	}
}

function drawSunRays(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const x = right ? draw.width : 0;
	const y = draw.height * 0.15;
	const max = Math.hypot(draw.width, draw.height) * 0.62;
	for (let ray = 0; ray < 26; ray += 1) {
		const angle =
			(right ? Math.PI : 0) +
			(ray / 25 - 0.5) * 1.45 +
			Math.sin(phase * 0.15) * 0.06;
		const length =
			max * (0.45 + extendedDecorRandom({ seed, salt: 3_100 + ray }) * 0.55);
		drawDecorSegment({
			alpha: alpha * (0.035 + (ray % 7) * 0.015),
			color:
				ray % 6 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit * (1 + (ray % 4) * 0.6)),
			x0: x,
			x1: x + Math.cos(angle) * length,
			y0: y,
			y1: y + Math.sin(angle) * length,
		});
	}
}

function drawRainRipples(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let ripple = 0; ripple < 14; ripple += 1) {
		const x =
			draw.width *
			(0.06 + extendedDecorRandom({ seed, salt: 3_300 + ripple }) * 0.88);
		const y =
			draw.height *
			(0.58 + extendedDecorRandom({ seed, salt: 3_400 + ripple }) * 0.36);
		const progress =
			(phase * (0.23 + (ripple % 5) * 0.025) +
				extendedDecorRandom({ seed, salt: 3_500 + ripple })) %
			1;
		for (let ring = 0; ring < 2; ring += 1) {
			drawDecorRing({
				alpha: alpha * (1 - progress) * (0.08 + ring * 0.07),
				color:
					ring === 0 ? draw.frame.palette.secondary : draw.frame.palette.accent,
				draw,
				radius: (5 + progress * 28 + ring * 7) * unit,
				segments: 18,
				thickness: Math.max(0.75, unit),
				x,
				y,
			});
		}
	}
}

function drawBubbles(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let bubble = 0; bubble < 18; bubble += 1) {
		const progress =
			(extendedDecorRandom({ seed, salt: 3_700 + bubble }) +
				phase * (0.025 + (bubble % 6) * 0.004)) %
			1;
		const x =
			draw.width *
				(0.07 + extendedDecorRandom({ seed, salt: 3_800 + bubble }) * 0.86) +
			Math.sin(phase * 0.7 + bubble) * 10 * unit;
		const y = draw.height * (1.03 - progress * 1.05);
		const radius =
			(4 + extendedDecorRandom({ seed, salt: 3_900 + bubble }) * 12) * unit;
		drawDecorRing({
			alpha: alpha * (0.28 + (bubble % 4) * 0.12),
			color: extendedDecorColor({ draw, index: bubble }),
			draw,
			radius,
			segments: 16,
			thickness: Math.max(0.75, unit),
			x,
			y,
		});
		drawDecorDot({
			alpha: alpha * 0.45,
			color: draw.frame.palette.foreground,
			draw,
			radius: Math.max(0.8, radius * 0.1),
			x: x - radius * 0.34,
			y: y - radius * 0.34,
		});
	}
}

function drawSmoke(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let wisp = 0; wisp < 7; wisp += 1) {
		const baseX = draw.width * (0.1 + wisp * 0.135);
		const points = Array.from({ length: 30 }, (_, index) => {
			const progress = index / 29;
			return {
				x:
					baseX +
					Math.sin(
						progress * Math.PI * (2.5 + (wisp % 3)) + phase * 0.4 + wisp,
					) *
						(8 + progress * 16) *
						unit,
				y:
					draw.height * (0.96 - progress * 0.82) +
					extendedDecorSigned({ seed, salt: 4_100 + wisp * 40 + index }) * unit,
			};
		});
		drawDecorPolyline({
			alpha: alpha * (0.035 + wisp * 0.018),
			color:
				wisp % 3 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			points,
			thickness: Math.max(1, unit * (2 + wisp * 0.28)),
		});
	}
}

function drawDandelion(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const x =
		bounds.x0 > draw.width * 0.25 ? draw.width * 0.12 : draw.width * 0.88;
	const baseY = draw.height * 0.9;
	const headY = draw.height * 0.62;
	drawDecorSegment({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		thickness: Math.max(1, unit * 1.8),
		x0: x,
		x1: x + Math.sin(phase * 0.4) * 8 * unit,
		y0: baseY,
		y1: headY,
	});
	for (let seedIndex = 0; seedIndex < 24; seedIndex += 1) {
		const angle = (seedIndex * Math.PI * 2) / 24;
		const detached = seedIndex % 5 === 0;
		const drift = detached ? ((phase * (5 + seedIndex * 0.1)) % 90) * unit : 0;
		const radius =
			(18 + extendedDecorRandom({ seed, salt: 4_400 + seedIndex }) * 16) * unit;
		const sx = x + Math.cos(angle) * radius + drift;
		const sy = headY + Math.sin(angle) * radius - drift * 0.35;
		drawDecorSegment({
			alpha: alpha * (detached ? 0.45 : 0.72),
			color:
				seedIndex % 4 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			thickness: Math.max(0.75, unit),
			x0: detached ? sx - 5 * unit : x,
			x1: sx,
			y0: detached ? sy + 3 * unit : headY,
			y1: sy,
		});
		drawDecorDot({
			alpha,
			color: draw.frame.palette.foreground,
			draw,
			radius: 1.2 * unit,
			x: sx,
			y: sy,
		});
	}
}

function drawFireflies(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let firefly = 0; firefly < 20; firefly += 1) {
		const baseX =
			draw.width *
			(0.06 + extendedDecorRandom({ seed, salt: 4_700 + firefly }) * 0.88);
		const baseY =
			draw.height *
			(0.1 + extendedDecorRandom({ seed, salt: 4_800 + firefly }) * 0.82);
		const x =
			baseX +
			Math.sin(phase * (0.35 + (firefly % 5) * 0.06) + firefly) * 18 * unit;
		const y =
			baseY +
			Math.cos(phase * (0.3 + (firefly % 7) * 0.04) + firefly * 0.8) *
				13 *
				unit;
		const pulse = Math.max(
			0.06,
			0.5 + 0.5 * Math.sin(phase * 2.2 + firefly * 1.7),
		);
		drawDecorSoftDot({
			alpha: alpha * pulse * (0.18 + (firefly % 4) * 0.08),
			color:
				firefly % 6 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			radius: (2.5 + (firefly % 3) * 1.5) * unit,
			x,
			y,
		});
	}
}
