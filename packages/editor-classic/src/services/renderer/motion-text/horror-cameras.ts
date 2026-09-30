import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import { signedRandom, unitRandom } from "./deterministic-random";
import { clamp01, outBack, TICKS_PER_SECOND } from "./horror-frame-utils";
import type { KineticCameraTransform } from "./kinetic-cameras";

export function resolveHorrorCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform | null {
	switch (cut.preset.cam) {
		case "hrNervous":
			return nervousCamera({ cut, localTime });
		case "hrDutchSnap":
			return dutchSnapCamera({ cut, localTime });
		default:
			return null;
	}
}

function nervousCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const seconds = localTime / TICKS_PER_SECOND;
	const lowStep = Math.floor(seconds * 9);
	const highStep = Math.floor(seconds * 23);
	let translateX =
		signedRandom({ seed: cut.seed, salt: 901 + lowStep }) * 0.006 +
		signedRandom({ seed: cut.seed, salt: 1901 + highStep }) * 0.0035;
	let translateY =
		signedRandom({ seed: cut.seed, salt: 2901 + lowStep }) * 0.007 +
		signedRandom({ seed: cut.seed, salt: 3901 + highStep }) * 0.004 +
		Math.sin(seconds * 2.2) * 0.004;
	let rotation =
		(signedRandom({ seed: cut.seed, salt: 4901 + lowStep }) * 1.2 * Math.PI) /
		180;
	const cycleTicks = Math.round(TICKS_PER_SECOND * 1.6);
	const cycle = Math.floor(localTime / cycleTicks);
	const cycleProgress = (localTime - cycle * cycleTicks) / cycleTicks;
	const trigger = unitRandom({ seed: cut.seed, salt: 5901 + cycle });
	const start = unitRandom({ seed: cut.seed, salt: 6901 + cycle }) * 0.6;
	const since = cycleProgress - start;
	if (trigger < 0.65 && since > 0 && since < 0.32) {
		const decay = Math.exp(-since * 18);
		translateX +=
			signedRandom({ seed: cut.seed, salt: 7901 + cycle }) * 0.025 * decay;
		translateY +=
			signedRandom({ seed: cut.seed, salt: 8901 + cycle }) * 0.03 * decay;
		rotation +=
			(signedRandom({ seed: cut.seed, salt: 9901 + cycle }) *
				3 *
				Math.PI *
				decay) /
			180;
	}
	return { scale: 1.03, translateX, translateY, rotation };
}

function dutchSnapCamera({
	cut,
	localTime,
}: {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}): KineticCameraTransform {
	const at = 0.45 + unitRandom({ seed: cut.seed, salt: 911 }) * 0.2;
	const amplitude = 3 + unitRandom({ seed: cut.seed, salt: 912 }) * 1.8;
	const direction = unitRandom({ seed: cut.seed, salt: 913 }) >= 0.5 ? 1 : -1;
	const snapTicks = Math.max(1, TICKS_PER_SECOND * 0.1);
	const snap = outBack({
		value: (localTime - cut.duration * at) / snapTicks,
		overshoot: 2.5,
	});
	const whole = clamp01(localTime / Math.max(1, cut.duration));
	return {
		rotation: (amplitude * direction * Math.PI * snap) / 180,
		scale: 1 + 0.045 * Math.sin(Math.PI * whole) + 0.02 * snap,
		translateY: -0.006 * snap,
	};
}
