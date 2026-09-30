import { mixHex } from "./exit-hold-geometry";
import {
	clamp01,
	clipEnterBPolygon,
	degrees,
	drawEnterBClipped,
	drawEnterBDot,
	drawEnterBGlyph,
	drawEnterBGlyphs,
	drawEnterBLine,
	drawEnterBRing,
	drawEnterBWhole,
	enterBBounds,
	enterBDirection,
	enterBGlyphs,
	enterBOutBack,
	enterBOutQuart,
	enterBOutQuint,
	enterBPhase,
	enterBRandom,
	enterBRandomSigned,
	enterBSeconds,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	type EnterBDraw,
} from "./enter-b-drawing";

export function drawEnterBGraphic(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "hatchFill":
			drawHatchFill(options);
			return true;
		case "brushReveal":
			drawBrushReveal(options);
			return true;
		case "inkDrop":
			drawInkDrop(options);
			return true;
		case "quarters":
			drawQuarters(options);
			return true;
		case "invertBox":
			drawInvertBox(options);
			return true;
		case "printRegister":
			drawPrintRegister(options);
			return true;
		case "echoCount":
			drawEchoCount(options);
			return true;
		case "liquidFill":
			drawLiquidFill(options);
			return true;
		case "windBlown":
			drawWindBlown(options);
			return true;
		case "strokeOrder":
			drawStrokeOrder(options);
			return true;
		case "clockWipe":
			drawClockWipe(options);
			return true;
		case "shadowFirst":
			drawShadowFirst(options);
			return true;
		case "bubbles":
			drawBubbles(options);
			return true;
		case "tokoroten":
			drawTokoroten(options);
			return true;
		default:
			return false;
	}
}

function drawHatchFill(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.45,
		});
		if (progress <= 0) continue;
		const patternAlpha =
			clamp01(progress * 5) * (1 - clamp01((progress - 0.75) / 0.25));
		const baseAlpha = options.ctx.globalAlpha;
		options.ctx.save();
		options.ctx.globalAlpha = baseAlpha * patternAlpha;
		options.ctx.lineWidth = Math.max(1, options.size * 0.014);
		options.ctx.strokeStyle = options.frame.palette.accent;
		options.ctx.textAlign = "center";
		options.ctx.strokeText(
			glyph.character,
			glyph.x,
			glyph.y,
			options.size * 0.76,
		);
		options.ctx.restore();
		options.ctx.globalAlpha = baseAlpha;
		for (let line = -2; line <= 2; line += 1) {
			drawEnterBLine({
				alpha: patternAlpha * 0.6,
				color: options.frame.palette.secondary,
				from: [
					glyph.x - glyph.width * 0.42,
					glyph.y + line * options.size * 0.17 + options.size * 0.22,
				],
				options,
				to: [
					glyph.x + glyph.width * 0.42,
					glyph.y + line * options.size * 0.17 - options.size * 0.22,
				],
				width: Math.max(1, options.size * 0.012),
			});
		}
		if (progress > 0.35) {
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					alpha: inOutSine((progress - 0.35) / 0.55),
				},
			});
		}
	}
}

function drawBrushReveal(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.2);
	const progress = options.frame.enterProgress;
	const strips = 14;
	const tail = options.size * 1.1;
	let any = false;
	options.ctx.save();
	options.ctx.beginPath();
	for (let strip = 0; strip < strips; strip += 1) {
		const lag = tail * enterBRandom(options, strip, 141) ** 1.6;
		const edge =
			lerp({
				start: bounds.left,
				end: bounds.right + tail,
				progress: inOutSine(progress),
			}) - lag;
		if (edge <= bounds.left) continue;
		const stripHeight = bounds.height / strips + 0.8;
		options.ctx.rect(
			bounds.left,
			bounds.top + (bounds.height * strip) / strips,
			Math.min(bounds.width, edge - bounds.left),
			stripHeight,
		);
		any = true;
	}
	if (any) {
		options.ctx.clip();
		drawEnterBWhole({ options });
	}
	options.ctx.restore();
	for (let strip = 0; strip < strips; strip += 1) {
		const lag = tail * enterBRandom(options, strip, 141) ** 1.6;
		const edge =
			lerp({
				start: bounds.left,
				end: bounds.right + tail,
				progress: inOutSine(progress),
			}) - lag;
		if (edge <= bounds.left || edge >= bounds.right + options.size * 0.32) {
			continue;
		}
		const height = bounds.height / strips;
		options.ctx.save();
		options.ctx.globalAlpha *= 1 - clamp01((progress - 0.7) / 0.25);
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(
			Math.max(bounds.left, edge - options.size * 0.32),
			bounds.top + strip * height,
			Math.min(options.size * 0.32, edge - bounds.left),
			height * 0.9,
		);
		options.ctx.restore();
	}
}

function drawInkDrop(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: enterBRandom(options, glyph.index, 151),
			spread: 0.5,
		});
		if (progress <= 0) continue;
		const centerX =
			glyph.x +
			enterBRandomSigned(options, glyph.index, 152) * glyph.width * 0.2;
		const centerY =
			glyph.y +
			enterBRandomSigned(options, glyph.index, 153) * options.size * 0.2;
		const maxRadius = Math.hypot(glyph.width, options.size) * 0.7;
		if (progress > 0.12) {
			const radius = maxRadius * outCubic((progress - 0.12) / 0.88);
			const points: Array<readonly [number, number]> = [];
			for (let index = 0; index < 20; index += 1) {
				const angle = (index / 20) * Math.PI * 2;
				const wobble =
					1 +
					0.1 *
						Math.sin(angle * 3 + enterBRandom(options, glyph.index, 154) * 6) +
					0.07 *
						Math.sin(angle * 5 + enterBRandom(options, glyph.index, 155) * 6);
				points.push([
					centerX + Math.cos(angle) * radius * wobble,
					centerY + Math.sin(angle) * radius * wobble,
				]);
			}
			clipEnterBPolygon({
				draw: () => drawEnterBGlyph({ glyph, options }),
				options,
				points,
			});
		}
		if (progress < 0.4) {
			drawEnterBDot({
				alpha:
					progress < 0.12
						? clamp01(progress / 0.12)
						: 1 - (progress - 0.12) / 0.28,
				color: options.frame.palette.accent,
				options,
				radius:
					options.size *
					0.07 *
					(progress < 0.12
						? enterBOutBack(progress / 0.12, 2)
						: 1 + (progress - 0.12) * 4),
				x: centerX,
				y: centerY,
			});
		}
	}
}

function drawQuarters(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.08);
	const progress = options.frame.enterProgress;
	const distance =
		options.size * 1.1 + Math.max(bounds.width, bounds.height) * 0.12;
	const direction = enterBDirection(options, 161);
	const quadrants = [
		[-1, -1],
		[1, 1],
		[1, -1],
		[-1, 1],
	] as const;
	for (const [index, [xSign, ySign]] of quadrants.entries()) {
		const phase = enterBOutQuint(
			clamp01((progress - (index < 2 ? 0 : 0.2)) / 0.8),
		);
		const left = xSign < 0 ? bounds.left : bounds.centerX;
		const top = ySign < 0 ? bounds.top : bounds.centerY;
		drawEnterBClipped({
			alpha: clamp01(progress * 5),
			height: bounds.height / 2 + 0.8,
			left,
			options,
			rotation: degrees(direction * xSign * ySign * 9 * (1 - phase)),
			top,
			translateX: xSign * distance * (1 - phase),
			translateY: ySign * distance * (1 - phase),
			width: bounds.width / 2 + 0.8,
		});
	}
}

function drawInvertBox(options: EnterBDraw): void {
	const bounds = enterBBounds(options, options.size * 0.16);
	const progress = options.frame.enterProgress;
	const widthProgress = enterBOutQuart(progress / 0.34);
	const dropProgress = inOutCubic((progress - 0.42) / 0.55);
	const blockLeft = bounds.left;
	const blockRight = lerp({
		start: bounds.left,
		end: bounds.right,
		progress: widthProgress,
	});
	const blockTop = lerp({
		start: bounds.top,
		end: bounds.bottom,
		progress: dropProgress,
	});
	const width = Math.max(0, blockRight - blockLeft);
	const height = Math.max(0, bounds.bottom - blockTop);
	if (dropProgress > 0) {
		drawEnterBClipped({
			height: Math.max(0, blockTop - bounds.top),
			left: bounds.left,
			options,
			top: bounds.top,
			width: bounds.width,
		});
	}
	if (width <= 0 || height <= 0) return;
	options.ctx.save();
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.fillRect(blockLeft, blockTop, width, height);
	options.ctx.beginPath();
	options.ctx.rect(blockLeft, blockTop, width, height);
	options.ctx.clip();
	drawEnterBWhole({
		color: options.frame.palette.background,
		options,
	});
	options.ctx.restore();
}

function drawPrintRegister(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const scaled = clamp01(progress / 0.8) * 4;
	const key = Math.min(3, Math.floor(scaled));
	const eased =
		progress >= 0.8
			? 1
			: (key + enterBOutBack(clamp01((scaled - key) / 0.3), 2.2)) / 4;
	const distance = options.size * 0.42 * (1 - eased);
	const angle = enterBRandom(options, 171, 172) * Math.PI * 2;
	const offsets = [0, 1, 2].map(
		(index) =>
			[
				Math.cos(angle + (index * Math.PI * 2) / 3) * distance,
				Math.sin(angle + (index * Math.PI * 2) / 3) * distance,
			] as const,
	);
	const plateAlpha = 1 - clamp01((progress - 0.8) / 0.2);
	for (let index = 2; index >= 1; index -= 1) {
		drawEnterBWhole({
			alpha: clamp01(progress * 4) * plateAlpha * 0.76,
			color:
				index === 1
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			options,
			translateX: offsets[index]![0],
			translateY: offsets[index]![1],
		});
	}
	drawEnterBWhole({
		alpha: clamp01(progress * 4),
		options,
		translateX: offsets[0]![0],
		translateY: offsets[0]![1],
	});
}

function drawEchoCount(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const direction = enterBDirection(options, 181);
	const scaled = clamp01(progress / 0.88) * 4;
	const beat = Math.min(3, Math.floor(scaled));
	const phase = scaled - beat;
	const echoes = progress >= 0.88 ? 0 : 3 - beat;
	const punch =
		progress < 0.88
			? 0.14 * Math.exp(-phase * 7)
			: 0.1 * Math.exp(-(progress - 0.88) * 40);
	for (let echo = echoes; echo >= 1; echo -= 1) {
		drawEnterBWhole({
			alpha: clamp01(progress * 10) * 0.75 * 0.72 ** (echo - 1),
			color: options.frame.palette.accent,
			options,
			translateX: direction * options.size * 0.16 * echo,
			translateY: options.size * 0.11 * echo,
		});
	}
	drawEnterBWhole({
		alpha: clamp01(progress * 10),
		options,
		scaleX: 1 + punch,
		scaleY: 1 + punch,
	});
}

function liquidSurface({
	bounds,
	options,
	progress,
}: {
	readonly bounds: ReturnType<typeof enterBBounds>;
	readonly options: EnterBDraw;
	readonly progress: number;
}): Array<readonly [number, number]> {
	const eased = inOutSine(progress / 0.94);
	const amplitude =
		options.size * 0.08 * (1 - clamp01((progress - 0.75) / 0.25));
	const level = lerp({
		start: bounds.bottom + options.size * 0.3,
		end: bounds.top - options.size * 0.3 - amplitude * 2,
		progress: eased,
	});
	const points: Array<readonly [number, number]> = [];
	for (let index = 0; index <= 24; index += 1) {
		const x = lerp({
			start: bounds.left - options.size * 0.3,
			end: bounds.right + options.size * 0.3,
			progress: index / 24,
		});
		points.push([
			x,
			level +
				amplitude *
					Math.sin(
						(x / (options.size * 1.7)) * Math.PI * 2 +
							enterBSeconds(options) * 7,
					),
		]);
	}
	return points;
}

function drawLiquidFill(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterBBounds(options, options.size * 0.3);
	const surface = liquidSurface({ bounds, options, progress });
	const polygon = [
		...surface,
		[bounds.right + options.size * 0.3, bounds.bottom + options.size] as const,
		[bounds.left - options.size * 0.3, bounds.bottom + options.size] as const,
	];
	clipEnterBPolygon({
		draw: () => drawEnterBWhole({ options }),
		options,
		points: polygon,
	});
	const outlineAlpha =
		clamp01(progress * 6) * (1 - clamp01((progress - 0.8) / 0.2));
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.globalAlpha = baseAlpha * outlineAlpha * 0.45;
	options.ctx.lineWidth = Math.max(1, options.size * 0.014);
	options.ctx.strokeStyle = options.frame.palette.foreground;
	options.ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
	for (let index = 1; index < surface.length; index += 1) {
		drawEnterBLine({
			alpha: outlineAlpha,
			color: options.frame.palette.accent,
			from: surface[index - 1]!,
			options,
			to: surface[index]!,
			width: Math.max(1.5, options.size * 0.025),
		});
	}
}

function drawWindBlown(options: EnterBDraw): void {
	const direction = enterBDirection(options, 191);
	drawEnterBGlyphs({
		options,
		resolve: (glyph) => {
			const order = direction > 0 ? 1 - glyph.order : glyph.order;
			const progress = enterBPhase({ options, order, spread: 0.5 });
			if (progress <= 0) return null;
			const remaining = 1 - outCubic(progress);
			const phase = enterBRandom(options, glyph.index, 193) * Math.PI * 2;
			return {
				alpha: clamp01(progress * 4),
				rotation:
					Math.sin(phase * 2 + remaining * 7) * degrees(120) * remaining,
				scaleX: 1 - remaining * 0.18,
				scaleY: 1 - remaining * 0.18,
				translateX:
					-direction * (options.maxWidth * 0.3 + options.size * 2) * remaining,
				translateY:
					Math.sin(phase + remaining * 6) * options.size * 0.5 * remaining,
			};
		},
	});
}

function drawStrokeOrder(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const glyphProgress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.6,
		});
		if (glyphProgress <= 0) continue;
		const columns = 3;
		const rows = 4;
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const order = (row / rows) * 0.62 + (column / columns) * 0.38;
				const phase = clamp01((glyphProgress - order * 0.72) / 0.28);
				if (phase <= 0) continue;
				drawEnterBClipped({
					alpha: clamp01(phase * 3),
					height: options.size / rows + 0.8,
					left: glyph.x - glyph.width / 2 + (glyph.width * column) / columns,
					options: {
						...options,
						text: glyph.character,
						x: glyph.x,
						y: glyph.y - (1 - outCubic(phase)) * options.size * 0.04,
					},
					top: glyph.y - options.size * 0.5 + (options.size * row) / rows,
					width: glyph.width / columns + 0.8,
				});
			}
		}
	}
}

function drawClockWipe(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.5,
		});
		if (progress <= 0) continue;
		const clockwise = enterBRandom(options, glyph.index, 211) < 0.5;
		const sweep = inOutSine(progress) * Math.PI * 2;
		const start = -Math.PI / 2;
		const radius = Math.hypot(glyph.width, options.size) * 0.62;
		const segments = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 24));
		const points: Array<readonly [number, number]> = [[glyph.x, glyph.y]];
		for (let segment = 0; segment <= segments; segment += 1) {
			const angle = start + (clockwise ? 1 : -1) * sweep * (segment / segments);
			points.push([
				glyph.x + Math.cos(angle) * radius,
				glyph.y + Math.sin(angle) * radius,
			]);
		}
		clipEnterBPolygon({
			draw: () => drawEnterBGlyph({ glyph, options }),
			options,
			points,
		});
		const handAngle = start + (clockwise ? sweep : -sweep);
		const alpha = (1 - clamp01((progress - 0.8) / 0.2)) * clamp01(progress * 8);
		drawEnterBLine({
			alpha,
			color: options.frame.palette.accent,
			from: [glyph.x, glyph.y],
			options,
			to: [
				glyph.x + Math.cos(handAngle) * radius * 0.9,
				glyph.y + Math.sin(handAngle) * radius * 0.9,
			],
			width: Math.max(1.5, options.size * 0.028),
		});
		drawEnterBDot({
			alpha,
			color: options.frame.palette.accent,
			options,
			radius: options.size * 0.04,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawShadowFirst(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const progress = enterBPhase({
			options,
			order: glyph.order,
			spread: 0.45,
		});
		if (progress <= 0) continue;
		const landing = 0.72;
		if (progress < landing + 0.05) {
			drawEnterBGlyph({
				glyph,
				options,
				transform: {
					alpha: clamp01(progress * 5) * 0.72,
					color: mixHex({
						from: options.frame.palette.background,
						to: options.frame.palette.secondary,
						progress: 0.28,
					}),
					scaleX: lerp({
						start: 0.55,
						end: 1,
						progress: clamp01(progress / landing),
					}),
					scaleY: lerp({
						start: 0.55,
						end: 1,
						progress: clamp01(progress / landing),
					}),
				},
			});
		}
		if (progress <= 0.12) continue;
		const fall = clamp01((progress - 0.12) / (landing - 0.12));
		const settle = clamp01((progress - landing) / (1 - landing));
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01((progress - 0.12) * 4),
				scaleX:
					progress < landing
						? lerp({ start: 1.75, end: 1, progress: fall ** 2 })
						: 1 - 0.07 * Math.sin(Math.PI * settle) * (1 - settle),
				scaleY:
					progress < landing
						? lerp({ start: 1.75, end: 1, progress: fall ** 2 })
						: 1,
				translateX: -options.size * 0.22 * (1 - fall),
				translateY: -options.size * 0.34 * (1 - fall),
			},
		});
	}
}

function drawBubbles(options: EnterBDraw): void {
	for (const glyph of enterBGlyphs(options)) {
		const order =
			0.5 * enterBRandom(options, glyph.index, 221) + 0.5 * glyph.order;
		const progress = enterBPhase({ options, order, spread: 0.45 });
		if (progress <= 0) continue;
		const pop = 0.68;
		const float = clamp01(progress / pop);
		const phase = enterBRandom(options, glyph.index, 222) * Math.PI * 2;
		const deltaX =
			Math.sin(phase + float * 9) * options.size * 0.1 * (1 - float);
		const deltaY = options.size * 1.7 * (1 - outCubic(float));
		const scale =
			progress < pop
				? 0.68
				: lerp({
						start: 0.68,
						end: 1,
						progress: enterBOutBack((progress - pop) / (1 - pop), 2.6),
					});
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 6),
				scaleX: scale,
				scaleY: scale,
				translateX: deltaX,
				translateY: deltaY,
			},
		});
		const radius = Math.max(glyph.width, options.size) * 0.55;
		if (progress < pop) {
			drawEnterBRing({
				alpha: clamp01(progress * 6) * 0.85,
				color: options.frame.palette.accent,
				options,
				radius,
				width: Math.max(1.2, options.size * 0.018),
				x: glyph.x + deltaX,
				y: glyph.y + deltaY,
			});
		} else {
			const burst = (progress - pop) / (1 - pop);
			if (burst < 0.5) {
				drawEnterBRing({
					alpha: 1 - burst / 0.5,
					color: options.frame.palette.accent,
					options,
					radius: radius * (1 + 0.6 * outCubic(burst / 0.5)),
					width: Math.max(1, options.size * 0.018 * (1 - burst)),
					x: glyph.x,
					y: glyph.y,
				});
			}
		}
	}
}

function drawTokoroten(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	const bounds = enterBBounds(options, options.size * 0.3);
	const progress = options.frame.enterProgress;
	const slit = bounds.left - options.size * 0.12;
	const length = bounds.width + options.size * 0.3;
	const offset = -(1 - inOutSine(progress / 0.9)) * length;
	const relax = 1 - clamp01((progress - 0.55) / 0.45);
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		slit,
		bounds.top,
		bounds.width + options.size * 20,
		bounds.height,
	);
	options.ctx.clip();
	for (const glyph of glyphs) {
		const emerged = glyph.x + offset - slit;
		if (emerged + glyph.width / 2 < 0) continue;
		const squeeze = Math.max(
			0.08,
			1 -
				relax *
					(1 -
						lerp({
							start: 0.18,
							end: 1,
							progress: emerged / (options.size * 2),
						})),
		);
		const compressed =
			emerged <= 0 ? emerged * (1 - relax * 0.82) : emerged * squeeze;
		drawEnterBGlyph({
			glyph,
			options,
			transform: {
				scaleX: squeeze,
				scaleY: 1 + 0.3 * (1 - squeeze),
				translateX: slit + compressed - glyph.x,
			},
		});
	}
	options.ctx.restore();
	drawEnterBLine({
		alpha: clamp01(progress * 8) * (1 - clamp01((progress - 0.85) / 0.15)),
		color: options.frame.palette.accent,
		from: [slit, bounds.top - options.size * 0.25],
		options,
		to: [slit, bounds.bottom + options.size * 0.25],
		width: Math.max(3, options.size * 0.07),
	});
}
