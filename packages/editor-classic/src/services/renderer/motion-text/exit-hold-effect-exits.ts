import {
	clamp01,
	degrees,
	drawExitHoldGlyph,
	drawExitHoldOutline,
	exitHoldGlyphs,
	frameStep,
	inOutCubic,
	inOutSine,
	mixHex,
	outCubic,
	randomSigned,
	randomUnit,
	secondsOf,
	smooth,
	stagger,
	type ExitHoldDraw,
} from "./exit-hold-geometry";

const SYMBOL_POOL = Array.from("※◆◇■□▲△▼●○◎＃＊＋×÷＝≠∞§†01／＼＜＞");

const EFFECT_EXITS = new Set([
	"dissolve",
	"backspace",
	"scrambleOut",
	"glitchDissolve",
	"echoOut",
	"popOut",
	"burn",
	"sweepCover",
	"shatterLite",
]);

export function drawExitHoldEffectExit(options: ExitHoldDraw): boolean {
	const exit = options.frame.cut?.preset.exit;
	if (!exit || !EFFECT_EXITS.has(exit)) return false;
	switch (exit) {
		case "dissolve":
			drawDissolve(options);
			break;
		case "backspace":
			drawBackspace(options);
			break;
		case "scrambleOut":
			drawScrambleOut(options);
			break;
		case "glitchDissolve":
			drawGlitchDissolve(options);
			break;
		case "echoOut":
			drawEchoOut(options);
			break;
		case "popOut":
			drawPopOut(options);
			break;
		case "burn":
			drawBurn(options);
			break;
		case "sweepCover":
			drawSweepCover(options);
			break;
		case "shatterLite":
			drawShatterLite(options);
			break;
	}
	return true;
}

function drawDissolve(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	for (const glyph of exitHoldGlyphs(options)) {
		const start = randomUnit(seed, glyph.index, 71) * 0.5 + glyph.order * 0.25;
		const phase = clamp01((progress - start) / 0.25);
		if (phase >= 0.999) continue;
		const granular =
			phase <= 0
				? 1
				: randomUnit(seed, step, glyph.index, 73) > phase
					? 1
					: 0.18;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				alpha: (1 - phase) * granular,
				scaleX: 1 + 0.3 * phase,
				scaleY: 1 + 0.3 * phase,
				translateY: -phase * options.size * 0.05,
			},
		});
	}
}

function drawBackspace(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const glyphs = exitHoldGlyphs(options);
	const deletion = clamp01((progress - 0.1) / 0.8) ** 1.3;
	const keep = Math.max(
		0,
		glyphs.length - Math.floor(deletion * (glyphs.length + 0.999)),
	);
	for (const glyph of glyphs.slice(0, keep)) {
		drawExitHoldGlyph({ glyph, options });
	}
	if (progress >= 0.94 || glyphs.length === 0) return;
	const blink = Math.floor(secondsOf(options.frame) * 5) % 2 === 0;
	if (!blink && (progress < 0.1 || keep === 0)) return;
	const target = keep > 0 ? glyphs[keep - 1]! : glyphs[0]!;
	const cursorX =
		keep > 0
			? target.x + target.width / 2 + options.size * 0.05
			: target.x - target.width / 2 - options.size * 0.1;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		cursorX,
		options.y - options.size * 0.5,
		Math.max(2, options.size * 0.07),
		options.size,
	);
}

function drawScrambleOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	for (const glyph of exitHoldGlyphs(options)) {
		const start =
			0.65 * glyph.order + 0.35 * randomUnit(seed, glyph.index, 701);
		const phase = stagger({ order: start, progress, spread: 0.55 });
		if (phase >= 0.999) continue;
		if (
			phase > 0.55 &&
			randomUnit(seed, glyph.index, step, 703) < (phase - 0.55) * 2.4
		) {
			continue;
		}
		const symbol =
			SYMBOL_POOL[
				Math.floor(
					randomUnit(seed, glyph.index, step, 702) * SYMBOL_POOL.length,
				)
			];
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				character: phase > 0 ? (symbol ?? glyph.character) : glyph.character,
				color:
					randomUnit(seed, glyph.index, step, 704) < 0.3
						? options.frame.palette.accent
						: undefined,
				scaleX: 1 - 0.35 * smooth((phase - 0.4) / 0.6),
				scaleY: 1 - 0.35 * smooth((phase - 0.4) / 0.6),
			},
		});
	}
}

function drawGlitchDissolve(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const step = frameStep(options.frame);
	const glyphs = exitHoldGlyphs(options);
	for (const glyph of glyphs) {
		const start = randomUnit(seed, glyph.index, 801) * 0.55;
		const phase = (progress - start) / 0.45;
		if (phase <= 0) {
			drawExitHoldGlyph({ glyph, options });
			continue;
		}
		if (phase < 0.3) {
			const upper = randomUnit(seed, glyph.index, step, 802) < 0.5;
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					clipY: upper ? [-1.2, 0.15] : [-0.15, 1.2],
					color: upper ? options.frame.palette.accent : undefined,
					translateX:
						randomSigned(seed, glyph.index, step, 803) * options.size * 0.12,
				},
			});
		}
		if (phase >= 1) continue;
		const blocks = Math.ceil(5 * (1 - phase * 0.8));
		for (let block = 0; block < blocks; block += 1) {
			if (randomUnit(seed, glyph.index, block, step, 805) < phase * 0.55) {
				continue;
			}
			const width =
				options.size *
				(0.12 + randomUnit(seed, glyph.index, block, 806) * 0.48) *
				(1 - phase * 0.5);
			const height =
				options.size *
				(0.06 + randomUnit(seed, glyph.index, block, 807) * 0.24);
			options.ctx.fillStyle =
				block % 3 === 0
					? options.frame.palette.accent
					: block % 3 === 1
						? options.frame.palette.secondary
						: options.frame.palette.foreground;
			options.ctx.fillRect(
				glyph.x +
					randomSigned(seed, glyph.index, block, step, 808) *
						options.size *
						0.34 -
					width / 2,
				glyph.y +
					randomSigned(seed, glyph.index, block, step, 809) *
						options.size *
						0.34 -
					height / 2,
				width,
				height,
			);
		}
	}
}

function drawEchoOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const mainAlpha = 1 - inOutSine(clamp01(progress / 0.45));
	for (const glyph of exitHoldGlyphs(options)) {
		if (mainAlpha > 0.003) {
			drawExitHoldGlyph({
				glyph,
				options,
				transform: { alpha: mainAlpha },
			});
		}
		for (let copy = 0; copy < 3; copy += 1) {
			const phase = clamp01((progress - copy * 0.15) / 0.55);
			if (phase <= 0 || phase >= 1) continue;
			drawExitHoldOutline({
				alpha: 0.8 * (1 - phase),
				color:
					copy === 1
						? options.frame.palette.accent
						: options.frame.palette.foreground,
				glyph,
				lineWidth: Math.max(1, options.size * 0.016),
				options,
				scale: 1 + 0.5 * outCubic(phase) * (1 + copy * 0.2),
			});
		}
	}
}

function drawPopOut(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	for (const glyph of exitHoldGlyphs(options)) {
		const start = 0.6 * glyph.order + 0.4 * randomUnit(seed, glyph.index, 1001);
		const phase = stagger({ order: start, progress, spread: 0.5 });
		if (phase < 0.55) {
			const local = phase / 0.55;
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					color: mixHex({
						from: options.frame.palette.foreground,
						to: options.frame.palette.accent,
						progress: local * 0.7,
					}),
					scaleX:
						(1 + 0.5 * local ** 2) * (1 + 0.07 * Math.sin(local * 26) * local),
					scaleY:
						(1 + 0.5 * local ** 2) * (1 - 0.07 * Math.sin(local * 26) * local),
				},
			});
			continue;
		}
		if (phase >= 1) continue;
		const burst = (phase - 0.55) / 0.45;
		const radius = options.size * (0.35 + 0.45 * outCubic(burst));
		const baseAlpha = options.ctx.globalAlpha;
		options.ctx.globalAlpha = baseAlpha * (1 - burst);
		options.ctx.fillStyle = options.frame.palette.accent;
		const line = Math.max(1, options.size * 0.08 * (1 - burst));
		for (let ray = 0; ray < 8; ray += 1) {
			const angle =
				randomUnit(seed, glyph.index, 1002) * Math.PI * 2 +
				(ray / 8) * Math.PI * 2;
			options.ctx.save();
			options.ctx.translate(glyph.x, glyph.y);
			options.ctx.rotate(angle);
			options.ctx.fillRect(radius, -line / 2, options.size * 0.16, line);
			options.ctx.restore();
		}
		options.ctx.globalAlpha = baseAlpha;
	}
}

function drawBurn(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const reverse = (seed & 0x20) !== 0;
	const step = frameStep(options.frame);
	for (const glyph of exitHoldGlyphs(options)) {
		const order = reverse ? 1 - glyph.order : glyph.order;
		const start = 0.6 * order + 0.4 * randomUnit(seed, glyph.index, 1101);
		const phase = stagger({ order: start, progress, spread: 0.45 });
		if (phase >= 0.999) continue;
		const heat = smooth(phase / 0.2);
		const char = smooth((phase - 0.35) / 0.6);
		const burned = clamp01((phase - 0.12) / 0.88) ** 1.15;
		drawExitHoldGlyph({
			glyph,
			options,
			transform: {
				clipY: [-1.2, 0.72 - 1.44 * burned],
				color:
					char > 0
						? mixHex({
								from: options.frame.palette.accent,
								to: options.frame.palette.background,
								progress: char * 0.75,
							})
						: mixHex({
								from: options.frame.palette.foreground,
								to: options.frame.palette.accent,
								progress: heat,
							}),
				translateX:
					randomSigned(seed, glyph.index, step, 1102) *
					options.size *
					0.012 *
					heat,
				translateY: -burned * options.size * 0.1,
			},
		});
		for (let ember = 0; ember < 4; ember += 1) {
			const birth = 0.15 + randomUnit(seed, glyph.index, ember, 1103) * 0.6;
			const age = (phase - birth) / 0.35;
			if (age <= 0 || age >= 1) continue;
			const size = Math.max(1, options.size * 0.04 * (1 - age));
			options.ctx.fillStyle = options.frame.palette.accent;
			options.ctx.fillRect(
				glyph.x +
					randomSigned(seed, glyph.index, ember, 1104) * glyph.width * 0.4 -
					size / 2,
				glyph.y + options.size * (0.45 - age * 0.55) - size / 2,
				size,
				size,
			);
		}
	}
}

function drawSweepCover(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const phase = inOutCubic(progress);
	const left = options.x - options.maxWidth / 2 - options.size * 0.14;
	const right = options.x + options.maxWidth / 2 + options.size * 0.14;
	const leading = left + (right - left) * clamp01(phase * 2);
	const trailing = left + (right - left) * clamp01((phase - 0.5) * 2);
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		leading,
		options.y - options.size,
		right - leading,
		options.size * 2,
	);
	options.ctx.clip();
	options.drawGlyph(options);
	options.ctx.restore();
	if (leading - trailing <= 0.3) return;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		trailing,
		options.y - options.size * 0.68,
		leading - trailing,
		options.size * 1.36,
	);
}

function drawShatterLite(options: ExitHoldDraw): void {
	const progress = options.frame.exitProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const distance = options.size * 1.7;
	for (const glyph of exitHoldGlyphs(options)) {
		const delay = randomUnit(seed, glyph.index, 1201) * 0.35;
		const phase = clamp01((progress - delay) / 0.65);
		if (phase >= 0.999) continue;
		for (const [piece, xDirection, yDirection] of [
			[0, -1, -1],
			[1, 1, -1],
			[2, -1, 1],
			[3, 1, 1],
		] as const) {
			const eased = outCubic(phase);
			const pieceDistance =
				distance * (0.7 + 0.6 * randomUnit(seed, glyph.index, piece, 1203));
			drawExitHoldGlyph({
				glyph,
				options,
				transform: {
					alpha: 1 - smooth((phase - 0.45) / 0.55),
					clipX: xDirection < 0 ? [-1.6, 0.01] : [0, 1.6],
					clipY: yDirection < 0 ? [-1.6, 0.01] : [0, 1.6],
					rotation: degrees(
						randomSigned(seed, glyph.index, piece, 1204) * 110 * eased,
					),
					scaleX: 1 - 0.45 * phase,
					scaleY: 1 - 0.45 * phase,
					translateX:
						(xDirection + randomSigned(seed, glyph.index, piece, 1202) * 0.5) *
						pieceDistance *
						eased,
					translateY:
						(yDirection + randomSigned(seed, glyph.index, piece, 1205) * 0.5) *
							pieceDistance *
							eased +
						options.size * 0.9 * phase ** 2,
				},
			});
		}
	}
}
