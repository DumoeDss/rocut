/** Bounded pixel evidence for a failed full-frame gate; never changes its score. */
export function titleRiffDifferenceLocations(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
) {
	const columns = 16,
		rows = 9,
		cells = new Array<number>(columns * rows).fill(0);
	const peaks: {
		x: number;
		y: number;
		channel: number;
		actual: number;
		expected: number;
		delta: number;
	}[] = [];
	let minX = 1920,
		minY = 1080,
		maxX = -1,
		maxY = -1;
	for (let offset = 0; offset < actual.length; offset++) {
		const delta = Math.abs(actual[offset]! - expected[offset]!);
		if (delta === 0) continue;
		const pixel = Math.floor(offset / 4),
			x = pixel % 1920,
			y = Math.floor(pixel / 1920);
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		cells[Math.floor(y / 120) * columns + Math.floor(x / 120)]! += delta;
		if (peaks.length < 24 || delta > peaks.at(-1)!.delta) {
			peaks.push({
				x,
				y,
				channel: offset % 4,
				actual: actual[offset]!,
				expected: expected[offset]!,
				delta,
			});
			peaks.sort((a, b) => b.delta - a.delta);
			if (peaks.length > 24) peaks.pop();
		}
	}
	return {
		bounds: [minX, minY, maxX, maxY],
		cellSize: 120,
		columns,
		rows,
		cells,
		peaks,
	};
}
