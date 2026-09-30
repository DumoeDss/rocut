import { signedRandom, unitRandom } from "./deterministic-random";
import {
	activeHorrorAlpha,
	clamp01,
	drawHorrorSegment,
	horrorTextBounds,
	localSeconds,
	outCubic,
	TICKS_PER_SECOND,
} from "./horror-frame-utils";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

type HorrorDecorLayer = "back" | "front";

interface HorrorDecorDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly layer: HorrorDecorLayer;
	readonly width: number;
}

const BACK_DECORS = new Set(["hrDustBeam", "hrSigil"]);

export function drawHorrorDecors(options: HorrorDecorDraw): void {
	for (const decor of options.frame.cut?.preset.decor ?? []) {
		const expectedLayer = BACK_DECORS.has(decor) ? "back" : "front";
		if (options.layer !== expectedLayer) continue;
		switch (decor) {
			case "hrScratches":
				drawScratches(options);
				break;
			case "hrSigil":
				drawSigil(options);
				break;
			case "hrWatchEye":
				drawWatchEye(options);
				break;
			case "hrStaticPatch":
				drawStaticPatches(options);
				break;
			case "hrDustBeam":
				drawDustBeam(options);
				break;
			case "hrDrips":
				drawDrips(options);
				break;
			case "hrCracks":
				drawCracks(options);
				break;
		}
	}
}

function drawScratches(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const active = activeHorrorAlpha(options.frame);
	for (let group = 0; group < 2; group += 1) {
		const reveal =
			outCubic(
				(options.frame.localTime - TICKS_PER_SECOND * (0.08 + group * 0.18)) /
					(TICKS_PER_SECOND * 0.16),
			) * active;
		if (reveal <= 0.003) continue;
		const right = (group + Math.abs(cut.seed)) % 2 === 1;
		const low = (group + Math.abs(cut.seed >> 2)) % 2 === 1;
		const centerX = options.width * (right ? 0.82 : 0.18);
		const centerY = options.height * (low ? 0.78 : 0.22);
		const angle =
			(right ? -1 : 1) *
			(low ? -1 : 1) *
			(0.98 + unitRandom({ seed: cut.seed, salt: 110 + group }) * 0.28);
		const length =
			unit * (0.28 + unitRandom({ seed: cut.seed, salt: 120 + group }) * 0.14);
		const directionX = Math.sin(angle);
		const directionY = -Math.cos(angle);
		const perpendicularX = Math.cos(angle);
		const perpendicularY = Math.sin(angle);
		for (let claw = 0; claw < 4; claw += 1) {
			const offset = (claw - 1.5) * unit * 0.042;
			let x = centerX - (directionX * length) / 2 + perpendicularX * offset;
			let y = centerY - (directionY * length) / 2 + perpendicularY * offset;
			for (let segment = 0; segment < 9; segment += 1) {
				const fraction = (segment + 1) / 9;
				const jitter =
					signedRandom({
						seed: cut.seed,
						salt: 140 + group * 100 + claw * 10 + segment,
					}) *
					unit *
					0.004;
				const nextX =
					x + (directionX * length * reveal) / 9 + perpendicularX * jitter;
				const nextY =
					y + (directionY * length * reveal) / 9 + perpendicularY * jitter;
				drawHorrorSegment({
					ctx: options.ctx,
					x0: x,
					y0: y,
					x1: nextX,
					y1: nextY,
					thickness: Math.max(1, unit * 0.011 * Math.sin(Math.PI * fraction)),
					color:
						group % 2 === 0
							? options.frame.palette.foreground
							: options.frame.palette.accent,
					alpha: 0.82 * active,
				});
				x = nextX;
				y = nextY;
			}
		}
	}
}

function drawSigil(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const bounds = horrorTextBounds(options);
	const unit = Math.min(options.width, options.height);
	const centerX = (bounds.x0 + bounds.x1) / 2;
	const centerY = (bounds.y0 + bounds.y1) / 2;
	const radius = Math.min(
		unit * 0.46,
		Math.max(bounds.width, bounds.height) * 0.62 + unit * 0.08,
	);
	const alpha = activeHorrorAlpha(options.frame) * 0.48;
	const reveal = outCubic(options.frame.localTime / (TICKS_PER_SECOND * 1.2));
	const rotation = localSeconds(options.frame) * 0.07;
	const color = options.frame.palette.secondary;
	const marks = Math.floor(42 * reveal);
	for (let index = 0; index < marks; index += 1) {
		const angle = rotation + (index / 42) * Math.PI * 2;
		const inner = radius * (index % 3 === 0 ? 0.88 : 0.93);
		const outer = radius * (index % 4 === 0 ? 1 : 0.975);
		drawHorrorSegment({
			ctx: options.ctx,
			x0: centerX + Math.cos(angle) * inner,
			y0: centerY + Math.sin(angle) * inner,
			x1: centerX + Math.cos(angle) * outer,
			y1: centerY + Math.sin(angle) * outer,
			thickness: Math.max(1, unit * 0.0022),
			color,
			alpha,
		});
	}
	const star: Array<readonly [number, number]> = [];
	for (let index = 0; index < 8; index += 1) {
		const point = (index * 3) % 7;
		const angle = rotation - Math.PI / 2 + (point / 7) * Math.PI * 2;
		star.push([
			centerX + Math.cos(angle) * radius * 0.88,
			centerY + Math.sin(angle) * radius * 0.88,
		]);
	}
	const visibleSegments = Math.floor(7 * reveal);
	for (let index = 0; index < visibleSegments; index += 1) {
		drawHorrorSegment({
			ctx: options.ctx,
			x0: star[index]![0],
			y0: star[index]![1],
			x1: star[index + 1]![0],
			y1: star[index + 1]![1],
			thickness: Math.max(1, unit * 0.0024),
			color,
			alpha,
		});
	}
}

function drawWatchEye(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const bounds = horrorTextBounds(options);
	const right = unitRandom({ seed: cut.seed, salt: 301 }) >= 0.5;
	const low = unitRandom({ seed: cut.seed, salt: 302 }) >= 0.5;
	const eyeWidth = unit * 0.18;
	const eyeHeight = eyeWidth * 0.28;
	const centerX = right ? options.width - unit * 0.13 : unit * 0.13;
	const centerY = low ? options.height - unit * 0.13 : unit * 0.13;
	const seconds = localSeconds(options.frame);
	const blinkStep = Math.floor(seconds / 1.35);
	const blinkPhase = (seconds % 1.35) / 1.35;
	const blinks = unitRandom({ seed: cut.seed, salt: 303 + blinkStep }) < 0.42;
	const blink = blinks ? clamp01(Math.abs(blinkPhase - 0.2) / 0.08) : 1;
	const open =
		outCubic((options.frame.localTime - 12_000) / 72_000) *
		activeHorrorAlpha(options.frame) *
		blink;
	const color = options.frame.palette.foreground;
	let previousTop: readonly [number, number] | null = null;
	let previousBottom: readonly [number, number] | null = null;
	for (let index = 0; index <= 16; index += 1) {
		const fraction = index / 16;
		const x = centerX - eyeWidth / 2 + eyeWidth * fraction;
		const arc = Math.sin(Math.PI * fraction) * eyeHeight * open;
		const top: readonly [number, number] = [x, centerY - arc];
		const bottom: readonly [number, number] = [x, centerY + arc];
		if (previousTop && previousBottom) {
			drawHorrorSegment({
				ctx: options.ctx,
				x0: previousTop[0],
				y0: previousTop[1],
				x1: top[0],
				y1: top[1],
				thickness: Math.max(1.2, unit * 0.003),
				color,
				alpha: 0.9,
			});
			drawHorrorSegment({
				ctx: options.ctx,
				x0: previousBottom[0],
				y0: previousBottom[1],
				x1: bottom[0],
				y1: bottom[1],
				thickness: Math.max(1, unit * 0.0022),
				color,
				alpha: 0.82,
			});
		}
		previousTop = top;
		previousBottom = bottom;
	}
	if (open <= 0.08) return;
	const targetX = (bounds.x0 + bounds.x1) / 2;
	const targetY = (bounds.y0 + bounds.y1) / 2;
	const angle = Math.atan2(targetY - centerY, targetX - centerX);
	const irisX = centerX + Math.cos(angle) * eyeWidth * 0.14;
	const irisY = centerY + Math.sin(angle) * eyeHeight * 0.3;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * open;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		irisX - eyeHeight * 0.38,
		irisY - eyeHeight * 0.38,
		eyeHeight * 0.76,
		eyeHeight * 0.76,
	);
	options.ctx.fillStyle = color;
	options.ctx.fillRect(
		irisX - eyeHeight * 0.14,
		irisY - eyeHeight * 0.14,
		eyeHeight * 0.28,
		eyeHeight * 0.28,
	);
	options.ctx.globalAlpha = baseAlpha;
}

function drawStaticPatches(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const active = activeHorrorAlpha(options.frame);
	const step = Math.floor(options.frame.localTime / 5_000);
	const baseAlpha = options.ctx.globalAlpha;
	for (let patch = 0; patch < 7; patch += 1) {
		if (unitRandom({ seed: cut.seed, salt: step * 101 + patch }) < 0.25) {
			continue;
		}
		const horizontal = patch % 2 === 0;
		const patchWidth =
			unit * (0.08 + unitRandom({ seed: cut.seed, salt: 410 + patch }) * 0.13);
		const patchHeight =
			unit * (0.025 + unitRandom({ seed: cut.seed, salt: 420 + patch }) * 0.05);
		const x = horizontal
			? unitRandom({ seed: cut.seed, salt: 430 + patch }) *
				(options.width - patchWidth)
			: patch % 4 === 1
				? unit * 0.025
				: options.width - patchWidth - unit * 0.025;
		const y = horizontal
			? patch % 4 === 0
				? unit * 0.025
				: options.height - patchHeight - unit * 0.025
			: unitRandom({ seed: cut.seed, salt: 440 + patch }) *
				(options.height - patchHeight);
		const cellWidth = patchWidth / 8;
		const cellHeight = patchHeight / 4;
		for (let row = 0; row < 4; row += 1) {
			for (let column = 0; column < 8; column += 1) {
				const noise = unitRandom({
					seed: cut.seed,
					salt: step * 1009 + patch * 97 + row * 11 + column,
				});
				if (noise < 0.38) continue;
				options.ctx.fillStyle =
					noise > 0.76
						? options.frame.palette.foreground
						: options.frame.palette.secondary;
				options.ctx.globalAlpha = baseAlpha * active * (0.35 + noise * 0.45);
				options.ctx.fillRect(
					x + column * cellWidth,
					y + row * cellHeight,
					cellWidth + 1,
					cellHeight + 1,
				);
			}
		}
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawDustBeam(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const active = activeHorrorAlpha(options.frame);
	const unit = Math.min(options.width, options.height);
	const right = unitRandom({ seed: cut.seed, salt: 501 }) >= 0.5;
	const topX = options.width * (right ? 0.78 : 0.22);
	const bottomX = topX + options.width * (right ? -0.28 : 0.28);
	for (let strip = 0; strip < 6; strip += 1) {
		const offset = (strip - 2.5) * unit * 0.035;
		drawHorrorSegment({
			ctx: options.ctx,
			x0: topX + offset,
			y0: -unit * 0.05,
			x1: bottomX + offset * 2.4,
			y1: options.height + unit * 0.05,
			thickness: unit * 0.055,
			color: options.frame.palette.foreground,
			alpha: active * (0.018 + strip * 0.006),
		});
	}
	const seconds = localSeconds(options.frame);
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.secondary;
	for (let index = 0; index < 42; index += 1) {
		const speed =
			0.004 + unitRandom({ seed: cut.seed, salt: 520 + index }) * 0.016;
		const vertical =
			(unitRandom({ seed: cut.seed, salt: 560 + index }) + seconds * speed) % 1;
		const beamCenter = topX + (bottomX - topX) * vertical;
		const beamWidth = unit * (0.1 + vertical * 0.24);
		const x =
			beamCenter +
			signedRandom({ seed: cut.seed, salt: 600 + index }) * beamWidth +
			Math.sin(seconds * 0.7 + index) * unit * 0.01;
		const y = vertical * options.height;
		const size =
			unit *
			(0.0015 + unitRandom({ seed: cut.seed, salt: 640 + index }) * 0.003);
		options.ctx.globalAlpha =
			baseAlpha *
			active *
			(0.18 + unitRandom({ seed: cut.seed, salt: 680 + index }) * 0.35);
		options.ctx.fillRect(x, y, Math.max(1, size), Math.max(1, size));
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawDrips(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const alpha = activeHorrorAlpha(options.frame) * 0.9;
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.globalAlpha = baseAlpha * alpha;
	const band = unit * 0.03 * outCubic(options.frame.localTime / 48_000);
	options.ctx.fillRect(0, 0, options.width, band);
	for (let index = 0; index < 9; index += 1) {
		const x =
			options.width *
			(0.03 + unitRandom({ seed: cut.seed, salt: 701 + index }) * 0.94);
		const delay = unitRandom({ seed: cut.seed, salt: 720 + index }) * 96_000;
		const growth = outCubic(
			(options.frame.localTime - delay) /
				(TICKS_PER_SECOND *
					(2.5 + unitRandom({ seed: cut.seed, salt: 740 + index }) * 3)),
		);
		const length =
			unit *
			(0.06 + unitRandom({ seed: cut.seed, salt: 760 + index }) * 0.24) *
			growth;
		const width =
			unit *
			(0.004 + unitRandom({ seed: cut.seed, salt: 780 + index }) * 0.008);
		if (length <= 1) continue;
		options.ctx.fillRect(x - width / 2, band * 0.5, width, length);
		options.ctx.fillRect(
			x - width,
			band * 0.5 + length - width,
			width * 2,
			width * 2,
		);
	}
	options.ctx.globalAlpha = baseAlpha;
}

function drawCracks(options: HorrorDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const unit = Math.min(options.width, options.height);
	const right = unitRandom({ seed: cut.seed, salt: 801 }) >= 0.5;
	const low = unitRandom({ seed: cut.seed, salt: 802 }) >= 0.5;
	const originX = right ? options.width : 0;
	const originY = low ? options.height : 0;
	const baseAngle = Math.atan2(
		options.height / 2 - originY,
		options.width / 2 - originX,
	);
	const reveal = outCubic(options.frame.localTime / (TICKS_PER_SECOND * 1.6));
	const alpha = activeHorrorAlpha(options.frame) * 0.75;
	const branch = ({
		angle,
		depth,
		id,
		length,
		x,
		y,
	}: {
		readonly angle: number;
		readonly depth: number;
		readonly id: number;
		readonly length: number;
		readonly x: number;
		readonly y: number;
	}) => {
		let currentX = x;
		let currentY = y;
		const points: Array<readonly [number, number]> = [[x, y]];
		for (let segment = 0; segment < 7; segment += 1) {
			const jitter =
				signedRandom({ seed: cut.seed, salt: 820 + id * 19 + segment }) * 0.28;
			const nextX = currentX + (Math.cos(angle + jitter) * length) / 7;
			const nextY = currentY + (Math.sin(angle + jitter) * length) / 7;
			const segmentReveal = clamp01(reveal * (1 + depth * 0.2) - depth * 0.25);
			if ((segment + 1) / 7 <= segmentReveal) {
				drawHorrorSegment({
					ctx: options.ctx,
					x0: currentX,
					y0: currentY,
					x1: nextX,
					y1: nextY,
					thickness: Math.max(1, unit * 0.0024 * (1 - depth * 0.22)),
					color: options.frame.palette.foreground,
					alpha,
				});
			}
			currentX = nextX;
			currentY = nextY;
			points.push([currentX, currentY]);
		}
		if (depth >= 2) return;
		for (let side = 0; side < 2; side += 1) {
			const point = points[2 + ((id + side) % 3)]!;
			branch({
				x: point[0],
				y: point[1],
				angle:
					angle +
					(side === 0 ? -1 : 1) *
						(0.38 +
							unitRandom({ seed: cut.seed, salt: 900 + id * 7 + side }) * 0.34),
				length: length * 0.5,
				depth: depth + 1,
				id: id * 3 + side + 1,
			});
		}
	};
	for (let ray = 0; ray < 3; ray += 1) {
		branch({
			x: originX,
			y: originY,
			angle:
				baseAngle +
				(ray - 1) * 0.35 +
				signedRandom({ seed: cut.seed, salt: 960 + ray }) * 0.15,
			length:
				unit * (0.28 + unitRandom({ seed: cut.seed, salt: 970 + ray }) * 0.14),
			depth: 0,
			id: ray + 1,
		});
	}
}
