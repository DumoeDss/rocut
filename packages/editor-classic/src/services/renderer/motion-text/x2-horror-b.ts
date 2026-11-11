import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import {
	drawEnterBLine,
	drawEnterBWhole,
	enterBBounds,
	enterBGlyphs,
	enterBOutBack,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	drawExitHoldOutline,
	inCubic,
	inOutCubic,
	inOutSine,
	inQuad,
	lerp,
	mixHex,
	outCubic,
	outQuad,
	randomUnit,
	secondsOf,
	smooth,
	smoothNoise,
} from "./exit-hold-geometry";
import type { KineticCameraTransform } from "./kinetic-cameras";
import {
	captureLooksSource,
	isLooksPixelContext,
} from "./looks-screen-effect-types";
import {
	transitionBoundary,
	type TreatTransTransitionDraw,
} from "./treat-trans-transition-drawing";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";
import {
	drawX2Glyphs,
	x2Hash,
	x2Signed,
	x2Unit,
	type X2Draw,
} from "./x2-drawing";

/*
 * JIZURA 追加分2 (v0.12) x2horrorB pack — uneasy entrances, exits, holds,
 * treatments, cameras, screen frights and handovers.
 *
 * Semantic simplifications match the A/B family ports (see x2-drawing.ts):
 * single-line items, horizontal writing, planner params (`minDur`/`inDur`/
 * plan rng fields) derived deterministically from the cut seed instead, and
 * the fx.motion hold/camera amplitude is fixed at its 0.7 default (k = 1).
 */

const TAU = Math.PI * 2;

function clamp(value: number): number {
	return clamp01(value);
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

/** JIZURA `J.smooth(e0, e1, v)` — smoothstep between two edges. */
// eslint-disable-next-line opencut/prefer-object-params
function smoothR(edge0: number, edge1: number, value: number): number {
	return smooth((value - edge0) / (edge1 - edge0));
}

// eslint-disable-next-line opencut/prefer-object-params
function gcd(a: number, b: number): number {
	return b ? gcd(b, a % b) : a;
}

/** A seeded order of 0..N-1 (rank of each index) — JIZURA `ranks`. */
// eslint-disable-next-line opencut/prefer-object-params
function ranks(seed: number, count: number, salt: number): number[] {
	const indices: number[] = [];
	for (let index = 0; index < count; index += 1) indices.push(index);
	indices.sort(
		(x, y) => randomUnit(seed, x, salt) - randomUnit(seed, y, salt) || x - y,
	);
	const result = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		result[indices[index]!] = index;
	}
	return result;
}

/** Irregular (uneasy) timeline: N moments in 0..span with some long gaps. */
// eslint-disable-next-line opencut/prefer-object-params
function uneasyTimes(seed: number, count: number, span: number): number[] {
	const gaps: number[] = [];
	let total = 0;
	for (let index = 0; index < count; index += 1) {
		const roll = x2Unit(seed, index, 917);
		const gap = 0.3 + (roll < 0.25 ? 2 : roll);
		gaps.push(gap);
		total += gap;
	}
	const times: number[] = [];
	let accumulator = 0;
	for (let index = 0; index < count; index += 1) {
		times.push((accumulator / total) * span);
		accumulator += gaps[index]!;
	}
	return times;
}

/** Attack (0..a) → hold → release (b..1) — JIZURA `ahr`. */
// eslint-disable-next-line opencut/prefer-object-params
function ahr(value: number, attack: number, release: number): number {
	if (value < attack) return outCubic(value / attack);
	if (value > release) {
		return (
			1 -
			inOutCubic((value - release) / Math.max(1e-3, 1 - release))
		);
	}
	return 1;
}

function lum(color: string): number {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(color);
	if (!match?.[1]) return 0.5;
	const digits =
		match[1].length === 3
			? Array.from(match[1], (part) => part.repeat(2)).join("")
			: match[1];
	const red = Number.parseInt(digits.slice(0, 2), 16) / 255;
	const green = Number.parseInt(digits.slice(2, 4), 16) / 255;
	const blue = Number.parseInt(digits.slice(4, 6), 16) / 255;
	return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function isDark(color: string): boolean {
	return lum(color) < 0.45;
}

/** JIZURA `nightC(sc)` — the scheme background pushed toward black. */
function nightOf(frame: MotionTextRenderFrame): string {
	const background = frame.palette.background;
	return mixHex({
		from: background,
		to: "#000000",
		progress: isDark(background) ? 0.72 : 0.9,
	});
}

function seedOf(options: X2Draw): number {
	return options.frame.cut?.seed ?? 0;
}

function step24(options: X2Draw): number {
	return Math.floor(secondsOf(options.frame) * 24);
}

function glyphCount(options: X2Draw): number {
	return enterBGlyphs(options).length;
}

/** Frame width/height approximations for glyph-anim contracts (house precedent). */
function frameWidthOf(options: X2Draw): number {
	return options.maxWidth / 0.86;
}

/* ================================================================== ENTRANCES */

export function drawX2HorrorEnter(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "hzAlreadyThere":
			drawAlreadyThere(options);
			return true;
		case "hzUnwatched":
			drawUnwatched(options);
			return true;
		case "hzShakyHand":
			drawShakyHand(options);
			return true;
		case "hzFloorSeep":
			drawFloorSeep(options);
			return true;
		case "hzTooClose":
			drawTooClose(options);
			return true;
		case "hzWrongGlyph":
			drawWrongGlyph(options);
			return true;
		case "hzFromScratch":
			drawFromScratch(options);
			return true;
		case "hzLateSnap":
			drawLateSnap(options);
			return true;
		case "hzLampSweep":
			drawLampSweep(options);
			return true;
		default:
			return false;
	}
}

/** 闇に居た — the line was standing in the dark all along; patches brighten at their own pace. */
function drawAlreadyThere(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	const color = options.frame.palette.foreground;
	const dim = mixHex({
		from: color,
		to: options.frame.palette.background,
		progress: 0.78,
	});
	const on = Math.min(1, progress / 0.1);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const key = x2Hash(seed, glyph.index, 211);
			const start = x2Unit(key, 1) * 0.5;
			const length = 0.22 + x2Unit(key, 2) * 0.28;
			const phase = clamp((progress - start) / length);
			// the brightening sags once on the way up
			const level = clamp(
				inOutSine(phase) - Math.sin(phase * Math.PI) * 0.3 * x2Unit(key, 3),
			);
			if (level >= 0.999) return undefined;
			return {
				alpha: lerp({ start: 0.1, end: 1, progress: level }) * on,
				color: mixHex({ from: dim, to: color, progress: level }),
			};
		},
	});
}

/** 目を離した隙 — glyphs turn up far apart from each other, each faint until the next arrives. */
function drawUnwatched(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	const count = glyphCount(options);
	let hop = Math.max(1, Math.round(count * 0.38));
	while (gcd(hop, count) !== 1) hop += 1;
	const start = x2Hash(seed, 221) % count;
	const slot = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		slot[(start + index * hop) % count] = index;
	}
	const gap = 0.86 / count;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const phase = progress - (slot[glyph.index] ?? 0) * gap;
			if (phase < 0) return null;
			if (phase >= gap) return undefined;
			return {
				alpha: 0.3,
				translateY:
					options.size * 0.05 * (x2Unit(seed, glyph.index, 222) < 0.5 ? -1 : 1),
			};
		},
	});
}

/** 震える筆跡 — glyphs tremble into place; the stroke-trace layer is not modelled (fill ramp only). */
function drawShakyHand(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	const size = options.size;
	const fillAlpha = smoothR(0.78, 1, progress);
	const tremor = 1 - smoothR(0.7, 1, progress);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (tremor <= 0.01) {
				return fillAlpha < 1 ? { alpha: fillAlpha } : undefined;
			}
			const key = x2Hash(seed, glyph.index, 231);
			return {
				alpha: fillAlpha,
				translateX:
					smoothNoise({ seed: key, salt: 1, value: progress * 38 }) *
					size *
					0.028 *
					tremor,
				translateY:
					smoothNoise({ seed: key + 1, salt: 2, value: progress * 31 }) *
					size *
					0.035 *
					tremor,
				rotation: degrees(
					smoothNoise({ seed: key + 2, salt: 3, value: progress * 17 }) *
						3.5 *
						tremor,
				),
			};
		},
	});
}

/** 床下から滲む — each glyph soaks up from under the floor, stalls halfway, then comes through. */
function drawFloorSeep(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	const size = options.size;
	const color = options.frame.palette.foreground;
	const dim = mixHex({
		from: color,
		to: options.frame.palette.background,
		progress: 0.6,
	});
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const key = x2Hash(seed, glyph.index, 241);
			const start = x2Unit(key, 1) * 0.38;
			const length = 0.4 + x2Unit(key, 2) * 0.22;
			const phase = clamp((progress - start) / length);
			if (phase <= 0) return null;
			if (phase >= 1) return undefined;
			const stall = 0.3 + x2Unit(key, 3) * 0.2; // where it stalls
			const rise =
				phase < 0.4
					? stall * outCubic(phase / 0.4)
					: phase < 0.58
						? stall
						: lerp({
								start: stall,
								end: 1,
								progress: inOutCubic((phase - 0.58) / 0.42),
							});
			return {
				clipY: [0.7 - rise * 1.4, 0.75],
				color:
					rise < 0.98
						? mixHex({ from: dim, to: color, progress: rise })
						: undefined,
				translateY: (1 - rise) * size * 0.16,
			};
		},
	});
}

/** 近すぎる — it is suddenly there, a step nearer than it should be, then backs off in three stiff steps. */
function drawTooClose(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const levels = [1.12, 1.07, 1.03, 1] as const;
	const at = [0.5, 0.68, 0.86] as const;
	let scale = levels[0]! + 0.015 * Math.min(1, progress / 0.5);
	for (let step = 0; step < 3; step += 1) {
		if (progress >= at[step]!) {
			scale = lerp({
				start: step === 0 ? levels[0]! + 0.015 : levels[step]!,
				end: levels[step + 1]!,
				progress: outExpo(clamp((progress - at[step]!) / 0.07)),
			});
		}
	}
	drawEnterBWhole({
		options,
		alpha: Math.min(1, progress / 0.06),
		scaleX: scale,
		scaleY: scale,
	});
}

/** 逆さの一字 — the line fades up with one glyph hanging head-down; it notices late and rights itself. */
function drawWrongGlyph(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	const size = options.size;
	const step = step24(options);
	const accent = options.frame.palette.accent;
	const count = glyphCount(options);
	const pick = x2Hash(seed, 251) % count;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const alpha = smoothR(0, 0.3, progress - glyph.order * 0.12);
			if (glyph.index !== pick) {
				if (alpha >= 0.999) return undefined;
				if (alpha <= 0) return null;
				return { alpha };
			}
			if (alpha <= 0) return null;
			if (progress < 0.58) {
				return { alpha, color: accent, rotation: degrees(180) };
			}
			if (progress < 0.7) {
				return {
					color: accent,
					rotation: degrees(180 + x2Signed(seed, step, 252) * 9),
					translateX: x2Signed(seed, step, 253) * size * 0.03,
				};
			}
			const phase = clamp((progress - 0.7) / 0.24);
			if (phase >= 1) return undefined;
			return {
				color: phase < 0.5 ? accent : undefined,
				rotation: degrees(180 * (1 - enterBOutBack(phase, 1.5))),
			};
		},
	});
}

/** 掻き傷から — every glyph starts as a thin slanted scratch that is drawn, then swells into the letter. */
function drawFromScratch(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const key = x2Hash(seed, glyph.index, 261);
			const phase = clamp((progress - x2Unit(key, 1) * 0.45) / 0.52);
			if (phase <= 0) return null;
			if (phase >= 1) return undefined;
			const slant =
				(x2Unit(key, 2) < 0.5 ? -1 : 1) * (28 + x2Unit(key, 3) * 30);
			if (phase < 0.38) {
				return {
					rotation: degrees(slant),
					scaleX: 0.05,
					scaleY: lerp({
						start: 0.12,
						end: 1.35,
						progress: outCubic(phase / 0.38),
					}),
				};
			}
			const ease = inOutCubic((phase - 0.38) / 0.62);
			return {
				rotation: degrees(slant * (1 - ease)),
				scaleX: lerp({ start: 0.05, end: 1, progress: ease }),
				scaleY: lerp({ start: 1.35, end: 1, progress: ease }),
			};
		},
	});
}

/** ずれて昇る — glyphs creep up dim and out of true, then all click into place at once. */
function drawLateSnap(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = seedOf(options);
	const size = options.size;
	const at = 0.86;
	const rise = Math.min(1, progress / at);
	const snap =
		progress < at ? 0 : outExpo((progress - at) / (1 - at));
	const crooked = 1 - snap;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const key = x2Hash(seed, glyph.index, 271);
			return {
				alpha: lerp({
					start:
						lerp({ start: 0.12, end: 0.62, progress: rise }) *
						Math.min(1, progress / 0.1),
					end: 1,
					progress: snap,
				}),
				rotation: degrees(x2Signed(key, 3) * 11 * crooked),
				translateX: x2Signed(key, 1) * size * 0.1 * crooked,
				translateY:
					(x2Signed(key, 2) * size * 0.09 + (1 - rise) * size * 0.55) *
					crooked,
			};
		},
	});
}

/** 灯りが二度 — a beam of light crosses and shows the words for a moment; dark again; then they stay. */
function drawLampSweep(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const width = frameWidthOf(options);
	const height = options.size * 4;
	const left = -0.14 * width;
	const right = 1.14 * width;
	const beamWidth = width * 0.13;
	const fromRight = (x2Hash(seedOf(options), 281) & 1) === 1;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const position = glyph.x + (glyph.y - height / 2) * 0.3;
			const at = fromRight ? width - position : position;
			if (progress < 0.42) {
				const beam = lerp({
					start: left,
					end: right,
					progress: progress / 0.42,
				});
				const lit = 1 - Math.abs(at - beam) / beamWidth;
				if (lit <= 0) return null;
				return { alpha: 0.85 * outQuad(lit) };
			}
			if (progress < 0.48) return null;
			if (progress < 0.94) {
				const beam = lerp({
					start: left,
					end: right,
					progress: (progress - 0.48) / 0.46,
				});
				const distance = at - beam;
				if (distance <= 0) return undefined;
				const lit = 1 - distance / beamWidth;
				if (lit <= 0) return null;
				return { alpha: 0.85 * outQuad(lit) };
			}
			return undefined;
		},
	});
}

/* ================================================================== HOLDS */

export function drawX2HorrorHold(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "hzSlowBreath":
			drawSlowBreath(options);
			return true;
		case "hzLoneTremor":
			drawLoneTremor(options);
			return true;
		case "hzPassing":
			drawPassing(options);
			return true;
		case "hzPresence":
			drawPresence(options);
			return true;
		case "hzLoom":
			drawLoom(options);
			return true;
		default:
			return false;
	}
}

function drawPlain(options: EnterBDraw): void {
	drawX2Glyphs({ options, resolve: () => undefined });
}

/** 遅すぎる呼吸 — a very long breath in, held with a faint tremor, let go all at once. */
function drawSlowBreath(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const seconds = secondsOf(options.frame);
	const period = 6.2;
	const phase =
		(((seconds / period + x2Unit(seed, 411) * 0.25) % 1) + 1) % 1;
	const breath =
		phase < 0.55
			? inOutSine(phase / 0.55)
			: phase < 0.8
				? 1
				: phase < 0.86
					? 1 - outExpo((phase - 0.8) / 0.06)
					: 0;
	let deltaX = 0;
	let deltaY = 0;
	if (phase >= 0.55 && phase < 0.8) {
		const step = step24(options);
		deltaX = x2Signed(seed, step, 412) * size * 0.006;
		deltaY = x2Signed(seed, step, 413) * size * 0.004;
	}
	drawEnterBWhole({
		options,
		alpha: 1 - 0.14 * breath,
		scaleX: 1 + 0.05 * breath,
		scaleY: 1 + 0.05 * breath,
		translateX: deltaX,
		translateY: deltaY,
	});
}

/** 一字の震え — everything is dead still except one glyph, which shivers in slow swells. */
function drawLoneTremor(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const step = step24(options);
	const count = glyphCount(options);
	const target = x2Hash(seed, 421) % count;
	const swell =
		(0.5 -
			0.5 * Math.cos((secondsOf(options.frame) * TAU) / 3.4 + x2Unit(seed, 422) * TAU)) **
		1.6;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (glyph.index !== target || swell < 0.02) return undefined;
			return {
				rotation: degrees(x2Signed(seed, step, 425) * 6 * swell),
				translateX: x2Signed(seed, step, 423) * size * 0.04 * swell,
				translateY: x2Signed(seed, step, 424) * size * 0.03 * swell,
			};
		},
	});
}

/** 何かが通る — an unseen thing moves along the line; glyphs dim and lean out of its way. */
function drawPassing(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const width = frameWidthOf(options);
	const period = 3.6;
	const cycles = secondsOf(options.frame) / period + x2Unit(seed, 431) * 0.4;
	const cycle = Math.floor(cycles);
	const phase = (cycles - cycle) / 0.62;
	if (phase >= 1) {
		drawPlain(options);
		return;
	}
	const backward = ((x2Hash(seed, 432) + cycle) & 1) === 1;
	const position = backward
		? lerp({ start: 1.2 * width, end: -0.2 * width, progress: phase })
		: lerp({ start: -0.2 * width, end: 1.2 * width, progress: phase });
	const radius = width * 0.15;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const distance = (glyph.x - position) / radius;
			if (distance <= -1 || distance >= 1) return undefined;
			const pressure = (1 - distance * distance) ** 2;
			const side = distance < 0 ? -1 : 1;
			return {
				alpha: 1 - 0.6 * pressure,
				rotation: degrees(side * 8 * pressure),
				translateX: side * pressure * size * 0.07,
				translateY: pressure * size * 0.02,
			};
		},
	});
}

/** 薄れる気配 — each glyph is, at its own slow pace, a little less there — and then back. */
function drawPresence(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const time = secondsOf(options.frame) * 0.42;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const fade = smoothR(
				0.05,
				0.75,
				smoothNoise({
					seed: seed + 441,
					salt: 0,
					value: time + glyph.index * 7.31,
				}),
			);
			if (fade <= 0) return undefined;
			return { alpha: 1 - 0.62 * fade, translateY: fade * size * 0.035 };
		},
	});
}

/** 背後の影 — a larger, faint copy slowly rises up behind the words, then drops away. */
function drawLoom(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const seconds = secondsOf(options.frame);
	const period = 4.8;
	const phase =
		(((seconds / period + x2Unit(seed, 451) * 0.3) % 1) + 1) % 1;
	const rise =
		phase < 0.8 ? inOutSine(phase / 0.8) : 1 - outExpo((phase - 0.8) / 0.2);
	if (rise < 0.02) {
		drawPlain(options);
		return;
	}
	const scale = 1 + 0.17 * rise;
	const color = mixHex({
		from: options.frame.palette.foreground,
		to: options.frame.palette.background,
		progress: isDark(options.frame.palette.background) ? 0.5 : 0.35,
	});
	drawEnterBWhole({
		options,
		alpha: 0.34 * Math.sqrt(rise),
		color,
		scaleX: scale,
		scaleY: scale,
		translateY: -size * 0.1 * rise,
	});
	drawPlain(options);
}

/* ================================================================== EXITS */

export function drawX2HorrorExit(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "hzOutOfLight":
			drawOutOfLight(options);
			return true;
		case "hzTaken":
			drawTaken(options);
			return true;
		case "hzThumbSmear":
			drawThumbSmear(options);
			return true;
		case "hzRetinal":
			drawRetinal(options);
			return true;
		case "hzDragCorner":
			drawDragCorner(options);
			return true;
		case "hzFlatline":
			drawFlatline(options);
			return true;
		case "hzShadowOff":
			drawShadowOff(options);
			return true;
		case "hzBackAway":
			drawBackAway(options);
			return true;
		default:
			return false;
	}
}

/** 灯りの外へ — the line sinks while the edge of the dark comes down over it from above. */
function drawOutOfLight(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const color = options.frame.palette.foreground;
	const bounds = enterBBounds(options);
	const edge = lerp({
		start: bounds.top - size * 0.4,
		end: bounds.bottom + size * 0.75,
		progress: inOutSine(clamp(progress / 0.92)),
	});
	const sink = inQuad(progress) * size * 0.45;
	const shade = smoothR(0, 0.75, progress);
	const alpha = 1 - smoothR(0.8, 1, progress);
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(
		-options.maxWidth * 2,
		edge,
		options.maxWidth * 5,
		options.size * 40,
	);
	options.ctx.clip();
	drawX2Glyphs({
		options,
		resolve: () => ({
			alpha,
			color: mixHex({
				from: color,
				to: nightOf(options.frame),
				progress: shade * 0.7,
			}),
			translateY: sink,
		}),
	});
	options.ctx.restore();
}

/** 攫われる — one after another, at uneven moments, a glyph is snatched sideways into the dark. */
function drawTaken(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const seed = seedOf(options);
	const size = options.size;
	const step = step24(options);
	const width = frameWidthOf(options);
	const count = glyphCount(options);
	const order = ranks(seed, count, 311);
	const times = uneasyTimes(seed, count, 0.8);
	const side = (x2Hash(seed, 312) & 1) === 1 ? 1 : -1;
	const length = 0.1;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const phase = (progress - (times[order[glyph.index] ?? 0] ?? 0)) / length;
			if (phase >= 1) return null;
			if (phase < 0) {
				const tension = clamp(1 + phase / 2.5);
				if (tension <= 0) return undefined;
				return {
					rotation: degrees(x2Signed(seed, glyph.index, step, 314) * 5 * tension),
					translateX:
						-side * size * 0.05 * tension +
						x2Signed(seed, glyph.index, step, 313) * size * 0.02 * tension,
				};
			}
			const away = inCubic(phase);
			return {
				alpha: 1 - 0.6 * phase,
				scaleX: 1 + phase * 3.5,
				scaleY: 1 - phase * 0.35,
				translateX: side * away * width * 0.85,
			};
		},
	});
}

/** 指で擦る — three slow rubs back and forth; each drags the ink sideways and leaves less of it. */
function drawThumbSmear(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	if (progress >= 0.9) {
		drawX2Glyphs({ options, resolve: () => null });
		return;
	}
	const rub = Math.min(2, Math.floor(progress / 0.3));
	const phase = progress / 0.3 - rub;
	const levels = [1, 0.62, 0.3, 0] as const;
	const direction = ((x2Hash(seedOf(options), 321) + rub) & 1) === 1 ? 1 : -1;
	const sway = Math.sin(phase * Math.PI);
	drawEnterBWhole({
		options,
		alpha: lerp({
			start: levels[rub]!,
			end: levels[rub + 1]!,
			progress: smoothR(0.15, 0.85, phase),
		}),
		translateX: direction * sway * size * 0.1,
		translateY: sway * size * 0.015 * (rub - 1),
	});
}

/** 目に焼きつく — the words cut out, but their outline stays on the eye, swelling and paling. */
function drawRetinal(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	if (progress < 0.06) {
		drawPlain(options);
		return;
	}
	const phase = (progress - 0.06) / 0.94;
	const size = options.size;
	const color = mixHex({
		from: options.frame.palette.foreground,
		to: options.frame.palette.background,
		progress: 0.3,
	});
	const alpha = 0.85 * (1 - outQuad(clamp(phase)));
	if (alpha <= 0.004) {
		drawX2Glyphs({ options, resolve: () => null });
		return;
	}
	const scale = 1 + 0.05 * phase;
	const { ctx } = options;
	ctx.save();
	ctx.translate(0, -size * 0.04 * phase);
	ctx.translate(options.x, options.y);
	ctx.scale(scale, scale);
	ctx.translate(-options.x, -options.y);
	for (const glyph of enterBGlyphs(options)) {
		drawExitHoldOutline({
			alpha,
			color,
			glyph,
			lineWidth: Math.max(1, size * 0.018),
			options,
		});
	}
	ctx.restore();
}

/** 隅へ引きずる — something tugs the whole line towards a corner — a tug, a pause, a harder tug — then gone. */
function drawDragCorner(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const seed = seedOf(options);
	const size = options.size;
	const step = step24(options);
	const width = frameWidthOf(options);
	const height = options.size * 4;
	const towardX = (x2Hash(seed, 331) & 1) === 1 ? 1 : -1;
	const towardY = x2Unit(seed, 332) < 0.75 ? 1 : -1;
	const pull =
		progress < 0.3
			? 0.07 * outCubic(clamp((progress - 0.04) / 0.14))
			: progress < 0.58
				? lerp({
						start: 0.07,
						end: 0.24,
						progress: outCubic(clamp((progress - 0.3) / 0.14)),
					})
				: lerp({
						start: 0.24,
						end: 1,
						progress: inCubic((progress - 0.58) / 0.42),
					});
	const rest =
		(progress > 0.2 && progress < 0.3) || (progress > 0.46 && progress < 0.58)
			? 1
			: 0;
	const shrink = 1 - 0.45 * pull;
	const centerX = width / 2;
	const centerY = height / 2;
	const angle = degrees(towardX * towardY * -16 * pull);
	const { ctx } = options;
	ctx.save();
	ctx.translate(
		centerX + towardX * width * 0.62 * pull + rest * x2Signed(seed, step, 333) * size * 0.012,
		centerY + towardY * height * 0.62 * pull,
	);
	ctx.rotate(angle);
	ctx.scale(shrink, shrink);
	ctx.translate(-centerX, -centerY);
	ctx.globalAlpha *= 1 - smoothR(0.7, 0.97, progress);
	drawX2Glyphs({ options, resolve: () => undefined });
	ctx.restore();
}

/** 心停止 — two beats, each weaker; then the line goes flat, holds as a thin trace, and shortens to nothing. */
function drawFlatline(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the pack's `bump = (c, w) => …` closure.
	const bump = (center: number, width: number): number =>
		Math.exp(-(((progress - center) / width) ** 2));
	if (progress < 0.46) {
		const swell = 1 + 0.08 * bump(0.08, 0.035) + 0.045 * bump(0.27, 0.04);
		drawEnterBWhole({ options, scaleX: swell, scaleY: swell });
		return;
	}
	const flat = lerp({
		start: 1,
		end: 0.035,
		progress: outExpo(clamp((progress - 0.46) / 0.14)),
	});
	let scaleX = 1;
	let alpha = 1;
	if (progress > 0.8) {
		const phase = (progress - 0.8) / 0.2;
		scaleX = Math.max(0.02, 1 - inOutCubic(clamp(phase)));
		alpha = 1 - smoothR(0.6, 1, phase);
	}
	drawEnterBWhole({ options, alpha, scaleX, scaleY: flat });
}

/** 影だけ去る — the words fade where they stand while their shadow slips out and walks off. */
function drawShadowOff(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const seed = seedOf(options);
	const size = options.size;
	const color = options.frame.palette.foreground;
	const background = options.frame.palette.background;
	const direction = (x2Hash(seed, 341) & 1) === 1 ? 1 : -1;
	const shadowColor = mixHex({
		from: color,
		to: background,
		progress: isDark(background) ? 0.62 : 0.45,
	});
	const slip = outCubic(clamp(progress / 0.3));
	const walk = inQuad(clamp((progress - 0.3) / 0.7));
	const shadowAlpha =
		0.75 * smoothR(0, 0.2, progress) * (1 - smoothR(0.72, 1, progress));
	if (shadowAlpha >= 0.01) {
		const width = frameWidthOf(options);
		const shadowX =
			options.x +
			direction * (size * 0.22 * slip + width * 0.55 * walk);
		const shadowY =
			options.y +
			size * 0.1 * slip +
			Math.abs(Math.sin(walk * 14)) * size * 0.04 * (walk > 0 ? 1 : 0);
		drawEnterBWhole({
			options: { ...options, x: shadowX, y: shadowY },
			alpha: shadowAlpha,
			color: shadowColor,
			skewX: degrees(-direction * 14 * walk),
		});
	}
	drawX2Glyphs({
		options,
		resolve: () => ({ alpha: 1 - smoothR(0.08, 0.5, progress) }),
	});
}

/** 後ずさり — it retreats one stiff step at a time, smaller and dimmer, and after the last step it is not there. */
function drawBackAway(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	if (progress >= 0.92) {
		drawX2Glyphs({ options, resolve: () => null });
		return;
	}
	const seed = seedOf(options);
	const width = frameWidthOf(options);
	const height = options.size * 4;
	const at = [0.06, 0.28, 0.5, 0.72] as const;
	let steps = 0;
	let drift = 0;
	for (let index = 0; index < 4; index += 1) {
		const ease = outExpo(clamp((progress - at[index]!) / 0.08));
		steps += ease;
		drift += ease * x2Signed(seed, index, 351);
	}
	const scale = 0.88 ** steps;
	const shade = mixHex({
		from: options.frame.palette.foreground,
		to: options.frame.palette.background,
		progress: 0.12 * steps,
	});
	const { ctx } = options;
	ctx.save();
	ctx.translate(drift * width * 0.012, -steps * height * 0.008);
	ctx.translate(options.x, options.y);
	ctx.scale(scale, scale);
	ctx.translate(-options.x, -options.y);
	ctx.globalAlpha *= 0.7 ** steps;
	drawX2Glyphs({ options, resolve: () => ({ color: shade }) });
	ctx.restore();
}

/* ================================================================== TREATMENTS */

/*
 * Treatments redraw the text themselves with raw canvas fills — calling the
 * dispatch's own drawGlyph here would re-enter the treatment chain.
 */

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

interface X2HorrorRawGlyph {
	readonly character: string;
	readonly x: number;
	readonly y: number;
}

function rawGlyphFill({
	alpha = 1,
	color,
	deltaY = 0,
	glyph,
	options,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly deltaY?: number;
	readonly glyph: X2HorrorRawGlyph;
	readonly options: EnterBDraw;
}): void {
	const { ctx } = options;
	const { font } = options.frame;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	const baseFont = ctx.font;
	ctx.font = `${font.style} ${font.weight} ${Math.max(10, options.size)}px ${quoteFamily(font.family)}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.globalAlpha = baseAlpha * alpha;
	if (color) ctx.fillStyle = color;
	ctx.fillText(glyph.character, glyph.x, glyph.y + deltaY, options.size * 0.78);
	ctx.font = baseFont;
	ctx.fillStyle = baseFill;
	ctx.globalAlpha = baseAlpha;
}

function rawWholeFill({
	alpha = 1,
	color,
	deltaX = 0,
	deltaY = 0,
	options,
}: {
	readonly alpha?: number;
	readonly color?: string;
	readonly deltaX?: number;
	readonly deltaY?: number;
	readonly options: EnterBDraw;
}): void {
	const { ctx } = options;
	const { font } = options.frame;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	const baseFont = ctx.font;
	ctx.font = `${font.style} ${font.weight} ${Math.max(10, options.size)}px ${quoteFamily(font.family)}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.globalAlpha = baseAlpha * alpha;
	if (color) ctx.fillStyle = color;
	ctx.fillText(
		options.text,
		options.x + deltaX,
		options.y + deltaY,
		options.maxWidth,
	);
	ctx.font = baseFont;
	ctx.fillStyle = baseFill;
	ctx.globalAlpha = baseAlpha;
}

function rawWholeStroke({
	color,
	lineWidth,
	options,
}: {
	readonly color: string;
	readonly lineWidth: number;
	readonly options: EnterBDraw;
}): void {
	const { ctx } = options;
	const { font } = options.frame;
	const baseFont = ctx.font;
	const baseStroke = ctx.strokeStyle;
	ctx.font = `${font.style} ${font.weight} ${Math.max(10, options.size)}px ${quoteFamily(font.family)}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	ctx.strokeStyle = baseStroke;
	ctx.font = baseFont;
}

export function drawX2HorrorTreat(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "hzUneven":
			drawUnevenInk(options);
			return true;
		case "hzHairlines":
			drawHairlineScratches(options);
			return true;
		case "hzColdRim":
			drawColdRim(options);
			return true;
		case "hzHusk":
			drawHusk(options);
			return true;
		case "hzDragMarks":
			drawDragMarks(options);
			return true;
		default:
			return false;
	}
}

/** むらのある字 — some glyphs took the ink badly — a few are much fainter, and sit a hair low. */
function drawUnevenInk(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const count = glyphCount(options);
	const low = 0.42;
	const rate = 0.26;
	const sure = count > 1 ? x2Hash(seed, 512) % count : -1;
	for (const glyph of enterBGlyphs(options)) {
		const key = x2Hash(seed, glyph.index, 511);
		// never two weak glyphs in a row
		const weak =
			glyph.index === sure ||
			(x2Unit(key, 1) < rate &&
				glyph.index !== sure + 1 &&
				!(x2Unit(x2Hash(seed, glyph.index - 1, 511), 1) < rate &&
					(glyph.index & 1) === 1));
		if (weak) {
			rawGlyphFill({
				alpha: low,
				deltaY: size * 0.025,
				glyph,
				options,
			});
		} else {
			rawGlyphFill({
				alpha: 0.72 + 0.28 * x2Unit(key, 2),
				glyph,
				options,
			});
		}
	}
}

/** 細い傷 — a few long, thin cuts run straight through the words. */
function drawHairlineScratches(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const background = options.frame.palette.background;
	const secondary = options.frame.palette.secondary;
	for (const glyph of enterBGlyphs(options)) {
		rawGlyphFill({ glyph, options });
	}
	const bounds = enterBBounds(options);
	const width = bounds.right - bounds.left;
	const height = bounds.bottom - bounds.top;
	if (width < 2 || height < 2) return;
	const single = glyphCount(options) <= 1;
	const cuts = single ? 1 + (seed & 1) : 4;
	const thickness = Math.max(1.2, size * 0.014);
	for (let index = 0; index < cuts; index += 1) {
		const fraction = (index + 0.5 + x2Signed(seed, index, 521) * 0.32) / cuts;
		const along = single || width >= height;
		const slant =
			x2Signed(seed, index, 522) * 0.12 * (along ? height : width);
		let from: readonly [number, number];
		let to: readonly [number, number];
		if (along) {
			const y = lerp({
				start: bounds.top,
				end: bounds.bottom,
				progress: 0.12 + 0.76 * fraction,
			});
			from = [bounds.left - size * 0.12, y - slant];
			to = [bounds.right + size * 0.12, y + slant];
		} else {
			const x = lerp({
				start: bounds.left,
				end: bounds.right,
				progress: 0.12 + 0.76 * fraction,
			});
			from = [x - slant, bounds.top - size * 0.12];
			to = [x + slant, bounds.bottom + size * 0.12];
		}
		drawEnterBLine({
			options,
			alpha: 1,
			color: background,
			from,
			to,
			width: thickness * (1 + x2Unit(seed, index, 523)),
		});
		// the cut runs a little past the letters as a faint line
		const extend = size * (0.25 + 0.5 * x2Unit(seed, index, 524));
		const directionX = to[0] - from[0];
		const directionY = to[1] - from[1];
		const length = Math.hypot(directionX, directionY) || 1;
		const edge = x2Unit(seed, index, 525) < 0.5 ? from : to;
		const sign = edge === from ? -1 : 1;
		drawEnterBLine({
			options,
			alpha: 0.4,
			color: secondary,
			from: edge,
			to: [
				edge[0] + (sign * directionX * extend) / length,
				edge[1] + (sign * directionY * extend) / length,
			],
			width: thickness * 0.8,
		});
	}
}

/** 冷たい縁 — the letters fall into shade; only a thin cold edge on one side still catches the light. */
function drawColdRim(options: EnterBDraw): void {
	const size = options.size;
	const foreground = options.frame.palette.foreground;
	const background = options.frame.palette.background;
	const offset = Math.max(1.5, size * 0.026);
	const side = x2Unit(seedOf(options), 531) < 0.5 ? -1 : 1;
	const shade = mixHex({ from: foreground, to: background, progress: 0.55 });
	// the lit rim: an offset copy in the original colour, behind the shade
	rawWholeFill({
		color: foreground,
		deltaX: side * offset,
		deltaY: -offset * 0.8,
		options,
	});
	rawWholeFill({ color: shade, options });
}

/** 抜け殻 — only a broken, irregular outline is left, with the faintest stain of the letter inside. */
function drawHusk(options: EnterBDraw): void {
	const size = options.size;
	const foreground = options.frame.palette.foreground;
	// the faintest stain of the letter
	rawWholeFill({ alpha: 0.15, color: foreground, options });
	// a broken outline; the dash pattern is approximated by a thin solid stroke
	rawWholeStroke({
		color: foreground,
		lineWidth: Math.max(1.3, size * 0.024),
		options,
	});
}

/** 引きずり跡 — every letter has been dragged a little way; a fading trail hangs underneath. */
function drawDragMarks(options: EnterBDraw): void {
	const seed = seedOf(options);
	const size = options.size;
	const foreground = options.frame.palette.foreground;
	const background = options.frame.palette.background;
	const lean = x2Signed(seed, 561) * 0.06;
	const length = 0.26 + 0.16 * x2Unit(seed, 562);
	const trailColor = mixHex({
		from: foreground,
		to: background,
		progress: 0.45,
	});
	const copies = 9;
	for (let index = copies; index >= 1; index -= 1) {
		const distance = index / (copies + 1);
		rawWholeFill({
			alpha: 0.42 * (1 - distance),
			color: trailColor,
			deltaX: size * lean * distance,
			deltaY: size * length * distance,
			options,
		});
	}
	rawWholeFill({ options });
}

/* ================================================================== CAMERAS */

const CAMERA_MOTION = 0.875; // fx.motion 0.7 default × 1.25 (KM), fixed.

export function drawX2HorrorCam({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform | null {
	switch (cut.preset.cam) {
		case "hzCreepFreeze":
			return creepFreezeCamera({ cut, localTime });
		case "hzGlanceBack":
			return glanceBackCamera({ cut, localTime });
		case "hzHeldBreath":
			return heldBreathCamera({ cut, localTime });
		case "hzColdShiver":
			return coldShiverCamera({ cut, localTime });
		default:
			return null;
	}
}

function cameraSeconds(localTime: number): number {
	return localTime / 120_000;
}

/** 寄って固まる — a very slow push that stops dead mid-move and eases a hair back. */
function creepFreezeCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const seconds = cameraSeconds(localTime);
	const duration = Math.max(0.4, cameraSeconds(cut.duration));
	const at = 0.5 + randomUnit(cut.seed, 711) * 0.18;
	const roll = (randomUnit(cut.seed, 712) * 2 - 1) * 0.6;
	const freezeAt = duration * at;
	const push = Math.min(1, seconds / freezeAt);
	const back =
		seconds > freezeAt ? outExpo(clamp01((seconds - freezeAt) / 0.14)) : 0;
	return {
		rotation: degrees(roll * CAMERA_MOTION * push),
		scale: 1 + 0.085 * CAMERA_MOTION * push - 0.012 * CAMERA_MOTION * back,
		translateY: -0.01 * CAMERA_MOTION * push,
	};
}

/** 振り返り — a slow drift one way, a quick look over the shoulder the other way, a reluctant return. */
function glanceBackCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const seconds = cameraSeconds(localTime);
	const duration = Math.max(0.6, cameraSeconds(cut.duration));
	const direction = randomUnit(cut.seed, 721) < 0.5 ? -1 : 1;
	const glanceAt = duration * (0.32 + randomUnit(cut.seed, 722) * 0.18);
	const drift = direction * 0.02 * CAMERA_MOTION * inOutSine(clamp01(seconds / duration));
	const hold = Math.min(0.55, duration * 0.2);
	const since = seconds - glanceAt;
	const glance =
		since <= 0
			? 0
			: since < 0.13
				? outExpo(since / 0.13)
				: since < 0.13 + hold
					? 1
					: 1 - inOutSine(clamp01((since - 0.13 - hold) / 0.9));
	return {
		rotation: degrees(-direction * 1.3 * CAMERA_MOTION * glance),
		scale: 1.035 + 0.012 * CAMERA_MOTION * glance,
		translateX: drift - direction * 0.045 * CAMERA_MOTION * glance,
		translateY: 0.004 * CAMERA_MOTION * glance,
	};
}

/** 息を殺す — the frame sways with slow breathing, then the breath is held — still but for a tremor — and let out. */
function heldBreathCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const seconds = cameraSeconds(localTime);
	const duration = Math.max(0.6, cameraSeconds(cut.duration));
	const holdAt = duration * (0.3 + randomUnit(cut.seed, 731) * 0.2);
	const holdLength = Math.min(
		0.9 + randomUnit(cut.seed, 732) * 0.6,
		duration * 0.4,
	);
	const period = 2.8 + randomUnit(cut.seed, 733) * 0.8;
	const held = seconds >= holdAt && seconds < holdAt + holdLength;
	const breathing = seconds < holdAt ? seconds : held ? holdAt : seconds - holdLength;
	const phase = (breathing * TAU) / period;
	const sway = Math.sin(phase);
	const tremor = held ? Math.min(1, (seconds - holdAt) / 0.3) : 0;
	return {
		rotation: degrees(0.35 * CAMERA_MOTION * Math.sin(phase * 0.5 + 1)),
		scale: 1.03 + 0.014 * CAMERA_MOTION * sway,
		translateX:
			Math.sin(phase * 0.5) * 0.004 * CAMERA_MOTION +
			smoothNoise({ seed: cut.seed, salt: 0, value: seconds * 15 }) *
				0.0014 *
				CAMERA_MOTION *
				tremor,
		translateY:
			-0.009 * CAMERA_MOTION * sway +
			smoothNoise({ seed: cut.seed + 1, salt: 0, value: seconds * 13 }) *
				0.0016 *
				CAMERA_MOTION *
				tremor,
	};
}

/** 悪寒 — perfectly still — then a short, fine shudder runs through the frame and dies away. */
function coldShiverCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const seconds = cameraSeconds(localTime);
	const period = 1.9 + randomUnit(cut.seed, 741) * 0.7;
	const rate = 0.6 + randomUnit(cut.seed, 742) * 0.25;
	let x = 0;
	let y = 0;
	let rotation = 0;
	let scale =
		1.03 +
		0.012 *
			CAMERA_MOTION *
			clamp01(seconds / Math.max(0.5, cameraSeconds(cut.duration)));
	const cycle = Math.floor(seconds / period);
	const since =
		seconds - cycle * period - (0.15 + randomUnit(cut.seed, 611 + cycle) * 0.45) * period;
	if (since > 0 && randomUnit(cut.seed, 612 + cycle) < rate) {
		const envelope =
			Math.exp(-since * 5.5) * (1 - Math.exp(-since * 45)) * CAMERA_MOTION;
		x = Math.sin(since * TAU * 13) * 0.0065 * envelope;
		y = Math.sin(since * TAU * 17 + 1) * 0.004 * envelope;
		rotation = degrees(Math.sin(since * TAU * 11 + 2) * 0.8 * envelope);
		scale -= 0.014 * envelope;
	}
	return { rotation, scale, translateX: x, translateY: y };
}

/* ================================================================== SCREEN EFFECTS */

interface X2HorrorFxDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly effect: string;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

/** Per-cut fx cycle over the JIZURA effect duration (the occurrence scheduler is planner-side). */
function fxCycle({
	options,
	duration,
}: {
	readonly options: X2HorrorFxDraw;
	readonly duration: number;
}): number {
	return Math.floor(secondsOf(options.frame) / duration);
}

function fxProgress({
	options,
	duration,
}: {
	readonly options: X2HorrorFxDraw;
	readonly duration: number;
}): number {
	const seconds = secondsOf(options.frame);
	return ((seconds / duration) % 1 + 1) % 1;
}

/** Occurrence-stable stand-in for JIZURA `evS` (per-event seed). */
function fxEventSeed({
	duration,
	options,
}: {
	readonly duration: number;
	readonly options: X2HorrorFxDraw;
}): number {
	return x2Hash(
		options.frame.cut?.seed ?? 0,
		fxCycle({ duration, options }),
		7741,
	);
}

function fillCircle({
	alpha,
	color,
	ctx,
	radius,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly radius: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (radius <= 0.05 || alpha <= 0.004) return;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	if (ctx.arc && ctx.fill) {
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
	}
	ctx.restore();
	ctx.fillStyle = baseFill;
	ctx.globalAlpha = baseAlpha;
}

/** Two-step disc stack approximating a radial gradient (0.55 stop at half alpha). */
function glowPuff({
	alpha,
	color,
	ctx,
	radius,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly radius: number;
	readonly x: number;
	readonly y: number;
}): void {
	const outer = alpha * 0.5;
	const inner = (alpha - outer) / (1 - outer);
	fillCircle({ alpha: outer, color, ctx, radius, x, y });
	fillCircle({ alpha: inner, color, ctx, radius: radius * 0.55, x, y });
}

export function drawX2HorrorFx(options: X2HorrorFxDraw): boolean {
	switch (options.effect) {
		case "hzTear":
			drawTearEffect(options);
			return true;
		case "hzDrain":
			drawDrainEffect(options);
			return true;
		case "hzClosingDark":
			drawClosingDarkEffect(options);
			return true;
		case "hzColdBreath":
			drawColdBreathEffect(options);
			return true;
		case "hzFaint":
			drawFaintEffect(options);
			return true;
		case "hzUpside":
			drawUpsideEffect(options);
			return true;
		default:
			return false;
	}
}

/** 縦の裂け目 — the picture rips open along a ragged vertical line, the halves slip, and it closes. */
function drawTearEffect(options: X2HorrorFxDraw): void {
	const { ctx, frame, width, height } = options;
	const duration = 8;
	const progress = fxProgress({ duration, options });
	const seed = fxEventSeed({ duration, options });
	const unit = Math.min(width, height);
	const open =
		progress < 0.18
			? outExpo(progress / 0.18)
			: 1 - inOutCubic((progress - 0.18) / 0.82);
	const gap = unit * 0.075 * open;
	if (gap < 0.6) return;
	const x0 = width * lerp({ start: 0.28, end: 0.72, progress: x2Unit(seed, 1) });
	const segments = 14;
	const slip = unit * 0.014 * open * (x2Unit(seed, 2) < 0.5 ? 1 : -1);
	const lean = x2Signed(seed, 3) * width * 0.05;
	const points: Array<readonly [number, number]> = [];
	for (let index = 0; index <= segments; index += 1) {
		points.push([
			x0 +
				lean * (index / segments - 0.5) +
				x2Signed(seed, index, 4) * unit * 0.022,
			(height * index) / segments,
		]);
	}
	if (isLooksPixelContext(ctx)) {
		const surface = captureLooksSource({ ctx, height, width });
		if (surface && ctx.moveTo && ctx.lineTo) {
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = nightOf(frame);
			ctx.fillRect(0, 0, width, height);
			for (const side of [-1, 1] as const) {
				ctx.save();
				ctx.beginPath();
				clipTearHalf({ ctx, gap, height, points, side, width });
				ctx.clip();
				ctx.drawImage(surface.canvas, (side * gap) / 2, side * slip);
				ctx.restore();
			}
			ctx.restore();
			return;
		}
	}
	// fallback: the dark tear seam alone (no image displacement)
	if (!ctx.moveTo || !ctx.lineTo || !ctx.fill) return;
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(points[0]![0] - gap / 2, points[0]![1]);
	for (const [x, y] of points) ctx.lineTo(x - gap / 2, y);
	for (let index = segments; index >= 0; index -= 1) {
		ctx.lineTo(points[index]![0] + gap / 2, points[index]![1]);
	}
	ctx.closePath?.();
	ctx.globalAlpha *= 0.85;
	ctx.fillStyle = nightOf(frame);
	ctx.fill();
	ctx.restore();
}

function clipTearHalf({
	ctx,
	gap,
	height,
	points,
	side,
	width,
}: {
	readonly ctx: MotionTextCanvasContext;
	readonly gap: number;
	readonly height: number;
	readonly points: readonly (readonly [number, number])[];
	readonly side: -1 | 1;
	readonly width: number;
}): void {
	ctx.moveTo?.(side < 0 ? -2 : width + 2, -2);
	for (const [index, point] of points.entries()) {
		ctx.lineTo?.(
			point[0] + (side * gap) / 2,
			index === 0 ? -2 : index === points.length - 1 ? height + 2 : point[1],
		);
	}
	ctx.lineTo?.(side < 0 ? -2 : width + 2, height + 2);
	ctx.closePath?.();
}

/** 色を失う — for a moment all colour leaves the picture and the contrast goes flat and pale. */
function drawDrainEffect(options: X2HorrorFxDraw): void {
	const { ctx, frame, width, height } = options;
	const envelope = ahr(fxProgress({ duration: 10, options }), 0.15, 0.55);
	if (envelope < 0.004) return;
	ctx.save();
	if (typeof ctx.globalCompositeOperation === "string") {
		ctx.globalCompositeOperation = "saturation";
		ctx.globalAlpha *= Math.min(1, envelope);
		ctx.fillStyle = "#808080";
		ctx.fillRect(0, 0, width, height);
		ctx.globalCompositeOperation = "source-over";
	}
	ctx.globalAlpha *= 0.3 * envelope;
	ctx.fillStyle = mixHex({
		from: frame.palette.foreground,
		to: frame.palette.background,
		progress: 0.5,
	});
	ctx.fillRect(0, 0, width, height);
	ctx.restore();
}

/** 迫る闇 — the dark at the edges of the frame swells inwards, nearly reaches the middle, and draws back. */
function drawClosingDarkEffect(options: X2HorrorFxDraw): void {
	const { ctx, width, height } = options;
	const duration = 13;
	const progress = fxProgress({ duration, options });
	const seed = fxEventSeed({ duration, options });
	const envelope = ahr(progress, 0.4, 0.5);
	if (envelope < 0.004) return;
	const radius = Math.hypot(width, height) / 2;
	const centerX = width * (0.5 + x2Signed(seed, 1) * 0.05);
	const centerY = height * (0.5 + x2Signed(seed, 2) * 0.05);
	const wobble = 1 + 0.04 * Math.sin(progress * 23 + (seed % 7));
	const outer =
		radius * lerp({ start: 1.25, end: 0.78, progress: envelope }) * wobble;
	const inner =
		radius * lerp({ start: 0.8, end: 0.26, progress: envelope }) * wobble;
	// the radial gradient (0 → 0.7e at 60% → 0.96e) as stepped annuli inwards
	const steps = 6;
	const gradientAlpha = (fraction: number): number =>
		envelope *
		(fraction <= 0.6
			? (0.7 * fraction) / 0.6
			: 0.7 + 0.26 * ((fraction - 0.6) / 0.4));
	for (let index = 0; index < steps; index += 1) {
		fillDarkAnnulus({
			alpha: gradientAlpha((index + 0.5) / steps),
			ctx,
			innerRadius:
				lerp({ start: inner, end: outer, progress: index / steps }),
			outerRadius:
				lerp({ start: inner, end: outer, progress: (index + 1) / steps }),
			x: centerX,
			y: centerY,
		});
	}
	// everything past the gradient's outer stop stays at its full alpha
	fillDarkAnnulus({
		alpha: 0.96 * envelope,
		ctx,
		innerRadius: outer,
		outerRadius: radius * 1.5,
		x: centerX,
		y: centerY,
	});
}

/** Dark annulus (disc when `innerRadius` is 0) via evenodd circle-in-circle. */
function fillDarkAnnulus({
	alpha,
	ctx,
	innerRadius,
	outerRadius,
	x,
	y,
}: {
	readonly alpha: number;
	readonly ctx: MotionTextCanvasContext;
	readonly innerRadius: number;
	readonly outerRadius: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (alpha <= 0.004 || outerRadius <= innerRadius) return;
	if (!ctx.arc || !ctx.fill) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.fillStyle = "#000000";
	ctx.beginPath();
	ctx.arc(x, y, outerRadius, 0, TAU);
	if (innerRadius > 0) {
		ctx.arc(x, y, innerRadius, 0, TAU);
		ctx.fill("evenodd");
	} else {
		ctx.fill();
	}
	ctx.restore();
}

/** 白い息 — a pale cloud of breath rises from below the frame, spreads and thins out. */
function drawColdBreathEffect(options: X2HorrorFxDraw): void {
	const { ctx, frame, width, height } = options;
	const duration = 16;
	const progress = fxProgress({ duration, options });
	const seed = fxEventSeed({ duration, options });
	const unit = Math.min(width, height);
	const dark = isDark(frame.palette.background);
	const color = mixHex({
		from: frame.palette.foreground,
		to: frame.palette.background,
		progress: dark ? 0.25 : 0.72,
	});
	const originX = width * lerp({ start: 0.3, end: 0.7, progress: x2Unit(seed, 1) });
	const lean = x2Signed(seed, 2) * width * 0.16;
	for (let puff = 0; puff < 9; puff += 1) {
		const delay = puff * 0.055;
		const phase = clamp01((progress - delay) / (1 - delay));
		if (phase <= 0 || phase >= 1) continue;
		const rise = outCubic(phase);
		const radius =
			unit * (0.07 + 0.24 * rise) * (0.6 + 0.8 * x2Unit(seed, puff, 3));
		const x =
			originX +
			lean * rise * (0.4 + puff * 0.15) +
			x2Signed(seed, puff, 4) * unit * 0.34 * rise;
		const y =
			height * 1.03 -
			height * (0.16 + 0.34 * x2Unit(seed, puff, 5)) * rise;
		const alpha = (dark ? 0.13 : 0.2) * Math.sin(Math.PI * phase ** 0.7);
		glowPuff({ alpha, color, ctx, radius, x, y });
	}
}

/** 気が遠のく — the picture slips away from you — smaller, dimmer, soft — into a dark surround, and swims back. */
function drawFaintEffect(options: X2HorrorFxDraw): void {
	const { ctx, frame, width, height } = options;
	const duration = 13;
	const progress = fxProgress({ duration, options });
	const seed = fxEventSeed({ duration, options });
	const envelope = ahr(progress, 0.38, 0.52);
	if (envelope < 0.004) return;
	if (isLooksPixelContext(ctx)) {
		const surface = captureLooksSource({ ctx, height, width });
		if (surface) {
			const zoom = 1 - 0.11 * envelope;
			const centerX = width / 2 + x2Signed(seed, 1) * width * 0.02 * envelope;
			const centerY = height / 2 + height * 0.025 * envelope;
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = nightOf(frame);
			ctx.fillRect(0, 0, width, height);
			ctx.translate(centerX, centerY);
			ctx.rotate(x2Signed(seed, 2) * 0.02 * envelope);
			ctx.filter = `blur(${(envelope * 3.2).toFixed(1)}px)`;
			ctx.scale(zoom, zoom);
			ctx.drawImage(surface.canvas, -width / 2, -height / 2);
			ctx.filter = "none";
			ctx.restore();
		}
	}
	ctx.save();
	ctx.globalAlpha *= 0.5 * envelope;
	ctx.fillStyle = "#000000";
	ctx.fillRect(0, 0, width, height);
	ctx.restore();
}

/** 逆さの一コマ — for two frames the whole picture hangs upside down, dim and a little too near. */
function drawUpsideEffect(options: X2HorrorFxDraw): void {
	const { ctx, frame, width, height } = options;
	// the glimpse lasts about two frames of the 3 s cycle (the JIZURA k > 0.7
	// gate would leave the frame flipped for seconds)
	const progress = fxProgress({ duration: 3, options });
	if (progress > 0.08) return;
	if (isLooksPixelContext(ctx)) {
		const surface = captureLooksSource({ ctx, height, width });
		if (surface) {
			const zoom = 1.06;
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = nightOf(frame);
			ctx.fillRect(0, 0, width, height);
			ctx.translate(width / 2, height / 2);
			ctx.scale(zoom, -zoom);
			ctx.drawImage(surface.canvas, -width / 2, -height / 2);
			ctx.restore();
		}
	}
	ctx.save();
	ctx.globalAlpha *= 0.42;
	ctx.fillStyle = "#000000";
	ctx.fillRect(0, 0, width, height);
	ctx.restore();
}

/* ================================================================== TRANSITIONS */

export function drawX2HorrorTrans(options: TreatTransTransitionDraw): boolean {
	if (!options.frame.previousCut) return false;
	switch (options.frame.cut?.preset.trans) {
		case "hzBlackout":
			drawBlackoutTransition(options);
			return true;
		case "hzSlideDown":
			drawSlideDownTransition(options);
			return true;
		case "hzLinger":
			drawLingerTransition(options);
			return true;
		default:
			return false;
	}
}

/** 停電 — the light on the old shot sputters and fails; a beat of dark; it comes back on over the new one. */
function drawBlackoutTransition(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, width, height } = options;
	const progress = clamp01(options.frame.enterProgress);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(secondsOf(options.frame) * 24);
	const gap = 0.14;
	const fadeOutAt = 0.5 - gap / 2;
	const fadeInAt = 0.5 + gap / 2;
	let level = 0;
	let source: (() => void) | null = null;
	if (progress < fadeOutAt) {
		const phase = progress / fadeOutAt;
		source = options.drawPrevious;
		level = 1 - inQuad(phase);
		if (phase > 0.2 && randomUnit(seed, step, 711) < 0.4) level *= 0.25;
	} else if (progress > fadeInAt) {
		const phase = (progress - fadeInAt) / (1 - fadeInAt);
		source = options.drawCurrent;
		level = outQuad(phase);
		if (phase < 0.6 && randomUnit(seed, step, 712) < 0.4) level *= 0.3;
	}
	if (!source || level <= 0.003) {
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, width, height);
		return;
	}
	source();
	if (level < 0.997) {
		ctx.save();
		ctx.globalAlpha *= 1 - level;
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, width, height);
		ctx.restore();
	}
}

/** ずり落ちる — the old picture loses its grip and slides off downwards in uneven strips, stretching. */
function drawSlideDownTransition(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, width, height } = options;
	const progress = clamp01(options.frame.enterProgress);
	const seed = options.frame.cut?.seed ?? 0;
	const strips = [18, 28, 40] as const;
	const count = strips[x2Hash(seed, 722) % 3]!;
	const stripWidth = Math.ceil(width / count);
	options.drawCurrent();
	for (let index = 0; index < count; index += 1) {
		const delay = clamp(
			0.2 +
				smoothNoise({ seed, salt: 0, value: index * 0.37 }) * 0.2 +
				x2Signed(seed, index, 721) * 0.05,
		);
		const phase = clamp01((progress - delay) / 0.6);
		const x = Math.floor((width * index) / count);
		const sliceWidth = Math.min(stripWidth, width - x);
		if (sliceWidth <= 0) continue;
		if (phase >= 1) continue;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, 0, sliceWidth + 1, height);
		ctx.clip();
		if (phase <= 0) {
			options.drawPrevious();
		} else {
			const offset = inCubic(phase) * height * 1.03;
			ctx.translate(0, offset);
			ctx.scale(1, 1 + 0.45 * phase);
			options.drawPrevious();
		}
		ctx.restore();
	}
}

/** 居残る影 — the new shot is there at once, but the old one stays on as a pale ghost that drifts up and thins. */
function drawLingerTransition(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, width, height } = options;
	const progress = clamp01(options.frame.enterProgress);
	const seed = options.frame.cut?.seed ?? 0;
	const step = Math.floor(secondsOf(options.frame) * 24);
	const revealAt = 0.14;
	if (progress < revealAt) {
		options.drawPrevious();
		ctx.save();
		ctx.globalAlpha *= progress / revealAt;
		options.drawCurrent();
		ctx.restore();
	} else {
		options.drawCurrent();
	}
	const previousDark = isDark(
		options.frame.previousPalette?.background ?? options.frame.palette.background,
	);
	const currentDark = isDark(options.frame.palette.background);
	let alpha = 0.6 * (1 - inOutSine(progress));
	if (progress > 0.3 && randomUnit(seed, step, 731) < 0.22) alpha *= 0.35;
	if (alpha <= 0.004) return;
	const up = randomUnit(seed, 733) < 1 / 3 ? 1 : -1;
	const zoom = 1 + 0.07 * progress;
	const drift = up * height * 0.035 * outCubic(progress);
	ctx.save();
	ctx.globalAlpha *= previousDark === currentDark ? alpha : alpha * 0.6;
	if (
		previousDark === currentDark &&
		typeof ctx.globalCompositeOperation === "string"
	) {
		ctx.globalCompositeOperation = currentDark ? "lighten" : "darken";
	}
	ctx.translate(width / 2, height / 2 + drift);
	ctx.scale(zoom, zoom);
	ctx.translate(-width / 2, -height / 2);
	options.drawPrevious();
	ctx.restore();
}
