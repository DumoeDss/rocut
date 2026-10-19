import { useEffect, useMemo, useState } from "react";

export function hoverSourceTime({
	ratio,
	duration,
}: {
	ratio: number;
	duration: number;
}): number | undefined {
	if (!Number.isFinite(ratio) || !Number.isFinite(duration) || duration <= 0)
		return undefined;
	return Math.min(
		Math.max(0, duration - 0.001),
		Math.max(0, Math.min(1, ratio)) * duration,
	);
}

type HoverSample = { id: string; time: number };

export function createHoverScrubber({
	onSample,
}: {
	onSample: (sample: HoverSample | undefined) => void;
}) {
	let pending: ReturnType<typeof setTimeout> | undefined;
	let latest: HoverSample | undefined;
	const dispose = () => {
		clearTimeout(pending);
		pending = undefined;
		latest = undefined;
	};
	return {
		dispose,
		cancel() {
			dispose();
			onSample(undefined);
		},
		move({
			id,
			ratio,
			duration,
		}: {
			id: string;
			ratio: number;
			duration: number;
		}) {
			const time = hoverSourceTime({ ratio, duration });
			if (time === undefined) return;
			latest = { id, time };
			if (pending !== undefined) return;
			pending = setTimeout(() => {
				pending = undefined;
				onSample(latest);
			}, 100);
		},
	};
}

/** One pending sample and one active card per mounted media list. */
export function useHoverScrub() {
	const [sample, setSample] = useState<HoverSample>();
	const scrubber = useMemo(
		() => createHoverScrubber({ onSample: setSample }),
		[],
	);
	useEffect(() => () => scrubber.dispose(), [scrubber]);
	return { sample, ...scrubber };
}
