// Original unchanged gatherPlan, exposed only for a CPU numerical oracle. Not pixels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
const root = process.env.MV_HEART_ORIGINAL_ROOT;
const executable = process.env.MV_HEART_CPU_EXECUTABLE;
assert.ok(root);
assert.ok(executable);
const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(`${root}/core/util.js`, "utf8"), context);
const source = readFileSync(`${root}/scenes/glass.js`, "utf8");
vm.runInContext(
	source.replace(/\}\)\(\);\s*$/, "window.gatherPlan = gatherPlan;})();"),
	context,
);
const shards = Array.from({ length: 32 }, (_, index) => ({
	index,
	cov: ((index * 7) % 11) + 1,
}));
const beats = [0, 0.49, 1.01, 1.54, 2.02, 2.57];
const result = spawnSync(executable, [], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const actual = result.stdout
	.trim()
	.split(/\r?\n/)
	.map((line) => line.split(/\s+/).map(Number));
let row = 0;
let assertions = 0;
for (const [t0, t1] of [
	[0, 2.2],
	[1.5, 3.8],
	[4, 6],
]) {
	const plan = context.window.gatherPlan(
		{ clock: { beats, spb: 0.51 } },
		{ shards },
		24,
		t0,
		t1,
	);
	for (const q of plan) {
		const expected = [
			q.s.index,
			q.k,
			q.ta,
			q.T,
			q.th,
			q.rho,
			Number(q.far),
			q.side,
			q.bend,
			q.sz,
			q.psi0,
			q.phi0,
			q.phw,
			Number(q.toHand),
			q.rn,
		];
		assert.equal(actual[row].length, expected.length);
		expected.forEach((value, i) => {
			assert.ok(
				Math.abs(actual[row][i] - value) < 1e-10,
				`row ${row} field ${i}: ${actual[row][i]} != ${value}`,
			);
			assertions++;
		});
		row++;
	}
}
assert.equal(actual.length, row);
console.log(
	`Original gatherPlan: ${row} arrivals / ${assertions} assertions green; CPU data only.`,
);
