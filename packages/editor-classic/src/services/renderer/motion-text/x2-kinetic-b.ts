import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import {
	drawEnterBWhole,
	enterBDirection,
	enterBGlyphs,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	bell,
	clamp01,
	degrees,
	drawExitHoldOutline,
	inCubic,
	inOutCubic,
	inOutSine,
	mixHex,
	outCubic,
	outQuad,
	randomSigned,
	randomUnit,
	secondsOf,
} from "./exit-hold-geometry";
import { fxBPhase, type FxBScreenEffectDraw } from "./fx-b-screen-effect-types";
import type { KineticCameraTransform } from "./kinetic-cameras";
import { kineticWordSegments } from "./kinetic-words";
import {
	captureLooksSource,
	fillLooksEffectRect,
	isLooksPixelContext,
	type LooksPixelEffectDraw,
} from "./looks-screen-effect-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";
import {
	drawX2Glyphs,
	x2Bounds,
	x2Hash,
	x2Sub,
	type X2Draw,
	type X2Glyph,
	type X2GlyphTransform,
} from "./x2-drawing";

/**
 * JIZURA x2kineticB — kinetic typography (追加分2): entrances, exits, holds,
 * treatments, cameras, frame fx and transitions where words carry weight —
 * they overshoot, squash, recoil, get hit and thrown. Ported onto rocut's
 * EnterB glyph pipeline and the camera / fx / transition contracts.
 */

const PI = Math.PI;
const TAU = PI * 2;

// --- word geometry over the EnterB glyph model ---------------------------------

interface X2BWord {
	readonly cx: number;
	readonly cy: number;
	readonly count: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}

interface X2BBox {
	readonly cx: number;
	readonly cy: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}

interface X2BGeometry {
	readonly box: X2BBox;
	readonly glyphs: readonly X2Glyph[];
	readonly inWord: readonly number[];
	readonly wordOf: readonly number[];
	readonly words: readonly X2BWord[];
}

function geoOf(options: X2Draw): X2BGeometry {
	const glyphs = enterBGlyphs(options);
	const words = kineticWordSegments({ maximum: 6, text: options.text });
	const counts = words.map((word) => Array.from(word).length);
	const bounds: number[] = [];
	let acc = 0;
	for (const count of counts) {
		acc += count;
		bounds.push(acc);
	}
	const wordOf: number[] = [];
	const inWord: number[] = [];
	const boxes = words.map(() => ({
		count: 0,
		cx: 0,
		cy: 0,
		x0: Number.POSITIVE_INFINITY,
		x1: Number.NEGATIVE_INFINITY,
		y0: Number.POSITIVE_INFINITY,
		y1: Number.NEGATIVE_INFINITY,
	}));
	for (const glyph of glyphs) {
		let j = bounds.findIndex((bound) => glyph.index < bound);
		if (j < 0) j = words.length - 1;
		wordOf[glyph.index] = j;
		inWord[glyph.index] = glyph.index - (j > 0 ? bounds[j - 1]! : 0);
		const box = boxes[j];
		if (!box) continue;
		box.count += 1;
		box.x0 = Math.min(box.x0, glyph.x - glyph.width / 2);
		box.x1 = Math.max(box.x1, glyph.x + glyph.width / 2);
		box.y0 = Math.min(box.y0, glyph.y - glyph.height / 2);
		box.y1 = Math.max(box.y1, glyph.y + glyph.height / 2);
	}
	let x0 = Number.POSITIVE_INFINITY;
	let x1 = Number.NEGATIVE_INFINITY;
	let y0 = Number.POSITIVE_INFINITY;
	let y1 = Number.NEGATIVE_INFINITY;
	for (const box of boxes) {
		if (box.count === 0) continue;
		box.cx = (box.x0 + box.x1) / 2;
		box.cy = (box.y0 + box.y1) / 2;
		x0 = Math.min(x0, box.x0);
		x1 = Math.max(x1, box.x1);
		y0 = Math.min(y0, box.y0);
		y1 = Math.max(y1, box.y1);
	}
	return {
		box: {
			cx: (x0 + x1) / 2,
			cy: (y0 + y1) / 2,
			x0: x0 === Number.POSITIVE_INFINITY ? options.x : x0,
			x1: x1 === Number.NEGATIVE_INFINITY ? options.x : x1,
			y0: y0 === Number.POSITIVE_INFINITY ? options.y : y0,
			y1: y1 === Number.NEGATIVE_INFINITY ? options.y : y1,
		},
		glyphs,
		inWord,
		wordOf,
		words: boxes,
	};
}

// --- rigid body motion about a word pivot (JIZURA `rigid`) ---------------------

interface RigidSpec {
	readonly a?: number;
	readonly color?: string;
	readonly px?: number;
	readonly py?: number;
	readonly rot?: number;
	readonly s?: number;
	readonly skew?: number;
	readonly sx?: number;
	readonly sy?: number;
	readonly tx?: number;
	readonly ty?: number;
}

// eslint-disable-next-line opencut/prefer-object-params
function rigid(
	glyph: X2Glyph,
	word: X2BWord | null,
	spec: RigidSpec,
): X2GlyphTransform {
	const gx = glyph.x;
	const gy = glyph.y;
	const px = spec.px ?? word?.cx ?? gx;
	const py = spec.py ?? word?.cy ?? gy;
	const s = spec.s ?? 1;
	const sx = spec.sx ?? 1;
	const sy = spec.sy ?? 1;
	let rx = (gx - px) * s * sx;
	let ry = (gy - py) * s * sy;
	if (spec.rot) {
		const c = Math.cos(degrees(spec.rot));
		const sn = Math.sin(degrees(spec.rot));
		const x = rx;
		rx = x * c - ry * sn;
		ry = x * sn + ry * c;
	}
	return {
		alpha: spec.a,
		color: spec.color,
		rotation: spec.rot ? degrees(spec.rot) : 0,
		scaleX: s * sx,
		scaleY: s * sy,
		skewX: spec.skew ? degrees(spec.skew) : 0,
		translateX: px + rx - gx + (spec.tx ?? 0),
		translateY: py + ry - gy + (spec.ty ?? 0),
	};
}

// --- source easings / clocks ----------------------------------------------------

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
}

// eslint-disable-next-line opencut/prefer-object-params
function oBack(value: number, overshoot = 1.70158): number {
	const shifted = clamp01(value) - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function oExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

/** JIZURA `J.smooth(a, b, x)`: smoothstep between two bounds. */
// eslint-disable-next-line opencut/prefer-object-params
function smoothRange(from: number, to: number, value: number): number {
	const t = clamp01((value - from) / (to - from));
	return t * t * (3 - 2 * t);
}

/** Damped wobble that starts at 0: 0 → out → back (JIZURA `kick`, seconds). */
// eslint-disable-next-line opencut/prefer-object-params
function kick(t: number, k = 9, f = 26): number {
	return t <= 0 ? 0 : Math.exp(-k * t) * Math.sin(f * t);
}

/** Damped spring: 1 at t=0 → 0 at t=1, swinging through 0 (JIZURA `spring1`). */
// eslint-disable-next-line opencut/prefer-object-params
function spring1(t: number, k: number, f: number): number {
	const value = clamp01(t);
	return Math.exp(-k * value) * Math.cos(f * PI * value) * (1 - value ** 3);
}

function bounceE(value: number): number {
	const n1 = 7.5625;
	const d1 = 2.75;
	const progress = clamp01(value);
	if (progress < 1 / d1) return n1 * progress * progress;
	if (progress < 2 / d1) {
		return n1 * (progress - 1.5 / d1) ** 2 + 0.75;
	}
	if (progress < 2.5 / d1) {
		return n1 * (progress - 2.25 / d1) ** 2 + 0.9375;
	}
	return n1 * (progress - 2.625 / d1) ** 2 + 0.984375;
}

/** Staggered local progress for element k of n (JIZURA `stg`). */
// eslint-disable-next-line opencut/prefer-object-params
function stgOf(p: number, k: number, n: number, spread: number): number {
	return clamp01((p - (n > 1 ? (k / (n - 1)) * spread : 0)) / (1 - spread));
}

/** Nominal in/out window seconds from the cut duration (JIZURA WIN/OUT). */
// eslint-disable-next-line opencut/prefer-object-params
function durOf(
	options: X2Draw,
	share: number,
	minimum: number,
	maximum: number,
): number {
	const duration = (options.frame.cut?.duration ?? 120_000) / 120_000;
	return Math.min(Math.max(duration * share, minimum), maximum);
}

/** Frame width/height stand-ins for the item stage (see the port spec). */
function frameWidthOf(options: X2Draw): number {
	return options.maxWidth / 0.86;
}

function frameHeightOf(options: X2Draw): number {
	return options.size * 4;
}

/** Seconds since the last beat boundary of `period` (JIZURA `beatSince`). */
// eslint-disable-next-line opencut/prefer-object-params
function beatSince(seconds: number, period: number): number {
	return ((seconds % period) + period) % period;
}

// eslint-disable-next-line opencut/prefer-object-params
function beatIndex(seconds: number, period: number): number {
	return Math.floor(seconds / period);
}

// ============================================================================ ENTRANCES

/** 左右から語 — words shoot in from the left and the right in turn and overshoot. */
function drawKzSideVolley(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.6 : 0;
	const secs = durOf(options, 0.45, 0.34, 1) * (1 - sp);
	const d0 = enterBDirection(options, 811);
	const D = frameWidthOf(options) * 0.62;
	const fade = clamp01((1 - p) * 10);
	const sgn = (j: number): number => (j % 2 ? -d0 : d0);
	const q: number[] = [];
	for (let j = 0; j < n; j++) q.push(stgOf(p, j, n, sp));
	const sh = new Array<number>(n).fill(0);
	for (let j = 0; j < n; j++) {
		for (let j2 = j + 1; j2 < n; j2++) {
			if (q[j2]! > 0.45) {
				sh[j] -= sgn(j2) * 0.14 * kick((q[j2]! - 0.45) * secs, 10, 30);
			}
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			if (q[j]! <= 0) return null;
			const e = oBack(clamp01(q[j]! * 1.3), 1.5);
			const fast = (1 - clamp01(q[j]! * 1.7)) ** 2;
			const a = sgn(j) * D * (1 - e) + sh[j]! * options.size * fade;
			const st = 1 + 0.7 * fast;
			return rigid(glyph, geo.words[j], {
				a: clamp01(q[j]! * 8),
				sx: st,
				tx: a,
			});
		},
	});
}

/** 語の車輪 — each word rolls in along the line as one rigid wheel, a full turn. */
function drawKzWordWheel(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.5 : 0;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const q = stgOf(p, j, n, sp);
			if (q <= 0) return null;
			const b = geo.words[j]!;
			const R = Math.max(
				0.45,
				Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * 0.4,
			);
			const d = TAU * R * (1 - oBack(q, 1.1));
			const ang = d / R / (PI / 180);
			return rigid(glyph, b, { a: clamp01(q * 7), rot: ang, tx: d });
		},
	});
}

/**
 * 突き抜け戻り — each word swells through its size as a hollow outline, then
 * snaps back solid and rings. rocut's glyph pipeline has no stroke mode, so
 * the outline stage lands as the muted secondary colour.
 */
function drawKzPunchThrough(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.55 : 0;
	const acc = options.frame.palette.accent;
	const T = 0.46;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const q = stgOf(p, j, n, sp);
			if (q <= 0) return null;
			if (q < T) {
				return rigid(glyph, geo.words[j], {
					a: clamp01(q * 12),
					color: x2Sub(options),
					s: lerpN(0.15, 1.6, outCubic(q / T)),
				});
			}
			const t = (q - T) / (1 - T);
			return rigid(glyph, geo.words[j], {
				color: t < 0.2 ? acc : undefined,
				s: 1 + 0.6 * spring1(t, 4.5, 3.4),
			});
		},
	});
}

/** 塔からほどく — the words pile up as a tower in the middle, then swing out into the line. */
function drawKzTowerUnstack(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	if (n < 2) {
		drawX2Glyphs({
			options,
			resolve: () => ({
				alpha: clamp01(p * 7),
				translateY: -(1 - bounceE(p)) * options.size * 1.5,
			}),
		});
		return;
	}
	let lh = 0;
	for (const b of geo.words) {
		lh = Math.max(lh, b.y1 - b.y0);
	}
	lh *= 1.1;
	const fit = Math.min(
		1,
		frameHeightOf(options) * 0.78 / Math.max(1, n * lh),
	);
	const T = 0.5;
	const B = geo.box;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const aIn = stgOf(clamp01(p / T), j, n, 0.72);
			if (aIn <= 0) return null;
			const b = geo.words[j]!;
			const off = (j - (n - 1) / 2) * lh * fit;
			const sy0 = B.cy + off;
			const e = oBack(
				inOutSine(stgOf(clamp01((p - T) / (1 - T)), j, n, 0.4)),
				1.25,
			);
			const pop = oBack(aIn, 2.2);
			const s = lerpN(fit * lerpN(0.55, 1, pop), 1, clamp01(e));
			return rigid(glyph, b, {
				a: clamp01(aIn * 7),
				rot: 4 * e * (1 - e) * (j % 2 ? 9 : -9),
				s,
				tx: (B.cx - b.cx) * (1 - e),
				ty: (sy0 - b.cy) * (1 - e),
			});
		},
	});
}

/** 水切り — each word skips in from the side like a flat stone: three lower hops. */
function drawKzSkipStone(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.5 : 0;
	const sg = enterBDirection(options, 815);
	const D = Math.min(frameWidthOf(options) * 0.5, options.size * 5.5);
	const H0 = options.size * 1.05;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const q = stgOf(p, j, n, sp);
			if (q <= 0) return null;
			const b = geo.words[j]!;
			const u = 1 - (1 - q) ** 1.7;
			const ph = u * 3;
			const fr = ph - Math.floor(ph);
			const h = Math.abs(Math.sin(PI * ph)) * H0 * (1 - u) ** 1.1;
			const touch = Math.max(0, 1 - Math.min(fr, 1 - fr) * 7) * (1 - u);
			return rigid(glyph, b, {
				a: clamp01(q * 9),
				py: b.y1,
				rot: -sg * 7 * (1 - u) * (1 - touch),
				sx: 1 + 0.2 * touch,
				sy: 1 - 0.32 * touch,
				tx: sg * D * (1 - u),
				ty: -h,
			});
		},
	});
}

/** シーソー着地 — every word that drops onto the line tips it towards its side. */
function drawKzSeesaw(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.45 : 0;
	const fd = (1 - sp) * 0.34;
	const secs = durOf(options, 0.5, 0.45, 1.15);
	const B = geo.box;
	const half = (B.x1 - B.x0) / 2;
	const st: number[] = [];
	let th = 0;
	for (let j = 0; j < n; j++) {
		const p0 = (n > 1 ? j / (n - 1) : 0) * sp;
		st.push(p0);
		const u =
			n > 1 ? (geo.words[j]!.cx - B.cx) / half : 0.5 * enterBDirection(options, 817);
		th += 9 * u * kick((p - p0 - fd) * secs, 6.5, 20);
	}
	th = Math.min(Math.max(th, -13), 13) * clamp01((1 - p) * 8);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			if (p <= st[j]!) return null;
			const q = clamp01((p - st[j]!) / fd);
			const fall = (1 - q * q) * options.size * 2.4;
			return rigid(glyph, null, {
				a: clamp01(q * 5),
				px: B.cx,
				py: B.cy,
				rot: th,
				ty: -fall,
			});
		},
	});
}

/** トランポリン — each word is tossed up from a springy sheet and lands on it. */
function drawKzTrampoline(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.5 : 0;
	const fd = (1 - sp) * 0.4;
	const secs = durOf(options, 0.5, 0.45, 1.15);
	const A = options.size * 0.3 * clamp01((1 - p) * 9);
	const st: number[] = [];
	const pos: number[] = [];
	for (let j = 0; j < n; j++) {
		st.push((n > 1 ? j / (n - 1) : 0) * sp);
		pos.push(geo.words[j]!.cx);
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			if (p <= st[j]!) return null;
			const q = clamp01((p - st[j]!) / fd);
			const x = glyph.x;
			let w = 0;
			for (let j2 = 0; j2 < n; j2++) {
				const d = Math.abs(x - pos[j2]!);
				const t = (p - st[j2]! - fd) * secs - d / 28;
				if (t > 0) w += Math.exp(-d * 0.28) * kick(t, 6, 19);
			}
			const fly =
				q < 0.55
					? lerpN(2.4, -0.75, outQuad(q / 0.55))
					: -0.75 * (1 - ((q - 0.55) / 0.45) ** 2);
			const v = fly * options.size + A * w;
			return {
				alpha: clamp01(q * 5),
				scaleY: 1 + 0.22 * (q < 1 ? Math.sin(PI * q) : 0),
				translateY: v,
			};
		},
	});
}

/** 行き過ぎ戻り — every word runs in leaning forward, skids past its place and backs up. */
function drawKzOverrun(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.enterProgress;
	const sp = n > 1 ? 0.48 : 0;
	const D = frameWidthOf(options) * 0.55;
	const O = options.size * 0.95;
	const T = 0.55;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const q = stgOf(p, j, n, sp);
			if (q <= 0) return null;
			let a: number;
			let lean: number;
			let st = 1;
			if (q < T) {
				const t = q / T;
				a = lerpN(D, -O, outQuad(t));
				lean = lerpN(17, -21, t * t);
				st = 1 + 0.4 * (1 - t) * (1 - t);
			} else {
				const t = (q - T) / (1 - T);
				a = -O * (1 - inOutCubic(t));
				lean = -21 * (1 - t) * (1 - t) + 7 * Math.sin(PI * t) * (1 - t);
			}
			return rigid(glyph, geo.words[j], {
				a: clamp01(q * 9),
				skew: lean,
				sx: st,
				tx: a,
			});
		},
	});
}

/** 弓なり戻り — the line appears drawn like a bow and is let go: it whips straight. */
function drawKzBowSnap(options: EnterBDraw): void {
	const geo = geoOf(options);
	const p = options.frame.enterProgress;
	const B = geo.box;
	const half = (B.x1 - B.x0) / 2;
	const sg = enterBDirection(options, 823);
	const A =
		Math.min(options.size * 1.5, frameHeightOf(options) * 0.2) *
		sg *
		spring1((p - 0.14) / 0.86, 2.1, 3.2);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const u = Math.min(Math.max((glyph.x - B.cx) / half, -1), 1);
			const al = clamp01((p * 1.8 - Math.abs(u) * 0.22) * 8);
			if (al <= 0) return null;
			const d = A * (1 - u * u);
			const sl = Math.atan((2 * u * A) / half) / (PI / 180);
			return { alpha: al, rotation: degrees(sl), translateY: -d };
		},
	});
}

export function drawX2KineticEnter(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "kzBowSnap":
			drawKzBowSnap(options);
			return true;
		case "kzOverrun":
			drawKzOverrun(options);
			return true;
		case "kzPunchThrough":
			drawKzPunchThrough(options);
			return true;
		case "kzSeesaw":
			drawKzSeesaw(options);
			return true;
		case "kzSideVolley":
			drawKzSideVolley(options);
			return true;
		case "kzSkipStone":
			drawKzSkipStone(options);
			return true;
		case "kzTowerUnstack":
			drawKzTowerUnstack(options);
			return true;
		case "kzTrampoline":
			drawKzTrampoline(options);
			return true;
		case "kzWordWheel":
			drawKzWordWheel(options);
			return true;
		default:
			return false;
	}
}

// ============================================================================ EXITS

/** 打ち飛ばし — the line takes a hit on one end, then sails off tumbling end over end. */
function drawKzBatAway(options: EnterBDraw): void {
	const geo = geoOf(options);
	const p = options.frame.exitProgress;
	const B = geo.box;
	const sg = enterBDirection(options, 831);
	const T = 0.16;
	const acc = options.frame.palette.accent;
	const gone = p >= 0.999;
	let spec: RigidSpec;
	if (p < T) {
		const bl = bell(p / T);
		spec = {
			px: B.cx,
			py: B.cy,
			color: p > T * 0.35 ? acc : undefined,
			sx: 1 - 0.16 * bl,
			sy: 1 + 0.1 * bl,
			tx: sg * options.size * 0.14 * bl,
		};
	} else {
		const t = (p - T) / (1 - T);
		const e = t ** 0.85;
		spec = {
			a: 1 - smoothRange(0.72, 1, t),
			px: B.cx,
			py: B.cy,
			rot: sg * 230 * e,
			s: 1 - 0.35 * e,
			tx: sg * frameWidthOf(options) * e,
			ty:
				-frameHeightOf(options) * 0.55 * e +
				frameHeightOf(options) * 0.5 * e * e,
		};
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (geo.wordOf[glyph.index] === undefined) return undefined;
			if (gone) return null;
			return rigid(glyph, null, spec);
		},
	});
}

/** 引っこ抜き — the words are stretched and snatched off sideways, the last word first. */
function drawKzYankOut(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.exitProgress;
	const sp = n > 1 ? 0.55 : 0;
	const d0 = enterBDirection(options, 833);
	const D = frameWidthOf(options) * 1.1;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const r = n - 1 - j;
			const q = stgOf(p, r, n, sp);
			if (q >= 1) return null;
			if (q <= 0) return undefined;
			const b = geo.words[j]!;
			const sg = r % 2 ? -d0 : d0;
			let st: number;
			let a = 0;
			let al = 1;
			if (q < 0.4) {
				st = 1 + 0.55 * outCubic(q / 0.4);
			} else {
				const t = (q - 0.4) / 0.6;
				st = 1.55 + 0.9 * t;
				a = sg * D * 1.2 * t ** 1.7;
				al = 1 - smoothRange(0.7, 1, t);
			}
			return rigid(glyph, b, {
				a: al,
				px: sg > 0 ? b.x0 : b.x1,
				sx: st,
				tx: a,
			});
		},
	});
}

/** 振って放る — the line swings from a point above it and is let go at full speed. */
function drawKzSwingFling(options: EnterBDraw): void {
	const geo = geoOf(options);
	const p = options.frame.exitProgress;
	const B = geo.box;
	const sg = enterBDirection(options, 835);
	const L = 3.2;
	const T = 0.66;
	const gone = p >= 0.999;
	let spec: RigidSpec;
	if (p < T) {
		const u = p / T;
		spec = {
			px: B.cx,
			py: B.y0 - L * options.size,
			rot: sg * 24 * u ** 1.3 * Math.sin(TAU * 1.5 * u),
		};
	} else {
		const t = (p - T) / (1 - T);
		const v0 = 6.5 * options.size;
		spec = {
			a: 1 - smoothRange(0.78, 1, t),
			px: B.cx,
			py: B.cy,
			rot: -sg * (116 * t + 70 * t * t),
			tx: sg * (v0 * t + Math.max(0, frameWidthOf(options) * 1.15 - v0) * t * t),
			ty:
				-options.size * 1.6 * t +
				(frameHeightOf(options) * 0.45 + options.size * 1.6) * t * t,
		};
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (geo.wordOf[glyph.index] === undefined) return undefined;
			if (gone) return null;
			return rigid(glyph, null, spec);
		},
	});
}

/** 屈んで飛び込む — word after word crouches flat, springs up and dives straight down. */
function drawKzCrouchDive(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.exitProgress;
	const sp = n > 1 ? 0.4 : 0;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const q = stgOf(p, j, n, sp);
			if (q >= 1) return null;
			if (q <= 0) return undefined;
			const b = geo.words[j]!;
			if (q < 0.3) {
				const c = outCubic(q / 0.3);
				return rigid(glyph, b, {
					py: b.y1,
					sx: 1 + 0.31 * c,
					sy: 1 - 0.42 * c,
				});
			}
			const t = (q - 0.3) / 0.7;
			const v = 7 * options.size;
			const accel = Math.max(17.5 * options.size, frameHeightOf(options) * 1.2 + v);
			const sy = 0.58 + 0.8 * outCubic(clamp01(t / 0.12));
			return rigid(glyph, b, {
				a: 1 - smoothRange(0.7, 1, t),
				py: b.y1,
				sx: 1 / Math.sqrt(sy),
				sy,
				ty: -v * t + accel * t * t,
			});
		},
	});
}

/** 引き絞り発射 — the middle of the line is drawn back like a catapult band and fired. */
function drawKzSlingAway(options: EnterBDraw): void {
	const geo = geoOf(options);
	const p = options.frame.exitProgress;
	const B = geo.box;
	const half = (B.x1 - B.x0) / 2;
	const sg = enterBDirection(options, 837);
	const T = 0.58;
	let A: number;
	let shoot = 0;
	let st = 1;
	let al = 1;
	if (p < T) {
		const c = inOutSine(p / T);
		A = options.size * 1.25 * c * (1 + 0.035 * Math.sin(p * 90) * c);
	} else {
		const t = (p - T) / (1 - T);
		A = options.size * 1.25 * lerpN(1, -0.55, outCubic(clamp01(t * 3.5)));
		shoot = frameHeightOf(options) * 1.3 * t ** 1.5;
		st = 1 + 0.5 * t;
		al = 1 - smoothRange(0.8, 1, t);
	}
	const gone = p >= 0.999;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (geo.wordOf[glyph.index] === undefined) return undefined;
			if (gone) return null;
			const u = Math.min(Math.max((glyph.x - B.cx) / half, -1), 1);
			const d = sg * (A * (1 - u * u) - shoot);
			const sl = Math.atan((-2 * u * sg * A) / half) / (PI / 180);
			return { alpha: al, rotation: degrees(sl), scaleY: st, translateY: d };
		},
	});
}

/** 打ち込み — the words are hammered into the floor like nails: three blows each. */
function drawKzHammerDown(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.exitProgress;
	const sp = n > 1 ? 0.4 : 0;
	const gap = (1 - sp) / 3.4;
	const secs = durOf(options, 0.38, 0.36, 0.9);
	// eslint-disable-next-line opencut/prefer-object-params
	const hit = (j: number, m: number): number =>
		(n > 1 ? j / (n - 1) : 0) * sp + m * gap + 0.02;
	const depth: number[] = [];
	let jolt = 0;
	for (let j = 0; j < n; j++) {
		let d = 0;
		for (let m = 0; m < 3; m++) {
			d += oExpo((p - hit(j, m)) / 0.07);
			if (j < 12) {
				jolt += Math.abs(kick((p - hit(j, m)) * secs, 13, 38));
			}
		}
		depth.push(d / 3);
	}
	jolt = Math.min(1.2, jolt) * options.size * 0.07;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const d = depth[j]!;
			if (d >= 0.999) return null;
			if (d <= 0) return jolt > 0.3 ? { translateY: -jolt } : undefined;
			const b = geo.words[j]!;
			const ty = d * (b.y1 - b.y0) * 1.06;
			const floor = b.y1 + options.size * 0.06;
			const c1 = (floor - (glyph.y + ty)) / Math.max(1, glyph.height);
			if (c1 <= -0.6) return null;
			return { clipY: [-0.95, Math.min(0.95, c1)], translateY: ty };
		},
	});
}

/** 激突して散る — the words rush together, crash in the middle with a flash, and ricochet. */
function drawKzCrashApart(options: EnterBDraw): void {
	const geo = geoOf(options);
	const n = geo.words.length;
	const p = options.frame.exitProgress;
	const B = geo.box;
	const T = 0.36;
	const acc = options.frame.palette.accent;
	const sd = options.frame.cut?.seed ?? 0;
	const far = Math.max(frameWidthOf(options), frameHeightOf(options)) * 0.8;
	const gone = p >= 0.999;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			if (gone) return null;
			const b = geo.words[j]!;
			const hx = (B.cx - b.cx) * 0.8;
			const hy = (B.cy - b.cy) * 0.8;
			if (p < T) {
				const c = inCubic(p / T);
				return rigid(glyph, b, { s: 1 - 0.12 * c, tx: hx * c, ty: hy * c });
			}
			const t = (p - T) / (1 - T);
			const e = outCubic(t);
			const tw = j % 2 ? 1 : -1;
			const ang =
				n > 1
					? Math.atan2(b.cy - B.cy, b.cx - B.cx) +
						tw * (0.45 + 0.5 * randomUnit(sd, j, 3))
					: TAU * randomUnit(sd, glyph.index, 5);
			return rigid(glyph, b, {
				a: 1 - smoothRange(0.55, 1, t),
				color: t < 0.16 ? acc : undefined,
				rot: tw * 250 * e,
				s: 0.88 + 0.3 * bell(t * 2.5),
				tx: hx + Math.cos(ang) * far * e,
				ty: hy + Math.sin(ang) * far * e,
			});
		},
	});
}

/** 細めて発射 — the line is pinched into one thin tall sliver that shoots out of frame. */
function drawKzPinchShoot(options: EnterBDraw): void {
	const geo = geoOf(options);
	const p = options.frame.exitProgress;
	const B = geo.box;
	const sg = enterBDirection(options, 841);
	const T = 0.44;
	let c: number;
	let shoot = 0;
	let lng: number;
	let al = 1;
	if (p < T) {
		const t = p / T;
		c = t < 0.25 ? -0.07 * Math.sin((PI * t) / 0.25) : inOutCubic((t - 0.25) / 0.75);
		lng = 1 + 0.3 * Math.max(0, c);
	} else {
		const t = (p - T) / (1 - T);
		c = 1;
		shoot = frameHeightOf(options) * 1.3 * t ** 1.6;
		lng = 1.3 + 1.7 * t;
		al = 1 - smoothRange(0.7, 1, t);
	}
	const thin = 1 - 0.93 * c;
	const gone = p >= 0.999;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (geo.wordOf[glyph.index] === undefined) return undefined;
			if (gone) return null;
			return {
				alpha: al,
				scaleX: thin,
				scaleY: lng,
				translateX: (glyph.x - B.cx) * (thin - 1),
				translateY: -sg * shoot,
			};
		},
	});
}

export function drawX2KineticExit(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "kzBatAway":
			drawKzBatAway(options);
			return true;
		case "kzCrashApart":
			drawKzCrashApart(options);
			return true;
		case "kzCrouchDive":
			drawKzCrouchDive(options);
			return true;
		case "kzHammerDown":
			drawKzHammerDown(options);
			return true;
		case "kzPinchShoot":
			drawKzPinchShoot(options);
			return true;
		case "kzSlingAway":
			drawKzSlingAway(options);
			return true;
		case "kzSwingFling":
			drawKzSwingFling(options);
			return true;
		case "kzYankOut":
			drawKzYankOut(options);
			return true;
		default:
			return false;
	}
}

// ============================================================================ HOLDS

/** Hold amount: JIZURA `amt * (0.4 + mot)` with the default motion of 0.7. */
const HOLD_AMOUNT = 1.1;

/** つぶれ波 — a bump runs along the line under the letters, pressing each flat. */
function drawKzSquashWave(options: EnterBDraw): void {
	const geo = geoOf(options);
	const M = HOLD_AMOUNT;
	if (M < 0.01) return;
	const t = secondsOf(options.frame);
	const start = geo.box.x0;
	const len = Math.max(1e-3, geo.box.x1 - geo.box.x0);
	const per = 1.7;
	const fr = ((t % per) + per) % per / per;
	const xw = start - 2 + fr * (len + 4);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const d = glyph.x - xw;
			const b0 = Math.exp((-d * d) / 0.8);
			const b1 =
				Math.exp((-((d - 1.5) ** 2)) / 0.9) + Math.exp((-((d + 1.5) ** 2)) / 0.9);
			const sy = 1 - 0.32 * M * b0 + 0.1 * M * b1;
			if (Math.abs(sy - 1) < 0.004) return undefined;
			return {
				scaleX: 1 + 0.2 * M * b0 - 0.04 * M * b1,
				scaleY: sy,
				translateY: (glyph.height * (1 - sy)) / 2,
			};
		},
	});
}

/** 慣性ゆれ — the line shuttles to and fro; the words follow like wagons. */
function drawKzInertiaSway(options: EnterBDraw): void {
	const geo = geoOf(options);
	const M = HOLD_AMOUNT;
	if (M < 0.01) return;
	const t = secondsOf(options.frame);
	const w = TAU * 0.42;
	const A = options.size * 0.2 * M;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const ph = w * (t - j * 0.15);
			const off = A * Math.sin(ph);
			const v = Math.cos(ph);
			return { skewX: degrees(6.5 * M * v), translateX: off };
		},
	});
}

/** 飛び込み板 — the line is a springboard fixed at one end, flicked every beat. */
function drawKzDivingBoard(options: EnterBDraw): void {
	const geo = geoOf(options);
	const M = HOLD_AMOUNT;
	const t = secondsOf(options.frame);
	const s0 = beatSince(t, 1.15);
	const A = options.size * 0.45 * M * Math.exp(-s0 * 2.5) * Math.sin(s0 * 12.5);
	if (Math.abs(A) < 0.25) {
		drawX2Glyphs({ options, resolve: () => undefined });
		return;
	}
	const start = geo.box.x0;
	const len = Math.max(1e-3, geo.box.x1 - geo.box.x0);
	const end = enterBDirection(options, 851) > 0;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			let v = clamp01((glyph.x - start) / len);
			if (end) v = 1 - v;
			const d = A * v * v;
			const sl = Math.atan(((2 * A * v) / len) * (end ? -1 : 1)) / (PI / 180);
			return { rotation: degrees(sl), translateY: d };
		},
	});
}

/** 疎密パルス — a push travels down the line like along a slinky. */
function drawKzSlinky(options: EnterBDraw): void {
	const geo = geoOf(options);
	const M = HOLD_AMOUNT;
	const t = secondsOf(options.frame);
	const s0 = beatSince(t, 0.95);
	const fr = s0 / 0.5;
	if (M < 0.01 || fr > 1.5) {
		drawX2Glyphs({ options, resolve: () => undefined });
		return;
	}
	const start = geo.box.x0;
	const len = Math.max(1e-3, geo.box.x1 - geo.box.x0);
	const fwd = beatIndex(t, 0.95) % 2 === 0;
	const xp = fwd
		? start - 1 + fr * (len + 2)
		: start + len + 1 - fr * (len + 2);
	const A = options.size * 0.3 * M * (fwd ? 1 : -1) * clamp01((1.5 - fr) * 2.5);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const d = (glyph.x - xp) / 1.25;
			const u = A * Math.exp(-d * d);
			if (Math.abs(u) < 0.3) return undefined;
			return { translateX: u };
		},
	});
}

/** 拍で屈伸 — on every beat the words bend their knees, one a moment after the other. */
function drawKzBeatSquat(options: EnterBDraw): void {
	const geo = geoOf(options);
	const M = HOLD_AMOUNT;
	const t = secondsOf(options.frame);
	const s0Base = beatSince(t, 0.6);
	if (M < 0.01) return;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0) return undefined;
			const s = s0Base - Math.min(j, 6) * 0.045;
			if (s < 0) return undefined;
			const v = 0.2 * M * Math.exp(-s * 4.2) * Math.cos(s * 13);
			if (Math.abs(v) < 0.003) return undefined;
			const b = geo.words[j]!;
			return rigid(glyph, b, {
				py: b.y1,
				sx: 1 + v * 0.5,
				sy: 1 - v,
			});
		},
	});
}

export function drawX2KineticHold(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "kzBeatSquat":
			drawKzBeatSquat(options);
			return true;
		case "kzDivingBoard":
			drawKzDivingBoard(options);
			return true;
		case "kzInertiaSway":
			drawKzInertiaSway(options);
			return true;
		case "kzSlinky":
			drawKzSlinky(options);
			return true;
		case "kzSquashWave":
			drawKzSquashWave(options);
			return true;
		default:
			return false;
	}
}

// ============================================================================ TREATMENTS

const TREAT_PUNCT =
	/[、。,.!?:;…‥「」『』（）()[\]［］〈〉《》・ー\-–—]/u;

/** Treatment entry progress: in over 0.4s, out with the exit window. */
function treatAmount(options: EnterBDraw): number {
	return (
		oBack(clamp01((options.frame.enterProgress - 0.05) / 0.4), 1.8) *
		(1 - inCubic(options.frame.exitProgress))
	);
}

/**
 * 流線影 — the glyphs drag a shadow of thin speed lines behind them, seen
 * through a comb. The copies are whole-item redraws clipped to the comb.
 */
function drawKzSpeedShadow(options: EnterBDraw): void {
	const amount =
		outCubic(clamp01((secondsOf(options.frame) - 0.02) / 0.4)) *
		(1 - inCubic(options.frame.exitProgress));
	if (amount < 0.02) {
		drawX2Glyphs({ options, resolve: () => undefined });
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const n = 3 + (randomUnit(seed, 8801) < 0.5 ? 0 : 1);
	const d = 0.36 + randomUnit(seed, 8802) * 0.16;
	const gp = 0.17 + randomUnit(seed, 8803) * 0.04;
	const tc = options.frame.palette.accent;
	const s = options.size;
	const L = s * d * amount;
	const th = s * 0.07;
	const gap = s * gp;
	const bounds = x2Bounds(options);
	const ex = bounds.width / 2 + L + s;
	const ey = bounds.height / 2 + L + s;
	const { ctx } = options;
	ctx.save();
	ctx.translate(options.x, options.y);
	ctx.beginPath();
	let strips = 0;
	for (let y = -ey + gap * 0.35; y < ey && strips < 200; y += gap, strips++) {
		ctx.rect(-ex, y, ex * 2, th);
	}
	ctx.clip();
	ctx.translate(-options.x, -options.y);
	for (let copy = n; copy >= 1; copy--) {
		const o = (L * copy) / n;
		drawEnterBWhole({
			alpha: 1 - (0.7 * (copy - 1)) / Math.max(1, n - 1),
			color: tc,
			options,
			translateX: -o,
		});
	}
	ctx.restore();
	drawX2Glyphs({ options, resolve: () => undefined });
}

/**
 * 前コマ残し — two outline drawings of the line stay behind it, tipped back
 * about its foot like the previous frames of a swing.
 */
function drawKzOnionSkin(options: EnterBDraw): void {
	const amount = treatAmount(options);
	const seed = options.frame.cut?.seed ?? 0;
	const r0 = (2.6 + randomUnit(seed, 8811) * 1.2) * (randomUnit(seed, 8812) < 0.5 ? 1 : -1);
	const n = randomUnit(seed, 8813) < 0.66 ? 2 : 3;
	if (amount <= 0.01) {
		drawX2Glyphs({ options, resolve: () => undefined });
		return;
	}
	const tc = options.frame.palette.accent;
	const bounds = x2Bounds(options);
	const t = secondsOf(options.frame);
	const th =
		r0 * amount * (0.9 + 0.1 * Math.sin(t * 2.6)) * (PI / 180);
	const { ctx } = options;
	for (let copy = 1; copy <= n; copy++) {
		const share = copy / n;
		const px = th > 0 ? bounds.left : bounds.right;
		const py = bounds.bottom;
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(th * share);
		ctx.translate(-px, -py);
		for (const glyph of enterBGlyphs(options)) {
			drawExitHoldOutline({
				alpha: 0.85 * 0.62 ** (copy - 1),
				color: tc,
				glyph,
				lineWidth: Math.max(1, options.size * 0.03),
				options,
			});
		}
		ctx.restore();
	}
	drawX2Glyphs({ options, resolve: () => undefined });
}

/** 加速組み — the glyphs grow steadily along the line, as if gathering speed. */
function drawKzCrescendo(options: EnterBDraw): void {
	const glyphs = enterBGlyphs(options);
	if (glyphs.length < 2) {
		drawX2Glyphs({ options, resolve: () => undefined });
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const kk = 0.34 + randomUnit(seed, 8821) * 0.12;
	const rev = randomUnit(seed, 8822) < 0.22;
	const m = glyphs.length;
	const first = glyphs[0]!;
	const last = glyphs[m - 1]!;
	const a0 = first.x - first.width / 2;
	const a1 = last.x + last.width / 2;
	const old = a1 - a0;
	const sc0 = (q: number): number => {
		const u = q / (m - 1);
		return lerpN(1 - kk * 0.55, 1 + kk * 0.45, rev ? 1 - u : u);
	};
	let tot = 0;
	glyphs.forEach((glyph) => {
		tot += glyph.width * sc0(glyph.index);
	});
	const norm = Math.min(1, old / Math.max(1e-6, tot));
	const np: number[] = [];
	let pos = 0;
	glyphs.forEach((glyph, q) => {
		const adv = glyph.width * sc0(q) * norm;
		if (q > 0) {
			const prev = glyphs[q - 1]!;
			pos += (glyph.x - glyph.width / 2) - (prev.x + prev.width / 2);
		}
		np.push(pos + adv / 2);
		pos += adv;
	});
	const start = a0 + (old - pos) / 2;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const s = sc0(glyph.index) * norm;
			return {
				scaleX: s,
				scaleY: s,
				translateX: start + np[glyph.index]! - glyph.x,
				translateY: (1 - s) * 0.36 * options.size,
			};
		},
	});
}

/** 跳ね組み — every word is set along the arc of a hop: rise, tip over the top, come down. */
function drawKzHopArc(options: EnterBDraw): void {
	const geo = geoOf(options);
	const seed = options.frame.cut?.seed ?? 0;
	const hh = 0.17 + randomUnit(seed, 8831) * 0.08;
	const tl = 9 + randomUnit(seed, 8832) * 5;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const j = geo.wordOf[glyph.index] ?? -1;
			if (j < 0 || TREAT_PUNCT.test(glyph.character)) return undefined;
			const word = geo.words[j]!;
			if (word.count < 2) return undefined;
			const u =
				0.12 + (0.76 * (geo.inWord[glyph.index] ?? 0)) / (word.count - 1);
			const lift =
				(Math.sin(PI * u) - 0.55) *
				hh *
				options.size *
				Math.min(1, 0.55 + word.count * 0.15);
			const rot = -Math.cos(PI * u) * tl;
			return { rotation: degrees(-rot), translateY: -lift };
		},
	});
}

/**
 * 段々斜体 — the line is cut into level strips, each pushed a step further
 * forward: an italic made of stairs. Bands are clip rows over one redraw.
 */
function drawKzStepShear(options: EnterBDraw): void {
	const amount = treatAmount(options);
	if (Math.abs(amount) < 0.02) {
		drawX2Glyphs({ options, resolve: () => undefined });
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const n = pickBandCount(seed);
	const dir = randomUnit(seed, 8842) < 0.66 ? 1 : -1;
	const d = 0.05 + randomUnit(seed, 8843) * 0.025;
	const bounds = x2Bounds(options);
	const lead = bounds.height;
	const { ctx } = options;
	const x0 = options.x - options.maxWidth / 2 - options.size;
	const bandWidth = options.maxWidth + options.size * 2;
	for (let band = 0; band < n; band++) {
		const top = bounds.top + (band * lead) / n;
		const dx = dir * d * options.size * amount * ((n - 1) / 2 - band);
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0, top, bandWidth, lead / n + 1);
		ctx.clip();
		ctx.translate(dx, 0);
		drawX2Glyphs({ options, resolve: () => undefined });
		ctx.restore();
	}
}

function pickBandCount(seed: number): number {
	const roll = randomUnit(seed, 8841);
	if (roll < 0.25) return 3;
	if (roll < 0.75) return 4;
	return 5;
}

export function drawX2KineticTreat(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "kzCrescendo":
			drawKzCrescendo(options);
			return true;
		case "kzHopArc":
			drawKzHopArc(options);
			return true;
		case "kzOnionSkin":
			drawKzOnionSkin(options);
			return true;
		case "kzSpeedShadow":
			drawKzSpeedShadow(options);
			return true;
		case "kzStepShear":
			drawKzStepShear(options);
			return true;
		default:
			return false;
	}
}

// ============================================================================ CAMERAS

/** Camera motion scale: JIZURA `KM(env)` with the default motion amount 0.7. */
const CAMERA_MOTION = Math.min(1, 0.7 * 1.25);

/** Camera options mirror kinetic-cameras.ts (`resolveKineticCamera`). */
export interface X2KineticCameraDraw {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}

/** Word onsets of a cut in seconds (JIZURA `wordTimes`, no beat lock). */
function camWordTimes(cut: MotionTextResolvedCut): number[] {
	const duration = cut.duration / 120_000;
	let n = Math.max(
		1,
		Math.min(6, kineticWordSegments({ text: cut.text }).length || 1),
	);
	if (n < 2 && duration > 1.2) n = 2;
	const last = Math.max(0, Math.min(duration * 0.5, (n - 1) * 0.38));
	return Array.from(
		{ length: n },
		(_, index) => (n > 1 ? (last * index) / (n - 1) : 0),
	);
}

/** 被弾の反動 — the cut opens as if the frame had just been struck. */
function kzRecoil({ cut, localTime }: X2KineticCameraDraw): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const lt = localTime / 120_000;
	const ts = camWordTimes(cut);
	const angle = randomUnit(cut.seed, 8601) * TAU;
	const roll = (2.4 + randomUnit(cut.seed, 8602) * 1.1) * (randomUnit(cut.seed, 8603) < 0.5 ? 1 : -1);
	const ca = Math.cos(angle);
	const sa = Math.sin(angle);
	let x = 0;
	let y = 0;
	let rot = 0;
	let z = 0;
	for (let index = 0; index < ts.length && index < 6; index++) {
		const d = lt - ts[index]!;
		if (d < 0) break;
		const g = index === 0 ? 1 : 0.36;
		const sg = index % 2 ? -1 : 1;
		const r = Math.exp(-d * 7.5) * Math.cos(d * 19);
		x += sg * ca * g * r;
		y += sg * sa * g * r;
		rot += sg * g * Math.exp(-d * 6.5) * Math.cos(d * 15);
		z += g * Math.exp(-d * 9);
	}
	return {
		blur: 5 * K * Math.exp(-lt * 14),
		rotation: degrees(Math.min(Math.max(rot, -1.2), 1.2) * roll * K),
		scale: 1.03 + 0.045 * K * Math.min(1, z),
		translateX: Math.min(Math.max(x, -1), 1) * 0.042 * K,
		translateY: Math.min(Math.max(y, -1), 1) * 0.036 * K,
	};
}

/** ノックバック — the frame is punched away from the viewer, springs back, settles. */
function kzKnockback({
	cut,
	localTime,
}: X2KineticCameraDraw): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const lt = localTime / 120_000;
	const roll = randomSigned(cut.seed, 8611) * 1.6;
	const z = 0.06 + randomUnit(cut.seed, 8612) * 0.015;
	const a = 0.07;
	const kb =
		lt < a ? outCubic(lt / a) : Math.exp(-(lt - a) * 6) * Math.cos((lt - a) * 13.5);
	const duration = cut.duration / 120_000;
	const drift = 0.02 * clamp01((lt - 0.6) / Math.max(0.6, duration - 0.6));
	return {
		blur: 6 * K * Math.max(0, kb) * Math.exp(-lt * 9),
		rotation: degrees(roll * K * kb),
		scale: 1 - z * K * kb + drift,
	};
}

/** 語でうなずく — the camera nods once for every word: a quick dip, up again. */
function kzWordNod({ cut, localTime }: X2KineticCameraDraw): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const lt = localTime / 120_000;
	const ts = camWordTimes(cut);
	const a = 0.018 + randomUnit(cut.seed, 8621) * 0.008;
	const up = randomUnit(cut.seed, 8622) < 0.25;
	const nod = (d: number): number =>
		d < 0 ? 0 : d < 0.08 ? outCubic(d / 0.08) : Math.exp(-(d - 0.08) * 8) * Math.cos((d - 0.08) * 14);
	let v = 0;
	for (let index = 0; index < ts.length && index < 6; index++) {
		v += (index === 0 ? 0.6 : 1) * nod(lt - ts[index]!);
	}
	v = Math.min(Math.max(v, -1), 1.2);
	return {
		scale: 1.02 + 0.02 * K * Math.max(0, v),
		scaleY: 1 - 0.012 * K * v,
		translateY: (up ? -1 : 1) * a * K * v,
	};
}

/** 横滑り停止 — the frame slides in sideways, sheared by its speed, brakes hard. */
function kzSkidStop({ cut, localTime }: X2KineticCameraDraw): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const lt = localTime / 120_000;
	const dir = randomUnit(cut.seed, 8631) < 0.5 ? -1 : 1;
	const a = 0.04 + randomUnit(cut.seed, 8632) * 0.01;
	const T = 0.46;
	const rem = 1 - outCubic(clamp01(lt / T));
	const d = lt - T * 0.8;
	const back = d > 0 ? Math.exp(-d * 8) * Math.sin(d * 19) : 0;
	return {
		blur: 4 * K * rem * rem,
		scale: 1.02,
		scaleX: 1 + 0.04 * K * rem,
		skewX: degrees(dir * K * (7 * rem ** 0.7 - 3 * back)),
		translateX: -dir * a * K * rem,
	};
}

/**
 * Camera resolver mirroring kinetic-cameras.ts: returns the transform for the
 * cut's x2 cam preset, or null when the preset is not one of ours.
 */
export function drawX2KineticCam(
	options: X2KineticCameraDraw,
): KineticCameraTransform | null {
	switch (options.cut.preset.cam) {
		case "kzKnockback":
			return kzKnockback(options);
		case "kzRecoil":
			return kzRecoil(options);
		case "kzSkidStop":
			return kzSkidStop(options);
		case "kzWordNod":
			return kzWordNod(options);
		default:
			return null;
	}
}

// ============================================================================ FX

/** Event seed: changes every millisecond of sequence time (JIZURA `evS`). */
function fxEventSeed(options: LooksPixelEffectDraw): number {
	return x2Hash(Math.round(secondsOf(options.frame) * 1000), 6841);
}

/** JIZURA `J.rr(a, b, s, i, salt)`: seeded range pick. */
// eslint-disable-next-line opencut/prefer-object-params
function rrOf(
	from: number,
	to: number,
	seed: number,
	index: number,
	salt: number,
): number {
	return from + randomUnit(seed, index, salt) * (to - from);
}

function fxPopColor(options: LooksPixelEffectDraw): string {
	return options.frame.palette.accent;
}

function isDarkColor(color: string): boolean {
	const hex = /^#([\da-f]{6})$/iu.exec(color)?.[1];
	if (!hex) return true;
	const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
	const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
	const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

/** 1 at q=0, swings through zero and dies out at q=1 (JIZURA `ring`). */
// eslint-disable-next-line opencut/prefer-object-params
function ring(q: number, turns = 1.5, k = 3.2): number {
	return Math.exp(-k * q) * Math.cos(q * TAU * turns) * (1 - q);
}

function fxFillBackground(options: LooksPixelEffectDraw): void {
	fillLooksEffectRect({
		alpha: 1,
		color: options.frame.palette.background,
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
}

/**
 * Recompose the frame the way the JIZURA fx do: reset the transform, lay the
 * background under the captured picture, then draw. Unlike the fx-b frame
 * replacer this never clears — in overlay composition the background rides
 * source-atop on the existing ink.
 */
// eslint-disable-next-line opencut/prefer-object-params
function fxBaseline(options: LooksPixelEffectDraw, draw: () => void): void {
	const { ctx } = options;
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	fxFillBackground(options);
	draw();
	ctx.restore();
}

/** 端からの一撃 — something hits the frame from one edge: spikes burst inward. */
function drawKzEdgeHit(options: LooksPixelEffectDraw): void {
	const { ctx, height: ch, source, width: cw } = options;
	const s = fxEventSeed(options);
	const M = Math.min(cw, ch);
	const side = x2Hash(s, 1) % 4;
	const u = 0.3 + 0.4 * randomUnit(s, 2);
	const hx = side === 0 ? 0 : side === 1 ? cw : cw * u;
	const hy = side === 2 ? 0 : side === 3 ? ch : ch * u;
	const nx = side === 0 ? 1 : side === 1 ? -1 : 0;
	const ny = side === 2 ? 1 : side === 3 ? -1 : 0;
	const k = fxBPhase(options);
	const rec =
		(k < 0.14 ? oExpo(k / 0.14) : ring((k - 0.14) / 0.86)) * M * 0.035;
	fxBaseline(options, () => {
		ctx.drawImage(source, Math.round(nx * rec), Math.round(ny * rec));
	});
	const g = k < 0.22 ? oExpo(k / 0.22) : 1;
	const out = outCubic(clamp01((k - 0.18) / 0.82));
	const n = 9;
	const base = Math.atan2(ny, nx);
	const pc = fxPopColor(options);
	for (let index = 0; index < n; index++) {
		const an =
			base +
			((index + 0.5) / n - 0.5) * 2.5 +
			randomSigned(s, index, 3) * 0.08;
		const len = M * rrOf(0.2, 0.48, s, index, 4) * g;
		const r0 = M * 0.03 + len * 1.1 * out;
		const r1 = r0 + len * (1 - out);
		const w = M * rrOf(0.012, 0.028, s, index, 5) * (1 - out);
		if (r1 - r0 < 1 || w < 0.4) continue;
		const c = Math.cos(an);
		const sn = Math.sin(an);
		ctx.fillStyle = index % 3 === 1 ? options.frame.palette.foreground : pc;
		if (ctx.moveTo && ctx.lineTo && ctx.fill && ctx.closePath && ctx.beginPath) {
			ctx.beginPath();
			ctx.moveTo(hx + c * r0 - sn * w, hy + sn * r0 + c * w);
			ctx.lineTo(hx + c * r0 + sn * w, hy + sn * r0 - c * w);
			ctx.lineTo(hx + c * r1, hy + sn * r1);
			ctx.closePath();
			ctx.fill();
		}
	}
	const fr = M * 0.06 * g * (1 - out);
	if (fr > 0.5) {
		const baseAlpha = ctx.globalAlpha;
		ctx.fillStyle = options.frame.palette.foreground;
		if (ctx.beginPath && ctx.arc && ctx.fill) {
			ctx.beginPath();
			ctx.arc(hx, hy, fr, 0, TAU);
			ctx.fill();
		}
		ctx.globalAlpha = baseAlpha;
	}
}

/** 小突きスミア — the picture is knocked sideways and drags a smear of itself. */
function drawKzKnockSmear(options: LooksPixelEffectDraw): void {
	const { ctx, height: ch, source, width: cw } = options;
	const s = fxEventSeed(options);
	const vert = cw < ch ? randomUnit(s, 1) < 0.5 : randomUnit(s, 1) < 0.2;
	const dir = randomUnit(s, 2) < 0.5 ? 1 : -1;
	const L = vert ? ch : cw;
	const k = fxBPhase(options);
	const v =
		k < 0.16 ? oExpo(k / 0.16) : ring((k - 0.16) / 0.84, 1.5, 2.6);
	const o = Math.round(dir * L * 0.065 * v);
	if (Math.abs(o) < 1) return;
	fxBaseline(options, () => {
		ctx.drawImage(source, vert ? 0 : o, vert ? o : 0);
		ctx.globalCompositeOperation = isDarkColor(options.frame.palette.background)
			? "lighten"
			: "darken";
		const n = 6;
		for (let index = 1; index < n; index++) {
			const f = index / n;
			const q = Math.round(o * (1 - f * 1.6));
			ctx.globalAlpha = 0.42 * (1 - f);
			ctx.drawImage(source, vert ? 0 : q, vert ? q : 0);
		}
	});
}

/** 浮かせて叩く — the picture is lifted off the page as a card, then slapped back down. */
function drawKzCardSlam(options: LooksPixelEffectDraw): void {
	const { ctx, height: ch, source, width: cw } = options;
	const s = fxEventSeed(options);
	const M = Math.min(cw, ch);
	const k = fxBPhase(options);
	if (k >= 0.68) {
		const q = (k - 0.68) / 0.32;
		const z = 1 + 0.035 * ring(q, 1.5, 3);
		if (Math.abs(z - 1) < 0.0015) return;
		fxBaseline(options, () => {
			ctx.drawImage(
				source,
				cw / 2 - (cw * z) / 2,
				ch / 2 - (ch * z) / 2,
				cw * z,
				ch * z,
			);
		});
		return;
	}
	const lift =
		k < 0.28
			? oBack(k / 0.28, 1.8)
			: k < 0.56
				? 1
				: 1 - inCubic((k - 0.56) / 0.12);
	if (lift < 0.004) return;
	const z = 1 - 0.11 * lift;
	const d = M * 0.035 * lift;
	const sg = randomUnit(s, 1) < 0.5 ? 1 : -1;
	fxBaseline(options, () => {
		const baseAlpha = ctx.globalAlpha;
		ctx.fillStyle = "#000";
		ctx.globalAlpha = baseAlpha * 0.28 * clamp01(lift);
		ctx.fillRect(0, 0, cw, ch);
		ctx.globalAlpha = baseAlpha;
		ctx.translate(cw / 2, ch / 2);
		ctx.rotate(degrees(-1.6 * sg * lift));
		ctx.fillStyle = fxPopColor(options);
		ctx.fillRect((-cw * z) / 2 + d * sg, (-ch * z) / 2 + d, cw * z, ch * z);
		ctx.drawImage(source, (-cw * z) / 2, (-ch * z) / 2, cw * z, ch * z);
		ctx.strokeStyle = options.frame.palette.foreground;
		ctx.globalAlpha = baseAlpha * 0.6 * clamp01(lift);
		ctx.lineWidth = Math.max(1, M * 0.003);
		if (ctx.beginPath && ctx.moveTo && ctx.lineTo && ctx.closePath && ctx.stroke) {
			ctx.beginPath();
			ctx.rect((-cw * z) / 2, (-ch * z) / 2, cw * z, ch * z);
			ctx.stroke();
		}
	});
}

/** 衝撃の弧 — a shock leaves the middle of the frame as pairs of arcs, like (( )). */
function drawKzShockArcs(options: LooksPixelEffectDraw): void {
	const { ctx, height: ch, source, width: cw } = options;
	const M = Math.min(cw, ch);
	const a = 1;
	const vert = cw < ch * 0.9;
	const cx = cw / 2;
	const cy = ch / 2;
	const L = vert ? ch : cw;
	const k = fxBPhase(options);
	const pu =
		k < 0.15 ? oExpo(k / 0.15) : 1 - inOutCubic((k - 0.15) / 0.85);
	const st = 1 + 0.035 * a * pu;
	if (st > 1.002) {
		fxBaseline(options, () => {
			if (vert) {
				ctx.drawImage(source, 0, cy - (ch * st) / 2, cw, ch * st);
			} else {
				ctx.drawImage(source, cx - (cw * st) / 2, 0, cw * st, ch);
			}
		});
	}
	ctx.strokeStyle = fxPopColor(options);
	for (let index = 0; index < 3; index++) {
		const q = clamp01((k - index * 0.11) / 0.7);
		if (q <= 0 || q >= 1) continue;
		const R = L * (0.2 + 0.28 * outCubic(q));
		const span = Math.asin(Math.min(0.95, (M * 0.36) / R));
		const lw = M * 0.024 * (1 - q) * a * (1 - index * 0.22);
		if (lw < 0.5) continue;
		const baseAlpha = ctx.globalAlpha;
		ctx.lineWidth = lw;
		ctx.globalAlpha = baseAlpha * (1 - q * q);
		if (ctx.beginPath && ctx.arc && ctx.stroke) {
			for (const b of vert ? [PI / 2, -PI / 2] : [0, PI]) {
				ctx.beginPath();
				ctx.arc(cx, cy, R, b - span, b + span);
				ctx.stroke();
			}
		}
		ctx.globalAlpha = baseAlpha;
	}
}

/** 着地の土煙 — the picture lands with a thud and dust rolls along the bottom edge. */
function drawKzDustLanding(options: LooksPixelEffectDraw): void {
	const { ctx, height: ch, source, width: cw } = options;
	const s = fxEventSeed(options);
	const M = Math.min(cw, ch);
	const k = fxBPhase(options);
	const drop =
		k < 0.1 ? outCubic(k / 0.1) : ring((k - 0.1) / 0.9, 1.75, 3.5);
	const o = Math.round(M * 0.028 * drop);
	if (o) {
		fxBaseline(options, () => {
			ctx.drawImage(source, 0, o);
		});
	}
	const q = clamp01((k - 0.05) / 0.95);
	if (q <= 0 || q >= 1) return;
	const e = outCubic(q);
	const dust = mixHex({
		from: options.frame.palette.foreground,
		progress: 0.45,
		to: options.frame.palette.background,
	});
	for (const sd of [-1, 1]) {
		for (let index = 0; index < 6; index++) {
			const u = (index + 1) / 6;
			const r =
				M *
				(0.02 + 0.04 * randomUnit(s, index, sd + 2)) *
				(0.45 + 0.9 * e) *
				(1 - 0.55 * q);
			const x = cw / 2 + sd * (cw * 0.06 + cw * 0.38 * u * e);
			const y = ch - r * 0.5 - M * 0.07 * u * e * randomUnit(s, index, 7);
			const baseAlpha = ctx.globalAlpha;
			ctx.globalAlpha = baseAlpha * 0.9 * (1 - q) * (1 - 0.4 * u);
			ctx.fillStyle = dust;
			if (ctx.beginPath && ctx.arc && ctx.fill) {
				ctx.beginPath();
				ctx.arc(x, y, r, 0, TAU);
				ctx.fill();
			}
			ctx.globalAlpha = baseAlpha;
		}
	}
}

/** 押しのけバー — a bar ploughs across the frame; ahead of it the picture is squeezed. */
function drawKzBulldoze(options: LooksPixelEffectDraw): void {
	const { ctx, height: ch, source, width: cw } = options;
	const s = fxEventSeed(options);
	const M = Math.min(cw, ch);
	const k = fxBPhase(options);
	if (k <= 0 || k >= 1) return;
	const vert = cw < ch ? randomUnit(s, 1) < 0.6 : randomUnit(s, 1) < 0.15;
	const rev = randomUnit(s, 2) < 0.5;
	const L = vert ? ch : cw;
	const b = Math.round(L * inOutSine(k));
	const rest = L - b;
	const bw = Math.max(3, M * 0.03 * Math.sin(PI * k));
	if (rest < 1) return;
	const at = rev ? 0 : b;
	fxBaseline(options, () => {
		if (vert) {
			ctx.drawImage(source, 0, 0, cw, ch, 0, at, cw, rest);
		} else {
			ctx.drawImage(source, 0, 0, cw, ch, at, 0, rest, ch);
		}
	});
	const seam = rev ? rest : b;
	const baseAlpha = ctx.globalAlpha;
	ctx.fillStyle = fxPopColor(options);
	if (vert) {
		ctx.fillRect(0, seam - bw / 2, cw, bw);
	} else {
		ctx.fillRect(seam - bw / 2, 0, bw, ch);
	}
	ctx.fillStyle = options.frame.palette.foreground;
	ctx.globalAlpha = baseAlpha * 0.8;
	const lw = Math.max(1, bw * 0.16);
	const lead = rev ? seam - bw / 2 - lw * 2 : seam + bw / 2 + lw;
	if (vert) {
		ctx.fillRect(0, lead, cw, lw);
	} else {
		ctx.fillRect(lead, 0, lw, ch);
	}
	ctx.globalAlpha = baseAlpha;
}

/**
 * x2 kinetic frame fx. These redraw the captured frame, mirroring the fx-b
 * screen-effect conventions: without a pixel canvas there is nothing to
 * recompose, so the effect is handled as a no-op.
 */
export function drawX2KineticFx(options: FxBScreenEffectDraw): boolean {
	switch (options.effect) {
		case "kzBulldoze":
		case "kzCardSlam":
		case "kzDustLanding":
		case "kzEdgeHit":
		case "kzKnockSmear":
		case "kzShockArcs":
			break;
		default:
			return false;
	}
	options.ctx.save();
	try {
		if (!isLooksPixelContext(options.ctx)) return true;
		const surface = captureLooksSource({
			ctx: options.ctx,
			height: options.height,
			width: options.width,
		});
		if (!surface) return true;
		const pixelOptions: LooksPixelEffectDraw = {
			...options,
			ctx: options.ctx,
			source: surface.canvas,
		};
		switch (options.effect) {
			case "kzBulldoze":
				drawKzBulldoze(pixelOptions);
				return true;
			case "kzCardSlam":
				drawKzCardSlam(pixelOptions);
				return true;
			case "kzDustLanding":
				drawKzDustLanding(pixelOptions);
				return true;
			case "kzEdgeHit":
				drawKzEdgeHit(pixelOptions);
				return true;
			case "kzKnockSmear":
				drawKzKnockSmear(pixelOptions);
				return true;
			case "kzShockArcs":
				drawKzShockArcs(pixelOptions);
				return true;
			default:
				return true;
		}
	} finally {
		options.ctx.restore();
	}
}

// ============================================================================ TRANSITIONS

/** Transition draw contract mirroring kinetic-transitions.ts. */
export interface X2KineticTransitionDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawCurrent: () => void;
	readonly drawPrevious: () => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

/** 突き飛ばし — the new frame slams in from the side; the old one is knocked away tumbling. */
function drawKzShoveOff(options: X2KineticTransitionDraw): void {
	const { ctx, drawCurrent, drawPrevious, frame, height: ch, width: cw } = options;
	const p = frame.enterProgress;
	const seed = frame.cut?.seed ?? 0;
	const dir = randomUnit(seed, 8851) < 0.5 ? -1 : 1;
	const vert = randomUnit(seed, 8852) < 0.25;
	const L = vert ? ch : cw;
	const eB = oBack(p, 1.5);
	const eA = outCubic(clamp01(p * 1.15));
	fillTransitionBackground(options);
	const dA = -dir * L * 1.15 * eA;
	ctx.save();
	ctx.translate(
		cw / 2 + (vert ? cw * 0.1 * eA * eA : dA),
		ch / 2 + (vert ? dA : ch * 0.12 * eA * eA),
	);
	ctx.rotate(degrees(-dir * 14 * eA));
	ctx.translate(-cw / 2, -ch / 2);
	drawPrevious();
	ctx.restore();
	const dB = Math.round(dir * L * (1 - eB));
	ctx.save();
	ctx.translate(vert ? 0 : dB, vert ? dB : 0);
	drawCurrent();
	ctx.restore();
	const lw = Math.max(2, Math.min(cw, ch) * 0.012) * (1 - p);
	const edge = dir > 0 ? dB - lw : dB + L;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * clamp01((1 - p) * 1.4);
	ctx.fillStyle = frame.palette.accent;
	if (vert) {
		ctx.fillRect(0, edge, cw, lw);
	} else {
		ctx.fillRect(edge, 0, lw, ch);
	}
	ctx.globalAlpha = baseAlpha;
}

/** 押し潰し — the new frame comes down like a press and squeezes the old one flat. */
function drawKzCrushDown(options: X2KineticTransitionDraw): void {
	const { ctx, drawCurrent, drawPrevious, frame, height: ch, width: cw } = options;
	const p = frame.enterProgress;
	const seed = frame.cut?.seed ?? 0;
	const from = ["top", "top", "left", "right", "bottom"][
		Math.min(4, Math.floor(randomUnit(seed, 8861) * 5))
	]!;
	const hor = from === "left" || from === "right";
	const L = hor ? cw : ch;
	const tl = 0.62;
	let f: number;
	if (p < tl) {
		const q = p / tl;
		f = q * q;
	} else {
		const t = (p - tl) / (1 - tl);
		f = 1 - 0.075 * Math.abs(Math.sin(t * PI * 2)) * (1 - t);
	}
	const d = Math.round(L * f);
	const rest = L - d;
	const lw = Math.max(2, Math.min(cw, ch) * 0.007);
	fillTransitionBackground(options);
	const drawPreviousSqueezed = (): void => {
		if (rest < 1) return;
		ctx.save();
		if (from === "top") {
			ctx.translate(0, d);
			ctx.scale(1, rest / ch);
		} else if (from === "bottom") {
			ctx.scale(1, rest / ch);
		} else if (from === "left") {
			ctx.translate(d, 0);
			ctx.scale(rest / cw, 1);
		} else {
			ctx.scale(rest / cw, 1);
		}
		drawPrevious();
		ctx.restore();
	};
	drawPreviousSqueezed();
	ctx.save();
	if (from === "top") ctx.translate(0, d - ch);
	else if (from === "bottom") ctx.translate(0, rest);
	else if (from === "left") ctx.translate(d - cw, 0);
	else ctx.translate(rest, 0);
	drawCurrent();
	ctx.restore();
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * clamp01((1 - p) * 3);
	ctx.fillStyle = frame.palette.accent;
	const seam = from === "top" || from === "left" ? d : rest - lw;
	if (hor) {
		ctx.fillRect(seam, 0, lw, ch);
	} else {
		ctx.fillRect(0, seam, cw, lw);
	}
	ctx.globalAlpha = baseAlpha;
}

/** 大回し — both frames ride one huge wheel whose hub is far outside the picture. */
function drawKzCarousel(options: X2KineticTransitionDraw): void {
	const { ctx, drawCurrent, drawPrevious, frame, height: ch, width: cw } = options;
	const p = frame.enterProgress;
	const seed = frame.cut?.seed ?? 0;
	const dir = randomUnit(seed, 8871) < 0.5 ? -1 : 1;
	const top = randomUnit(seed, 8872) < 0.3;
	const R = Math.max(cw, ch) * 1.3;
	const px = cw / 2;
	const py = top ? ch / 2 - R : ch / 2 + R;
	const th = 2 * Math.atan(cw / 2 / (R - ch / 2)) * 1.05;
	const e =
		inOutCubic(clamp01(p / 0.78)) +
		0.035 * Math.sin(PI * clamp01((p - 0.55) / 0.45));
	fillTransitionBackground(options);
	// eslint-disable-next-line opencut/prefer-object-params
	const put = (draw: () => void, angle: number): void => {
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(angle);
		ctx.translate(-px, -py);
		draw();
		ctx.restore();
	};
	put(drawPrevious, -dir * th * e);
	put(drawCurrent, dir * th * (1 - e));
}

function fillTransitionBackground(options: X2KineticTransitionDraw): void {
	const { ctx, frame, height, width } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = frame.palette.background;
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = baseFill;
}

export function drawX2KineticTrans(options: X2KineticTransitionDraw): boolean {
	if (!options.frame.previousCut) return false;
	const p = options.frame.enterProgress;
	if (p <= 0) {
		options.drawPrevious();
		return true;
	}
	if (p >= 0.999) {
		options.drawCurrent();
		return true;
	}
	switch (options.frame.cut?.preset.trans) {
		case "kzCarousel":
			drawKzCarousel(options);
			return true;
		case "kzCrushDown":
			drawKzCrushDown(options);
			return true;
		case "kzShoveOff":
			drawKzShoveOff(options);
			return true;
		default:
			return false;
	}
}
