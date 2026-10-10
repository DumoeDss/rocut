// Original unchanged bakePhoto field/renderBurn oracle. Native rasters are inert, not pixel parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
const root = process.env.MV_MEMORIES_ORIGINAL_ROOT;
const executable = process.env.MV_MEMORIES_CPU_EXECUTABLE;
assert.ok(root);
assert.ok(executable);
const noop = () => {};
const canvas = (width, height) => {
	const ctx = new Proxy(
		{
			getImageData: () => ({
				data: new Uint8ClampedArray(width * height * 4).fill(255),
			}),
			createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
			createLinearGradient: () => ({ addColorStop: noop }),
			createRadialGradient: () => ({ addColorStop: noop }),
		},
		{ get: (target, key) => target[key] ?? noop },
	);
	return { width, height, getContext: () => ctx };
};
const context = vm.createContext({
	window: {},
	ImageData: class {
		constructor(w, h) {
			this.data = new Uint8ClampedArray(w * h * 4);
		}
	},
});
vm.runInContext(readFileSync(`${root}/core/util.js`, "utf8"), context);
context.window.Z.canvas = canvas;
context.window.Z.imgSync = () => ({ width: 20, height: 20 });
const source = readFileSync(`${root}/scenes/memory.js`, "utf8");
vm.runInContext(
	source.replace(
		/\}\)\(\);\s*$/,
		"window.bakePhotoOracle=bakePhoto;window.renderBurnOracle=renderBurn;})();",
	),
	context,
);
const run = spawnSync(executable, [], { maxBuffer: 32 * 1024 * 1024 });
assert.equal(run.status, 0, run.stderr.toString());
const bytes = run.stdout;
let offset = 0;
let assertions = 0;
function float(expected, size) {
	const actual =
		size === 4 ? bytes.readFloatLE(offset) : bytes.readDoubleLE(offset);
	offset += size;
	assert.ok(
		Math.abs(actual - expected) <= 1e-8,
		`${offset}: ${actual} != ${expected}`,
	);
	assertions++;
}
function pixel(expected) {
	const actual = bytes.subarray(offset, offset + expected.length);
	offset += expected.length;
	for (let i = 0; i < expected.length; i++) {
		// RGB where alpha0 is invisible; original buffer intentionally retains preceding RGB.
		if (i % 4 !== 3 && expected[i - (i % 4) + 3] === 0) continue;
		assert.equal(actual[i], expected[i], `byte${offset - expected.length + i}`);
		assertions++;
	}
}
for (const [seed, hero, char] of [
	[45, false, null],
	[52, true, "fixture-character"],
]) {
	const p = context.window.bakePhotoOracle(
		{ bg: "fixture-photo" },
		0,
		char,
		seed,
		hero,
	);
	float(p.faceLevel, 8);
	for (const v of p.F) float(v, 4);
	for (const v of p.N2) float(v, 4);
	for (const s of [...p.ash, ...p.sparks])
		for (const v of [s.u, s.v, s.f, s.k]) float(v, 8);
	for (const [b, t] of [
		[-0.02, 4],
		[0.2, 5],
		[0.7, 6],
		[1.06, 7],
	]) {
		context.window.renderBurnOracle(p, b, t);
		pixel(p.keep.id.data);
		pixel(p.over.id.data);
		pixel(p.glow.id.data);
	}
}
assert.equal(offset, bytes.length);
console.log(
	JSON.stringify({
		assertions,
		fieldAndBurnBufferParity: true,
		pixelParity: false,
	}),
);
