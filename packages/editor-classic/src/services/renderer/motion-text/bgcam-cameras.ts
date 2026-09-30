import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import { signedRandom, unitRandom } from "./deterministic-random";
import {
	clamp01,
	inOutCubic,
	outBack,
	outCubic,
	TICKS_PER_SECOND,
} from "./horror-frame-utils";
import type { KineticCameraTransform } from "./kinetic-cameras";

export function resolveBgcamCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform | null {
	switch (cut.preset.cam) {
		case "orbitDrift":
			return orbitDrift({ cut, localTime });
		case "barrelRoll":
			return barrelRoll({ cut, localTime });
		case "pendulumSway":
			return pendulumSway({ cut, localTime });
		case "focusIn":
			return focusIn({ cut, localTime });
		case "rackFocus":
			return rackFocus({ cut, localTime });
		case "earthquake":
			return earthquake({ cut, localTime });
		case "floatNoise":
			return floatNoise({ cut, localTime });
		case "vertigo":
			return vertigo({ cut, localTime });
		case "tiltDown":
			return tiltDown({ cut, localTime });
		case "spiralIn":
			return spiralIn({ cut, localTime });
		case "snapPan":
			return snapPan({ cut, localTime });
		case "jelly":
			return jelly({ cut, localTime });
		default:
			return null;
	}
}

interface BgcamCameraInput {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}

function orbitDrift({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const direction = unitRandom({ seed: cut.seed, salt: 90_001 }) > 0.5 ? 1 : -1;
	const angle =
		unitRandom({ seed: cut.seed, salt: 90_002 }) * Math.PI * 2 +
		direction *
			seconds *
			(1.1 + unitRandom({ seed: cut.seed, salt: 90_003 }) * 0.5);
	const ramp = outCubic(localTime / (TICKS_PER_SECOND * 0.7));
	return {
		rotation: Math.sin(angle) * direction * ramp * 0.016,
		scale: 1.02,
		translateX: Math.cos(angle) * 0.016 * ramp,
		translateY: Math.sin(angle) * 0.02 * ramp,
	};
}

function barrelRoll({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const durationSeconds =
		0.42 + unitRandom({ seed: cut.seed, salt: 91_001 }) * 0.13;
	const progress = clamp01(localTime / (durationSeconds * TICKS_PER_SECOND));
	if (progress >= 1) return { scale: 1 };
	const direction = unitRandom({ seed: cut.seed, salt: 91_002 }) > 0.5 ? 1 : -1;
	const angle = 70 + unitRandom({ seed: cut.seed, salt: 91_003 }) * 40;
	const remainder = 1 - outBack({ value: progress, overshoot: 1.3 });
	return {
		blur: 9 * clamp01(1 - progress * 2.2),
		rotation: (direction * angle * Math.PI * remainder) / 180,
		scale: 1 - 0.12 * Math.sin(Math.PI * Math.min(1, progress * 1.25)),
	};
}

function pendulumSway({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const amplitude = 1.8 + unitRandom({ seed: cut.seed, salt: 92_001 }) * 0.8;
	const period = 2 + unitRandom({ seed: cut.seed, salt: 92_002 });
	const direction = unitRandom({ seed: cut.seed, salt: 92_003 }) > 0.5 ? 1 : -1;
	const damping = 0.75 + 0.25 * Math.exp(-seconds * 0.6);
	const angle =
		((amplitude *
			direction *
			Math.cos((seconds / period) * Math.PI * 2) *
			damping) /
			180) *
		Math.PI;
	return {
		rotation: angle,
		scale: 1.02,
		translateX: -Math.sin(angle) * 0.62,
		translateY: -(1 - Math.cos(angle)) * 0.62,
	};
}

function focusIn({ cut, localTime }: BgcamCameraInput): KineticCameraTransform {
	const duration =
		TICKS_PER_SECOND *
		(0.5 + unitRandom({ seed: cut.seed, salt: 93_001 }) * 0.3);
	const progress = outCubic(localTime / duration);
	const whole = clamp01(localTime / Math.max(1, cut.duration));
	const blur = 10 + unitRandom({ seed: cut.seed, salt: 93_002 }) * 5;
	return {
		blur: (1 - progress) * blur,
		scale: 1 + 0.03 * (1 - progress) + 0.012 * whole,
	};
}

function rackFocus({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const at = 0.6 + unitRandom({ seed: cut.seed, salt: 94_001 }) * 0.1;
	const start = Math.max(
		cut.duration * at,
		cut.duration - TICKS_PER_SECOND * 0.9,
	);
	const progress = inOutSine(
		clamp01((localTime - start) / Math.max(1, cut.duration - start)),
	);
	const blur = 5 + unitRandom({ seed: cut.seed, salt: 94_002 }) * 3;
	return {
		blur: progress * blur,
		scale: 1.01 - 0.02 * progress,
		translateY: 0.004 * progress,
	};
}

function earthquake({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const period = 0.55 + unitRandom({ seed: cut.seed, salt: 95_001 }) * 0.25;
	const strength = 0.85 + unitRandom({ seed: cut.seed, salt: 95_002 }) * 0.25;
	const sinceImpact = ((seconds % period) + period) % period;
	const impact = Math.exp(-sinceImpact * 7);
	const amplitude = strength * (0.14 + impact);
	const step = Math.floor(seconds * 24);
	return {
		blur: 1.5 * impact,
		rotation:
			(signedRandom({ seed: cut.seed, salt: 95_300 + step }) *
				0.45 *
				amplitude *
				Math.PI) /
			180,
		scale: 1.02 + 0.012 * impact,
		translateX:
			signedRandom({ seed: cut.seed, salt: 95_100 + step }) * 0.005 * amplitude,
		translateY:
			signedRandom({ seed: cut.seed, salt: 95_200 + step }) * 0.014 * amplitude,
	};
}

function floatNoise({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const frequency = 0.8 + unitRandom({ seed: cut.seed, salt: 96_001 }) * 0.4;
	const phaseX = unitRandom({ seed: cut.seed, salt: 96_002 }) * Math.PI * 2;
	const phaseY = unitRandom({ seed: cut.seed, salt: 96_003 }) * Math.PI * 2;
	const time = seconds * frequency;
	return {
		rotation:
			((Math.sin(time * 0.3 + phaseX) * 0.9 +
				Math.sin(time * 0.17 + phaseY) * 0.4) *
				Math.PI) /
			180,
		scale: 1.025 + 0.012 * Math.sin(time * 0.8),
		translateX:
			(Math.sin(time * 0.6 + phaseX) * 0.72 +
				Math.sin(time * 0.23 + phaseY) * 0.28) *
			0.02,
		translateY:
			(Math.sin(time * 0.5 + phaseY) * 0.7 + Math.sin(time * 1.3) * 0.3) *
			0.024,
	};
}

function vertigo({ cut, localTime }: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const whole = inOutSine(clamp01(localTime / Math.max(1, cut.duration)));
	const direction = unitRandom({ seed: cut.seed, salt: 97_001 }) > 0.5 ? 1 : -1;
	const amplitude = 0.05 + unitRandom({ seed: cut.seed, salt: 97_002 }) * 0.02;
	const wave = Math.sin(seconds * 2.3);
	return {
		rotation:
			(direction * 0.8 * whole * Math.sin(seconds * 1.1 + 1) * Math.PI) / 180,
		scale: 1 + amplitude * whole,
		scaleX: 1 + 0.03 * whole * wave,
		scaleY: 1 - 0.026 * whole * wave,
		skewX: (direction * 2.2 * whole * Math.sin(seconds * 1.7) * Math.PI) / 180,
	};
}

function tiltDown({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const progress = outCubic(localTime / Math.max(1, cut.duration));
	const amplitude =
		0.024 + unitRandom({ seed: cut.seed, salt: 98_001 }) * 0.008;
	return {
		scale: 1.035 - 0.02 * progress,
		translateY: amplitude * (1.2 - 1.6 * progress),
	};
}

function spiralIn({
	cut,
	localTime,
}: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const duration = 0.9 + unitRandom({ seed: cut.seed, salt: 99_001 }) * 0.4;
	const progress = outCubic(seconds / duration);
	const remainder = 1 - progress;
	const direction = unitRandom({ seed: cut.seed, salt: 99_002 }) > 0.5 ? 1 : -1;
	const angle =
		unitRandom({ seed: cut.seed, salt: 99_003 }) * Math.PI * 2 +
		direction * progress * Math.PI * 1.6;
	return {
		rotation: (-direction * 7 * remainder * Math.PI) / 180,
		scale:
			1 -
			0.08 * remainder +
			0.015 * clamp01(localTime / Math.max(1, cut.duration)),
		translateX: Math.cos(angle) * 0.03 * remainder,
		translateY: Math.sin(angle) * 0.035 * remainder,
	};
}

function snapPan({ cut, localTime }: BgcamCameraInput): KineticCameraTransform {
	const direction =
		unitRandom({ seed: cut.seed, salt: 100_001 }) > 0.5 ? 1 : -1;
	const amplitude =
		(0.024 + unitRandom({ seed: cut.seed, salt: 100_002 }) * 0.008) * direction;
	const whole = clamp01(localTime / Math.max(1, cut.duration));
	if (cut.duration < TICKS_PER_SECOND * 1.1) {
		return {
			scale: 1.02,
			translateX: amplitude * 0.5 * (1 - whole * 2),
		};
	}
	const at = 0.45 + unitRandom({ seed: cut.seed, salt: 100_003 }) * 0.15;
	const snapDuration = TICKS_PER_SECOND * 0.16;
	const delta = localTime - cut.duration * at;
	const progress = inOutCubic(delta / snapDuration);
	const bell =
		delta > 0 && delta < snapDuration
			? Math.sin((Math.PI * delta) / snapDuration)
			: 0;
	const drift = 0.005 * direction * (whole - 0.5);
	return {
		blur: 14 * bell,
		scale: 1.02 + 0.015 * bell,
		skewX: (-direction * 5 * bell * Math.PI) / 180,
		translateX: amplitude * (1 - progress * 2) - drift,
	};
}

function jelly({ cut, localTime }: BgcamCameraInput): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const frequency = 18 + unitRandom({ seed: cut.seed, salt: 101_001 }) * 6;
	const amplitude =
		0.045 + unitRandom({ seed: cut.seed, salt: 101_002 }) * 0.02;
	const wave = Math.exp(-seconds * 5) * Math.cos(seconds * frequency);
	return {
		scale: 1.01,
		scaleX: 1 + amplitude * wave,
		scaleY: 1 - amplitude * wave * 0.9,
		translateY: 0.008 * wave,
	};
}

function inOutSine(value: number): number {
	return -(Math.cos(Math.PI * clamp01(value)) - 1) / 2;
}
