import {
	enterBDirection,
	enterBGlyphs,
	enterBOutBack,
	type EnterBDraw,
	type EnterBGlyphTransform,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inOutCubic,
	lerp,
	outCubic,
} from "./exit-hold-geometry";
import {
	drawX2Glyphs,
	x2CenterOrder,
	x2Hot,
	x2IsBlank,
	x2IsKanji,
	x2Random,
	x2RandomSigned,
	x2SideOf,
	x2Stagger,
	type X2Draw,
	type X2Glyph,
} from "./x2-drawing";

/** JIZURA `HIDE`: this glyph has already left the stage. */
function hide(): null {
	return null;
}

const PI = Math.PI;
const TAU = Math.PI * 2;

/** Motion-strength factor at the planner's default setting (JIZURA `motionK`). */
const MOTION_K = 1.005;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

/** Progress confined to the a..b window (JIZURA `seg`). */
// eslint-disable-next-line opencut/prefer-object-params
function seg(value: number, start: number, end: number): number {
	return clamp((value - start) / (end - start));
}

function oQuart(value: number): number {
	return 1 - (1 - clamp(value)) ** 4;
}

function iQuad(value: number): number {
	return clamp(value) ** 2;
}

function iCubic(value: number): number {
	return clamp(value) ** 3;
}

function ioCubic(value: number): number {
	return inOutCubic(value);
}

function oCubic(value: number): number {
	return outCubic(value);
}

// eslint-disable-next-line opencut/prefer-object-params
function oBack(value: number, overshoot = 1.70158): number {
	return enterBOutBack(value, overshoot);
}

function glyphsOf(options: X2Draw): readonly X2Glyph[] {
	return enterBGlyphs(options);
}

function glyphCount(options: X2Draw): number {
	return enterBGlyphs(options).length;
}

/** env.W stand-in for glyph-anim contracts (house approximation). */
function envWidthOf(options: X2Draw): number {
	return options.maxWidth / 0.86;
}

/** env.H stand-in for glyph-anim contracts (house approximation). */
function envHeightOf(options: X2Draw): number {
	return options.size * 4;
}

export function drawX2ExitA(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "xhCentreThin":
		case "xhKanaFirst":
		case "xhCombOut":
		case "xhEndsOut":
		case "xhRollCall":
		case "xhCeiling":
		case "xhFlick":
		case "xhHopFar":
		case "xhConveyor":
		case "xhGather":
		case "xhStairs":
		case "xhEatAlong":
		case "xhShuffle":
		case "xhShutters":
		case "xhStomp":
		case "xhCoinSpin":
		case "xhPageTurn":
		case "xhTiltSlide":
		case "xhConcertina":
		case "xhBarcode":
		case "xhMorse":
		case "xhFullStop":
		case "xhPieceStrata":
		case "xhPieceThin":
		case "xhPieceSpin":
		case "xhPieceHeap":
		case "xhPieceParts":
			drawX2ExitAPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2ExitAPart(options: EnterBDraw): void {
	if (options.frame.exitProgress >= 0.998) return;
	const preset = options.frame.cut?.preset.exit;
	switch (preset) {
		case "xhCentreThin":
			drawCentreThin(options);
			return;
		case "xhKanaFirst":
			drawKanaFirst(options);
			return;
		case "xhCombOut":
			drawCombOut(options);
			return;
		case "xhEndsOut":
			drawEndsOut(options);
			return;
		case "xhRollCall":
			drawRollCall(options);
			return;
		case "xhCeiling":
			drawCeiling(options);
			return;
		case "xhFlick":
			drawFlick(options);
			return;
		case "xhHopFar":
			drawHopFar(options);
			return;
		case "xhConveyor":
			drawConveyor(options);
			return;
		case "xhGather":
			drawGather(options);
			return;
		case "xhStairs":
			drawStairs(options);
			return;
		case "xhEatAlong":
			drawEatAlong(options);
			return;
		case "xhShuffle":
			drawShuffle(options);
			return;
		case "xhShutters":
			drawShutters(options);
			return;
		case "xhStomp":
			drawStomp(options);
			return;
		case "xhCoinSpin":
			drawCoinSpin(options);
			return;
		case "xhPageTurn":
			drawPageTurn(options);
			return;
		case "xhTiltSlide":
			drawTiltSlide(options);
			return;
		case "xhConcertina":
			drawConcertina(options);
			return;
		case "xhBarcode":
			drawBarcode(options);
			return;
		case "xhMorse":
			drawMorse(options);
			return;
		case "xhFullStop":
			drawFullStop(options);
			return;
		case "xhPieceStrata":
			drawPieceStrataFallback(options);
			return;
		case "xhPieceThin":
			drawPieceThinFallback(options);
			return;
		case "xhPieceSpin":
			drawPieceSpinFallback(options);
			return;
		case "xhPieceHeap":
			drawPieceHeapFallback(options);
			return;
		case "xhPieceParts":
			drawPiecePartsFallback(options);
			return;
		default:
			return;
	}
}

/** 中央から細る — spreading from the middle, each glyph narrows to a hairline that shortens to nothing. */
function drawCentreThin(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				x2CenterOrder(glyph, count),
				0.5,
			);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const narrow = ioCubic(seg(staggered, 0, 0.6));
			const shorten = iQuad(seg(staggered, 0.5, 1));
			return {
				scaleX: Math.max(0.03, lerpN(1, 0.05, narrow)),
				scaleY: Math.max(0.02, 1 - shorten),
			};
		},
	});
}

/** かなが先に — the light glyphs soften and sink away first; the heavy ones stand alone, then punch out. */
function drawKanaFirst(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const visible = Array.from(options.text).filter(
		(character) => !x2IsBlank(character) && character !== "\n",
	);
	const heavyGlyph = (character: string): boolean =>
		x2IsKanji(character) || /[A-Z0-9]/u.test(character);
	const heavyCount = visible.filter(heavyGlyph).length;
	const natural = heavyCount > 0 && heavyCount < visible.length;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const heavy = natural
				? heavyGlyph(glyph.character)
				: glyph.index % 3 === 1;
			if (!heavy) {
				const staggered = x2Stagger(
					seg(progress, 0, 0.55),
					glyph.order,
					0.45,
				);
				if (staggered <= 0) return undefined;
				if (staggered >= 1) return hide();
				return {
					alpha: 1 - iQuad(staggered),
					scaleX: 1 - 0.2 * staggered,
					scaleY: 1 - 0.2 * staggered,
					translateY: iQuad(staggered) * size * 0.3,
				};
			}
			const staggered = x2Stagger(seg(progress, 0.5, 1), glyph.order, 0.4);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const lift = Math.sin(seg(staggered, 0, 0.35) * (PI / 2)) * 0.16;
			const drop = iCubic(seg(staggered, 0.3, 1));
			const scale = Math.max(0.01, (1 + lift) * (1 - drop));
			return {
				alpha: 1 - iCubic(seg(staggered, 0.6, 1)),
				scaleX: scale,
				scaleY: scale,
			};
		},
	});
}

/** 櫛抜け — two combs pulled apart: every other glyph slides up out of its cell, the rest slide down. */
function drawCombOut(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const odd = glyph.index % 2 === 1;
			const staggered = x2Stagger(
				odd ? seg(progress, 0.38, 1) : seg(progress, 0, 0.62),
				glyph.order,
				0.3,
			);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const slide = ioCubic(staggered) * 1.3;
			const side = odd ? 1 : -1;
			return {
				clipY: side > 0 ? [-0.65, 0.65 - slide] : [-0.65 + slide, 0.65],
				translateY: side * slide * glyph.height,
			};
		},
	});
}

/** 両端から抜ける — the outermost pair is pulled off outwards first, then pair after pair. */
function drawEndsOut(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				1 - x2CenterOrder(glyph, count),
				0.62,
			);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const side = x2SideOf(glyph, count);
			if (side === 0) {
				const scale = Math.max(
					0.01,
					1 +
						Math.sin(seg(staggered, 0, 0.4) * PI) * 0.12 -
						iCubic(seg(staggered, 0.3, 1)),
				);
				return { alpha: 1 - iCubic(staggered), scaleX: scale, scaleY: scale };
			}
			const eased = iCubic(staggered);
			return {
				alpha: 1 - iQuad(seg(staggered, 0.35, 1)),
				scaleX: 1 + eased * 1.3,
				translateX: side * eased * size * 2.6 * MOTION_K,
			};
		},
	});
}

/** 指名されて消える — in a shuffled order, one glyph at a time lights up in the accent, swells, and snaps shut. */
function drawRollCall(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const hot = x2Hot(options);
	const order = Math.max(1, glyphCount(options));
	const rankOf = (index: number): number => {
		let rank = 0;
		const value = x2Random(options, index, 71);
		for (let other = 0; other < order; other += 1) {
			if (x2Random(options, other, 71) < value) rank += 1;
		}
		return order > 1 ? rank / (order - 1) : 0;
	};
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, rankOf(glyph.index), 0.72);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const swell = oBack(seg(staggered, 0, 0.45), 2.4);
			const shut = iCubic(seg(staggered, 0.55, 1));
			return {
				color: hot,
				scaleX: 1 + swell * 0.24,
				scaleY: Math.max(0.02, 1 - shut),
			};
		},
	});
}

/** 天井に貼り付く — glyphs squat, shoot straight up and splat flat against the top edge, then slip out. */
function drawCeiling(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const flat = 0.2;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.5);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const rise = Math.max(0, glyph.y - glyph.height * flat * 0.5 - 2);
			const squat = seg(staggered, 0, 0.14);
			const launch = iQuad(seg(staggered, 0.14, 0.4));
			const hit = seg(staggered, 0.4, 0.52);
			const out = iQuad(seg(staggered, 0.62, 1));
			let sy: number;
			let sx: number;
			if (staggered < 0.14) {
				sy = 1 - 0.22 * Math.sin(squat * (PI / 2));
				sx = 1 + 0.1 * squat;
			} else if (staggered < 0.4) {
				sy = lerpN(0.78, 1.5, oCubic(seg(staggered, 0.14, 0.24)));
				sx = 0.86;
			} else {
				sy = lerpN(1.5, flat, oCubic(hit * 2.5)) + Math.sin(hit * PI) * 0.06;
				sx = lerpN(0.86, 1.4, oBack(hit, 2));
			}
			const lift =
				(staggered < 0.14
					? (1 - sy) * glyph.height * 0.5
					: -rise * launch) - out * glyph.height * 0.45;
			return {
				alpha: 1 - iCubic(seg(staggered, 0.7, 1)),
				scaleX: sx,
				scaleY: sy,
				translateY: lift,
			};
		},
	});
}

/** 指で弾く — each glyph in turn is pressed back, then flicked: it shoots off low and fast, spinning and shrinking. */
function drawFlick(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const direction = enterBDirection(options, 81);
	const distance =
		Math.max(envWidthOf(options), envHeightOf(options)) * 0.42 * MOTION_K;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const lead = direction > 0 ? 1 - glyph.order : glyph.order;
			const staggered = x2Stagger(progress, lead, 0.6);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			if (staggered < 0.2) {
				const wind = Math.sin(seg(staggered, 0, 0.2) * (PI / 2));
				return {
					rotation: degrees(-direction * wind * 9),
					scaleX: 1 - wind * 0.08,
					translateX: -direction * wind * size * 0.07,
				};
			}
			const flight = seg(staggered, 0.2, 1);
			const eased = oQuart(flight);
			const lift = 0.6 + x2Random(options, glyph.index, 82) * 0.9;
			return {
				alpha: 1 - iQuad(seg(flight, 0.45, 1)),
				rotation: degrees(direction * (eased * 620 - 9 * (1 - flight))),
				scaleX: 1 - 0.72 * eased,
				scaleY: 1 - 0.72 * eased,
				translateX:
					direction *
					(eased * distance -
						(1 - flight) * size * 0.07 * (flight < 0.1 ? 1 : 0)),
				translateY: (-lift * flight + 0.9 * flight * flight) * size * 1.6,
			};
		},
	});
}

/** 遠くへ跳ねる — every glyph hops three times, each hop smaller and further away, until too far to see. */
function drawHopFar(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const hops = [1, 0.6, 0.3, 0.04];
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.3);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const hop = Math.min(2, Math.floor(staggered * 3));
			const fraction = staggered * 3 - hop;
			const shrink = lerpN(hops[hop]!, hops[hop + 1]!, ioCubic(fraction));
			const far = 1 - shrink;
			const landing =
				Math.max(0, 1 - fraction / 0.14) +
				Math.max(0, (fraction - 0.86) / 0.14);
			const squash = 1 + Math.sin(fraction * PI) * 0.16 - landing * 0.2;
			return {
				alpha: hop < 2 ? 1 : 1 - iQuad(seg(fraction, 0.3, 1)),
				scaleX: shrink * (1 + landing * 0.12),
				scaleY: shrink * squash,
				translateX: -(glyph.x - options.x) * far * 0.32,
				translateY:
					-(glyph.y - options.y) * far * 0.32 -
					Math.sin(fraction * PI) * size * hops[hop]! * 0.85 -
					far * size * 0.18 +
					(1 - squash) * glyph.height * shrink * 0.5,
			};
		},
	});
}

/** コンベア送り — the line is fed towards its head in jerky steps; whatever passes the head tips over and drops. */
function drawConveyor(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	const count = glyphs.length;
	const per = Math.max(1, Math.ceil(count / 7));
	const steps = Math.ceil(count / per) + 1.4;
	const belt = progress * steps;
	const stepIndex = Math.floor(belt);
	const stepFraction = belt - stepIndex;
	const fed = (stepIndex + oCubic(seg(stepFraction, 0, 0.55))) * per;
	const row = glyphs.map((glyph) => [glyph.x, glyph.y] as const);
	const positionAt = (fraction: number): readonly [number, number] => {
		if (count === 1) return row[0]!;
		const lower = Math.min(count - 2, Math.max(0, Math.floor(fraction)));
		const t = fraction - lower;
		const a = row[lower]!;
		const b = row[lower + 1]!;
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	};
	// eslint-disable-next-line opencut/prefer-object-params
	const drop = (t: number, ax: number, ay: number): EnterBGlyphTransform => {
		const u = t / per;
		return {
			alpha: 1 - iQuad(seg(u, 0.35, 1.3)),
			rotation: degrees(-Math.min(1.4, u) * 80),
			translateX: ax - u * size * 0.5,
			translateY: ay + u * u * size * 2.4,
		};
	};
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const t = fed - glyph.index;
			if (t <= 0) {
				const target = positionAt(fed);
				const head = row[0]!;
				return {
					translateX: head[0] - target[0],
					translateY: head[1] - target[1],
				};
			}
			if (t >= per * 1.3) return hide();
			const head = row[0]!;
			return drop(t, head[0] - glyph.x, head[1] - glyph.y);
		},
	});
}

/** カード集め — glyphs slide onto the first glyph of the line like swept-up cards, and the pile is flipped away. */
function drawGather(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	const count = glyphs.length;
	const first = glyphs[0];
	if (!first) return;
	const fold = iCubic(seg(progress, 0.72, 1));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (progress >= 1) return hide();
			const flipScale = Math.max(0.02, 1 - fold);
			const flipAlpha = 1 - iCubic(seg(progress, 0.86, 1));
			const lineOrder = count > 1 ? glyph.index / (count - 1) : 0;
			const staggered =
				glyph.index === 0
					? 0
					: x2Stagger(seg(progress, 0, 0.72), lineOrder, 0.62);
			if (staggered <= 0 && fold <= 0) return undefined;
			const eased = ioCubic(staggered);
			const arc = Math.sin(eased * PI) * size * 0.22;
			const tx =
				first.x +
				x2RandomSigned(options, glyph.index, 91) * size * 0.05 -
				glyph.x;
			const ty =
				first.y +
				x2RandomSigned(options, glyph.index, 92) * size * 0.05 -
				glyph.y;
			return {
				alpha: flipAlpha,
				rotation: degrees(x2RandomSigned(options, glyph.index, 93) * 9 * eased),
				scaleX: flipScale,
				translateX: tx * eased,
				translateY: ty * eased - arc - fold * size * 0.25,
			};
		},
	});
}

/** 階段落ち — the line breaks into a staircase; the glyphs then slide down the stairs and off, lowest first. */
function drawStairs(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const count = glyphCount(options);
	const stairs = Math.max(2, count);
	const stepHeight = Math.min(size * 0.24, (size * 2.2) / stairs);
	const walk = seg(progress, 0, 0.42) * (stairs - 1);
	const stairIndex = Math.floor(walk);
	const bent = stairIndex + oBack(seg(walk - stairIndex, 0, 0.7), 2.2);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const column = count > 1 ? glyph.order * (stairs - 1) : 0;
			const down = stepHeight * Math.min(column, bent);
			const staggered = x2Stagger(
				seg(progress, 0.36, 1),
				1 - column / (stairs - 1),
				0.4,
			);
			if (staggered >= 1) return hide();
			if (down <= 0 && staggered <= 0) return undefined;
			const slide = iQuad(staggered) * size * 4.2 * MOTION_K;
			return {
				alpha: 1 - iQuad(seg(staggered, 0.4, 1)),
				rotation:
					staggered > 0 ? degrees(Math.min(1, staggered * 4) * 10) : 0,
				translateX: slide,
				translateY: down + slide * 0.5,
			};
		},
	});
}

/** 隣を呑み込む — each glyph slides into its neighbour and is swallowed; the neighbour bulges, then is swallowed in turn. */
function drawEatAlong(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const glyphs = glyphsOf(options);
	const count = glyphs.length;
	if (count === 0) return;
	const row = glyphs.map((glyph) => [glyph.x, glyph.y] as const);
	const gulpScale = (value: number): number =>
		Math.max(
			0.01,
			(1 + Math.sin(seg(value, 0, 0.45) * (PI / 2)) * 0.3) *
				(1 - iCubic(seg(value, 0.35, 1))),
		);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const mouth = seg(progress, 0, 0.78) * (count - 1);
			const bulge =
				glyph.index > 0
					? Math.sin(
							seg(mouth - (glyph.index - 1), 0.35, 1.25) * PI,
						) * 0.26
					: 0;
			if (glyph.index === count - 1) {
				const finalGulp = seg(progress, 0.74, 1);
				if (finalGulp >= 1) return hide();
				const grow = count > 1 ? clamp(mouth / (count - 1)) * 0.14 : 0;
				if (finalGulp <= 0) {
					if (!bulge && !grow) return undefined;
					const scale = 1 + bulge + grow;
					return { scaleX: scale, scaleY: scale };
				}
				const scale = gulpScale(finalGulp) * (1 + grow);
				return { scaleX: scale, scaleY: scale };
			}
			const t = mouth - glyph.index;
			if (t >= 1) return hide();
			if (t <= 0) {
				if (!bulge) return undefined;
				return { scaleX: 1 + bulge, scaleY: 1 + bulge };
			}
			const eased = iQuad(t);
			const target = row[glyph.index + 1]!;
			const scale = (1 + bulge) * (1 - 0.6 * eased);
			return {
				alpha: 1 - iCubic(t),
				scaleX: scale,
				scaleY: scale,
				translateX: (target[0] - glyph.x) * eased,
				translateY: (target[1] - glyph.y) * eased,
			};
		},
	});
}

/** 席替え — neighbours trade places over and under each other, then trade again the other side, fading with every exchange. */
function drawShuffle(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	const count = glyphs.length;
	const row = glyphs.map((glyph) => [glyph.x, glyph.y] as const);
	const ease1 = ioCubic(seg(progress, 0, 0.42));
	const ease2 = ioCubic(seg(progress, 0.4, 0.8));
	const ending = iCubic(seg(progress, 0.62, 1));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (progress >= 1) return hide();
			const side = glyph.index % 2 ? 1 : -1;
			const arc =
				(Math.sin(ease1 * PI) + Math.sin(ease2 * PI) * 0.8) *
				size *
				0.5 *
				side;
			const tailScale = Math.max(0.01, 1 - ending * 0.7);
			const tailAlpha = (1 - 0.3 * ease1) * (1 - ending);
			if (count < 2) {
				return {
					alpha: tailAlpha,
					rotation: degrees(side * (ease1 + ease2) * 25),
					scaleX: tailScale,
					scaleY: tailScale,
					translateY: arc,
				};
			}
			let partner = glyph.index ^ 1;
			if (partner >= count) partner = glyph.index;
			let second = partner % 2 ? partner + 1 : partner - 1;
			if (second < 0 || second >= count) second = partner;
			const a = row[glyph.index]!;
			const b = row[partner]!;
			const c = row[second]!;
			const x = lerpN(lerpN(a[0], b[0], ease1), c[0], ease2);
			const y = lerpN(lerpN(a[1], b[1], ease1), c[1], ease2);
			return {
				alpha: tailAlpha,
				scaleX: tailScale,
				scaleY: tailScale,
				translateX: x - a[0],
				translateY: y - a[1] + arc,
			};
		},
	});
}

/** 字ごとシャッター — every glyph has its own shutter: in a scattered order they close, alternately from the sides and from top and bottom. */
function drawShutters(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				x2Random(options, glyph.index, 101),
				0.55,
			);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const slit =
				0.62 *
				(1 - ioCubic(seg(staggered, 0, 0.8)) * 0.94) *
				(1 - iQuad(seg(staggered, 0.8, 1)));
			if (slit <= 0.004) return hide();
			return glyph.index % 2
				? { clipY: [-slit, slit] }
				: { clipX: [-slit, slit] };
		},
	});
}

/** 踏み潰し — a heavy foot walks the line: glyphs are slammed flat into dashes, the neighbours jump, the dashes shrink away. */
function drawStomp(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const count = glyphCount(options);
	const SPREAD = 0.55;
	const HIT = 0.26;
	const phaseOf = (order: number): number =>
		x2Stagger(progress, order, SPREAD);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const phase = phaseOf(glyph.order);
			if (phase >= 1) return hide();
			const gap = 1 / Math.max(1, count - 1);
			const neighbour = phaseOf(glyph.order - gap);
			const joltWindow =
				glyph.order - gap >= -1e-6 ? seg(neighbour, HIT, HIT + 0.3) : 0;
			const jolt =
				joltWindow > 0 && joltWindow < 1 && phase < HIT
					? Math.sin(joltWindow * PI) * (1 - joltWindow) * size * 0.12
					: 0;
			if (phase <= 0) return jolt ? { translateY: -jolt } : undefined;
			const slam = iCubic(seg(phase, 0, HIT));
			const wobble = seg(phase, HIT, 0.5);
			const shrink = iQuad(seg(phase, 0.5, 1));
			const squash = Math.max(0.035, lerpN(1, 0.07, slam));
			const stretch =
				(1 +
					slam * 0.5 -
					Math.sin(wobble * PI) * 0.08 * (phase > HIT ? 1 : 0)) *
				(1 - shrink);
			if (stretch <= 0.01) return hide();
			return {
				alpha: 1 - iCubic(seg(phase, 0.8, 1)),
				scaleX: stretch,
				scaleY: squash,
				translateY: (1 - squash) * glyph.height * 0.5 - jolt,
			};
		},
	});
}

/** コイン回転 — each glyph spins faster and faster about its upright axis while it rises and dwindles. */
function drawCoinSpin(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.4);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const spin = Math.cos(staggered * staggered * TAU * 2.25);
			const face = (spin < 0 ? -1 : 1) * Math.max(0.03, Math.abs(spin));
			const shrink = Math.max(0.01, 1 - iCubic(staggered));
			return {
				alpha: 1 - iCubic(seg(staggered, 0.6, 1)),
				scaleX: shrink * face,
				scaleY: shrink,
				translateY:
					-(1.5 * staggered - 0.5 * staggered * staggered) * size * 0.9,
			};
		},
	});
}

/** 一字ずつめくる — glyphs are turned like pages, each swinging round its leading edge onto the place of the one before. */
function drawPageTurn(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.62);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			const angle = ioCubic(staggered) * PI;
			const cosine = Math.cos(angle);
			const face = (cosine < 0 ? -1 : 1) * Math.max(0.03, Math.abs(cosine));
			const alpha =
				angle < PI / 2 ? 1 : 1 - seg(angle, PI * 0.5, PI * 0.92);
			if (alpha <= 0.003) return hide();
			return {
				alpha,
				scaleX: face,
				scaleY: 1 + Math.sin(angle) * 0.08,
				translateX: -(1 - cosine) * glyph.width * 0.5,
			};
		},
	});
}

/** 傾いて滑る — glyphs tip over one by one as if the floor were tilted, then slide down the slope and off, downhill first. */
function drawTiltSlide(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const direction = enterBDirection(options, 111);
	const ANGLE = 22;
	const distance =
		Math.max(envWidthOf(options), envHeightOf(options)) * 0.55 * MOTION_K;
	const along = Math.cos(degrees(ANGLE));
	const across = Math.sin(degrees(ANGLE));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const downhill = direction > 0 ? glyph.order : 1 - glyph.order;
			const tip = x2Stagger(seg(progress, 0, 0.5), 1 - downhill, 0.55);
			const slide = x2Stagger(seg(progress, 0.3, 1), 1 - downhill, 0.45);
			if (tip <= 0) return undefined;
			if (slide >= 1) return hide();
			const travel = iQuad(slide) * distance;
			return {
				alpha: 1 - iQuad(seg(slide, 0.45, 1)),
				rotation: degrees(direction * ANGLE * oBack(tip, 2.6)),
				translateX: direction * along * travel,
				translateY: across * travel,
			};
		},
	});
}

/** 蛇腹畳み — the line folds up like a concertina: glyphs lean alternately, squeeze thin, close against the head, and shut. */
function drawConcertina(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const glyphs = glyphsOf(options);
	const first = glyphs[0];
	if (!first) return;
	const shut = iQuad(seg(progress, 0.5, 0.94));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (progress >= 1) return hide();
			const eased = ioCubic(
				x2Stagger(seg(progress, 0, 0.6), 1 - glyph.order, 0.25),
			);
			const side = glyph.index % 2 ? 1 : -1;
			const thin = Math.max(0.03, 1 - eased * 0.88);
			const half = glyph.width * 0.5 * (1 - thin);
			return {
				alpha: 1 - iCubic(seg(progress, 0.85, 1)),
				scaleX: thin,
				scaleY: Math.max(0.02, 1 - shut),
				skewX: degrees(side * eased * 30),
				translateX:
					(first.x - glyph.x) * eased * 0.9 -
					(glyph.index === 0 ? half : 0),
				translateY: (first.y - glyph.y) * eased * 0.9,
			};
		},
	});
}

/** バーコード化 — each glyph is squeezed into a bar of its own width; a reader then runs along and the bars drop out. */
function drawBarcode(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const early = x2Stagger(seg(progress, 0, 0.55), glyph.order, 0.5);
			const late = x2Stagger(seg(progress, 0.5, 1), glyph.order, 0.55);
			if (early <= 0) return undefined;
			if (late >= 1) return hide();
			const width =
				0.07 +
				0.2 *
					x2Random(options, glyph.index, 121) *
					x2Random(options, glyph.index, 122) +
				(x2Random(options, glyph.index, 123) < 0.3 ? 0.14 : 0);
			const bar = early >= 0.5;
			const thin = bar
				? lerpN(0.34, width, oCubic(seg(early, 0.5, 1)))
				: lerpN(1, 0.3, iQuad(seg(early, 0, 0.5)));
			const long =
				(bar
					? lerpN(0.9, 1.12, oCubic(seg(early, 0.5, 1)))
					: 1) * Math.max(0.02, 1 - ioCubic(late));
			const offset =
				(bar ? 1.12 : 1) * ioCubic(late) * glyph.height * 0.5;
			if (!bar) {
				return { scaleX: thin, scaleY: long, translateY: offset };
			}
			return {
				character: "■",
				scaleX: thin,
				scaleY: long,
				translateY: offset,
			};
		},
	});
}

/** 信号になる — the glyphs shrink into dots and dashes, a line of Morse in the accent colour, keyed off signal by signal. */
function drawMorse(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const hot = x2Hot(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const early = x2Stagger(seg(progress, 0, 0.5), glyph.order, 0.5);
			const late = x2Stagger(seg(progress, 0.5, 1), glyph.order, 0.6);
			if (early <= 0) return undefined;
			if (late >= 1) return hide();
			if (early < 0.5) {
				const shrink = Math.max(0.05, 1 - iQuad(early * 2) * 0.9);
				return {
					alpha: 1 - iQuad(early * 2) * 0.5,
					scaleX: shrink,
					scaleY: shrink,
				};
			}
			if (late > 0.45 && late < 0.72) return hide();
			const dash = x2Random(options, glyph.index, 131) < 0.42;
			const pop = oBack(seg(early, 0.5, 1), 2.2);
			const signal = 0.24 * pop * (late >= 0.72 ? 0.8 : 1);
			return {
				character: "●",
				color: hot,
				scaleX: signal,
				scaleY: dash ? signal * 3.1 : signal,
			};
		},
	});
}

/** 句点で終わる — the glyphs dwindle into the baseline one after another; the last becomes a full stop that stays a beat, then drops. */
function drawFullStop(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	let last = -1;
	for (const glyph of glyphs) {
		if (!x2IsBlank(glyph.character)) last = glyph.index;
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (glyph.index !== last) {
				const staggered = x2Stagger(
					seg(progress, 0, 0.62),
					glyph.order,
					0.55,
				);
				if (staggered <= 0) return undefined;
				if (staggered >= 1) return hide();
				const eased = iQuad(staggered);
				const shrink = Math.max(0.01, 1 - eased);
				return {
					alpha: 1 - iCubic(staggered),
					scaleX: shrink,
					scaleY: shrink,
					translateY: eased * glyph.height * 0.42,
				};
			}
			if (progress >= 1) return hide();
			const fall = iQuad(seg(progress, 0.84, 1));
			const endDrop = fall * size * 0.55;
			const endAlpha = 1 - fall;
			if ("。．.".includes(glyph.character)) {
				return progress > 0.84
					? { alpha: endAlpha, translateY: endDrop }
					: undefined;
			}
			const close = seg(progress, 0.42, 0.6);
			if (close <= 0) return undefined;
			if (close < 1) {
				const eased = iQuad(close);
				const shrink = Math.max(0.01, 1 - eased);
				return {
					scaleX: shrink,
					scaleY: shrink,
					translateY: eased * glyph.height * 0.42,
				};
			}
			const latin =
				/[A-Za-z]/u.test(glyph.character) || /[0-9]/u.test(glyph.character);
			const pop = Math.max(0.01, oBack(seg(progress, 0.6, 0.72), 2.6));
			return {
				alpha: endAlpha,
				character: latin ? "." : "。",
				scaleX: pop,
				scaleY: pop,
				translateY: endDrop,
			};
		},
	});
}

/**
 * 段ずれ抜け / 画が痩せる / 画が回る / 画が積もる / 偏と旁が別れる — stroke-piece
 * assemblies. rocut has no stroke-piece layer, so these land the pack's own
 * glyph-level fallback (the `softOut` path JIZURA uses for outline/gradient
 * items).
 */
// eslint-disable-next-line opencut/prefer-object-params
function softOutFallback(
	options: EnterBDraw,
	spread: number,
	resolve: (
		staggered: number,
		glyph: X2Glyph,
	) => EnterBGlyphTransform | undefined,
): void {
	const progress = options.frame.exitProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, spread);
			if (staggered <= 0) return undefined;
			if (staggered >= 1) return hide();
			return resolve(staggered, glyph);
		},
	});
}

function drawPieceStrataFallback(options: EnterBDraw): void {
	const size = options.size;
	softOutFallback(options, 0.4, (staggered, glyph) => ({
		alpha: 1 - iQuad(staggered),
		translateX: (glyph.index % 2 ? 1 : -1) * iCubic(staggered) * size * 1.2,
	}));
}

function drawPieceThinFallback(options: EnterBDraw): void {
	softOutFallback(options, 0.4, (staggered) => {
		const shrink = Math.max(0.01, 1 - iQuad(staggered));
		return {
			alpha: 1 - iCubic(staggered),
			scaleX: shrink,
			scaleY: shrink,
		};
	});
}

function drawPieceSpinFallback(options: EnterBDraw): void {
	softOutFallback(options, 0.4, (staggered, glyph) => {
		const shrink = Math.max(0.01, 1 - iCubic(staggered));
		return {
			alpha: 1 - iCubic(staggered),
			rotation: degrees(
				(glyph.index % 2 ? 1 : -1) * staggered * staggered * 300,
			),
			scaleX: shrink,
			scaleY: shrink,
		};
	});
}

function drawPieceHeapFallback(options: EnterBDraw): void {
	softOutFallback(options, 0.4, (staggered, glyph) => {
		const squash = Math.max(0.05, 1 - iQuad(seg(staggered, 0, 0.6)) * 0.9);
		return {
			alpha: 1 - iQuad(seg(staggered, 0.6, 1)),
			scaleY: squash,
			translateY: (1 - squash) * glyph.height * 0.5,
		};
	});
}

function drawPiecePartsFallback(options: EnterBDraw): void {
	const size = options.size;
	const far =
		Math.max(envWidthOf(options), envHeightOf(options)) * 0.4 * MOTION_K;
	softOutFallback(options, 0.3, (staggered, glyph) => ({
		alpha: 1 - iQuad(seg(staggered, 0.5, 1)),
		translateX:
			(glyph.index % 2 ? 1 : -1) *
			(oCubic(seg(staggered, 0, 0.35)) * size * 0.12 +
				iCubic(seg(staggered, 0.4, 1)) * far),
	}));
}
