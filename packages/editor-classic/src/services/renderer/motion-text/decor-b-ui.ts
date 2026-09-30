import {
	drawDecorDot,
	drawDecorLabel,
	drawDecorRing,
	drawDecorSegment,
	fillDecorRect,
} from "./core-decor-geometry";
import type { CoreDecorDraw } from "./core-decor-types";
import {
	drawDecorBox,
	drawDecorPolygon,
	extendedDecorColor,
	extendedDecorRandom,
	extendedDecorState,
} from "./extended-decor-utils";

const UI_DECORS = new Set([
	"cursorClick",
	"likeCounter",
	"mediaControls",
	"musicNotes",
	"notifBell",
	"progressBar",
	"toggleSwitch",
	"volumeBars",
	"windowChrome",
]);

export function drawDecorBUi(draw: CoreDecorDraw): boolean {
	if (!UI_DECORS.has(draw.decor)) return false;
	switch (draw.decor) {
		case "cursorClick":
			drawCursorClick(draw);
			break;
		case "windowChrome":
			drawWindowChrome(draw);
			break;
		case "progressBar":
			drawProgressBar(draw);
			break;
		case "toggleSwitch":
			drawToggleSwitch(draw);
			break;
		case "notifBell":
			drawNotifBell(draw);
			break;
		case "likeCounter":
			drawLikeCounter(draw);
			break;
		case "mediaControls":
			drawMediaControls(draw);
			break;
		case "volumeBars":
			drawVolumeBars(draw);
			break;
		case "musicNotes":
			drawMusicNotes(draw);
			break;
	}
	return true;
}

function drawCursorClick(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, seed, unit } = extendedDecorState(draw);
	const progress =
		(phase * 0.18 + extendedDecorRandom({ seed, salt: 6_000 })) % 1;
	const x = bounds.x0 - 40 * unit + progress * (bounds.width + 80 * unit);
	const y =
		bounds.y1 + 24 * unit + Math.sin(progress * Math.PI * 2) * 16 * unit;
	const size = 22 * unit;
	drawDecorPolygon({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		points: [
			{ x, y },
			{ x: x + size * 0.3, y: y + size },
			{ x: x + size * 0.48, y: y + size * 0.63 },
			{ x: x + size * 0.82, y: y + size * 0.98 },
			{ x: x + size, y: y + size * 0.79 },
			{ x: x + size * 0.63, y: y + size * 0.47 },
		],
		thickness: Math.max(1, unit * 1.6),
	});
	const click = Math.max(0, Math.sin(phase * 3.2));
	for (let ring = 0; ring < 2; ring += 1) {
		drawDecorRing({
			alpha: alpha * click * (0.6 - ring * 0.2),
			color:
				ring === 0 ? draw.frame.palette.accent : draw.frame.palette.secondary,
			draw,
			radius: (8 + ring * 9 + click * 5) * unit,
			segments: 14,
			thickness: Math.max(1, unit),
			x,
			y,
		});
	}
}

function drawWindowChrome(draw: CoreDecorDraw): void {
	const { alpha, bounds, phase, unit } = extendedDecorState(draw);
	const padX = 38 * unit + Math.sin(phase * 0.6) * 4 * unit;
	const padY = 28 * unit;
	const left = Math.max(draw.width * 0.04, bounds.x0 - padX);
	const top = Math.max(draw.height * 0.05, bounds.y0 - padY);
	const width = Math.min(
		draw.width - left - draw.width * 0.04,
		bounds.width + padX * 2,
	);
	const height = Math.min(
		draw.height - top - draw.height * 0.05,
		bounds.height + padY * 2,
	);
	drawDecorBox({
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		height,
		left,
		thickness: Math.max(1, unit * 1.3),
		top,
		width,
	});
	fillDecorRect({
		alpha: alpha * 0.28,
		color: draw.frame.palette.secondary,
		draw,
		height: 20 * unit,
		width,
		x: left,
		y: top,
	});
	for (let dot = 0; dot < 3; dot += 1) {
		drawDecorDot({
			alpha,
			color: extendedDecorColor({ draw, index: dot }),
			draw,
			radius: 3 * unit,
			x: left + (12 + dot * 11) * unit,
			y: top + 10 * unit,
		});
	}
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 8 * unit,
		text: `WINDOW / ${String(Math.floor(phase * 8) % 100).padStart(2, "0")}`,
		x: left + 52 * unit,
		y: top + 10 * unit,
	});
}

function drawProgressBar(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const width = Math.min(draw.width * 0.42, 320 * unit);
	const height = 20 * unit;
	const left =
		seed % 2 === 0 ? draw.width * 0.08 : draw.width - draw.width * 0.08 - width;
	const top = draw.height * 0.84;
	const progress = (phase * 0.13) % 1;
	drawDecorBox({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		height,
		left,
		thickness: Math.max(1, unit),
		top,
		width,
	});
	fillDecorRect({
		alpha: alpha * 0.78,
		color: draw.frame.palette.accent,
		draw,
		height: height - 6 * unit,
		width: Math.max(2 * unit, (width - 6 * unit) * progress),
		x: left + 3 * unit,
		y: top + 3 * unit,
	});
	drawDecorLabel({
		align: "right",
		alpha,
		color: draw.frame.palette.secondary,
		draw,
		size: 9 * unit,
		text: `${String(Math.floor(progress * 100)).padStart(2, "0")}%`,
		x: left + width,
		y: top - 9 * unit,
	});
}

function drawToggleSwitch(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const width = 64 * unit;
	const height = 30 * unit;
	const x = seed % 2 === 0 ? draw.width * 0.1 : draw.width * 0.9 - width;
	const y = draw.height * 0.18;
	const on = 0.5 + 0.5 * Math.sin(phase * 1.4);
	drawDecorBox({
		alpha,
		color: on > 0.5 ? draw.frame.palette.accent : draw.frame.palette.secondary,
		draw,
		height,
		left: x,
		thickness: Math.max(1, unit * 1.5),
		top: y,
		width,
	});
	const knobX = x + height / 2 + on * (width - height);
	drawDecorRing({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		radius: height * 0.34,
		segments: 18,
		thickness: Math.max(2, unit * 2),
		x: knobX,
		y: y + height / 2,
	});
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 9 * unit,
		text: on > 0.5 ? "ON" : "OFF",
		x: x,
		y: y + height + 12 * unit,
	});
}

function drawNotifBell(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const x = seed % 2 === 0 ? draw.width * 0.12 : draw.width * 0.88;
	const y = draw.height * 0.2;
	const radius = 25 * unit;
	draw.ctx.save();
	draw.ctx.translate(x, y);
	draw.ctx.rotate(Math.sin(phase * 3.1) * 0.12);
	drawDecorPolygon({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		points: [
			{ x: -radius, y: radius * 0.55 },
			{ x: -radius * 0.62, y: -radius * 0.55 },
			{ x: 0, y: -radius },
			{ x: radius * 0.62, y: -radius * 0.55 },
			{ x: radius, y: radius * 0.55 },
		],
		thickness: Math.max(1, unit * 1.8),
	});
	drawDecorDot({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		radius: 4 * unit,
		x: 0,
		y: radius * 0.72,
	});
	draw.ctx.restore();
	const count = 1 + ((Math.abs(seed) + Math.floor(phase * 1.8)) % 9);
	drawDecorDot({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		radius: 11 * unit,
		x: x + radius * 0.78,
		y: y - radius * 0.78,
	});
	drawDecorLabel({
		align: "center",
		alpha,
		color: draw.frame.palette.background,
		draw,
		size: 9 * unit,
		text: String(count),
		x: x + radius * 0.78,
		y: y - radius * 0.78,
	});
}

function drawLikeCounter(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const x = seed % 2 === 0 ? draw.width * 0.12 : draw.width * 0.82;
	const y = draw.height * 0.78;
	const radius = (14 + Math.max(0, Math.sin(phase * 2.2)) * 4) * unit;
	drawDecorPolygon({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		points: heartPoints({ radius, x, y }),
		thickness: Math.max(1, unit * 1.6),
	});
	const count = 100 + ((Math.abs(seed) + Math.floor(phase * 7)) % 900);
	drawDecorLabel({
		alpha,
		color: draw.frame.palette.foreground,
		draw,
		size: 12 * unit,
		text: String(count),
		x: x + radius * 1.5,
		y,
	});
	for (let spark = 0; spark < 4; spark += 1) {
		const angle = (spark * Math.PI) / 2 + phase * 0.4;
		drawDecorSegment({
			alpha: alpha * 0.6,
			color: draw.frame.palette.secondary,
			draw,
			thickness: Math.max(1, unit),
			x0: x + Math.cos(angle) * radius * 1.3,
			x1: x + Math.cos(angle) * radius * 1.75,
			y0: y + Math.sin(angle) * radius * 1.3,
			y1: y + Math.sin(angle) * radius * 1.75,
		});
	}
}

function drawMediaControls(draw: CoreDecorDraw): void {
	const { alpha, phase, unit } = extendedDecorState(draw);
	const y = draw.height * 0.88;
	const center = draw.width / 2;
	const gap = 42 * unit;
	const active = Math.floor(phase * 1.1) % 5;
	for (let control = -2; control <= 2; control += 1) {
		const x = center + control * gap;
		const highlight = control + 2 === active;
		if (control === 0) {
			drawDecorPolygon({
				alpha,
				color: highlight
					? draw.frame.palette.accent
					: draw.frame.palette.foreground,
				draw,
				points: [
					{ x: x - 7 * unit, y: y - 11 * unit },
					{ x: x + 13 * unit, y },
					{ x: x - 7 * unit, y: y + 11 * unit },
				],
				thickness: Math.max(1, unit * 1.7),
			});
		} else {
			const direction = control < 0 ? -1 : 1;
			for (
				let triangle = 0;
				triangle < (Math.abs(control) === 2 ? 2 : 1);
				triangle += 1
			) {
				const tx = x + direction * triangle * 9 * unit;
				drawDecorPolygon({
					alpha: alpha * (highlight ? 1 : 0.72),
					color: highlight
						? draw.frame.palette.accent
						: draw.frame.palette.secondary,
					draw,
					points: [
						{ x: tx - direction * 7 * unit, y: y - 9 * unit },
						{ x: tx + direction * 8 * unit, y },
						{ x: tx - direction * 7 * unit, y: y + 9 * unit },
					],
					thickness: Math.max(1, unit),
				});
			}
		}
	}
	const progress = (phase * 0.09) % 1;
	drawDecorSegment({
		alpha: alpha * 0.42,
		color: draw.frame.palette.secondary,
		draw,
		thickness: Math.max(2, unit * 2),
		x0: center - gap * 3,
		x1: center + gap * 3,
		y0: y + 26 * unit,
		y1: y + 26 * unit,
	});
	drawDecorSegment({
		alpha,
		color: draw.frame.palette.accent,
		draw,
		thickness: Math.max(2, unit * 2.4),
		x0: center - gap * 3,
		x1: center - gap * 3 + gap * 6 * progress,
		y0: y + 26 * unit,
		y1: y + 26 * unit,
	});
}

function drawVolumeBars(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	const left = seed % 2 === 0 ? draw.width * 0.08 : draw.width * 0.78;
	const baseline = draw.height * 0.82;
	const width = 8 * unit;
	for (let bar = 0; bar < 16; bar += 1) {
		const level =
			0.18 +
			0.82 * Math.abs(Math.sin(phase * (1.1 + (bar % 4) * 0.16) + bar * 0.58));
		const height = (12 + level * 64) * unit;
		fillDecorRect({
			alpha: alpha * (0.22 + level * 0.7),
			color:
				bar % 5 === 0
					? draw.frame.palette.accent
					: extendedDecorColor({ draw, index: bar }),
			draw,
			height,
			width,
			x: left + bar * width * 1.45,
			y: baseline - height,
		});
	}
}

function drawMusicNotes(draw: CoreDecorDraw): void {
	const { alpha, phase, seed, unit } = extendedDecorState(draw);
	for (let note = 0; note < 14; note += 1) {
		const progress =
			(extendedDecorRandom({ seed, salt: 6_500 + note }) +
				phase * (0.018 + (note % 5) * 0.004)) %
			1;
		const x =
			draw.width *
				(0.08 + extendedDecorRandom({ seed, salt: 6_600 + note }) * 0.84) +
			Math.sin(phase + note) * 9 * unit;
		const y = draw.height * (0.96 - progress * 0.9);
		const size = (4 + (note % 4) * 1.4) * unit;
		drawDecorDot({
			alpha: alpha * (0.42 + (note % 5) * 0.1),
			color: extendedDecorColor({ draw, index: note }),
			draw,
			radius: size,
			x,
			y,
		});
		drawDecorSegment({
			alpha,
			color: extendedDecorColor({ draw, index: note }),
			draw,
			thickness: Math.max(1, unit * 1.3),
			x0: x + size * 0.75,
			x1: x + size * 0.75,
			y0: y,
			y1: y - size * (2.4 + (note % 3) * 0.4),
		});
		if (note % 3 === 0) {
			drawDecorSegment({
				alpha,
				color: draw.frame.palette.foreground,
				draw,
				thickness: Math.max(1, unit),
				x0: x + size * 0.75,
				x1: x + size * 2.1,
				y0: y - size * 2.4,
				y1: y - size * 2.1,
			});
		}
	}
}

function heartPoints({
	radius,
	x,
	y,
}: {
	readonly radius: number;
	readonly x: number;
	readonly y: number;
}): readonly { readonly x: number; readonly y: number }[] {
	return Array.from({ length: 24 }, (_, index) => {
		const angle = (index / 24) * Math.PI * 2;
		const sx = 16 * Math.sin(angle) ** 3;
		const sy =
			13 * Math.cos(angle) -
			5 * Math.cos(angle * 2) -
			2 * Math.cos(angle * 3) -
			Math.cos(angle * 4);
		return { x: x + (sx / 17) * radius, y: y - (sy / 17) * radius };
	});
}
