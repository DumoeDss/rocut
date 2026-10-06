import assert from "node:assert/strict";

export function createMotionStressSchedule({ cycles = 4, targets = 30 } = {}) {
	assert(
		Number.isInteger(cycles) && cycles >= 4 && cycles <= 24,
		"F05 cycles must be an integer from 4 to 24; do not reduce the baseline",
	);
	assert(
		Number.isInteger(targets) && targets >= 30 && targets <= 600,
		"F05 targets must be an integer from 30 to 600; do not reduce the baseline",
	);
	const gcd = (left, right) => (right === 0 ? left : gcd(right, left % right));
	let stride = 13;
	while (gcd(stride, targets) !== 1) stride++;
	return {
		cycles,
		targets,
		referenceFrames: Array.from(
			{ length: targets },
			(_, i) => ((i * 197) % 600) * 24 + 6,
		),
		cycleOrder: (cycle) => {
			assert(Number.isInteger(cycle) && cycle >= 0 && cycle < cycles);
			return Array.from(
				{ length: targets },
				(_, i) => (i * stride + 7 + cycle) % targets,
			);
		},
	};
}
