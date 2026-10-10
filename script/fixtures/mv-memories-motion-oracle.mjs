import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = process.env.MV_MEMORIES_ORIGINAL_ROOT;
const executable = process.env.MV_MEMORIES_MOTION_EXECUTABLE;
assert.ok(root && executable);
const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(`${root}/core/util.js`, "utf8"), context);
const source = readFileSync(`${root}/scenes/memory.js`, "utf8");
vm.runInContext(
	source.replace(
		/\}\)\(\);\s*$/,
		"window.motionOracle={slotsFor,photoPose,localToDesk};})();",
	),
	context,
);
const oracle = context.window.motionOracle;
const run = spawnSync(executable, [], { maxBuffer: 1024 * 1024 });
assert.equal(run.status, 0, run.stderr.toString());
let offset = 0,
	assertions = 0;
function compare(expected) {
	const actual = run.stdout.readDoubleLE(offset);
	offset += 8;
	assert.ok(
		Math.abs(actual - expected) <= 1e-8,
		`${offset}: ${actual} != ${expected}`,
	);
	assertions++;
}
for (const n of [1, 2, 3, 4, 6, 16]) {
	for (const [i, sl] of oracle.slotsFor(n, 45).entries()) {
		for (const v of [sl.x, sl.y, sl.r, sl.s, ...sl.from]) compare(v);
		for (const dt of [-0.43, -0.42, -0.3, -0.01, 0, 0.04, 0.3, 1]) {
			const p = oracle.photoPose({ slot: sl, idx: i }, 10, 10 + dt);
			compare(p ? 1 : 0);
			if (p) {
				for (const v of [p.x, p.y, p.r, p.s, p.hgt, p.alpha]) compare(v);
				for (const v of oracle.localToDesk(p, 302, 133)) compare(v);
			}
		}
	}
}
assert.equal(offset, run.stdout.length);
console.log(
	JSON.stringify({
		assertions,
		originalSlotsPoseLocalParity: true,
		pixelParity: false,
	}),
);
