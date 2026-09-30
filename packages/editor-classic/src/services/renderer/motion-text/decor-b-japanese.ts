import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorPolyline,
	drawDecorRing,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw, CoreDecorPoint } from "./core-decor-types";
import {
	drawDecorPolygon,
	drawDecorSoftDot,
	drawDecorStar,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorSigned,
	extendedDecorState,
} from "./extended-decor-utils";

const JAPANESE_DECORS = new Set([
	"asanoha",
	"chochin",
	"hanabi",
	"kamon",
	"kasumi",
	"momiji",
	"namiGashira",
	"seigaiha",
	"sensu",
	"shimenawa",
	"tsukiKumo",
]);

export function drawDecorBJapanese(draw: CoreDecorDraw): boolean {
	if (!JAPANESE_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "kamon":
			drawKamon(draw);
			break;
		case "seigaiha":
			drawSeigaiha(draw);
			break;
		case "asanoha":
			drawAsanoha(draw);
			break;
		case "hanabi":
			drawHanabi(draw);
			break;
		case "chochin":
			drawChochin(draw);
			break;
		case "shimenawa":
			drawShimenawa(draw);
			break;
		case "sensu":
			drawSensu(draw);
			break;
		case "tsukiKumo":
			drawTsukiKumo(draw);
			break;
		case "momiji":
			drawMomiji(draw);
			break;
		case "namiGashira":
			drawNamiGashira(draw);
			break;
		case "kasumi":
			drawKasumi(draw);
			break;
	}
	return true;
}

function drawKamon(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(54 * unit, draw.height * 0.11);
	const x = seed % 2 === 0 ? draw.width * 0.11 : draw.width * 0.89;
	const y = bounds.y0 > radius * 2 ? bounds.y0 * 0.52 : draw.height * 0.18;
	for (const scale of [1, 0.76, 0.32]) {
		drawDecorRing({
			alpha: alpha * (0.5 + scale * 0.42),
			color:
				scale === 0.76
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			radius: radius * scale,
			segments: 28,
			thickness: Math.max(1, unit * (1.1 + scale)),
			x,
			y,
		});
	}
	for (let petal = 0; petal < 6; petal += 1) {
		const angle = phase * 0.22 + (petal * Math.PI) / 3;
		const cx = x + Math.cos(angle) * radius * 0.47;
		const cy = y + Math.sin(angle) * radius * 0.47;
		drawDecorPolygon({
			alpha: alpha * 0.72,
			color: extendedDecorColor({ draw, index: petal }),
			draw,
			points: [
				{
					x: cx + Math.cos(angle) * radius * 0.3,
					y: cy + Math.sin(angle) * radius * 0.3,
				},
				{
					x: cx + Math.cos(angle + 2.2) * radius * 0.2,
					y: cy + Math.sin(angle + 2.2) * radius * 0.2,
				},
				{
					x: cx + Math.cos(angle - 2.2) * radius * 0.2,
					y: cy + Math.sin(angle - 2.2) * radius * 0.2,
				},
			],
			thickness: Math.max(1, unit),
		});
	}
}

function drawSeigaiha(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.max(18 * unit, Math.min(draw.width, draw.height) * 0.045);
	const rowHeight = radius * 0.55;
	const drift = (phase * 8 * unit) % (radius * 2);
	const columns = 11;
	const rows = 8;
	const patchWidth = columns * radius * 1.55;
	const left = seed % 2 === 0 ? draw.width - patchWidth - radius : radius;
	const top = draw.height - rows * rowHeight - radius * 0.4;
	const path = batchPathContext(draw.ctx);
	if (path) {
		const baseAlpha = path.globalAlpha;
		const baseStroke = path.strokeStyle;
		const baseWidth = path.lineWidth;
		for (let band = 1; band <= 3; band += 1) {
			path.beginPath();
			for (let row = 0; row < rows; row += 1) {
				for (let column = 0; column < columns; column += 1) {
					const x =
						left + column * radius * 1.55 + (row % 2) * radius * 0.78 + drift;
					const y = top + row * rowHeight;
					const bandRadius = (radius * band) / 3;
					path.moveTo(x - bandRadius, y);
					path.arc(x, y, bandRadius, Math.PI, Math.PI * 2);
				}
			}
			path.globalAlpha = baseAlpha * alpha * (0.07 + band * 0.025);
			path.strokeStyle =
				band === 3 ? draw.frame.palette.accent : draw.frame.palette.secondary;
			path.lineWidth = Math.max(0.75, unit);
			path.stroke();
		}
		path.strokeStyle = baseStroke;
		path.lineWidth = baseWidth;
		path.globalAlpha = baseAlpha;
	}
	drawDecorSegment({
		alpha: alpha * 0.32,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(1, unit),
		x0: left + drift,
		x1: left + radius * (2.6 + Math.sin(phase * 0.8) * 0.2),
		y0: top - 5 * unit,
		y1: top - 5 * unit,
	});
}

function drawAsanoha(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const cell = Math.max(26 * unit, Math.min(draw.width, draw.height) * 0.052);
	const shift = (phase * 5 * unit) % cell;
	const columns = 9;
	const rows = 7;
	const patchWidth = columns * cell;
	const left =
		seed % 2 === 0
			? draw.width * 0.05
			: draw.width - patchWidth - draw.width * 0.05;
	const top = draw.height * 0.08;
	const path = batchPathContext(draw.ctx);
	if (path) {
		const baseAlpha = path.globalAlpha;
		const baseStroke = path.strokeStyle;
		const baseWidth = path.lineWidth;
		path.beginPath();
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const cx = left + column * cell + (row % 2) * cell * 0.5 + shift;
				const cy = top + row * cell * 0.86;
				for (let spoke = 0; spoke < 6; spoke += 1) {
					const angle = (spoke * Math.PI) / 3;
					const x = cx + Math.cos(angle) * cell * 0.46;
					const y = cy + Math.sin(angle) * cell * 0.46;
					path.moveTo(cx, cy);
					path.lineTo(x, y);
					path.lineTo(
						cx + Math.cos(angle + Math.PI / 3) * cell * 0.46,
						cy + Math.sin(angle + Math.PI / 3) * cell * 0.46,
					);
				}
			}
		}
		path.globalAlpha = baseAlpha * alpha * 0.13;
		path.strokeStyle = draw.frame.palette.secondary;
		path.lineWidth = Math.max(0.75, unit);
		path.stroke();
		path.strokeStyle = baseStroke;
		path.lineWidth = baseWidth;
		path.globalAlpha = baseAlpha;
	}
	drawDecorSegment({
		alpha: alpha * 0.38,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(1, unit),
		x0: left + shift,
		x1: left + cell * (1.4 + Math.sin(phase * 0.7) * 0.18),
		y0: top - 6 * unit,
		y1: top + cell * 0.25,
	});
}

function drawHanabi(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let burst = 0; burst < 3; burst += 1) {
		const x = draw.width * (0.16 + burst * 0.34);
		const y = draw.height * (0.2 + (burst % 2) * 0.18);
		const pulse = 0.72 + 0.22 * Math.sin(phase * 1.8 + burst * 1.7);
		const radius = (28 + burst * 11) * unit * pulse;
		for (let ray = 0; ray < 16 + burst * 4; ray += 1) {
			const angle = (ray * Math.PI * 2) / (16 + burst * 4) + phase * 0.08;
			const inner =
				radius *
				(0.18 + extendedDecorRandom({ seed, salt: burst * 100 + ray }) * 0.12);
			const outer =
				radius *
				(0.72 +
					extendedDecorRandom({ seed, salt: burst * 100 + ray + 40 }) * 0.28);
			drawDecorSegment({
				alpha: alpha * (0.34 + (ray % 5) * 0.1),
				color: extendedDecorColor({ draw, index: ray + burst }),
				draw,
				thickness: Math.max(1, unit * (0.8 + (ray % 3) * 0.3)),
				x0: x + Math.cos(angle) * inner,
				x1: x + Math.cos(angle) * outer,
				y0: y + Math.sin(angle) * inner,
				y1: y + Math.sin(angle) * outer,
			});
		}
	}
}

function drawChochin(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let index = 0; index < 4; index += 1) {
		const width = (24 + (index % 2) * 9) * unit;
		const height = width * 1.35;
		const x = draw.width * (0.09 + index * 0.27);
		const y = draw.height * 0.12 + Math.sin(phase * 1.2 + index) * 8 * unit;
		drawDecorSegment({
			alpha: alpha * 0.6,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x,
			y0: 0,
			y1: y,
		});
		for (let band = 0; band < 5; band += 1) {
			const inset = Math.abs(2 - band) * width * 0.08;
			fillDecorRect({
				alpha: alpha * (0.12 + band * 0.045),
				color:
					index % 2 === 0
						? draw.frame.palette.accent
						: draw.frame.palette.secondary,
				draw,
				height: height / 6,
				width: width - inset * 2,
				x: x - width / 2 + inset,
				y: y + band * (height / 6),
			});
		}
		drawDecorLabel({
			align: "center",
			alpha,
			color: draw.frame.palette.foreground,
			draw,
			size: 10 * unit,
			text: String((Math.abs(seed) + index + Math.floor(phase)) % 10),
			x,
			y: y + height * 0.43,
		});
	}
}

function drawShimenawa(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const y = draw.height * 0.15;
	const points = Array.from({ length: 44 }, (_, index) => {
		const progress = index / 43;
		return {
			x: draw.width * (0.08 + progress * 0.84),
			y: y + Math.sin(progress * Math.PI * 3 + phase * 0.45) * 8 * unit,
		};
	});
	for (let strand = -1; strand <= 1; strand += 1) {
		drawDecorPolyline({
			alpha: alpha * (0.45 + (strand + 1) * 0.16),
			color:
				strand === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			points: points.map((point, index) => ({
				x: point.x,
				y: point.y + strand * 3 * unit + Math.sin(index * 0.9 + phase) * unit,
			})),
			thickness: Math.max(1, unit * 1.4),
		});
	}
	for (let tassel = 0; tassel < 5; tassel += 1) {
		const index = 5 + tassel * 8;
		const point = points[index]!;
		const length =
			(20 + extendedDecorRandom({ seed, salt: 800 + tassel }) * 18) * unit;
		drawDecorSegment({
			alpha,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit * 1.5),
			x0: point.x,
			x1: point.x + Math.sin(phase + tassel) * 3 * unit,
			y0: point.y,
			y1: point.y + length,
		});
	}
}

function drawSensu(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(92 * unit, draw.height * 0.19);
	const x =
		seed % 2 === 0 ? bounds.x0 - radius * 0.15 : bounds.x1 + radius * 0.15;
	const y = Math.min(draw.height * 0.9, bounds.y1 + radius * 0.35);
	const start = Math.PI * 1.08 + Math.sin(phase * 0.6) * 0.04;
	const end = Math.PI * 1.92 + Math.sin(phase * 0.6) * 0.04;
	drawDecorRing({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		end,
		radius,
		segments: 22,
		start,
		thickness: Math.max(1, unit * 2),
		x,
		y,
	});
	for (let spoke = 0; spoke <= 10; spoke += 1) {
		const angle = start + ((end - start) * spoke) / 10;
		drawDecorSegment({
			alpha: alpha * (0.35 + (spoke % 3) * 0.18),
			color: extendedDecorColor({ draw, index: spoke }),
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x + Math.cos(angle) * radius,
			y0: y,
			y1: y + Math.sin(angle) * radius,
		});
	}
}

function drawTsukiKumo(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(46 * unit, draw.height * 0.1);
	const x = seed % 2 === 0 ? draw.width * 0.18 : draw.width * 0.82;
	const y = draw.height * 0.2;
	drawDecorSoftDot({
		alpha: alpha * 0.3,
		color: draw.frame.palette.accent,
		draw,
		radius,
		x,
		y,
	});
	drawDecorRing({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		radius,
		segments: 30,
		thickness: Math.max(1, unit * 1.5),
		x,
		y,
	});
	for (let cloud = 0; cloud < 3; cloud += 1) {
		const cy = y + (10 + cloud * 13) * unit;
		const drift = Math.sin(phase * (0.3 + cloud * 0.07) + cloud) * 14 * unit;
		const points: CoreDecorPoint[] = [];
		for (let index = 0; index <= 18; index += 1) {
			const progress = index / 18;
			points.push({
				x: x - radius * 1.45 + progress * radius * 2.9 + drift,
				y: cy + Math.sin(progress * Math.PI * 4 + cloud) * 4 * unit,
			});
		}
		drawDecorPolyline({
			alpha: alpha * (0.45 + cloud * 0.15),
			color:
				cloud === 1 ? draw.frame.palette.accent : draw.frame.palette.secondary,
			draw,
			points,
			thickness: Math.max(1, unit * (1 + cloud * 0.3)),
		});
	}
}

function drawMomiji(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let leaf = 0; leaf < 9; leaf += 1) {
		const progress =
			(extendedDecorRandom({ seed, salt: 1_000 + leaf }) +
				phase * (0.015 + leaf * 0.001)) %
			1;
		const x =
			draw.width *
				(0.08 + extendedDecorRandom({ seed, salt: 1_040 + leaf }) * 0.84) +
			Math.sin(phase + leaf) * 8 * unit;
		const y = draw.height * (-0.08 + progress * 1.1);
		const radius = (6 + (leaf % 4) * 2.2) * unit;
		drawDecorStar({
			alpha: alpha * (0.38 + (leaf % 5) * 0.1),
			color: extendedDecorColor({ draw, index: leaf + 1 }),
			draw,
			innerRadius: radius * 0.34,
			outerRadius: radius,
			rotation: phase * 0.5 + leaf,
			thickness: Math.max(1, unit),
			x,
			y,
		});
	}
}

function drawNamiGashira(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const baseY = draw.height * 0.82;
	for (let wave = 0; wave < 4; wave += 1) {
		const width = draw.width * (0.22 + wave * 0.035);
		const x0 =
			draw.width * (0.02 + wave * 0.24) +
			Math.sin(phase * 0.5 + wave) * 8 * unit;
		const points = Array.from({ length: 25 }, (_, index) => {
			const progress = index / 24;
			const crest = Math.sin(progress * Math.PI) * (24 + wave * 5) * unit;
			return {
				x: x0 + progress * width,
				y: baseY - crest + Math.sin(progress * Math.PI * 3 + phase) * 5 * unit,
			};
		});
		drawDecorPolyline({
			alpha: alpha * (0.4 + wave * 0.13),
			color: extendedDecorColor({ draw, index: wave }),
			draw,
			points,
			thickness: Math.max(1, unit * (1 + wave * 0.35)),
		});
		for (let spray = 0; spray < 3; spray += 1) {
			drawDecorDot({
				alpha: alpha * 0.55,
				color: draw.frame.palette.foreground,
				draw,
				radius: (1.4 + spray * 0.7) * unit,
				x: x0 + width * (0.72 + spray * 0.06),
				y:
					baseY -
					(32 + spray * 9) * unit -
					extendedDecorSigned({ seed, salt: 1_200 + wave * 10 + spray }) *
						4 *
						unit,
			});
		}
	}
}

function drawKasumi(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	for (let band = 0; band < 6; band += 1) {
		const y = draw.height * (0.16 + band * 0.14);
		const direction = band % 2 === 0 ? 1 : -1;
		const drift = Math.sin(phase * 0.3 + band) * 26 * unit * direction;
		const left = draw.width * (band % 3 === 0 ? 0.04 : 0.38) + drift;
		const width = draw.width * (0.34 + (band % 3) * 0.09);
		for (let step = 0; step < 3; step += 1) {
			fillDecorRect({
				alpha: alpha * (0.055 + step * 0.035),
				color:
					step === 2 ? draw.frame.palette.accent : draw.frame.palette.secondary,
				draw,
				height: (5 + step * 2) * unit,
				width: width - step * 18 * unit,
				x: left + step * 9 * unit,
				y: y + step * 5 * unit,
			});
		}
	}
}

type BatchPathContext = CoreDecorDraw["ctx"] & {
	arc: CanvasRenderingContext2D["arc"];
	lineTo: CanvasRenderingContext2D["lineTo"];
	moveTo: CanvasRenderingContext2D["moveTo"];
	stroke: CanvasRenderingContext2D["stroke"];
};

function batchPathContext(ctx: CoreDecorDraw["ctx"]): BatchPathContext | null {
	return isBatchPathContext(ctx) ? ctx : null;
}

function isBatchPathContext(
	ctx: CoreDecorDraw["ctx"],
): ctx is BatchPathContext {
	return (
		typeof ctx.moveTo === "function" &&
		typeof ctx.lineTo === "function" &&
		typeof ctx.arc === "function" &&
		typeof ctx.stroke === "function"
	);
}
