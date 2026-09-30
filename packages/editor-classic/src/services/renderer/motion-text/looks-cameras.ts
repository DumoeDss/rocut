import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import { signedRandom, unitRandom } from "./deterministic-random";
import type { KineticCameraTransform } from "./kinetic-cameras";

const TICKS_PER_SECOND = 120_000;

interface LooksCameraInput {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}

export function resolveLooksCamera(
	input: LooksCameraInput,
): KineticCameraTransform | null {
	switch (input.cut.preset.cam) {
		case "pullOut":
			return pullOut(input);
		case "panL":
			return pan({ direction: 1, input });
		case "panR":
			return pan({ direction: -1, input });
		case "tiltUp":
			return tiltUp(input);
		case "dutch":
			return dutch(input);
		case "handheld":
			return handheld(input);
		case "beatPunch":
			return beatPunch(input);
		case "whipIn":
			return whipIn(input);
		case "crashZoom":
			return crashZoom(input);
		case "bounce":
			return bounce(input);
		case "roll":
			return roll(input);
		case "driftDiag":
			return driftDiag(input);
		case "shakeHard":
			return shakeHard(input);
		case "dollyIn":
			return dollyIn(input);
		case "stepZoom":
			return stepZoom(input);
		default:
			return null;
	}
}

function whole(input: LooksCameraInput): number {
	return clamp01(input.localTime / Math.max(1, input.cut.duration));
}

function pullOut(input: LooksCameraInput): KineticCameraTransform {
	const amplitude =
		0.06 + unitRandom({ seed: input.cut.seed, salt: 1401 }) * 0.03;
	return { scale: 1 + amplitude * (1 - outCubic(whole(input))) };
}

function pan({
	direction,
	input,
}: {
	readonly direction: 1 | -1;
	readonly input: LooksCameraInput;
}): KineticCameraTransform {
	const amplitude =
		0.018 + unitRandom({ seed: input.cut.seed, salt: 1411 }) * 0.01;
	const progress = whole(input);
	const eased = progress * 0.6 + inOutSine(progress) * 0.4;
	return {
		scale: 1.02,
		translateX: (eased - 0.5) * 2 * amplitude * direction,
	};
}

function tiltUp(input: LooksCameraInput): KineticCameraTransform {
	const amplitude =
		0.02 + unitRandom({ seed: input.cut.seed, salt: 1421 }) * 0.01;
	const progress = whole(input);
	const eased = progress * 0.6 + inOutSine(progress) * 0.4;
	return { scale: 1.02, translateY: (eased - 0.5) * 2 * amplitude };
}

function dutch(input: LooksCameraInput): KineticCameraTransform {
	const direction =
		unitRandom({ seed: input.cut.seed, salt: 1431 }) > 0.5 ? 1 : -1;
	const degrees = 2.5 + unitRandom({ seed: input.cut.seed, salt: 1432 }) * 2;
	const progress = inOutSine(clamp01(whole(input) / 0.8));
	return {
		rotation: (direction * degrees * progress * Math.PI) / 180,
		scale: 1 + 0.03 * whole(input),
	};
}

function handheld(input: LooksCameraInput): KineticCameraTransform {
	const seconds = input.localTime / TICKS_PER_SECOND;
	const frequency =
		0.8 + unitRandom({ seed: input.cut.seed, salt: 1441 }) * 0.5;
	const step = Math.floor(seconds * 18 * frequency);
	const driftX = Math.sin(seconds * 2.1 + input.cut.seed) * 0.004;
	const driftY = Math.sin(seconds * 1.7 + input.cut.seed * 0.7) * 0.005;
	return {
		rotation:
			((signedRandom({ seed: input.cut.seed, salt: 14_500 + step }) * 0.45 +
				Math.sin(seconds * 1.2) * 0.25) *
				Math.PI) /
			180,
		scale: 1.012,
		translateX:
			driftX +
			signedRandom({ seed: input.cut.seed, salt: 14_600 + step }) * 0.003,
		translateY:
			driftY +
			signedRandom({ seed: input.cut.seed, salt: 14_700 + step }) * 0.004,
	};
}

function beatPunch(input: LooksCameraInput): KineticCameraTransform {
	const seconds = input.localTime / TICKS_PER_SECOND;
	const beatLength = 0.5;
	const since = ((seconds % beatLength) + beatLength) % beatLength;
	const pulse = Math.exp(-since * 9);
	const amplitude =
		0.03 + unitRandom({ seed: input.cut.seed, salt: 1451 }) * 0.015;
	return {
		scale: 1 + amplitude * pulse,
		translateY: -0.004 * pulse,
	};
}

function whipIn(input: LooksCameraInput): KineticCameraTransform {
	const seconds = input.localTime / TICKS_PER_SECOND;
	const remainder = 1 - outExpo(seconds / 0.3);
	const axis = unitRandom({ seed: input.cut.seed, salt: 1461 }) > 0.28;
	const direction =
		unitRandom({ seed: input.cut.seed, salt: 1462 }) > 0.5 ? 1 : -1;
	const amplitude =
		0.16 + unitRandom({ seed: input.cut.seed, salt: 1463 }) * 0.08;
	return {
		blur: 22 * remainder,
		scale: 1 + 0.04 * remainder,
		skewX: axis ? (direction * 9 * remainder * Math.PI) / 180 : 0,
		translateX: axis ? direction * amplitude * remainder : 0,
		translateY: axis ? 0 : direction * amplitude * 0.7 * remainder,
	};
}

function crashZoom(input: LooksCameraInput): KineticCameraTransform {
	const at = 0.6 + unitRandom({ seed: input.cut.seed, salt: 1471 }) * 0.15;
	const center = Math.max(
		input.cut.duration * at,
		input.cut.duration - TICKS_PER_SECOND * 0.6,
	);
	const delta = (input.localTime - center) / TICKS_PER_SECOND;
	if (delta < 0) return { scale: 0.992 + 0.008 * clamp01(delta / 0.25 + 1) };
	const progress = outExpo(delta / 0.1);
	const shake = Math.exp(-delta * 6) * progress;
	const step = Math.floor(input.localTime / (TICKS_PER_SECOND / 24));
	return {
		blur: 12 * Math.max(0, 1 - Math.abs(delta - 0.05) / 0.08),
		scale:
			1 +
			(0.08 + unitRandom({ seed: input.cut.seed, salt: 1472 }) * 0.03) *
				progress,
		translateX:
			signedRandom({ seed: input.cut.seed, salt: 14_800 + step }) *
			0.004 *
			shake,
		translateY:
			signedRandom({ seed: input.cut.seed, salt: 14_900 + step }) *
			0.004 *
			shake,
	};
}

function bounce(input: LooksCameraInput): KineticCameraTransform {
	const seconds = input.localTime / TICKS_PER_SECOND;
	const decay = Math.exp(-seconds * 5.5);
	const amplitude =
		0.045 + unitRandom({ seed: input.cut.seed, salt: 1501 }) * 0.02;
	return {
		scale: 1 - amplitude * decay * Math.cos(seconds * 16),
		translateY: -0.012 * decay * Math.sin(seconds * 16),
	};
}

function roll(input: LooksCameraInput): KineticCameraTransform {
	const direction =
		unitRandom({ seed: input.cut.seed, salt: 1511 }) > 0.5 ? 1 : -1;
	const degrees = 2.5 + unitRandom({ seed: input.cut.seed, salt: 1512 }) * 1.5;
	return {
		rotation: (direction * (whole(input) - 0.5) * degrees * Math.PI) / 180,
		scale: 1.025,
	};
}

function driftDiag(input: LooksCameraInput): KineticCameraTransform {
	const directionX =
		unitRandom({ seed: input.cut.seed, salt: 1521 }) > 0.5 ? 1 : -1;
	const directionY =
		unitRandom({ seed: input.cut.seed, salt: 1522 }) > 0.5 ? 1 : -1;
	const progress = inOutSine(whole(input)) * 0.5 + whole(input) * 0.5;
	return {
		scale: 1.02 + progress * 0.025,
		translateX: (progress - 0.5) * 0.035 * directionX,
		translateY: (progress - 0.5) * 0.03 * directionY,
	};
}

function shakeHard(input: LooksCameraInput): KineticCameraTransform {
	const seconds = input.localTime / TICKS_PER_SECOND;
	const amplitude = Math.exp(-seconds * 4.5);
	const step = Math.floor(seconds * 24);
	return {
		blur: 2.5 * amplitude,
		rotation:
			(signedRandom({ seed: input.cut.seed, salt: 15_300 + step }) *
				1.6 *
				amplitude *
				Math.PI) /
			180,
		scale: 1 + 0.03 * amplitude,
		translateX:
			signedRandom({ seed: input.cut.seed, salt: 15_400 + step }) *
			0.022 *
			amplitude,
		translateY:
			signedRandom({ seed: input.cut.seed, salt: 15_500 + step }) *
			0.02 *
			amplitude,
	};
}

function dollyIn(input: LooksCameraInput): KineticCameraTransform {
	const amplitude =
		0.08 + unitRandom({ seed: input.cut.seed, salt: 1561 }) * 0.03;
	const progress = whole(input) ** 3;
	return { scale: 1 + amplitude * progress, translateY: -0.008 * progress };
}

function stepZoom(input: LooksCameraInput): KineticCameraTransform {
	const steps = unitRandom({ seed: input.cut.seed, salt: 1571 }) > 0.5 ? 3 : 2;
	const amplitude =
		0.035 + unitRandom({ seed: input.cut.seed, salt: 1572 }) * 0.01;
	let scale = 1;
	let blur = 0;
	for (let index = 0; index < steps; index += 1) {
		const at = input.cut.duration * ((index + 1) / (steps + 1));
		const delta = (input.localTime - at) / TICKS_PER_SECOND;
		if (delta < 0) continue;
		scale += amplitude * outExpo(delta / 0.07);
		blur += 5 * (1 - clamp01(delta / 0.06));
	}
	return { blur, scale: Math.min(1.15, scale) };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function inOutSine(value: number): number {
	return -(Math.cos(Math.PI * clamp01(value)) - 1) / 2;
}
