import {
	coreDecorTextBounds,
	drawDecorDot,
	drawDecorLabel,
	drawDecorPolyline,
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
	noise1,
	randomRange,
	randomSigned,
	randomUnit,
	TICKS_PER_SECOND,
} from "./core-decor-timing";
import type { CoreDecorDraw, CoreDecorPoint } from "./core-decor-types";

export function drawCoreFrontAccentDecor(options: CoreDecorDraw): boolean {
	switch (options.decor) {
		case "slash":
			drawSlash(options);
			return true;
		case "sparks":
			drawSparks(options);
			return true;
		case "leaders":
			drawLeaders(options);
			return true;
		case "waveform":
			drawWaveform(options);
			return true;
		case "barcode":
			drawBarcode(options);
			return true;
		default:
			return false;
	}
}

function drawSlash(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	for (let index = 0; index < plan.count; index += 1) {
		const entrance = delayedEntrance({
			frame: draw.frame,
			delay: index * 0.06,
			duration: 0.35,
		});
		if (entrance <= 0.001) continue;
		const angle =
			(randomRange({
				seed: plan.seed,
				salt: index * 5 + 1,
				minimum: -70,
				maximum: -20,
			}) *
				Math.PI) /
			180;
		const centerX = randomRange({
			seed: plan.seed,
			salt: index * 5 + 2,
			minimum: draw.width * 0.3,
			maximum: draw.width * 0.7,
		});
		const centerY = randomRange({
			seed: plan.seed,
			salt: index * 5 + 3,
			minimum: draw.height * 0.3,
			maximum: draw.height * 0.7,
		});
		const length = Math.hypot(draw.width, draw.height);
		const x0 = centerX - (Math.cos(angle) * length) / 2;
		const y0 = centerY - (Math.sin(angle) * length) / 2;
		const exitStart = clamp01(draw.frame.exitProgress) ** 3;
		drawDecorSegment({
			alpha: 0.9,
			color:
				index === 0 ? draw.frame.palette.foreground : draw.frame.palette.accent,
			draw,
			thickness: index === 0 ? 1.4 : 2,
			x0: x0 + Math.cos(angle) * length * exitStart,
			x1: x0 + Math.cos(angle) * length * entrance,
			y0: y0 + Math.sin(angle) * length * exitStart,
			y1: y0 + Math.sin(angle) * length * entrance,
		});
	}
}

function drawSparks(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	for (let index = 0; index < plan.count; index += 1) {
		const delay = randomUnit({ seed: plan.seed, salt: index * 7 + 1 }) * 0.16;
		const entrance = delayedEntrance({
			frame: draw.frame,
			delay,
			duration: 0.2,
			overshoot: 2,
		});
		if (entrance <= 0.001) continue;
		const x = randomRange({
			seed: plan.seed,
			salt: index * 7 + 2,
			minimum: draw.width * 0.05,
			maximum: draw.width * 0.95,
		});
		const y = randomRange({
			seed: plan.seed,
			salt: index * 7 + 3,
			minimum: draw.height * 0.08,
			maximum: draw.height * 0.92,
		});
		const radius =
			randomRange({
				seed: plan.seed,
				salt: index * 7 + 4,
				minimum: draw.height * 0.015,
				maximum: draw.height * 0.04,
			}) * entrance;
		const rotation =
			localSeconds(draw.frame) *
				randomSigned({ seed: plan.seed, salt: index * 7 + 5 }) *
				3 +
			randomUnit({ seed: plan.seed, salt: index * 7 + 6 }) * 3;
		const arms =
			randomUnit({ seed: plan.seed, salt: index * 7 + 7 }) < 0.5 ? 3 : 4;
		for (let arm = 0; arm < arms; arm += 1) {
			const angle = rotation + (arm * Math.PI) / arms;
			drawDecorSegment({
				alpha: 1,
				color:
					index % 3 === 0
						? draw.frame.palette.accent
						: draw.frame.palette.foreground,
				draw,
				thickness: Math.max(1.5, radius * 0.14),
				x0: x - Math.cos(angle) * radius,
				x1: x + Math.cos(angle) * radius,
				y0: y - Math.sin(angle) * radius,
				y1: y + Math.sin(angle) * radius,
			});
		}
	}
}

function drawLeaders(draw: CoreDecorDraw): void {
	const bounds = coreDecorTextBounds(draw);
	const plan = coreDecorPlan(draw);
	const entrance = delayedEntrance({
		frame: draw.frame,
		delay: 0.1,
		duration: 0.45,
	});
	if (entrance <= 0.001) return;
	const cut = draw.frame.cut;
	if (!cut) return;
	const labels = [
		cut.text.replace(/\s+/gu, " ").trim().toUpperCase(),
		`NO.${String((Math.abs(plan.seed) % 89) + 1).padStart(2, "0")} / ${formatTime(cut.startTime / TICKS_PER_SECOND)}`,
	];
	const size = Math.min(20, Math.max(11, draw.height * 0.018));
	const anchors = [
		{ x: bounds.x1, y: bounds.y0 },
		{ x: bounds.x0, y: bounds.y1 },
	] as const;
	for (const [index, anchor] of anchors.entries()) {
		const direction = index === 1 ? -1 : 1;
		const targetX = clampRange({
			value:
				anchor.x +
				direction *
					draw.width *
					randomRange({
						seed: plan.seed,
						salt: index * 3 + 1,
						minimum: 0.06,
						maximum: 0.14,
					}),
			minimum: draw.width * 0.06,
			maximum: draw.width * 0.94,
		});
		const targetY = clampRange({
			value:
				anchor.y +
				(index === 0 ? -1 : 1) *
					draw.height *
					randomRange({
						seed: plan.seed,
						salt: index * 3 + 2,
						minimum: 0.08,
						maximum: 0.16,
					}),
			minimum: draw.height * 0.08,
			maximum: draw.height * 0.92,
		});
		drawDecorPolyline({
			alpha: 1,
			color: draw.frame.palette.secondary,
			draw,
			points: [
				anchor,
				{ x: targetX, y: targetY },
				{ x: targetX + direction * draw.width * 0.05, y: targetY },
			],
			progress: entrance,
			thickness: 1.2,
		});
		drawDecorDot({
			alpha: entrance,
			color: draw.frame.palette.accent,
			draw,
			radius: 3.5,
			x: anchor.x,
			y: anchor.y,
		});
		drawDecorLabel({
			align: index === 1 ? "right" : "left",
			alpha: entrance,
			color: draw.frame.palette.foreground,
			draw,
			size,
			text: labels[index]!,
			x: targetX + direction * draw.width * 0.055,
			y: targetY - size * 0.9,
		});
	}
}

function drawWaveform(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	const entrance = decorInOut(draw.frame);
	if (entrance <= 0.001) return;
	const y = draw.height * (plan.low ? 0.86 : 0.14);
	const seconds = localSeconds(draw.frame);
	const points: CoreDecorPoint[] = [];
	const count = 96;
	for (let index = 0; index <= count; index += 1) {
		const amount = index / count;
		const x = lerp({
			first: draw.width * 0.18,
			second: draw.width * 0.82,
			amount,
		});
		const envelope = Math.sin(amount * Math.PI);
		const energy =
			0.7 + noise1({ seed: plan.seed, value: seconds * 2.3 }) * 0.25;
		const amplitude =
			draw.height *
			0.035 *
			envelope *
			energy *
			(0.5 +
				0.5 *
					noise1({
						seed: plan.seed,
						value: amount * 18 + seconds * 9,
					}));
		points.push({ x, y: y + (index % 2 === 0 ? -amplitude : amplitude) });
	}
	drawDecorPolyline({
		alpha: 0.9,
		color: draw.frame.palette.foreground,
		draw,
		points,
		progress: entrance,
		thickness: 1.4,
	});
}

function drawBarcode(draw: CoreDecorDraw): void {
	const plan = coreDecorPlan(draw);
	const entrance = decorInOut(draw.frame);
	if (entrance <= 0.001) return;
	const x0 = plan.right ? draw.width * 0.84 : draw.width * 0.06;
	const y0 = draw.height * (plan.low ? 0.84 : 0.07);
	const height = draw.height * 0.05;
	let x = x0;
	for (let index = 0; index < 34; index += 1) {
		const width =
			1 +
			Math.floor(randomUnit({ seed: plan.seed, salt: index * 2 + 1 }) * 3.2);
		if (randomUnit({ seed: plan.seed, salt: index * 2 + 2 }) < 0.62) {
			fillDecorRect({
				alpha: 0.9,
				color: draw.frame.palette.foreground,
				draw,
				height,
				width: width * entrance,
				x,
				y: y0,
			});
		}
		x += width + 1.5;
	}
	drawDecorLabel({
		alpha: entrance * 0.9,
		color: draw.frame.palette.foreground,
		draw,
		size: Math.min(16, Math.max(9, draw.height * 0.014)),
		text: String(plan.seed >>> 0)
			.slice(-9)
			.padStart(9, "0"),
		x: x0,
		y: y0 + height + 12,
	});
}

function clampRange({
	value,
	minimum,
	maximum,
}: {
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
}): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainder = Math.max(0, seconds - minutes * 60);
	return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}
