interface MarkerRange {
	startTime: number;
	endTime: number;
}

export function mergeMotionTextMarkers<T extends MarkerRange>({
	markers,
	clipStartTime,
	clipDuration,
	width,
}: {
	markers: readonly T[];
	clipStartTime: number;
	clipDuration: number;
	width: number;
}) {
	const groups: { items: T[]; startTime: number; endTime: number }[] = [];
	const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
	if (clipDuration <= 0) return groups;
	for (const marker of [...markers].sort((a, b) => a.startTime - b.startTime)) {
		const previous = groups.at(-1);
		const distance = previous
			? ((marker.startTime - previous.startTime) / clipDuration) * safeWidth
			: Infinity;
		if (previous && distance < 8) {
			previous.items.push(marker);
			previous.endTime = Math.max(previous.endTime, marker.endTime);
		} else {
			groups.push({
				items: [marker],
				startTime: Math.max(clipStartTime, marker.startTime),
				endTime: marker.endTime,
			});
		}
	}
	return groups;
}
