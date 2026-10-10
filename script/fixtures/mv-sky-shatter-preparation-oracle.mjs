// Original skyBuild geometry, deterministic piece stream, stars and ground heights.
// Canvas calls are inert. Texture/night/ground pixels are not covered by this oracle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
const root = process.env.MV_HEART_ORIGINAL_ROOT;
const executable = process.env.MV_HEART_CPU_EXECUTABLE;
assert.ok(root);
assert.ok(executable);
const noop = () => {};
const ctx = new Proxy(
	{},
	{
		get: (_target, key) =>
			key === "createLinearGradient" || key === "createRadialGradient"
				? () => ({ addColorStop: noop })
				: noop,
	},
);
const context = vm.createContext({
	window: {},
	Path2D: class {
		moveTo() {}
		lineTo() {}
		closePath() {}
	},
});
vm.runInContext(readFileSync(`${root}/core/util.js`, "utf8"), context);
context.window.Z.canvas = (width, height) => ({
	width,
	height,
	getContext: () => ctx,
});
context.window.Z.imgSync = () => ({ width: 20, height: 20 });
const source = readFileSync(`${root}/scenes/glass.js`, "utf8");
vm.runInContext(
	source.replace(/\}\)\(\);\s*$/, "window.skyBuildOracle = skyBuild;})();"),
	context,
);
const run = spawnSync(executable, [], {
	encoding: "utf8",
	maxBuffer: 16 * 1024 * 1024,
});
assert.equal(run.status, 0, run.stderr);
const actual = run.stdout
	.trim()
	.split(/\r?\n/)
	.map((line) => line.split(/\s+/).map(Number));
let row = 0;
let assertions = 0;
function compare(expected) {
	assert.equal(actual[row].length, expected.length, `row ${row} width`);
	expected.forEach((value, i) => {
		assert.ok(Number.isFinite(actual[row][i]));
		assert.ok(
			Math.abs(actual[row][i] - value) <= 1e-8,
			`row ${row} field ${i}: ${actual[row][i]} != ${value}`,
		);
		assertions++;
	});
	row++;
}
for (const [seed, ix, iy] of [
	[3913, 1150, 300],
	[7201, 960, 540],
	[0, 90, 70],
]) {
	const sky = context.window.skyBuildOracle(
		"fixture-sky",
		seed,
		ix,
		iy,
		"#070b1c",
	);
	compare([sky.pieces.length, sky.stars.length, sky.cx, sky.cy]);
	for (const p of sky.pieces)
		compare([
			p.x,
			p.y,
			p.ring,
			p.dist,
			p.near,
			p.dx,
			p.dy,
			p.ang,
			p.size,
			p.g,
			p.vx,
			p.vy,
			p.psV,
			p.psA,
			p.axis,
			p.phV,
			p.gph,
			p.jit,
			Number(p.fg),
			p.zv,
			p.spr.ox,
			p.spr.oy,
			p.spr.w,
			p.spr.h,
		]);
	for (const s of sky.stars)
		compare([s.x, s.y, s.r, s.f, s.ph, Number(s.cool)]);
	for (const x of [0, 140, 390, 960, 1210, 1920, 2200]) compare([x, sky.gy(x)]);
}
assert.equal(actual.length, row);
console.log(
	JSON.stringify({
		rows: row,
		assertions,
		tolerance: 1e-8,
		pixelParity: false,
	}),
);
