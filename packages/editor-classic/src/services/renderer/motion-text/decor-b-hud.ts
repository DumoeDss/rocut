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
	drawDecorBox,
	drawDecorCross,
	drawDecorPolygon,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorState,
} from "./extended-decor-utils";

const HUD_DECORS = new Set([
	"atomOrbit",
	"circuit",
	"dataColumns",
	"glyphLock",
	"headingTape",
	"hexGrid",
	"sonarArcs",
	"spectrumRing",
	"spinner",
]);

export function drawDecorBHud(draw: CoreDecorDraw): boolean {
	if (!HUD_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "hexGrid":
			drawHexGrid(draw);
			break;
		case "spectrumRing":
			drawSpectrumRing(draw);
			break;
		case "dataColumns":
			drawDataColumns(draw);
			break;
		case "spinner":
			drawSpinner(draw);
			break;
		case "headingTape":
			drawHeadingTape(draw);
			break;
		case "glyphLock":
			drawGlyphLock(draw);
			break;
		case "atomOrbit":
			drawAtomOrbit(draw);
			break;
		case "sonarArcs":
			drawSonarArcs(draw);
			break;
		case "circuit":
			drawCircuit(draw);
			break;
	}
	return true;
}

function drawHexGrid(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.max(10 * unit, draw.height * 0.025);
	const columns = 7;
	const rows = 5;
	const right = seed % 2 === 0;
	const left = right ? draw.width - radius * 12.5 : radius * 1.5;
	const top =
		bounds.y0 > draw.height * 0.35 ? draw.height * 0.08 : draw.height * 0.68;
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x = left + column * radius * 1.72 + (row % 2) * radius * 0.86;
			const y = top + row * radius * 1.48;
			const points = Array.from({ length: 6 }, (_, index) => {
				const angle = Math.PI / 6 + (index * Math.PI) / 3;
				return {
					x: x + Math.cos(angle) * radius,
					y: y + Math.sin(angle) * radius,
				};
			});
			const scan = Math.max(
				0.16,
				1 - Math.abs(row - ((phase * 1.4) % rows)) / 2.2,
			);
			drawDecorPolygon({
				alpha: alpha * scan * (0.28 + ((row + column) % 3) * 0.14),
				color:
					(row + column) % 5 === 0
						? draw.frame.palette.accent
						: draw.frame.palette.secondary,
				draw,
				points,
				thickness: Math.max(1, unit),
			});
		}
	}
}

function drawSpectrumRing(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(54 * unit, draw.height * 0.12);
	const x =
		bounds.x1 + radius * 1.4 < draw.width ? bounds.x1 + radius : radius * 1.35;
	const y = Math.max(radius * 1.35, bounds.y0 - radius * 0.15);
	for (let bar = 0; bar < 36; bar += 1) {
		const angle = (bar * Math.PI * 2) / 36 + phase * 0.12;
		const strength =
			0.35 +
			0.65 * Math.abs(Math.sin(phase * (1.3 + (bar % 5) * 0.08) + bar * 0.62));
		const inner = radius * 0.72;
		const outer =
			inner +
			(7 +
				strength * 17 +
				extendedDecorRandom({ seed, salt: 1_500 + bar }) * 5) *
				unit;
		drawDecorSegment({
			alpha: alpha * (0.34 + strength * 0.58),
			color:
				bar % 9 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
			draw,
			thickness: Math.max(1, unit * 1.7),
			x0: x + Math.cos(angle) * inner,
			x1: x + Math.cos(angle) * outer,
			y0: y + Math.sin(angle) * inner,
			y1: y + Math.sin(angle) * outer,
		});
	}
	drawDecorRing({
		alpha: alpha * 0.65,
		color: draw.frame.palette.secondary,
		draw,
		radius: radius * 0.64,
		segments: 30,
		thickness: Math.max(1, unit),
		x,
		y,
	});
}

function drawDataColumns(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const columnWidth = Math.max(12 * unit, draw.width * 0.018);
	const gap = columnWidth * 0.42;
	const left = draw.width * 0.06;
	const baseline = draw.height * 0.88;
	for (let column = 0; column < 12; column += 1) {
		const level =
			0.2 +
			0.8 * Math.abs(Math.sin(phase * (0.8 + column * 0.035) + column * 0.72));
		const height = draw.height * (0.08 + level * 0.22);
		fillDecorRect({
			alpha: alpha * (0.2 + level * 0.42),
			color: extendedDecorColor({ draw, index: column }),
			draw,
			height,
			width: columnWidth,
			x: left + column * (columnWidth + gap),
			y: baseline - height,
		});
		if (column % 3 === 0) {
			drawDecorLabel({
				alpha: alpha * 0.72,
				color: draw.frame.palette.foreground,
				draw,
				size: 8 * unit,
				text: String(
					(Math.abs(seed) + column * 17 + Math.floor(phase * 5)) % 100,
				).padStart(2, "0"),
				x: left + column * (columnWidth + gap),
				y: baseline + 10 * unit,
			});
		}
	}
}

function drawSpinner(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(44 * unit, draw.height * 0.095);
	const x = seed % 2 === 0 ? draw.width * 0.12 : draw.width * 0.88;
	const y =
		bounds.y1 < draw.height * 0.68 ? draw.height * 0.82 : draw.height * 0.16;
	for (let segment = 0; segment < 12; segment += 1) {
		const angle = phase * 2.1 + (segment * Math.PI * 2) / 12;
		const fade = (segment + Math.floor(phase * 4)) % 12;
		drawDecorSegment({
			alpha: alpha * (0.15 + (fade / 11) * 0.8),
			color:
				segment % 4 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(2, unit * 3),
			x0: x + Math.cos(angle) * radius * 0.62,
			x1: x + Math.cos(angle) * radius,
			y0: y + Math.sin(angle) * radius * 0.62,
			y1: y + Math.sin(angle) * radius,
		});
	}
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 9 * unit,
		text: `LOAD ${String(Math.floor((phase * 23) % 100)).padStart(2, "0")}`,
		x,
		y: y + radius * 1.45,
	});
}

function drawHeadingTape(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const y = draw.height * 0.08;
	const spacing = Math.max(18 * unit, draw.width / 32);
	const offset = (phase * 24 * unit) % spacing;
	drawDecorSegment({
		alpha: alpha * 0.7,
		color: draw.frame.palette.secondary,
		draw,
		thickness: Math.max(1, unit),
		x0: draw.width * 0.04,
		x1: draw.width * 0.96,
		y0: y,
		y1: y,
	});
	for (let tick = -1; tick < 36; tick += 1) {
		const x = draw.width * 0.04 + tick * spacing - offset;
		const major = tick % 4 === 0;
		drawDecorSegment({
			alpha: alpha * (major ? 0.95 : 0.48),
			color: major ? draw.frame.palette.accent : draw.frame.palette.foreground,
			draw,
			thickness: Math.max(1, unit),
			x0: x,
			x1: x,
			y0: y - (major ? 10 : 5) * unit,
			y1: y + (major ? 10 : 5) * unit,
		});
		if (major) {
			drawDecorLabel({
				align: "center",
				alpha,
				color: draw.frame.palette.foreground,
				draw,
				size: 8 * unit,
				text: ["N", "E", "S", "W"][Math.abs(tick / 4) % 4] ?? "N",
				x,
				y: y + 18 * unit,
			});
		}
	}
	const center = draw.width / 2;
	drawDecorPolygon({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		points: [
			{ x: center, y: y + 3 * unit },
			{ x: center - 6 * unit, y: y - 8 * unit },
			{ x: center + 6 * unit, y: y - 8 * unit },
		],
		thickness: Math.max(1, unit * 1.4),
	});
}

function drawGlyphLock(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const side = Math.max(42 * unit, Math.min(bounds.height * 0.9, 92 * unit));
	const x =
		bounds.x0 +
		bounds.width * (0.25 + extendedDecorRandom({ seed, salt: 1_800 }) * 0.5);
	const y = (bounds.y0 + bounds.y1) / 2;
	const pulse = 1 + Math.sin(phase * 2.4) * 0.08;
	drawDecorBox({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		height: side * pulse,
		left: x - (side * pulse) / 2,
		thickness: Math.max(1, unit * 1.5),
		top: y - (side * pulse) / 2,
		width: side * pulse,
	});
	drawDecorCross({
		alpha: alpha * 0.65,
		color: draw.frame.palette.secondary,
		draw,
		radius: side * 0.62,
		thickness: Math.max(1, unit),
		x,
		y,
	});
	const glyphs = Array.from(draw.frame.cut?.text ?? "字").filter((glyph) =>
		glyph.trim(),
	);
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: side * 0.42,
		text: glyphs[Math.abs(seed) % Math.max(1, glyphs.length)] ?? "字",
		x,
		y,
	});
}

function drawAtomOrbit(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const radius = Math.min(52 * unit, draw.height * 0.11);
	const x =
		bounds.x0 - radius * 1.35 > 0
			? bounds.x0 - radius
			: draw.width - radius * 1.25;
	const y = draw.height * 0.78;
	drawDecorDot({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		radius: 4 * unit,
		x,
		y,
	});
	for (let orbit = 0; orbit < 3; orbit += 1) {
		const rotation = phase * (0.24 + orbit * 0.05) + (orbit * Math.PI) / 3;
		const points: CoreDecorPoint[] = Array.from({ length: 37 }, (_, index) => {
			const angle = (index / 36) * Math.PI * 2;
			const px = Math.cos(angle) * radius;
			const py = Math.sin(angle) * radius * 0.36;
			return {
				x: x + px * Math.cos(rotation) - py * Math.sin(rotation),
				y: y + px * Math.sin(rotation) + py * Math.cos(rotation),
			};
		});
		drawDecorPolyline({
			alpha: alpha * (0.38 + orbit * 0.17),
			color: extendedDecorColor({ draw, index: orbit }),
			draw,
			points,
			thickness: Math.max(1, unit),
		});
		const electronAngle =
			phase * (1.2 + orbit * 0.3) +
			extendedDecorRandom({ seed, salt: 1_900 + orbit }) * Math.PI * 2;
		const index =
			Math.floor(((electronAngle % (Math.PI * 2)) / (Math.PI * 2)) * 36 + 36) %
			36;
		const electron = points[index]!;
		drawDecorDot({
			alpha,
			color: draw.frame.palette.foreground,
			draw,
			radius: (2 + orbit * 0.6) * unit,
			x: electron.x,
			y: electron.y,
		});
	}
}

function drawSonarArcs(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const right = seed % 2 === 0;
	const x = right ? draw.width * 0.94 : draw.width * 0.06;
	const y = draw.height * 0.5;
	const direction = right ? Math.PI : 0;
	for (let arc = 0; arc < 5; arc += 1) {
		const radius = (22 + arc * 22 + ((phase * 18) % 22)) * unit;
		drawDecorRing({
			alpha: alpha * (0.18 + arc * 0.13),
			color:
				arc % 2 === 0
					? draw.frame.palette.accent
					: draw.frame.palette.secondary,
			draw,
			end: direction + Math.PI * 0.42,
			radius,
			segments: 14,
			start: direction - Math.PI * 0.42,
			thickness: Math.max(1, unit * (1 + arc * 0.18)),
			x,
			y,
		});
	}
	drawDecorDot({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		radius: 3 * unit,
		x,
		y,
	});
}

function drawCircuit(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const routes = 8;
	for (let route = 0; route < routes; route += 1) {
		const fromLeft = route % 2 === 0;
		const startX = fromLeft ? draw.width * 0.03 : draw.width * 0.97;
		const startY = draw.height * (0.12 + route * 0.105);
		const midX = fromLeft
			? bounds.x0 - (18 + route * 2) * unit
			: bounds.x1 + (18 + route * 2) * unit;
		const endY = startY + Math.sin(phase * 0.7 + route) * 18 * unit;
		const points = [
			{ x: startX, y: startY },
			{
				x: startX + (fromLeft ? 1 : -1) * (28 + (route % 3) * 12) * unit,
				y: startY,
			},
			{ x: midX, y: endY },
			{ x: fromLeft ? bounds.x0 - 4 * unit : bounds.x1 + 4 * unit, y: endY },
		];
		drawDecorPolyline({
			alpha: alpha * (0.28 + (route % 4) * 0.16),
			color: extendedDecorColor({ draw, index: route }),
			draw,
			points,
			thickness: Math.max(1, unit * 1.2),
		});
		const lit = (route + Math.floor(phase * 3)) % routes;
		const node = points[1]!;
		drawDecorDot({
			alpha: alpha * (lit === 0 ? 1 : 0.45),
			color:
				lit === 0 ? draw.frame.palette.accent : draw.frame.palette.foreground,
			draw,
			radius:
				(2 + extendedDecorRandom({ seed, salt: 2_100 + route }) * 2) * unit,
			x: node.x,
			y: node.y,
		});
	}
}
