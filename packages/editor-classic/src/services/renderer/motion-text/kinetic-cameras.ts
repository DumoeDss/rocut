import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import { signedRandom, unitRandom } from "./deterministic-random";
import { kineticWordSegments } from "./kinetic-words";

const TICKS_PER_SECOND = 120_000;

export interface KineticCameraTransform {
	readonly blur?: number;
	readonly rotation?: number;
	readonly scale?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly skewX?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}

export function resolveKineticCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform | null {
	switch (cut.preset.cam) {
		case "knReadPan":
			return readPan({ cut, localTime });
		case "knTiltKick":
			return tiltKick({ cut, localTime });
		case "knCardFlip":
			return cardFlip({ cut, localTime });
		case "knShearKick":
			return shearKick({ cut, localTime });
		case "knJumpCut":
			return jumpCut({ cut, localTime });
		case "knRushIn":
			return rushIn({ cut, localTime });
		default:
			return null;
	}
}

function readPan({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const onsets = wordOnsets(cut);
	const count = onsets.length;
	const amplitude = 0.026 + unitRandom({ seed: cut.seed, salt: 801 }) * 0.01;
	if (count < 2) {
		return {
			scale: 1.03,
			translateX:
				(1 - 2 * inOutSine(clamp01(localTime / cut.duration))) *
				amplitude *
				0.5,
		};
	}
	const index = currentWord({ localTime, onsets });
	const position = (word: number) => amplitude * (1 - (2 * word) / (count - 1));
	const since = localTime - onsets[index];
	const eased =
		index > 0 ? outBack({ overshoot: 1.8, value: clamp01(since / 24_000) }) : 1;
	let translateX =
		index > 0
			? lerp({
					start: position(index - 1),
					end: position(index),
					progress: eased,
				})
			: position(0);
	const settleStart = onsets[count - 1] + Math.min(42_000, cut.duration * 0.22);
	const settle = inOutCubic(clamp01((localTime - settleStart) / 42_000));
	translateX *= 1 - settle;
	const whip = index > 0 ? bell(clamp01(since / 16_800)) : 0;
	return {
		blur: 3 * whip,
		scale: 1.035,
		skewX: -0.044 * whip,
		translateX,
	};
}

function tiltKick({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const onsets = wordOnsets(cut);
	const count = onsets.length;
	const index = currentWord({ localTime, onsets });
	const direction = unitRandom({ seed: cut.seed, salt: 811 }) >= 0.5 ? 1 : -1;
	const amplitude =
		((2.4 + unitRandom({ seed: cut.seed, salt: 812 })) * Math.PI * direction) /
		180;
	const angle = (word: number) =>
		word >= count - 1 ? 0 : word % 2 === 0 ? amplitude : -amplitude;
	const from = index > 0 ? angle(index - 1) : 0;
	const to = angle(index);
	const seconds = (localTime - onsets[index]) / TICKS_PER_SECOND;
	const spring = Math.exp(-seconds * 7) * Math.cos(seconds * 17);
	const rotation = to + (from - to) * spring;
	return {
		rotation: clampRange({ value: rotation, minimum: -0.087, maximum: 0.087 }),
		scale: 1.03 + (0.012 * Math.abs(rotation)) / 0.052,
	};
}

function cardFlip({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const vertical = unitRandom({ seed: cut.seed, salt: 821 }) < 0.3;
	const direction = unitRandom({ seed: cut.seed, salt: 822 }) >= 0.5 ? 1 : -1;
	const progress = clamp01(localTime / 50_400);
	const angle =
		(Math.PI / 2) * (1 - outBack({ overshoot: 1.7, value: progress }));
	let factor = Math.max(0.04, Math.abs(Math.cos(angle)));
	const onsets = wordOnsets(cut);
	for (let index = 1; index < onsets.length; index += 1) {
		const since = localTime - onsets[index];
		if (since > 0 && since < 28_800) {
			factor *= 1 - 0.1 * bell(since / 28_800);
		}
	}
	return vertical
		? {
				scale: 1.01,
				scaleY: factor,
				translateY: -0.02 * Math.sin(angle),
			}
		: {
				scale: 1.01,
				scaleX: factor,
				skewX: 0.049 * Math.sin(angle) * direction,
				translateX: 0.02 * Math.sin(angle) * direction,
			};
}

function shearKick({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const onsets = wordOnsets(cut);
	const index = currentWord({ localTime, onsets });
	const seconds = (localTime - onsets[index]) / TICKS_PER_SECOND;
	const wave = Math.exp(-seconds * 8) * Math.cos(seconds * 22);
	const direction = index % 2 === 0 ? -1 : 1;
	const amplitude = 5 + unitRandom({ seed: cut.seed, salt: 831 }) * 3;
	return {
		scale: 1.02,
		skewX: (amplitude * Math.PI * wave * direction) / 180,
		translateX: 0.006 * wave * direction,
	};
}

function jumpCut({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const onsets = wordOnsets(cut);
	const index = currentWord({ localTime, onsets });
	if (onsets.length < 2 || localTime > onsets[onsets.length - 1] + 60_000) {
		return { scale: 1.02 };
	}
	const offset = Math.abs(cut.seed) % 3;
	const scales = [1, 1.12, 1.05, 1.14, 1.08, 1.13] as const;
	const direction = index % 2 === 0 ? -1 : 1;
	return {
		scale: scales[(index + offset) % scales.length],
		translateX:
			index === 0
				? 0
				: direction *
					(0.5 + unitRandom({ seed: cut.seed, salt: index + 841 }) * 0.5) *
					0.04,
		translateY: signedRandom({ seed: cut.seed, salt: index + 851 }) * 0.035,
	};
}

function rushIn({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const progress = clamp01(localTime / 40_800);
	if (progress >= 1) {
		return { scale: 1 + 0.01 * clamp01((localTime - 40_800) / cut.duration) };
	}
	const startScale = 0.66 + unitRandom({ seed: cut.seed, salt: 861 }) * 0.1;
	const startRotation = signedRandom({ seed: cut.seed, salt: 862 }) * 0.07;
	const eased = outBack({ overshoot: 1.9, value: progress });
	const settle = outCubic(progress);
	return {
		blur: 9 * (1 - settle),
		rotation: startRotation * (1 - settle),
		scale: lerp({ start: startScale, end: 1, progress: eased }),
	};
}

function wordOnsets(cut: MotionTextResolvedCut): readonly number[] {
	const count = kineticWordSegments({ text: cut.text }).length;
	if (count <= 1) return [0];
	const last = Math.min(
		cut.duration * 0.5,
		(count - 1) * TICKS_PER_SECOND * 0.38,
	);
	return Array.from({ length: count }, (_, index) =>
		Math.round((last * index) / (count - 1)),
	);
}

function currentWord({
	localTime,
	onsets,
}: {
	readonly localTime: number;
	readonly onsets: readonly number[];
}): number {
	let current = 0;
	for (const [index, onset] of onsets.entries()) {
		if (localTime >= onset) current = index;
	}
	return current;
}

function bell(value: number): number {
	return Math.sin(Math.PI * clamp01(value));
}

function outBack({
	value,
	overshoot,
}: {
	readonly value: number;
	readonly overshoot: number;
}): number {
	const progress = clamp01(value);
	const shifted = progress - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

function inOutSine(value: number): number {
	return -(Math.cos(Math.PI * clamp01(value)) - 1) / 2;
}

function lerp({
	start,
	end,
	progress,
}: {
	readonly start: number;
	readonly end: number;
	readonly progress: number;
}): number {
	return start + (end - start) * progress;
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

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
