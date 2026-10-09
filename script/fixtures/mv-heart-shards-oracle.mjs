// Original heartBuild algorithm, with Canvas calls inert: this checks numerical data, not pixels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const originalRoot = process.env.MV_HEART_ORIGINAL_ROOT;
const executable = process.env.MV_HEART_CPU_EXECUTABLE;
assert.ok(originalRoot);
assert.ok(executable);
const rgba = new Uint8ClampedArray(20 * 20 * 4).fill(255);
const noop = () => {};
const context2d = new Proxy(
	{},
	{
		get: (_target, key) =>
			key === "getImageData"
				? () => ({ data: rgba })
				: key === "createLinearGradient" || key === "createRadialGradient"
					? () => ({ addColorStop: noop })
					: noop,
	},
);
const context = vm.createContext({
	window: {},
	console,
	ImageData: class {
		constructor(data, width, height) {
			this.data =
				typeof data === "number"
					? new Uint8ClampedArray(data * width * 4)
					: data;
			this.width = typeof data === "number" ? data : width;
			this.height = typeof data === "number" ? width : height;
		}
	},
	Path2D: class {
		moveTo() {}
		lineTo() {}
		closePath() {}
	},
});
vm.runInContext(readFileSync(`${originalRoot}/core/util.js`, "utf8"), context);
context.window.Z.canvas = (width, height) => ({
	width,
	height,
	getContext: () => context2d,
});
context.window.Z.imgSync = () => ({ width: 20, height: 20 });
const glass = readFileSync(`${originalRoot}/scenes/glass.js`, "utf8");
const end = glass.indexOf(
	"  // ---------------------------------------------------------------- mode: shatter / burn",
);
assert.ok(end > 0);
vm.runInContext(
	`${glass.slice(0, end)}\nwindow.heartBuildOracle=heartBuild;window.shardPosOracle=shardPos;})();`,
	context,
);
const expected = context.window.heartBuildOracle("fixture");
const run = spawnSync(executable, [], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr);
const lines = run.stdout
	.trim()
	.split(/\r?\n/)
	.map((line) => line.split(" ").map(Number));
let cursor = 0;
let assertions = 0;
function near(actual, expected) {
	assert.ok(Number.isFinite(actual));
	assert.ok(Math.abs(actual - expected) <= 1e-8, `${actual} != ${expected}`);
	assertions++;
}
const header = lines[cursor++];
assert.equal(header[0], expected.shards.length);
near(header[1], expected.Rmax);
near(header[2], expected.Dmax);
for (const s of expected.shards) {
	const values = [
		s.px,
		s.py,
		s.cov,
		s.dist,
		s.dx,
		s.dy,
		s.rn,
		s.size,
		s.A,
		s.V,
		s.psA,
		s.psV,
		s.axis,
		s.phA,
		s.phV,
		s.z,
		s.gph,
	];
	lines[cursor++].forEach((value, index) => near(value, values[index]));
	for (const tau of [0, 0.066, 0.067, 0.2, 1.5]) {
		const pos = context.window.shardPosOracle(s, tau, 0);
		lines[cursor++].forEach((value, index) => near(value, pos[index]));
	}
}
assert.equal(cursor, lines.length);
console.log(
	JSON.stringify({
		shards: expected.shards.length,
		assertions,
		tolerance: 1e-8,
		pixelParity: false,
	}),
);
