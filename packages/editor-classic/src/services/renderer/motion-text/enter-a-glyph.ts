import {
	clamp01,
	drawEnterAGlyph,
	drawEnterAGlyphs,
	drawEnterALine,
	drawEnterAOutlineGlyph,
	drawEnterAWhole,
	drawEnterAWholeOutline,
	enterABounds,
	enterACenterOrder,
	enterADirection,
	enterAGlyphs,
	enterAInOutQuart,
	enterAOutBack,
	enterAOutQuint,
	enterAPhase,
	enterASmooth,
	lerp,
	mixHex,
	outCubic,
	type EnterADraw,
} from "./enter-a-drawing";

export function drawEnterAGlyphFamily(options: EnterADraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "riseMask":
			drawRiseMask(options);
			return true;
		case "dropMask":
			drawDropMask(options);
			return true;
		case "slideWhole":
			drawSlideWhole(options);
			return true;
		case "flipX":
			drawFlipX(options);
			return true;
		case "flipY":
			drawFlipY(options);
			return true;
		case "domino":
			drawDomino(options);
			return true;
		case "fold":
			drawFold(options);
			return true;
		case "unroll":
			drawUnroll(options);
			return true;
		case "strokeDraw":
			drawStrokeDraw(options);
			return true;
		case "outlineFill":
			drawOutlineFill(options);
			return true;
		case "splitJoin":
			drawSplitJoin(options);
			return true;
		default:
			return false;
	}
}

function drawRiseMask(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.45,
			});
			if (progress <= 0) return null;
			const offset = 1.15 * (1 - enterAOutQuint(progress));
			return {
				clipX: [-1.3, 1.3],
				clipY: [-0.68 - offset, 0.68 - offset],
				translateY: offset * glyph.height,
			};
		},
	});
}

function drawDropMask(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.45,
			});
			if (progress <= 0) return null;
			const offset = -1.15 * (1 - enterAOutBack(progress, 1.35));
			return {
				clipX: [-1.3, 1.3],
				clipY: [-0.68 - offset, 0.68 - offset],
				translateY: offset * glyph.height,
			};
		},
	});
}

function drawSlideWhole(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const direction = enterADirection(options, 11);
	const glyphCount = enterAGlyphs(options).length;
	const distance =
		options.size * (glyphCount <= 1 ? 1.3 : 3.2) * (0.85 + glyphCount * 0.015);
	drawEnterAWhole({
		alpha: clamp01(progress * 4),
		options,
		translateX: direction * distance * (1 - enterAOutBack(progress, 1.7)),
	});
}

function drawFlipX(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.45 });
		if (progress <= 0) continue;
		const pop = enterAOutBack(progress / 0.22, 1.6);
		const angle = (1 - enterAOutBack((progress - 0.22) / 0.78, 1.25)) * Math.PI;
		const cosine = Math.cos(angle);
		const shade = Math.abs(Math.sin(angle));
		const color =
			cosine < 0
				? mixHex({
						from: options.frame.palette.accent,
						to: options.frame.palette.background,
						progress: shade * 0.35,
					})
				: mixHex({
						from: options.frame.palette.foreground,
						to: options.frame.palette.background,
						progress: Math.min(0.5, shade * 0.5),
					});
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 8),
				character: cosine < 0 ? "■" : glyph.character,
				color,
				scaleX: Math.max(0.04, Math.abs(cosine)),
				scaleY: cosine < 0 ? Math.max(0.3, pop) : 1,
			},
		});
	}
}

function drawFlipY(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({
			options,
			order: enterACenterOrder(glyph),
			spread: 0.4,
		});
		if (progress <= 0) continue;
		const angle = (1 - (1 - clamp01(progress)) ** 4) * 1.5 * Math.PI;
		const cosine = Math.cos(1.5 * Math.PI - angle);
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 3),
				color: mixHex({
					from: options.frame.palette.foreground,
					to: options.frame.palette.background,
					progress: Math.min(
						0.75,
						Math.abs(Math.sin(1.5 * Math.PI - angle)) * 0.6 +
							(cosine < 0 ? 0.2 : 0),
					),
				}),
				scaleY: Math.abs(cosine) < 0.04 ? (cosine < 0 ? -0.04 : 0.04) : cosine,
			},
		});
	}
}

function drawDomino(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.55 });
		if (progress <= 0) continue;
		const angle = (1 - enterAOutBack(progress, 1.5)) * Math.PI * 0.5;
		const halfWidth = glyph.width / 2;
		const halfHeight = glyph.height / 2;
		const vectorX = -halfWidth;
		const vectorY = -halfHeight;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				alpha: clamp01(progress * 4),
				rotation: angle,
				translateX: cosine * vectorX - sine * vectorY - vectorX,
				translateY: sine * vectorX + cosine * vectorY - vectorY,
			},
		});
	}
}

function drawFold(options: EnterADraw): void {
	drawEnterAGlyphs({
		options,
		resolve: (glyph) => {
			const progress = enterAPhase({
				options,
				order: glyph.order,
				spread: 0.5,
			});
			if (progress <= 0) return null;
			const scaleY = Math.max(0.02, enterAOutBack(progress, 1.6));
			return {
				alpha: clamp01(progress * 4),
				color: mixHex({
					from: options.frame.palette.foreground,
					to: options.frame.palette.background,
					progress: clamp01(1 - scaleY) * 0.6,
				}),
				scaleY,
				translateY:
					(glyph.index % 2 === 0 ? -1 : 1) * (1 - scaleY) * glyph.height * 0.5,
			};
		},
	});
}

function drawUnroll(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.5 });
		if (progress <= 0) continue;
		const eased = outCubic(progress);
		const scaleX = lerp({ start: 0.3, end: 1, progress: eased });
		const edge = lerp({ start: -0.62, end: 0.62, progress: eased });
		drawEnterAGlyph({
			glyph,
			options,
			transform: {
				clipX: [-2, edge],
				clipY: [-2, 2],
				scaleX,
				translateX: -(1 - scaleX) * glyph.width * 0.5,
			},
		});
		if (progress < 1) {
			const x =
				glyph.x -
				(1 - scaleX) * glyph.width * 0.5 +
				edge * glyph.width * scaleX;
			drawEnterALine({
				alpha: (1 - eased) ** 0.6,
				color: options.frame.palette.accent,
				from: [x, glyph.y - glyph.height * 0.56],
				options,
				to: [x, glyph.y + glyph.height * 0.56],
				width: Math.max(1.5, options.size * 0.028),
			});
		}
	}
}

function drawStrokeDraw(options: EnterADraw): void {
	const progress = options.frame.enterProgress;
	const bounds = enterABounds(options, options.size * 0.12);
	const outlineProgress = 1 - (1 - clamp01(progress / 0.86)) ** 2;
	const fillAlpha = enterASmooth({ start: 0.42, end: 0.9, value: progress });
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		bounds.left,
		bounds.top,
		bounds.width * outlineProgress,
		bounds.height,
	);
	options.ctx.clip();
	drawEnterAWholeOutline({
		alpha: 1 - fillAlpha * 0.45,
		color: options.frame.palette.foreground,
		lineWidth: Math.max(0.8, options.size * 0.032),
		options,
	});
	options.ctx.restore();
	drawEnterAWhole({ alpha: fillAlpha, options });
}

function drawOutlineFill(options: EnterADraw): void {
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.4 });
		if (progress <= 0) continue;
		const outlineEase = enterAOutQuint(progress / 0.35);
		if (progress < 0.9) {
			drawEnterAOutlineGlyph({
				alpha:
					clamp01(progress * 5) *
					(1 - enterASmooth({ start: 0.68, end: 0.9, value: progress })),
				color: options.frame.palette.accent,
				glyph,
				lineWidth: Math.max(1.2, options.size * 0.028),
				options,
				transform: {
					scaleX: lerp({ start: 1.3, end: 1, progress: outlineEase }),
					scaleY: lerp({ start: 1.3, end: 1, progress: outlineEase }),
				},
			});
		}
		if (progress <= 0.3) continue;
		const fill = enterAInOutQuart((progress - 0.3) / 0.55);
		drawEnterAGlyph({
			glyph,
			options,
			transform:
				fill >= 1
					? {}
					: {
							clipX: [-2, 2],
							clipY: [lerp({ start: 0.66, end: -0.68, progress: fill }), 0.72],
						},
		});
	}
}

function drawSplitJoin(options: EnterADraw): void {
	const direction = enterADirection(options, 13);
	for (const glyph of enterAGlyphs(options)) {
		const progress = enterAPhase({ options, order: glyph.order, spread: 0.4 });
		if (progress <= 0) continue;
		const distance = direction * 1.1 * (1 - enterAOutQuint(progress));
		for (const half of [-1, 1] as const) {
			drawEnterAGlyph({
				glyph,
				options,
				transform: {
					clipX: [-0.62 - half * distance, 0.62 - half * distance],
					clipY: half < 0 ? [-2, 0.004] : [0, 2],
					translateX: half * distance * glyph.width,
				},
			});
		}
	}
}
