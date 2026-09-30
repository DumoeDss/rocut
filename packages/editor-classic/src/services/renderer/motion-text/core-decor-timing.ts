import { unitRandom } from "./deterministic-random";
import type { CoreDecorDraw, CoreDecorPlan } from "./core-decor-types";

export const TICKS_PER_SECOND = 120_000;

export function coreDecorPlan({ decor, frame }: CoreDecorDraw): CoreDecorPlan {
	const cutSeed = frame.cut?.seed ?? 0;
	const seed = (cutSeed ^ Math.imul(stringSalt(decor), 0x45d9f3b)) | 0;
	const random = (salt: number) => unitRandom({ seed, salt });
	return {
		accent: random(4) < 0.4,
		big: random(5) < 0.4,
		corner: random(6) < 0.5,
		count:
			1 +
			Math.floor(random(1) * 3) +
			(decor === "shapes" ? 3 : 0) +
			(decor === "sparks" ? 4 : 0),
		from: Math.floor(random(8) * 20),
		low: random(3) < 0.5,
		mode: random(7) < 0.5 ? "count" : "index",
		right: random(2) < 0.5,
		seed,
		to: 30 + Math.floor(random(9) * 969),
	};
}

export function decorInOut(frame: CoreDecorDraw["frame"]): number {
	const entrance = outCubic(clamp01(localSeconds(frame) / 0.3));
	return entrance * exitFactor(frame);
}

export function delayedEntrance({
	frame,
	delay,
	duration,
	overshoot = 0,
}: {
	readonly frame: CoreDecorDraw["frame"];
	readonly delay: number;
	readonly duration: number;
	readonly overshoot?: number;
}): number {
	const progress = clamp01((localSeconds(frame) - delay) / duration);
	const entrance =
		overshoot > 0 ? outBack({ value: progress, overshoot }) : outExpo(progress);
	return entrance * exitFactor(frame);
}

export function localSeconds(frame: CoreDecorDraw["frame"]): number {
	return frame.localTime / TICKS_PER_SECOND;
}

export function sequenceSeconds(frame: CoreDecorDraw["frame"]): number {
	return frame.sequenceTime / TICKS_PER_SECOND;
}

export function randomUnit({
	seed,
	salt,
}: {
	readonly seed: number;
	readonly salt: number;
}): number {
	return unitRandom({ seed, salt });
}

export function randomSigned({
	seed,
	salt,
}: {
	readonly seed: number;
	readonly salt: number;
}): number {
	return randomUnit({ seed, salt }) * 2 - 1;
}

export function randomRange({
	seed,
	salt,
	minimum,
	maximum,
}: {
	readonly seed: number;
	readonly salt: number;
	readonly minimum: number;
	readonly maximum: number;
}): number {
	return minimum + (maximum - minimum) * randomUnit({ seed, salt });
}

export function noise1({
	seed,
	value,
}: {
	readonly seed: number;
	readonly value: number;
}): number {
	const index = Math.floor(value);
	const fraction = smooth(value - index);
	const first = randomUnit({ seed, salt: index + 2_000 });
	const second = randomUnit({ seed, salt: index + 2_001 });
	return first + (second - first) * fraction;
}

export function lerp({
	first,
	second,
	amount,
}: {
	readonly first: number;
	readonly second: number;
	readonly amount: number;
}): number {
	return first + (second - first) * amount;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function exitFactor(frame: CoreDecorDraw["frame"]): number {
	return 1 - clamp01(frame.exitProgress) ** 3;
}

function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function outBack({
	value,
	overshoot,
}: {
	readonly value: number;
	readonly overshoot: number;
}): number {
	const progress = clamp01(value) - 1;
	return 1 + (overshoot + 1) * progress ** 3 + overshoot * progress ** 2;
}

function smooth(value: number): number {
	const progress = clamp01(value);
	return progress * progress * (3 - 2 * progress);
}

function stringSalt(value: string): number {
	let hash = 0x811c9dc5;
	for (const character of value) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash | 0;
}
