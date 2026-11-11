import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import { enterBOutBack } from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inOutCubic,
	inOutSine,
	outCubic,
	randomSigned,
	randomUnit,
	smoothNoise,
} from "./exit-hold-geometry";
import type { KineticCameraTransform } from "./kinetic-cameras";

/**
 * JIZURA 追加分2 pack "x2camtr" camera group — 20 camera moves that settle.
 *
 * Transliteration notes (same simplifications as the other x2 ports): plan rng
 * fields are derived deterministically from the cut seed, beat timing and the
 * loudness envelope are not modelled (the packs' fixed-period fallbacks on the
 * cut clock are used), and the fx.motion amplitude is fixed at its 0.7 default
 * (KM = 0.875). JIZURA pixel offsets are fractions of env.W/env.H here — the
 * kinetic contract multiplies translateX/Y by the frame size.
 */

const TAU = Math.PI * 2;
const CAMERA_MOTION = 0.875; // fx.motion 0.7 default × 1.25 (KM), fixed.

export function resolveX2Camera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform | null {
	switch (cut.preset.cam) {
		case "xqArcSweep":
			return arcSweep({ cut, localTime });
		case "xqBeatBreath":
			return beatBreath({ cut, localTime });
		case "xqCraneUp":
			return craneUp({ cut, localTime });
		case "xqDriftTurn":
			return driftTurn({ cut, localTime });
		case "xqFindFrame":
			return findFrame({ cut, localTime });
		case "xqFocusHunt":
			return focusHunt({ cut, localTime });
		case "xqHeartbeat":
			return heartbeat({ cut, localTime });
		case "xqLeafFall":
			return leafFall({ cut, localTime });
		case "xqLevelOut":
			return levelOut({ cut, localTime });
		case "xqLongLens":
			return longLens({ cut, localTime });
		case "xqLoudZoom":
			return loudZoom({ cut, localTime });
		case "xqPushPull":
			return pushPull({ cut, localTime });
		case "xqSquashRelax":
			return squashRelax({ cut, localTime });
		case "xqStopMotion":
			return stopMotion({ cut, localTime });
		case "xqTickRoll":
			return tickRoll({ cut, localTime });
		case "xqTripodNudge":
			return tripodNudge({ cut, localTime });
		case "xqTruckAround":
			return truckAround({ cut, localTime });
		case "xqWalkCam":
			return walkCam({ cut, localTime });
		case "xqWhipSpring":
			return whipSpring({ cut, localTime });
		case "xqWindUp":
			return windUp({ cut, localTime });
		default:
			return null;
	}
}

interface X2CameraInput {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}

function clamp(value: number): number {
	return clamp01(value);
}

/** JIZURA `clamp(v, lo, hi)` — a range clamp (distinct from the 0..1 clamp). */
// eslint-disable-next-line opencut/prefer-object-params
function clampR(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

function secondsOf({ localTime }: X2CameraInput): number {
	return localTime / 120_000;
}

/** JIZURA `env.cut.dur` in seconds. */
function durationOf({ cut }: X2CameraInput): number {
	return cut.duration / 120_000;
}

/** JIZURA `cuOf` — progress across the whole cut, floored at 0.3s. */
function cutProgress(input: X2CameraInput): number {
	return clamp(secondsOf(input) / Math.max(0.3, durationOf(input)));
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors J.lerp's compact shape.
function lerpN(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors J.wrap(v, m).
function wrap(value: number, modulus: number): number {
	return ((value % modulus) + modulus) % modulus;
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors rng.pick(roll over a list).
function pickFrom<T>(list: readonly T[], roll: number): T {
	return list[Math.min(list.length - 1, Math.floor(roll * list.length))]!;
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors E.outBack(v, k).
function oBack(value: number, overshoot = 1.70158): number {
	return enterBOutBack(value, overshoot);
}

/**
 * JIZURA `beat2` without beat data — a fixed period on the cut clock: phase
 * 0..1 over two beats of `per` seconds, plus the period itself.
 */
// eslint-disable-next-line opencut/prefer-object-params
function beat2(seconds: number, per: number): { ph: number; T: number } {
	return { ph: wrap(seconds, per) / per, T: per };
}

/** JIZURA `J.noise1(x, seed)`. */
// eslint-disable-next-line opencut/prefer-object-params
function noise1(value: number, seed: number): number {
	return smoothNoise({ seed, salt: 0, value });
}

/** 弧を描く — one pass along a shallow arc, the frame leaning into the curve. */
function arcSweep(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const u = cutProgress(input);
	const e = (u * 0.5 + inOutSine(u) * 0.5) * 2 - 1;
	const s = input.cut.seed;
	const d = pickFrom([1, -1], randomUnit(s, 661_001));
	const v = pickFrom([1, 1, -1], randomUnit(s, 661_002));
	const a = 0.02 + randomUnit(s, 661_003) * 0.006;
	return {
		rotation: degrees(d * v * e * 1.5 * K),
		scale: 1.03,
		translateX: d * e * a * K,
		translateY: -v * 0.026 * K * (1 - e * e - 0.45),
	};
}

/** 溜めて寄る — backs off a little first, then pushes in on an S-curve. */
function windUp(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const dur = durationOf(input);
	const t1 = Math.min(0.45, dur * 0.25);
	const t2 = Math.max(0.3, dur * 0.5);
	const back = inOutSine(clamp(lt / t1));
	const push = inOutCubic(clamp((lt - t1) / t2));
	const b = (0.018 + randomUnit(s, 662_002) * 0.008) * K;
	const a = (0.055 + randomUnit(s, 662_001) * 0.02) * K;
	return {
		scale: 1 - b * back + (b + a) * push + 0.006 * K * cutProgress(input),
		translateY: -0.006 * K * push,
	};
}

/** ピント迷い — autofocus hunting, then it locks, the lens breathing along. */
function focusHunt(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const d = 0.75 + randomUnit(s, 663_001) * 0.25;
	const q = clamp(
		lt / Math.min(d, Math.max(0.4, durationOf(input) * 0.6)),
	);
	if (q >= 1) return { scale: 1 + 0.01 * K * cutProgress(input) };
	const c = Math.cos(q * Math.PI * 1.5);
	const dk = (1 - q) ** 1.2;
	return {
		blur: (8 + randomUnit(s, 663_002) * 4) * K * Math.abs(c) * dk,
		scale: 1 + 0.02 * K * c * dk + 0.01 * K * cutProgress(input),
	};
}

/** 拍で呼吸 — a smooth zoom breathing in on one beat and out on the next. */
function beatBreath(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const per = 1.5 + randomUnit(s, 664_002) * 0.4;
	const b = beat2(secondsOf(input), per);
	const w = 0.5 - 0.5 * Math.cos(b.ph * TAU);
	return {
		scale: 1.012 + (0.03 + randomUnit(s, 664_001) * 0.012) * K * w,
		translateY: -0.004 * K * w,
	};
}

/** 歩き撮り — carried on the shoulder while walking, hips swaying. */
function walkCam(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const ph = lt * (1.5 + randomUnit(s, 665_001) * 0.4) * Math.PI;
	const sg = pickFrom([1, -1], randomUnit(s, 665_002));
	return {
		rotation: degrees(sg * Math.sin(ph + 0.6) * 0.45 * K),
		scale: 1.02,
		translateX:
			sg * Math.sin(ph) * 0.006 * K +
			noise1(lt * 0.7, s + 3) * 0.003 * K,
		translateY: (0.5 - Math.abs(Math.sin(ph))) * 0.011 * K,
	};
}

/** 三脚の直し — locked off; the operator re-centres in smaller and smaller nudges. */
function tripodNudge(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const per = 0.85 + randomUnit(s, 666_001) * 0.4;
	const sd = s + Math.floor(randomUnit(s, 666_002) * 100);
	const kz = Math.max(1, Math.floor((durationOf(input) - 0.35) / per));
	const k = Math.floor(lt / per);
	const e = inOutCubic(clamp((lt - k * per) / 0.3));
	// eslint-disable-next-line opencut/prefer-object-params -- Mirrors J.rs(sd, i, c) salted positions.
	const pos = (i: number, c: number): number =>
		i < 0 || i >= kz ? 0 : randomSigned(sd, i, c) / (1 + 0.5 * i);
	const x0 = k > 0 ? pos(k - 1, 1) : pos(0, 1);
	const y0 = k > 0 ? pos(k - 1, 2) : pos(0, 2);
	return {
		scale: 1.02,
		translateX: lerpN(x0, pos(k, 1), e) * 0.016 * K,
		translateY: lerpN(y0, pos(k, 2), e) * 0.013 * K,
	};
}

/** 望遠の震え — telephoto on a far subject: fine fast tremor on a slow float. */
function longLens(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed + 21;
	const t = secondsOf(input) * (0.9 + randomUnit(input.cut.seed, 667_001) * 0.3);
	return {
		scale: 1.045 + 0.006 * Math.sin(t * 0.9),
		translateX:
			(noise1(t * 11, s) * 0.6 + noise1(t * 17, s + 1) * 0.4) *
				0.0026 *
				K +
			noise1(t * 0.35, s + 2) * 0.009 * K,
		translateY:
			(noise1(t * 12, s + 3) * 0.6 + noise1(t * 19, s + 4) * 0.4) *
			0.0032 *
			K,
	};
}

/** コマ撮り寄り — a push-in shot frame by frame, with registration wobble. */
function stopMotion(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const fps = pickFrom([5, 6, 8], randomUnit(s, 668_001));
	const f = Math.floor(lt * fps + 1e-6);
	const u = clamp(f / fps / Math.max(0.3, durationOf(input)));
	return {
		rotation: degrees(randomSigned(s, f, 3) * 0.22 * K),
		scale: 1 + (0.065 + randomUnit(s, 668_002) * 0.02) * K * u,
		translateX: randomSigned(s, f, 1) * 0.0022 * K,
		translateY: randomSigned(s, f, 2) * 0.0022 * K,
	};
}

/** 小ホイップ — a short diagonal whip that lands on a spring, then dead still. */
function whipSpring(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const t = secondsOf(input);
	const d = Math.exp(-t * 7);
	if (d < 0.004) return {};
	const ang = pickFrom(
		[0, 180, 25, 155, -25, -155, 90, -90],
		randomUnit(s, 669_001),
	);
	const w = d * Math.cos(t * (17 + randomUnit(s, 669_002) * 4));
	const a = degrees(ang);
	const cx = Math.cos(a);
	const cy = Math.sin(a);
	return {
		blur: 10 * K * Math.exp(-t * 16),
		rotation: degrees(cy * 1.2 * K * w),
		scale: 1 + 0.02 * K * d,
		skewX: degrees(cx * 3.5 * K * w),
		translateX: cx * 0.045 * K * w,
		translateY: cy * 0.04 * K * w,
	};
}

/** 水平出し — the cut opens crooked and is levelled like a spirit level. */
function levelOut(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const q = secondsOf(input) / clampR(durationOf(input) * 0.5, 0.5, 1.4);
	const r = Math.exp(-q * 3.2) * Math.cos(q * 4.4);
	const dir = pickFrom([1, -1], randomUnit(s, 670_001));
	const a = 3 + randomUnit(s, 670_002) * 1;
	return {
		rotation: degrees(
			Math.max(-5, Math.min(5, dir * a * K * r)),
		),
		scale: 1.035 - 0.012 * clamp(q),
	};
}

/** つぶれ戻り — the frame arrives pressed flat on one axis and slowly relaxes. */
function squashRelax(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const r =
		1 - outCubic(clamp(secondsOf(input) / clampR(durationOf(input) * 0.6, 0.5, 1.6)));
	const a =
		pickFrom([1, -1], randomUnit(s, 671_002)) *
		(0.07 + randomUnit(s, 671_003) * 0.025) *
		K *
		r;
	const across = pickFrom(["x", "y", "y"], randomUnit(s, 671_001));
	if (across === "x") {
		return { scale: 1.005, scaleX: 1 + a, scaleY: 1 - a * 0.35 };
	}
	return { scale: 1.005, scaleX: 1 - a * 0.35, scaleY: 1 + a };
}

/** 折り返し — drifts one way, turns round mid-cut, drifts back while sinking. */
function driftTurn(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const u = cutProgress(input);
	return {
		scale: 1.025,
		translateX:
			pickFrom([1, -1], randomUnit(s, 672_001)) *
			(0.024 + randomUnit(s, 672_003) * 0.006) *
			K *
			(Math.sin(Math.PI * u) - 0.55),
		translateY:
			pickFrom([1, -1], randomUnit(s, 672_002)) *
			0.014 *
			K *
			(u * 2 - 1),
	};
}

/** クレーン — the camera rises and pulls back at once, levelling as it goes. */
function craneUp(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const r = 1 - outCubic(cutProgress(input));
	const v = randomUnit(s, 673_002) >= 0.75 ? -1 : 1;
	return {
		rotation: degrees(pickFrom([1, -1], randomUnit(s, 673_001)) * 1.1 * K * r),
		scale: 1.01 + 0.055 * K * r,
		scaleY: 1 - 0.035 * K * r,
		translateY: v * 0.036 * K * (r - 0.2),
	};
}

/** 回り込み — the camera trucks round the lyric: one side, face-on, other side. */
function truckAround(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const u = cutProgress(input);
	const k = (u * 0.5 + inOutSine(u) * 0.5) * 2 - 1;
	const d = pickFrom([1, -1], randomUnit(s, 674_001));
	return {
		scale: 1.03,
		scaleX: 1 - (0.045 + randomUnit(s, 674_002) * 0.015) * K * k * k,
		skewX: degrees(d * 1.3 * K * k),
		translateX: d * 0.022 * K * k,
	};
}

/** 鼓動 — lub-dub: two close swells and a rest, over two beats. */
function heartbeat(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const per = 1 + randomUnit(s, 675_002) * 0.25;
	const b = beat2(secondsOf(input), per);
	const tt = b.ph * b.T;
	const d2 = Math.min(0.3, b.T * 0.27);
	const k =
		Math.exp(-tt * 10) + (tt > d2 ? 0.65 * Math.exp(-(tt - d2) * 10) : 0);
	return {
		scale: 1.01 + (0.024 + randomUnit(s, 675_001) * 0.008) * K * k,
		scaleY: 1 + 0.006 * K * k,
	};
}

/** 舞い降り — comes down like a falling leaf, swinging and tilting, and lands. */
function leafFall(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const q = clamp(lt / clampR(durationOf(input) * 0.65, 0.6, 1.9));
	const r = 1 - outCubic(q);
	const d = pickFrom([1, -1], randomUnit(s, 676_001));
	const ph = q * TAU * (1.2 + randomUnit(s, 676_002) * 0.5);
	return {
		rotation: degrees(d * 2.6 * K * r * Math.cos(ph)),
		scale: 1.01,
		translateX: d * 0.03 * K * r * Math.sin(ph),
		translateY: -0.042 * K * r,
	};
}

/** 音量で寄る — the framing follows the loudness of the song. */
function loudZoom(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const en = 0.5 + 0.5 * Math.sin(lt * 2.1) * Math.sin(lt * 0.7 + 1);
	return {
		scale: 1.005 + (0.04 + randomUnit(s, 677_001) * 0.015) * K * en,
		translateY: -0.004 * K * en,
	};
}

/** 寄って引く — in and back out in one breath: closest mid-cut, home at both ends. */
function pushPull(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const u = cutProgress(input);
	const at = 0.42 + randomUnit(s, 678_002) * 0.16;
	const v = u < at ? (u / at) * 0.5 : 0.5 + ((u - at) / (1 - at)) * 0.5;
	const b = 0.5 - 0.5 * Math.cos(TAU * v);
	return {
		scale: 1 + (0.065 + randomUnit(s, 678_001) * 0.02) * K * b,
		translateY: -0.006 * K * b,
	};
}

/** 構図を探す — starts too tight and off to a corner, then finds the lyric. */
function findFrame(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const T = clampR(durationOf(input) * 0.45, 0.45, 1.1);
	const r = 1 - oBack(clamp((lt - T * 0.15) / (T * 0.85)), 1.15);
	return {
		scale: 1 + 0.06 * K * Math.max(-0.15, r),
		translateX: pickFrom([1, -1], randomUnit(s, 679_001)) * 0.028 * K * r,
		translateY: pickFrom([1, -1, 0], randomUnit(s, 679_002)) * 0.03 * K * r,
	};
}

/** 秒針ロール — the frame rolls like a second hand, tick by tick with overshoot. */
function tickRoll(input: X2CameraInput): KineticCameraTransform {
	const K = CAMERA_MOTION;
	const s = input.cut.seed;
	const lt = secondsOf(input);
	const dur = Math.max(0.3, durationOf(input));
	const n = Math.max(
		2,
		Math.min(4 + Math.floor(randomUnit(s, 680_002) * 3), Math.floor(dur / 0.3)),
	);
	const per = dur / n;
	const k = Math.min(n - 1, Math.floor(lt / per));
	const A = pickFrom([1, -1], randomUnit(s, 680_001)) * (2 + randomUnit(s, 680_003) * 0.8) * K;
	const pos = (i: number): number => -A + (2 * A * i) / (n - 1);
	const e = oBack(clamp((lt - k * per) / 0.14), 2.2);
	return {
		rotation: degrees(k > 0 ? lerpN(pos(k - 1), pos(k), e) : pos(0)),
		scale: 1.03,
	};
}
