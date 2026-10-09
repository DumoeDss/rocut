// Test-only exposure of unchanged original functions; no production JS implementation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const originalRoot = process.env.MV_HEART_ORIGINAL_ROOT;
const executable = process.env.MV_HEART_CPU_EXECUTABLE;
assert.ok(
	originalRoot,
	"MV_HEART_ORIGINAL_ROOT must name the original template/engine directory",
);
assert.ok(
	executable,
	"MV_HEART_CPU_EXECUTABLE must name the compiled CPU fixture",
);
const util = readFileSync(`${originalRoot}/core/util.js`, "utf8");
const glass = readFileSync(`${originalRoot}/scenes/glass.js`, "utf8");
const context = vm.createContext({ window: {}, console });
vm.runInContext(util, context);
const end = glass.indexOf("  function tracePartial(");
assert.ok(end > 0);
const source = `${glass.slice(0, end)}\nwindow.heartFractureOracle = radialFracture;})();`;
vm.runInContext(source, context);
const expected = context.window.heartFractureOracle(1807, 300, 262.3, {
	spokes: 14,
	radii: [0, 26, 62, 112, 172, 244, 330, 440, 600],
	rj: 0.14,
	wig: 0.06,
	skip: (j) => (j < 3 ? 0.15 : 0.38),
	split: 0.45,
	jag: 0.05,
	jagMax: 6,
	seg: 20,
});
const run = spawnSync(executable, [], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr);
const lines = run.stdout.trim().split(/\r?\n/);
let cursor = 0;
let assertions = 0;
function near(actual, wanted) {
	assert.ok(Number.isFinite(actual));
	assert.ok(Math.abs(actual - wanted) <= 1e-8, `${actual} != ${wanted}`);
	assertions++;
}
function point(wanted) {
	const values = lines[cursor++].split(" ").map(Number);
	near(values[0], wanted[0]);
	near(values[1], wanted[1]);
}
assert.deepEqual(lines[cursor++].split(" ").map(Number), [
	expected.edges.length,
	expected.cells.length,
]);
for (const edge of expected.edges) {
	const [tag, kind, distance, length, count] = lines[cursor++].split(" ");
	assert.equal(tag, "E");
	assert.equal(kind, edge.kind);
	near(Number(distance), edge.d0);
	near(Number(length), edge.len);
	assert.equal(Number(count), edge.pts.length);
	edge.pts.forEach(point);
}
for (const cell of expected.cells) {
	const [tag, ring, area, x, y, count] = lines[cursor++].split(" ");
	assert.equal(tag, "C");
	assert.equal(Number(ring), cell.ring);
	near(Number(area), cell.area);
	near(Number(x), cell.c[0]);
	near(Number(y), cell.c[1]);
	assert.equal(Number(count), cell.poly.length);
	cell.poly.forEach(point);
}
assert.equal(cursor, lines.length);
console.log(
	JSON.stringify({
		edges: expected.edges.length,
		cells: expected.cells.length,
		assertions,
		tolerance: 1e-8,
	}),
);
