import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { recorder, original } from "./mv-road-oracle-runtime.mjs";
const source = readFileSync(
	new URL(
		"../../packages/editor-classic/src/services/renderer/programmatic/mv-road-renderer.ts",
		import.meta.url,
	),
	"utf8",
);
const renderer = new Function(
	source.replace("export const", "const") + ";return MV_ROAD_RENDERER_SOURCE;",
)();
const draw = new Function(`${renderer};return drawMvRoad;`)();
const root = process.env.MV_ROAD_ORIGINAL_ROOT;
assert.ok(root);
let rows;
if (process.env.MV_ROAD_ARTIFACT_PATH)
	rows = JSON.parse(readFileSync(process.env.MV_ROAD_ARTIFACT_PATH, "utf8"));
else {
	assert.ok(process.env.MV_ROAD_CPU_EXECUTABLE);
	const run = spawnSync(process.env.MV_ROAD_CPU_EXECUTABLE, [], {
		maxBuffer: 64 * 1024 * 1024,
		env: {
			...process.env,
			TEMP: "E:/Elftia-private-tests/rocut-ink-20261009-F0U4dW/temp",
			TMP: "E:/Elftia-private-tests/rocut-ink-20261009-F0U4dW/temp",
		},
	});
	assert.equal(run.status, 0, run.stderr.toString());
	rows = JSON.parse(run.stdout);
}
let assertions = 0;
function compare(actual, expected, path) {
	assertions++;
	if (typeof expected === "number")
		assert.ok(
			Math.abs(actual - expected) <= 1e-8,
			`${path}: ${actual} != ${expected}`,
		);
	else if (Array.isArray(expected)) {
		assert.equal(actual.length, expected.length, path);
		expected.forEach((v, i) => compare(actual[i], v, `${path}[${i}]`));
	} else if (expected && typeof expected === "object") {
		assert.deepEqual(
			Object.keys(actual).sort(),
			Object.keys(expected).sort(),
			path,
		);
		for (const k of Object.keys(expected))
			compare(actual[k], expected[k], `${path}.${k}`);
	} else assert.equal(actual, expected, path);
}
for (const row of rows) {
	const expected = recorder();
	original(root, row, expected);
	const actual = recorder(),
		ctx = actual.make(1920, 1080, "main").getContext(),
		fg = actual.make(1920, 1080, "foreground").getContext();
	const surfaces = row.plan.commands.filter(
		(command) => command.kind === "surface",
	);
	let surfaceIndex = 0;
	draw(
		ctx,
		row.plan,
		{
			descriptor: () => ({ kind: "image" }),
			image: () => ({
				width: row.character?.width ?? 320,
				height: row.character?.height ?? 640,
				label: "runner.png",
			}),
		},
		(width, height) => actual.make(width, height, surfaces[surfaceIndex++].id),
		fg,
	);
	compare(actual.calls, expected.calls, `${row.args.mode}@${row.t}`);
}
console.log(
	JSON.stringify({
		frames: rows.length,
		assertions,
		tolerance: 1e-8,
		completeNativeDrawingTrace: true,
		nativePixelParity: false,
	}),
);
