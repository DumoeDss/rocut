import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recorder } from "./mv-road-oracle-runtime.mjs";
const source = readFileSync(
	new URL(
		"../../packages/editor-classic/src/services/renderer/programmatic/mv-road-renderer.ts",
		import.meta.url,
	),
	"utf8",
);
const native = new Function(
	source.replace("export const", "const") + ";return MV_ROAD_RENDERER_SOURCE;",
)();
const steps = new Function(`${native};return drawMvRoadSteps;`)();
test("Road native cancellation unwinds state and releases allocated scratch", () => {
	const record = recorder(),
		root = record.make(1920, 1080, "main"),
		surfaces = [];
	const iterator = steps(
		root.getContext(),
		{
			commands: [
				{ kind: "native", target: "main", action: { kind: "save" } },
				{ kind: "surface", id: "test", size: [128, 128] },
				{
					kind: "native",
					target: "main",
					action: { kind: "translate", offset: [50, 80] },
				},
			],
		},
		{},
		(w, h) => {
			const c = record.make(w, h, "test");
			surfaces.push(c);
			return c;
		},
	);
	iterator.next();
	iterator.next();
	iterator.next();
	iterator.return();
	assert.equal(surfaces[0].width, 1);
	assert.equal(surfaces[0].height, 1);
	assert.deepEqual(root.getContext().getTransform(), {
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		e: 0,
		f: 0,
	});
});
test("Road native replay refuses implicit assets and wrongly-sized targets", () => {
	const record = recorder(),
		ctx = record.make(1920, 1080, "main").getContext();
	assert.throws(
		() =>
			Array.from(
				steps(
					ctx,
					{
						commands: [
							{
								kind: "native",
								target: "main",
								action: {
									kind: "image",
									source: "fallback",
									sourceKind: "asset",
									sourceRect: null,
									destinationRect: [0, 0, 20, 20],
									intrinsic: false,
								},
							},
						],
					},
					{},
				),
			),
		/descriptor/,
	);
	assert.throws(
		() =>
			Array.from(
				steps(
					record.make(128, 128, "wrong").getContext(),
					{ commands: [] },
					{},
				),
			),
		/1920x1080/,
	);
	assert.throws(
		() =>
			Array.from(
				steps(
					ctx,
					{ commands: [{ kind: "surface", id: "small", size: [128, 128] }] },
					{},
					() => record.make(64, 64),
				),
			),
		/dimensions mismatch/,
	);
});
