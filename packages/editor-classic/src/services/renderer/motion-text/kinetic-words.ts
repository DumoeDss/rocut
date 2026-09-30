import type { MotionTextRenderFrame } from "./types";

const TICKS_PER_SECOND = 120_000;

export function kineticWordSegments({
	text,
	maximum = 6,
}: {
	readonly text: string;
	readonly maximum?: number;
}): readonly string[] {
	const normalized = text.replace(/\s+/gu, " ").trim();
	if (!normalized) return [];
	const explicit = normalized.split(" ").filter(Boolean);
	if (explicit.length > 1) {
		return mergeOverflow({ maximum, segments: explicit });
	}
	const characters = Array.from(normalized);
	if (characters.length <= 1) return characters;
	const count = Math.min(
		maximum,
		Math.max(2, Math.ceil(characters.length / 3)),
	);
	const chunks: string[] = [];
	let offset = 0;
	for (let index = 0; index < count; index += 1) {
		const remaining = characters.length - offset;
		const take = Math.ceil(remaining / (count - index));
		chunks.push(characters.slice(offset, offset + take).join(""));
		offset += take;
	}
	return chunks;
}

export function kineticWordOnsets({
	count,
	frame,
}: {
	readonly count: number;
	readonly frame: MotionTextRenderFrame;
}): readonly number[] {
	if (count <= 0) return [];
	if (count === 1) return [0];
	const duration = frame.cut?.duration ?? TICKS_PER_SECOND;
	const last = Math.min(duration * 0.5, (count - 1) * TICKS_PER_SECOND * 0.38);
	return Array.from({ length: count }, (_, index) =>
		Math.round((last * index) / (count - 1)),
	);
}

export function currentKineticWord({
	frame,
	onsets,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly onsets: readonly number[];
}): number {
	let current = -1;
	for (const [index, onset] of onsets.entries()) {
		if (frame.localTime >= onset) current = index;
	}
	return current;
}

export function approximateTextWidth({
	text,
	size,
}: {
	readonly text: string;
	readonly size: number;
}): number {
	return (
		Array.from(text).reduce(
			(total, character) => total + (/\s/u.test(character) ? 0.34 : 0.62),
			0,
		) * size
	);
}

function mergeOverflow({
	segments,
	maximum,
}: {
	readonly segments: readonly string[];
	readonly maximum: number;
}): readonly string[] {
	if (segments.length <= maximum) return segments;
	return [
		...segments.slice(0, maximum - 1),
		segments.slice(maximum - 1).join(" "),
	];
}
