import {
	enterBOutBack,
	enterBDirection,
	enterBGlyphs,
	type EnterBDraw,
	type EnterBGlyphTransform,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
} from "./exit-hold-geometry";
import {
	drawX2Glyphs,
	x2Bounds,
	x2CenterOrder,
	x2Hash,
	x2IsBlank,
	x2IsKanji,
	x2LineEnds,
	x2Random,
	x2SideOf,
	x2SlotK,
	x2Stagger,
	x2Sub,
	x2Triangle,
	type X2Draw,
	type X2Glyph,
} from "./x2-drawing";

/** JIZURA `HIDE`: this glyph is not on stage yet. */
function hide(): null {
	return null;
}

const PI = Math.PI;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

function oQuart(value: number): number {
	return 1 - (1 - clamp(value)) ** 4;
}

function iQuad(value: number): number {
	return clamp(value) ** 2;
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

export function drawX2EntranceA(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "xeCenterDeal":
		case "xeEndsInward":
		case "xeFillGaps":
		case "xeKanjiFirst":
		case "xeTripleBeat":
		case "xeMarch":
		case "xeBlockDrop":
		case "xeArcToss":
		case "xeOrbitIn":
		case "xeRicochet":
		case "xeLeapfrog":
		case "xeCeilingFall":
		case "xeChainBump":
		case "xeVanishPoint":
		case "xeInchworm":
		case "xeSwingDoor":
		case "xeSkewFlap":
		case "xeGlyphCurtain":
		case "xeCellSlide":
		case "xeGearTick":
		case "xeCoinToss":
		case "xeBellows":
		case "xeUnevenScale":
		case "xeRedact":
		case "xeBlanks":
		case "xeCloneMorph":
		case "xePieceRain":
		case "xePieceVortex":
		case "xePieceStrata":
		case "xePiecePile":
			drawX2EntranceAPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2EntranceAPart(options: EnterBDraw): void {
	const preset = options.frame.cut?.preset.enter;
	switch (preset) {
		case "xeCenterDeal":
			drawCenterDeal(options);
			return;
		case "xeEndsInward":
			drawEndsInward(options);
			return;
		case "xeFillGaps":
			drawFillGaps(options);
			return;
		case "xeKanjiFirst":
			drawKanjiFirst(options);
			return;
		case "xeTripleBeat":
			drawTripleBeat(options);
			return;
		case "xeMarch":
			drawMarch(options);
			return;
		case "xeBlockDrop":
			drawBlockDrop(options);
			return;
		case "xeArcToss":
			drawArcToss(options);
			return;
		case "xeOrbitIn":
			drawOrbitIn(options);
			return;
		case "xeRicochet":
			drawRicochet(options);
			return;
		case "xeLeapfrog":
			drawLeapfrog(options);
			return;
		case "xeCeilingFall":
			drawCeilingFall(options);
			return;
		case "xeChainBump":
			drawChainBump(options);
			return;
		case "xeVanishPoint":
			drawVanishPoint(options);
			return;
		case "xeInchworm":
			drawInchworm(options);
			return;
		case "xeSwingDoor":
			drawSwingDoor(options);
			return;
		case "xeSkewFlap":
			drawSkewFlap(options);
			return;
		case "xeGlyphCurtain":
			drawGlyphCurtain(options);
			return;
		case "xeCellSlide":
			drawCellSlide(options);
			return;
		case "xeGearTick":
			drawGearTick(options);
			return;
		case "xeCoinToss":
			drawCoinToss(options);
			return;
		case "xeBellows":
			drawBellows(options);
			return;
		case "xeUnevenScale":
			drawUnevenScale(options);
			return;
		case "xeRedact":
			drawRedact(options);
			return;
		case "xeBlanks":
			drawBlanks(options);
			return;
		case "xeCloneMorph":
			drawCloneMorph(options);
			return;
		case "xePieceRain":
			drawPieceRainFallback(options);
			return;
		case "xePieceVortex":
			drawPieceVortexFallback(options);
			return;
		case "xePieceStrata":
			drawPieceStrataFallback(options);
			return;
		case "xePiecePile":
			drawPiecePileFallback(options);
			return;
		default:
			return;
	}
}

/** 中央から配る — glyphs dealt outwards from the line middle like cards. */
function drawCenterDeal(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = options.frame.cut ? glyphsOf(options) : [];
	const ends = x2LineEnds(glyphs);
	const count = glyphs.length;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				x2CenterOrder(glyph, count),
				0.45,
			);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const eased = oBack(staggered, 1.25);
			const remaining = 1 - eased;
			return {
				alpha: clamp(staggered * 5),
				rotation: degrees(
					x2SideOf(glyph, count) * (1 - oCubic(staggered)) * 22,
				),
				scaleX: lerpN(0.72, 1, oCubic(staggered)),
				scaleY: lerpN(0.72, 1, oCubic(staggered)),
				translateX: ends ? (ends.centerX - glyph.x) * remaining : 0,
				translateY: ends ? (ends.centerY - glyph.y) * remaining : 0,
			};
		},
	});
}

/** 両端から — the outermost pair slides in first, closing pair after pair. */
function drawEndsInward(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				1 - x2CenterOrder(glyph, count),
				0.5,
			);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const side = x2SideOf(glyph, count);
			const alpha = clamp(staggered * 4);
			if (side === 0) {
				const scale = lerpN(1.9, 1, oBack(staggered, 1.4));
				return { alpha, scaleX: scale, scaleY: scale };
			}
			const remaining = 1 - oQuart(staggered);
			const stretch = 1 + remaining * 0.7;
			return {
				alpha,
				scaleX: stretch,
				translateX: side * remaining * size * 1.7,
			};
		},
	});
}

/** 隙間埋め — every other glyph lands first; the rest fall into the gaps. */
function drawFillGaps(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	const count = glyphs.length;
	const startAt = (index: number): number =>
		0.36 + (count > 1 ? index / (count - 1) : 0) * 0.34;
	const landing = 0.26;
	const fallen = (index: number): number =>
		index >= 0 &&
		index < count &&
		glyphs[index] &&
		glyphs[index]!.index % 2 === 1
			? (progress - startAt(index) - landing) / 0.2
			: -1;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (glyph.index % 2 === 0) {
				const eased = clamp(
					(progress - glyph.order * 0.18) / 0.28,
				);
				if (eased <= 0) return hide();
				let jolt = 0;
				for (const neighbor of [glyph.index - 1, glyph.index + 1]) {
					const value = fallen(neighbor);
					if (value > 0 && value < 1) {
						jolt += Math.sin(value * PI) * (1 - value);
					}
				}
				if (eased >= 1 && jolt === 0) return undefined;
				const scale = lerpN(0.82, 1, oCubic(eased));
				return {
					alpha: inOutSine(eased),
					rotation: degrees(jolt * (glyph.index % 4 ? 3 : -3)),
					scaleX: scale,
					scaleY: scale,
					translateY: jolt * size * 0.09,
				};
			}
			const falling = (progress - startAt(glyph.index)) / landing;
			if (falling <= 0) return hide();
			if (falling < 1) {
				return {
					alpha: clamp(falling * 5),
					translateY: -(1 - iQuad(falling)) * size * 1.5,
				};
			}
			const settle = clamp(((falling - 1) * landing) / 0.14);
			if (settle >= 1) return undefined;
			const squash = 1 - 0.2 * Math.sin(settle * PI);
			return {
				scaleX: 1 + (1 - squash) * 0.6,
				scaleY: squash,
				translateY: (1 - squash) * glyph.height * 0.5,
			};
		},
	});
}

/** 漢字が先 — kanji (or word heads) drop in heavy; kana float up after. */
function drawKanjiFirst(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	const heavy = pickHeavyGlyphs(glyphs);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (heavy[glyph.index]) {
				const eased = clamp(
					(progress - glyph.order * 0.22) / 0.42,
				);
				if (eased <= 0) return hide();
				if (eased >= 1) return undefined;
				const fall = iQuad(clamp(eased / 0.55));
				const settle = clamp((eased - 0.55) / 0.45);
				const scale =
					lerpN(1.55, 1, fall) *
					(1 + 0.08 * Math.sin(settle * PI) * (1 - settle));
				return {
					alpha: clamp(eased * 6),
					scaleX: scale,
					scaleY: scale,
					translateY:
						-(1 - fall) * size * 1.1 -
						Math.sin(settle * PI) * (1 - settle) * size * 0.1,
				};
			}
			const eased = clamp((progress - 0.36 - glyph.order * 0.26) / 0.38);
			if (eased <= 0) return hide();
			if (eased >= 1) return undefined;
			const scale = lerpN(0.9, 1, oCubic(eased));
			return {
				alpha: inOutSine(eased),
				scaleX: scale,
				scaleY: scale,
				translateY: (1 - oCubic(eased)) * size * 0.42,
			};
		},
	});
}

function pickHeavyGlyphs(glyphs: readonly X2Glyph[]): boolean[] {
	const visible = glyphs.filter((glyph) => !x2IsBlank(glyph.character));
	let heavy = glyphs.map((glyph) => x2IsKanji(glyph.character));
	let heavyCount = heavy.filter(Boolean).length;
	if (heavyCount === 0 || heavyCount === visible.length) {
		heavy = glyphs.map(
			(glyph, index) =>
				!x2IsBlank(glyph.character) &&
				(glyph.index === 0 ||
					(index > 0 && x2IsBlank(glyphs[index - 1]!.character))),
		);
		heavyCount = heavy.filter(Boolean).length;
	}
	if (visible.length > 3 && (heavyCount <= 1 || heavyCount === visible.length)) {
		heavy = glyphs.map((glyph) => glyph.index % 3 === 0);
	}
	return heavy;
}

const PERM3 = [
	[0, 1, 2],
	[0, 2, 1],
	[1, 0, 2],
	[1, 2, 0],
	[2, 0, 1],
	[2, 1, 0],
] as const;

/** 三拍子 — glyphs snap on in three groups on three hard beats. */
function drawTripleBeat(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const group =
				count < 3
					? glyph.index % 3
					: (PERM3[x2Hash(seed, Math.floor(glyph.index / 3), 41) % 6] ?? 0)[
							glyph.index % 3
						];
			const eased = (progress - 0.03 - group * 0.31) / 0.3;
			if (eased <= 0) return hide();
			if (eased >= 1) return undefined;
			const remaining = (1 - eased) ** 3;
			return {
				color: eased < 0.3 ? options.frame.palette.accent : undefined,
				scaleX: 1 + 0.5 * remaining,
				scaleY: 1 + 0.5 * remaining,
				translateY: -remaining * options.size * 0.06,
			};
		},
	});
}

/** 行進 — the line walks in from the side, glyphs waddling foot to foot. */
function drawMarch(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const direction = enterBDirection(options, 11);
	const steps = 5;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const lead = direction > 0 ? 1 - glyph.order : glyph.order;
			const eased = clamp(progress * 1.14 - lead * 0.14);
			if (eased <= 0) return hide();
			if (eased >= 1) return undefined;
			const position = eased * steps;
			const stepIndex = Math.floor(position);
			const fraction = clamp((position - stepIndex) / 0.62);
			const walked = (stepIndex + ioCubic(fraction)) / steps;
			const hop = Math.sin(fraction * PI);
			return {
				alpha: clamp(eased * 5),
				rotation: degrees(
					((stepIndex + glyph.index) % 2 ? 1 : -1) * hop * 10,
				),
				translateX: direction * (1 - walked) * size * 2.4,
				translateY: -hop * size * 0.13,
			};
		},
	});
}

/** 落ちゲー — glyphs fall like blocks with one sideways shift and a quarter turn. */
function drawBlockDrop(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const step = options.size * 0.44;
	const ticks = 6;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const delay = count > 1 ? x2Random(options, glyph.index, 51) * 0.52 : 0;
			const eased = (progress - delay) / 0.46;
			if (eased <= 0) return hide();
			if (eased >= 1) return undefined;
			const landed = Math.floor(eased * ticks);
			const sign = x2Random(options, glyph.index, 52) < 0.5 ? -1 : 1;
			return {
				rotation: degrees(landed < 4 ? sign * 90 : 0),
				translateX: landed < 2 ? sign * step : 0,
				translateY: -(ticks - landed) * step,
			};
		},
	});
}

/** 放り投げ — glyphs thrown from one corner below, landing along parabolas. */
function drawArcToss(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const direction = enterBDirection(options, 13);
	const bounds = x2Bounds(options);
	const originX =
		(direction > 0 ? bounds.left : bounds.right) -
		direction * size * 0.8;
	const originY = bounds.bottom + size * 1.6;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				direction > 0 ? glyph.order : 1 - glyph.order,
				0.5,
			);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const eased = oCubic(staggered);
			const height = size * 1.7 + Math.abs(glyph.x - originX) * 0.18;
			return {
				alpha: clamp(staggered * 5),
				rotation: degrees(-direction * (1 - eased) * 210),
				scaleX: lerpN(0.45, 1, eased),
				scaleY: lerpN(0.45, 1, eased),
				translateX: (originX - glyph.x) * (1 - eased),
				translateY:
					(originY - glyph.y) * (1 - eased) - 4 * height * eased * (1 - eased),
			};
		},
	});
}

/** 小回り — each glyph circles its slot on a shrinking orbit. */
function drawOrbitIn(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.4);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const remaining = 1 - oCubic(staggered);
			const angle =
				-PI / 2 + (glyph.index % 2 ? 1 : -1) * remaining * Math.PI * 2 * 1.2;
			const radius = size * 0.95 * remaining;
			const scale = lerpN(0.6, 1, oCubic(staggered));
			return {
				alpha: clamp(staggered * 4),
				scaleX: scale,
				scaleY: scale,
				translateX: Math.cos(angle) * radius,
				translateY: Math.sin(angle) * radius,
			};
		},
	});
}

/** 跳ね返り — glyphs zigzag in between two narrowing invisible walls. */
function drawRicochet(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const direction = enterBDirection(options, 17);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				direction > 0 ? 1 - glyph.order : glyph.order,
				0.45,
			);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const remaining = (1 - staggered) ** 1.5;
			const wall = x2Triangle(staggered * 2.5 + (glyph.index % 2) * 0.5);
			return {
				alpha: clamp(staggered * 6),
				rotation: degrees(wall * 14 * (1 - staggered)),
				translateX: direction * remaining * size * 3.2,
				translateY: wall * size * 0.95 * (1 - staggered),
			};
		},
	});
}

/** 馬跳び — each glyph hops over from its predecessor's slot. */
function drawLeapfrog(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const glyphs = glyphsOf(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.72);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const previous = glyph.index > 0 ? glyphs[glyph.index - 1] : null;
			const previousX = previous ? previous.x : glyph.x - glyph.width;
			const previousY = previous ? previous.y : glyph.y;
			const eased = ioCubic(clamp(staggered / 0.8));
			const hop = Math.sin(eased * PI) * size * 0.85;
			const settle = clamp((staggered - 0.8) / 0.2);
			const squash = 1 - 0.16 * Math.sin(settle * PI);
			return {
				alpha: clamp(staggered * 8),
				scaleX: 1 + (1 - squash) * 0.5,
				scaleY: squash,
				translateX: (previousX - glyph.x) * (1 - eased),
				translateY:
					(previousY - glyph.y) * (1 - eased) +
					(-hop + (1 - squash) * glyph.height * 0.5),
			};
		},
	});
}

/** 天井から — glyphs hang from a ceiling, then drop and turn over one by one. */
function drawCeilingFall(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const ceiling = size * 1.2;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const appear = clamp((progress - glyph.order * 0.14) / 0.14);
			if (appear <= 0) return hide();
			const fall = clamp((progress - 0.3 - glyph.order * 0.38) / 0.32);
			if (fall >= 1) return undefined;
			const dropped = iQuad(clamp(fall / 0.72));
			const settle = clamp((fall - 0.72) / 0.28);
			const squash = 1 - 0.18 * Math.sin(settle * PI);
			return {
				alpha: appear * lerpN(0.6, 1, clamp(fall * 4)),
				rotation: degrees(180 * (1 - ioCubic(clamp(fall / 0.72)))),
				scaleX: 1 + (1 - squash) * 0.5,
				scaleY: squash,
				translateY: -(1 - dropped) * ceiling + (1 - squash) * glyph.height * 0.5,
			};
		},
	});
}

/** 玉突き — the first glyph knocks the rest of the row into place. */
function drawChainBump(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const hit = 0.26;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const last = glyph.index === count - 1 && count > 1;
			if (glyph.index === 0) {
				if (progress < hit) {
					return {
						alpha: clamp(progress * 9),
						translateX: -(1 - iQuad(progress / hit)) * size * 3,
					};
				}
				const recoil = clamp((progress - hit) / 0.3);
				return {
					translateX: -Math.sin(recoil * PI) * (1 - recoil) * size * 0.22,
				};
			}
			const strike =
				hit + (count > 1 ? (glyph.index - 1) / Math.max(1, count - 1) : 0) * 0.42;
			const eased = (progress - strike) / (1 - strike);
			if (eased <= 0) return hide();
			if (eased >= 1) return undefined;
			const bump = Math.sin(Math.min(1, eased * 1.6) * PI) * (1 - eased);
			return {
				alpha: clamp(eased * 9),
				rotation: last ? degrees(bump * 16) : 0,
				scaleX: 1 + 0.22 * (1 - eased) ** 4,
				scaleY: 1 + 0.22 * (1 - eased) ** 4,
				translateX: bump * size * (last ? 0.9 : 0.34),
			};
		},
	});
}

/** 消失点から — glyphs fly out of a far point above, growing in random order. */
function drawVanishPoint(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const bounds = x2Bounds(options);
	const count = glyphCount(options);
	const vanishX =
		bounds.centerX + enterBDirection(options, 19) * bounds.width * 0.3;
	const vanishY =
		bounds.centerY -
		Math.max(options.size * 2.2, bounds.height * 1.4);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				count > 1 ? x2Random(options, glyph.index, 23) : 0,
				0.42,
			);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const growth = Math.max(
				0.03,
				staggered ** 2.2 * (1 + 0.12 * Math.sin(staggered * PI)),
			);
			return {
				alpha: clamp(staggered * 3),
				scaleX: growth,
				scaleY: growth,
				translateX: (vanishX - glyph.x) * (1 - growth),
				translateY: (vanishY - glyph.y) * (1 - growth),
			};
		},
	});
}

/** 尺取り — glyphs stretch across from the previous slot, then pull their tail in. */
function drawInchworm(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = glyphsOf(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.66);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const previous = glyph.index > 0 ? glyphs[glyph.index - 1] : null;
			let distance = glyph.width;
			if (previous) distance = glyph.x - previous.x;
			distance = Math.min(
				glyph.width * 2.2,
				Math.max(glyph.width * 0.4, distance),
			);
			const extend = oCubic(clamp(staggered / 0.5));
			const retract = ioCubic(clamp((staggered - 0.5) / 0.5));
			const length =
				staggered < 0.5 ? distance * extend : distance * (1 - retract);
			const middle = staggered < 0.5 ? -distance + length / 2 : -length / 2;
			const stretch = 1 + length / Math.max(1, glyph.width);
			return {
				alpha: clamp(staggered * 8),
				scaleX: stretch,
				scaleY: 1 / stretch ** 0.25,
				translateX: middle,
			};
		},
	});
}

/** ドア開き — glyphs swing shut like doors on alternating edge hinges. */
function drawSwingDoor(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.45);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const angle = degrees(88) * springOf(staggered, 3.2, 2.5);
			const cosine = Math.max(0.03, Math.cos(angle));
			const spread = 1 + 0.16 * Math.abs(Math.sin(angle));
			const hinge = glyph.index % 2 ? 1 : -1;
			return {
				alpha: clamp(staggered * 6),
				scaleX: cosine,
				scaleY: spread,
				translateX: hinge * (1 - cosine) * glyph.width / 2,
			};
		},
	});
}

// eslint-disable-next-line opencut/prefer-object-params
function springOf(progress: number, strength: number, frequency: number): number {
	const value = clamp01(progress);
	return (
		Math.exp(-strength * value) *
		Math.cos(frequency * PI * value) *
		(1 - value ** 3)
	);
}

/** はためき — glyphs arrive sheared hard and flap back like flags. */
function drawSkewFlap(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.42);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const flap = springOf(staggered, 2.6, 3.4) * (glyph.index % 2 ? 1 : -1);
			return {
				alpha: clamp(staggered * 5),
				scaleX: 1 - 0.45 * Math.abs(flap),
				skewX: degrees(flap * 46),
			};
		},
	});
}

/** 字ごと開帳 — each glyph uncovers from its centre line outwards. */
function drawGlyphCurtain(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				count > 1
					? glyph.order * 0.6 + x2Random(options, glyph.index, 29) * 0.4
					: 0,
				0.5,
			);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const open = 0.02 + 0.8 * ioCubic(staggered);
			const stretch = lerpN(1.3, 1, oCubic(staggered));
			return {
				clipX: [-open, open],
				clipY: [-2, 2],
				scaleX: stretch,
			};
		},
	});
}

/** 互い違い窓 — glyphs slide up/down into their own alternating windows. */
function drawCellSlide(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.5);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const offset = (glyph.index % 2 ? 1 : -1) * (1 - oQuart(staggered)) * 1.15;
			return {
				clipX: [-2, 2],
				clipY: [-0.62 - offset, 0.62 - offset],
				translateY: offset * glyph.height,
			};
		},
	});
}

/** 歯車 — the row turns like meshed gears in clockwork ticks. */
function drawGearTick(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const ticks = 5;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.12);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const position = staggered * ticks;
			const tickIndex = Math.floor(position);
			const eased =
				(tickIndex + oBack((position - tickIndex) / 0.45, 2.2)) / ticks;
			return {
				alpha: clamp(staggered * 6),
				rotation: degrees((glyph.index % 2 ? 1 : -1) * 150 * (1 - eased)),
				scaleX: lerpN(0.5, 1, eased),
				scaleY: lerpN(0.5, 1, eased),
			};
		},
	});
}

/** コイントス — glyphs flip up like coins and land face up. */
function drawCoinToss(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, 0.5);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			const cosine = Math.cos((1 - staggered) * Math.PI * 2 * 1.5);
			const scale = lerpN(0.8, 1, staggered);
			return {
				alpha: clamp(staggered * 7),
				scaleX: (cosine < 0 ? -1 : 1) * Math.max(0.04, Math.abs(cosine)) * scale,
				scaleY: scale,
				translateY: -4 * size * 1.15 * staggered * (1 - staggered),
			};
		},
	});
}

/** 蛇腹のばし — the line pulls out of a pressed zigzag of thin slanted glyphs. */
function drawBellows(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = glyphsOf(options);
	const count = glyphCount(options);
	const baseAlpha = clamp(progress * 6);
	const ends = x2LineEnds(glyphs);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(
				progress,
				count > 1 ? glyph.index / (count - 1) : 0,
				0.28,
			);
			if (staggered >= 1) return baseAlpha < 1 ? { alpha: baseAlpha } : undefined;
			const eased = oBack(staggered, 1.3);
			const remaining = 1 - eased;
			const thin = Math.max(0.12, lerpN(0.12, 1, eased));
			return {
				alpha: baseAlpha,
				rotation: degrees((glyph.index % 2 ? 1 : -1) * 22 * remaining),
				scaleX: thin,
				skewX: degrees((glyph.index % 2 ? 1 : -1) * 38 * remaining),
				translateX: ends ? (ends.firstX - glyph.x) * remaining * 0.9 : 0,
				translateY: ends ? (ends.firstY - glyph.y) * remaining * 0.9 : 0,
			};
		},
	});
}

/** 背くらべ — glyphs fade in at wild sizes, then spring to equal size. */
function drawUnevenScale(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const alpha = clamp(progress * 5);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const settle = clamp((progress - 0.2 - glyph.order * 0.4) / 0.4);
			if (settle >= 1) return undefined;
			const roll = x2Random(options, glyph.index, 33);
			const start =
				(glyph.index + (seed & 1)) % 2
					? lerpN(0.35, 0.65, roll)
					: lerpN(1.3, 1.6, roll);
			const scale = 1 + (start - 1) * springOf(settle, 3, 2.5);
			return {
				alpha,
				scaleX: scale,
				scaleY: scale,
				translateY: (1 - scale) * glyph.height * 0.36,
			};
		},
	});
}

/** 伏せ字めくり — censored blocks flip over into the real glyphs. */
function drawRedact(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const count = glyphCount(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const appear = clamp((progress - glyph.order * 0.16) / 0.1);
			if (appear <= 0) return hide();
			const flip =
				(progress - 0.3 - (count > 1 ? x2Random(options, glyph.index, 37) : 0) * 0.5) /
				0.2;
			if (flip >= 1) return undefined;
			const width = x2SlotK(glyph, options.size);
			if (flip < 0.5) {
				const cosine = flip <= 0 ? 1 : Math.max(0.05, Math.cos(flip * PI));
				return {
					alpha: 1,
					character: "■",
					scaleX: width * cosine,
					scaleY: oBack(appear, 2),
				};
			}
			const cosine = Math.max(0.05, Math.sin((flip - 0.5) * PI));
			return { scaleX: cosine };
		},
	});
}

/** 空欄埋め — answer boxes fill in, each box becoming its glyph. */
function drawBlanks(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const muted = x2Sub(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const appear = clamp(progress / 0.16);
			if (appear <= 0) return hide();
			const fill = (progress - 0.24 - glyph.order * 0.5) / 0.26;
			if (fill >= 1) return undefined;
			if (fill <= 0) {
				const scale = lerpN(0.8, 0.94, oCubic(appear));
				return {
					alpha: 0.75 * appear,
					character: "□",
					color: muted,
					scaleX: x2SlotK(glyph, options.size) * scale,
					scaleY: scale,
				};
			}
			return {
				alpha: clamp(0.4 + fill * 3),
				scaleX: lerpN(0.45, 1, oBack(fill, 2.4)),
				scaleY: lerpN(0.45, 1, oBack(fill, 2.4)),
				translateY: -(1 - oCubic(fill)) * options.size * 0.12,
			};
		},
	});
}

/** 分身から — the first glyph clones along the line, then copies morph. */
function drawCloneMorph(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = glyphsOf(options);
	const first = glyphs.find((glyph) => !x2IsBlank(glyph.character));
	if (!first) return;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (x2IsBlank(glyph.character)) return undefined;
			const isLead = glyph.index === first.index;
			const appear = isLead
				? clamp(progress / 0.12)
				: x2Stagger(clamp(progress / 0.34), glyph.order, 0.55);
			if (appear <= 0) return hide();
			if (isLead) {
				return appear < 1
					? {
							alpha: clamp(appear * 3),
							scaleX: oBack(appear, 2.2),
							scaleY: oBack(appear, 2.2),
						}
					: undefined;
			}
			const morph = (progress - 0.4 - glyph.order * 0.4) / 0.2;
			if (morph >= 1) return undefined;
			const squash = morph > 0 ? 1 - 0.55 * Math.sin(morph * PI) : 1;
			if (morph < 0.5) {
				const remaining = 1 - oCubic(appear);
				return {
					alpha: 0.5,
					character: first.character,
					scaleX: Math.min(
						1,
						Math.max(0.35, glyph.width / Math.max(1, first.width)),
					),
					scaleY: squash,
					translateX: (first.x - glyph.x) * remaining,
					translateY: (first.y - glyph.y) * remaining,
				};
			}
			return {
				alpha: lerpN(0.5, 1, clamp((morph - 0.5) * 4)),
				scaleY: squash,
			};
		},
	});
}

/**
 * 画の雨 / 渦巻き組み / 段すべり / 積み木起こし — stroke-piece assemblies.
 * rocut has no stroke-piece layer, so these land the packs' own glyph-level
 * fallback (the `softIn` path JIZURA uses for outline/gradient items).
 */
// eslint-disable-next-line opencut/prefer-object-params
function softInFallback(
	options: EnterBDraw,
	spread: number,
	resolve: (staggered: number, glyph: X2Glyph) => EnterBGlyphTransform | undefined,
): void {
	const progress = options.frame.enterProgress;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const staggered = x2Stagger(progress, glyph.order, spread);
			if (staggered <= 0) return hide();
			if (staggered >= 1) return undefined;
			return resolve(staggered, glyph);
		},
	});
}

function drawPieceRainFallback(options: EnterBDraw): void {
	const size = options.size;
	softInFallback(options, 0.5, (staggered) => ({
		alpha: clamp(staggered * 4),
		scaleY: 1 + (1 - staggered) * 0.4,
		translateY: -(1 - iQuad(staggered)) * size * 1.3,
	}));
}

function drawPieceVortexFallback(options: EnterBDraw): void {
	softInFallback(options, 0.45, (staggered, glyph) => {
		const scale = lerpN(1.6, 1, oCubic(staggered));
		return {
			alpha: clamp(staggered * 3),
			rotation: degrees(
				(glyph.index % 2 ? 1 : -1) * (1 - oCubic(staggered)) * 160,
			),
			scaleX: scale,
			scaleY: scale,
		};
	});
}

function drawPieceStrataFallback(options: EnterBDraw): void {
	const size = options.size;
	softInFallback(options, 0.4, (staggered, glyph) => ({
		alpha: clamp(staggered * 4),
		translateX:
			(glyph.index % 2 ? 1 : -1) * (1 - oQuart(staggered)) * size * 0.9,
	}));
}

function drawPiecePileFallback(options: EnterBDraw): void {
	softInFallback(options, 0.4, (staggered, glyph) => {
		const scaleY = Math.max(0.06, oBack(staggered, 1.8));
		return {
			alpha: clamp(staggered * 5),
			scaleY,
			translateY: (1 - scaleY) * glyph.height * 0.5,
		};
	});
}
