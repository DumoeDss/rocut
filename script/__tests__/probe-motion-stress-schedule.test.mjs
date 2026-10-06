import assert from "node:assert/strict";
import { test } from "node:test";
import { createMotionStressSchedule } from "../probe-motion-stress-schedule.mjs";

test("default schedule preserves the existing thirty-picture order and minimum cycles", () => {
	const schedule = createMotionStressSchedule();
	assert.equal(schedule.cycles, 4);
	assert.deepEqual(
		schedule.referenceFrames,
		Array.from({ length: 30 }, (_, i) => ((i * 197) % 600) * 24 + 6),
	);
	for (let cycle = 0; cycle < 4; cycle++)
		assert.deepEqual(
			schedule.cycleOrder(cycle),
			Array.from({ length: 30 }, (_, i) => (i * 13 + 7 + cycle) % 30),
		);
});

test("expanded sweeps visit every cue and every selected reference exactly once per cycle", () => {
	for (const targets of [39, 120, 300, 600]) {
		const schedule = createMotionStressSchedule({ targets, cycles: 24 });
		assert.equal(new Set(schedule.referenceFrames).size, targets);
		assert(
			schedule.referenceFrames.every((frame) => frame >= 6 && frame < 14400),
		);
		for (let cycle = 0; cycle < 24; cycle++) {
			const order = schedule.cycleOrder(cycle);
			assert.equal(new Set(order).size, targets);
			assert.deepEqual(
				[...order].sort((a, b) => a - b),
				Array.from({ length: targets }, (_, i) => i),
			);
		}
	}
	const all = createMotionStressSchedule({ targets: 600 });
	assert.equal(
		new Set(all.referenceFrames.map((frame) => Math.floor(frame / 24))).size,
		600,
	);
});

test("invalid, reduced and unbounded workloads cannot silently become acceptance", () => {
	for (const targets of [0, 29, 601, 30.5, NaN, Infinity, "600"])
		assert.throws(() => createMotionStressSchedule({ targets }));
	for (const cycles of [0, 3, 25, 4.5, NaN, Infinity, "4"])
		assert.throws(() => createMotionStressSchedule({ cycles }));
	const schedule = createMotionStressSchedule();
	for (const cycle of [-1, 4, 0.5, NaN])
		assert.throws(() => schedule.cycleOrder(cycle));
});
